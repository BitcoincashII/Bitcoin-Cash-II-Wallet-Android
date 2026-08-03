/**
 * BCH2 App Password Screen
 * Set/remove an app-level password stored via AsyncStorage
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha256';
import { scrypt } from '@noble/hashes/scrypt';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import ReactNativeBiometrics from 'react-native-biometrics';
import { randomBytes } from '../../class/rng';
import { BCH2Colors, BCH2Spacing, BCH2Typography, BCH2BorderRadius } from '../../components/BCH2Theme';

const APP_PASSWORD_KEY = '@bch2_app_password';
const BIOMETRIC_ENABLED_KEY = '@bch2_biometric_enabled';
const AUTO_LOCK_TIMEOUT_KEY = '@bch2_auto_lock_timeout';

const MIN_PASSWORD_LENGTH = 6;
// scrypt params: memory-hard, ~sub-second on-device for a one-shot unlock.
const SCRYPT_PARAMS = { N: 2 ** 14, r: 8, p: 1, dkLen: 32 } as const;

const rnBiometrics = new ReactNativeBiometrics({ allowDeviceCredentials: true });

// Constant-time comparison of two equal-length hex strings.
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function derivePasswordHash(password: string, saltHex: string): string {
  return bytesToHex(scrypt(new TextEncoder().encode(password), hexToBytes(saltHex), SCRYPT_PARAMS));
}

// Persist a password as a salted scrypt record: {"v":2,"salt":hex,"hash":hex}.
async function persistPassword(password: string): Promise<void> {
  const salt = bytesToHex(await randomBytes(16));
  const hash = derivePasswordHash(password, salt);
  await AsyncStorage.setItem(APP_PASSWORD_KEY, JSON.stringify({ v: 2, salt, hash }));
}

// --- Biometric helpers ---

export async function isBiometricAvailable(): Promise<{ available: boolean; biometryType?: string }> {
  try {
    const { available, biometryType } = await rnBiometrics.isSensorAvailable();
    return { available, biometryType: biometryType || undefined };
  } catch {
    return { available: false };
  }
}

export async function isBiometricEnabled(): Promise<boolean> {
  const val = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
  return val === '1';
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, enabled ? '1' : '');
}

export async function authenticateWithBiometric(): Promise<boolean> {
  try {
    const { available } = await rnBiometrics.isSensorAvailable();
    if (!available) return false;
    const { success } = await rnBiometrics.simplePrompt({ promptMessage: 'Confirm your identity' });
    return success;
  } catch {
    return false;
  }
}

/**
 * Gate a sensitive action (e.g. revealing the recovery phrase) behind re-auth.
 * Returns:
 *  - 'ok'            — authenticated (biometric/device credential) or no lock configured
 *  - 'need-password' — biometric unavailable but an app password is set; the
 *                      caller must collect and verify the password
 *  - 'denied'        — a lock is configured but authentication failed
 */
export async function requireReauth(): Promise<'ok' | 'need-password' | 'denied'> {
  const bioEnabled = await isBiometricEnabled();
  const passwordSet = await isAppPasswordSet();
  if (!bioEnabled && !passwordSet) return 'ok'; // nothing to authenticate against
  if (bioEnabled) {
    return (await authenticateWithBiometric()) ? 'ok' : (passwordSet ? 'need-password' : 'denied');
  }
  // Password-only: try device credential first (covers most devices), else prompt.
  if (await authenticateWithBiometric()) return 'ok';
  return 'need-password';
}

// --- Auto-lock timeout helpers ---
// Values in seconds: 0 = immediate, 30, 60, 300, -1 = never
export async function getAutoLockTimeout(): Promise<number> {
  const val = await AsyncStorage.getItem(AUTO_LOCK_TIMEOUT_KEY);
  if (val === null) return 0; // default: immediate
  return parseInt(val, 10);
}

export async function setAutoLockTimeout(seconds: number): Promise<void> {
  await AsyncStorage.setItem(AUTO_LOCK_TIMEOUT_KEY, String(seconds));
}

export async function getAppPassword(): Promise<string | null> {
  return AsyncStorage.getItem(APP_PASSWORD_KEY);
}

export async function isAppPasswordSet(): Promise<boolean> {
  return !!(await AsyncStorage.getItem(APP_PASSWORD_KEY));
}

/** Set (or replace) the app-lock password. Stored as a salted scrypt record. */
export async function setAppPassword(password: string): Promise<void> {
  await persistPassword(password);
}

export async function verifyAppPassword(input: string): Promise<boolean> {
  const stored = await AsyncStorage.getItem(APP_PASSWORD_KEY);
  if (!stored) return false; // Fail closed — no password means the password path cannot unlock.
  // v2: salted scrypt.
  try {
    const parsed = JSON.parse(stored);
    if (parsed && parsed.v === 2 && typeof parsed.salt === 'string' && typeof parsed.hash === 'string') {
      const hash = derivePasswordHash(input, parsed.salt);
      return timingSafeEqualHex(hash, parsed.hash);
    }
  } catch {
    // not JSON — fall through to legacy check
  }
  // Legacy v1: unsalted single-round SHA-256 hex. Verify, then transparently
  // upgrade to a salted scrypt record on success.
  const legacyHash = bytesToHex(sha256(new TextEncoder().encode(input)));
  if (stored.length === legacyHash.length && timingSafeEqualHex(legacyHash, stored)) {
    try { await persistPassword(input); } catch {}
    return true;
  }
  return false;
}

interface Props {
  navigation?: any;
}

const BCH2AppPassword: React.FC<Props> = ({ navigation }) => {
  const [hasPassword, setHasPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    checkPasswordStatus();
  }, []);

  const checkPasswordStatus = async () => {
    const stored = await AsyncStorage.getItem(APP_PASSWORD_KEY);
    setHasPassword(!!stored);
    setLoading(false);
  };

  const handleSetPassword = async () => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      Alert.alert('Error', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }
    await persistPassword(newPassword);
    setHasPassword(true);
    setNewPassword('');
    setConfirmPassword('');
    Alert.alert('Success', 'App password has been set. You will be asked for it when opening the app.');
  };

  const handleRemovePassword = async () => {
    // Require the current password before removing the lock (fail closed).
    if (!(await verifyAppPassword(currentPassword))) {
      Alert.alert('Error', 'Current password is incorrect');
      return;
    }
    await AsyncStorage.removeItem(APP_PASSWORD_KEY);
    setHasPassword(false);
    setCurrentPassword('');
    Alert.alert('Success', 'App password has been removed.');
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={BCH2Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {hasPassword ? (
        <View style={styles.section}>
          <Text style={styles.title}>Remove App Password</Text>
          <Text style={styles.description}>
            Enter your current password to remove it.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Current password"
            placeholderTextColor={BCH2Colors.textMuted}
            secureTextEntry
            value={currentPassword}
            onChangeText={setCurrentPassword}
            autoFocus
          />
          <TouchableOpacity
            style={[styles.button, styles.dangerButton]}
            onPress={handleRemovePassword}
          >
            <Text style={styles.buttonText}>Remove Password</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={styles.title}>Set App Password</Text>
          <Text style={styles.description}>
            Protect the app with a password. You will be asked for it each time you open the app.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="New password"
            placeholderTextColor={BCH2Colors.textMuted}
            secureTextEntry
            value={newPassword}
            onChangeText={setNewPassword}
            autoFocus
          />
          <TextInput
            style={styles.input}
            placeholder="Confirm password"
            placeholderTextColor={BCH2Colors.textMuted}
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />
          <TouchableOpacity
            style={styles.button}
            onPress={handleSetPassword}
          >
            <Text style={styles.buttonText}>Set Password</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BCH2Colors.background,
    padding: BCH2Spacing.lg,
  },
  section: {
    marginTop: BCH2Spacing.xl,
  },
  title: {
    fontSize: BCH2Typography.fontSize.xl,
    fontWeight: BCH2Typography.fontWeight.bold as any,
    color: BCH2Colors.textPrimary,
    marginBottom: BCH2Spacing.sm,
  },
  description: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textSecondary,
    marginBottom: BCH2Spacing.lg,
    lineHeight: 20,
  },
  input: {
    backgroundColor: BCH2Colors.backgroundSecondary,
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.md,
    fontSize: BCH2Typography.fontSize.md,
    color: BCH2Colors.textPrimary,
    marginBottom: BCH2Spacing.md,
    borderWidth: 1,
    borderColor: BCH2Colors.border,
  },
  button: {
    backgroundColor: BCH2Colors.primary,
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.md,
    alignItems: 'center',
    marginTop: BCH2Spacing.sm,
  },
  dangerButton: {
    backgroundColor: BCH2Colors.error,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: BCH2Typography.fontSize.md,
    fontWeight: BCH2Typography.fontWeight.semibold as any,
  },
});

export default BCH2AppPassword;
