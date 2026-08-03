/**
 * BCH2 App Entry Point
 * Main app with BCH2 navigation
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { StatusBar, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, AppState } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BCH2Navigator } from './navigation/BCH2Navigator';
import { BCH2Colors } from './components/BCH2Theme';
import BCH2Electrum from './blue_modules/BCH2Electrum';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  isAppPasswordSet,
  verifyAppPassword,
  isBiometricAvailable,
  isBiometricEnabled,
  authenticateWithBiometric,
  getAutoLockTimeout,
  readUnlockAttempts,
  readLockedUntil,
  recordFailedAttempt,
  clearFailedAttempts,
} from './screen/bch2/BCH2AppPassword';

// BCH2 Dark Theme
const BCH2Theme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: BCH2Colors.primary,
    background: BCH2Colors.background,
    card: BCH2Colors.backgroundCard,
    text: BCH2Colors.textPrimary,
    border: BCH2Colors.border,
    notification: BCH2Colors.primary,
  },
};

const BCH2App: React.FC = () => {
  const [isConnecting, setIsConnecting] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'offline' | 'connecting'>('connecting');
  const [locked, setLocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [biometricType, setBiometricType] = useState<string | undefined>(undefined);
  const [biometricReady, setBiometricReady] = useState(false);
  const [passwordConfigured, setPasswordConfigured] = useState(false);
  const [unlockAttempts, setUnlockAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  // Background re-lock refs (avoid stale closures)
  const appState = useRef(AppState.currentState);
  const backgroundTimestamp = useRef<number | null>(null);
  const unlockedRef = useRef(false);           // true once the user has unlocked this session
  const lockConfiguredRef = useRef(false);     // password set OR biometric enabled
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    initializeApp();
  }, []);

  // Auto-lock on background — single listener, uses refs to avoid stale state.
  // Locking is driven by whether a lock is CONFIGURED, not by whether the user
  // happened to pass through an unlock this session (so enabling a lock and then
  // backgrounding always re-locks).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      try {
        if (appState.current === 'active' && (nextAppState === 'inactive' || nextAppState === 'background')) {
          backgroundTimestamp.current = Date.now();
        } else if (appState.current !== 'active' && nextAppState === 'active') {
          if (!lockedRef.current) {
            const passwordSet = await isAppPasswordSet();
            const bioEnabled = await isBiometricEnabled();
            const lockConfigured = passwordSet || bioEnabled;
            lockConfiguredRef.current = lockConfigured;
            if (lockConfigured) {
              const timeout = await getAutoLockTimeout();
              if (timeout !== -1) {
                const elapsed = backgroundTimestamp.current
                  ? (Date.now() - backgroundTimestamp.current) / 1000
                  : Infinity;
                if (elapsed >= timeout) {
                  setPasswordConfigured(passwordSet);
                  setUnlockAttempts(await readUnlockAttempts());
                  setLockedUntil(await readLockedUntil());
                  setLocked(true);
                  setPasswordInput('');
                  setPasswordError('');
                  if (bioEnabled) {
                    setTimeout(() => tryBiometricUnlock(), 300);
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        // FAIL CLOSED: if we can't determine lock status on resume and a lock
        // was ever configured, re-lock rather than leave the wallet open.
        console.log('Auto-lock error:', e);
        if (lockConfiguredRef.current && !lockedRef.current) {
          setPasswordConfigured(true);
          setLocked(true);
          setPasswordInput('');
          setPasswordError('');
        }
      }
      appState.current = nextAppState;
    });
    return () => subscription.remove();
  }, []);

  // While locked out, tick every second so the countdown updates and the
  // Unlock button re-enables when the lockout expires.
  useEffect(() => {
    if (!locked || lockedUntil <= now) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [locked, lockedUntil, now]);

  const initializeApp = async () => {
    setIsConnecting(true);
    // FAIL CLOSED: assume locked until we POSITIVELY determine no lock is
    // configured. If the lock-status probe throws (AsyncStorage error/corruption),
    // the app must NOT fall through to an unlocked wallet.
    setLocked(true);
    try {
      const passwordSet = await isAppPasswordSet();
      const bioEnabled = await isBiometricEnabled();
      const { available, biometryType } = await isBiometricAvailable();

      setPasswordConfigured(passwordSet);
      lockConfiguredRef.current = passwordSet || bioEnabled;

      if (available && bioEnabled) {
        setBiometricType(biometryType);
        setBiometricReady(true);
      }

      if (passwordSet || bioEnabled) {
        setUnlockAttempts(await readUnlockAttempts());
        setLockedUntil(await readLockedUntil());
        // stays locked (set above); auto-trigger biometric if available
        if (available && bioEnabled) {
          setTimeout(() => tryBiometricUnlock(), 400);
        }
      } else {
        // Definitive result: no lock configured — unlock the session.
        unlockedRef.current = true;
        setLocked(false);
      }
      setConnectionStatus('connected');
    } catch (error) {
      // Could not determine lock status — stay LOCKED (fail closed), never open.
      console.log('Lock-status probe failed; staying locked (fail-closed)');
      setConnectionStatus('offline');
    } finally {
      setIsConnecting(false);
    }
  };

  const onUnlocked = async () => {
    await clearFailedAttempts();
    setLocked(false);
    setPasswordInput('');
    setPasswordError('');
    setUnlockAttempts(0);
    setLockedUntil(0);
    unlockedRef.current = true;
  };

  const tryBiometricUnlock = useCallback(async () => {
    const success = await authenticateWithBiometric();
    if (success) {
      await onUnlocked();
    }
  }, []);

  const handleUnlock = async () => {
    // Enforce the persistent lockout before checking the password.
    const until = await readLockedUntil();
    if (until > Date.now()) {
      setLockedUntil(until);
      setNow(Date.now());
      const secs = Math.ceil((until - Date.now()) / 1000);
      setPasswordError(`Too many attempts. Try again in ${secs}s.`);
      return;
    }
    const ok = await verifyAppPassword(passwordInput);
    if (ok) {
      await onUnlocked();
    } else {
      const { attempts, lockedUntil: newUntil } = await recordFailedAttempt();
      setUnlockAttempts(attempts);
      setLockedUntil(newUntil);
      setNow(Date.now());
      setPasswordInput('');
      if (newUntil > Date.now()) {
        const secs = Math.ceil((newUntil - Date.now()) / 1000);
        setPasswordError(`Incorrect password. Locked for ${secs}s (${attempts} attempts).`);
      } else {
        setPasswordError(`Incorrect password (${attempts} attempts).`);
      }
    }
  };

  if (isConnecting) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" backgroundColor={BCH2Colors.background} />
        <View style={styles.logoContainer}>
          <Text style={styles.logoText}>BCH2</Text>
          <Text style={styles.logoSubtext}>Wallet</Text>
        </View>
        <ActivityIndicator size="large" color={BCH2Colors.primary} style={styles.spinner} />
        <Text style={styles.loadingText}>Initializing...</Text>
      </View>
    );
  }

  if (locked) {
    // Only offer the password path when a password is actually configured.
    const hasPasswordSet = passwordConfigured;
    const lockedOut = lockedUntil > now;
    const lockoutSecs = lockedOut ? Math.ceil((lockedUntil - now) / 1000) : 0;
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" backgroundColor={BCH2Colors.background} />
        <View style={styles.logoContainer}>
          <Text style={styles.logoText}>BCH2</Text>
          <Text style={styles.logoSubtext}>Wallet</Text>
        </View>

        {biometricReady && (
          <TouchableOpacity style={styles.biometricButton} onPress={tryBiometricUnlock}>
            <Text style={styles.biometricIcon}>🔓</Text>
            <Text style={styles.biometricButtonText}>
              Unlock with {biometricType === 'FaceID' ? 'Face' : biometricType === 'TouchID' ? 'Touch ID' : 'Biometrics'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Password path — only when a password is actually configured. */}
        {hasPasswordSet && (
          <>
            {biometricReady && (
              <Text style={styles.orText}>or enter password</Text>
            )}
            <TextInput
              style={styles.passwordInput}
              placeholder="Enter password"
              placeholderTextColor={BCH2Colors.textMuted}
              secureTextEntry
              editable={!lockedOut}
              value={passwordInput}
              onChangeText={(t) => { setPasswordInput(t); setPasswordError(''); }}
              onSubmitEditing={handleUnlock}
              autoFocus={!biometricReady}
            />
            {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
            <TouchableOpacity
              style={[styles.unlockButton, lockedOut && styles.unlockButtonDisabled]}
              onPress={handleUnlock}
              disabled={lockedOut}
            >
              <Text style={styles.unlockButtonText}>
                {lockedOut ? `Locked (${lockoutSecs}s)` : 'Unlock'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {/* Biometric configured but the sensor is currently unavailable and no
            password is set — offer a retry that falls back to device credentials. */}
        {!hasPasswordSet && !biometricReady && (
          <>
            <Text style={styles.orText}>Biometric unlock is unavailable right now.</Text>
            <TouchableOpacity style={styles.unlockButton} onPress={tryBiometricUnlock}>
              <Text style={styles.unlockButtonText}>Retry unlock</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={BCH2Colors.background} />
      <NavigationContainer theme={BCH2Theme}>
        <BCH2Navigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: BCH2Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 48,
  },
  logoText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: BCH2Colors.primary,
  },
  logoSubtext: {
    fontSize: 24,
    color: BCH2Colors.textSecondary,
    marginLeft: 8,
  },
  spinner: {
    marginBottom: 16,
  },
  loadingText: {
    fontSize: 14,
    color: BCH2Colors.textMuted,
  },
  biometricButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BCH2Colors.primaryGlow,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: BCH2Colors.primary,
  },
  biometricIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  biometricButtonText: {
    color: BCH2Colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  orText: {
    color: BCH2Colors.textMuted,
    fontSize: 14,
    marginBottom: 12,
    marginTop: 4,
  },
  passwordInput: {
    width: '80%',
    backgroundColor: BCH2Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: BCH2Colors.textPrimary,
    borderWidth: 1,
    borderColor: BCH2Colors.border,
    marginBottom: 12,
    textAlign: 'center',
  },
  errorText: {
    color: BCH2Colors.error,
    fontSize: 14,
    marginBottom: 12,
  },
  unlockButton: {
    backgroundColor: BCH2Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  unlockButtonDisabled: {
    opacity: 0.5,
  },
  unlockButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default BCH2App;
