/**
 * BCH2 QR Scanner
 * Full-screen camera that scans a payment QR (a raw address or a payment URI) and
 * hands the raw string back to the caller via the `onScanned` route param. Used by
 * the Send screen for BOTH BCH2 and BC2 — the caller decides how to parse it.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, PermissionsAndroid, Platform } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import CameraScreen from '../../components/CameraScreen';
import { BCH2Colors, BCH2Spacing, BCH2Typography, BCH2BorderRadius } from '../../components/BCH2Theme';

export const BCH2ScanQRScreen: React.FC = () => {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const onScanned = route.params?.onScanned as ((data: string) => void) | undefined;
  const [granted, setGranted] = useState<boolean | undefined>(undefined);
  const handledRef = useRef(false); // one QR per open — don't fire the callback repeatedly

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (Platform.OS !== 'android') { if (!cancelled) setGranted(true); return; }
      try {
        const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
          title: 'Camera access',
          message: 'Allow the camera to scan a QR code for the recipient address.',
          buttonPositive: 'OK',
          buttonNegative: 'Cancel',
        });
        if (!cancelled) setGranted(res === PermissionsAndroid.RESULTS.GRANTED);
      } catch {
        if (!cancelled) setGranted(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const goBack = useCallback(() => { navigation.goBack(); }, [navigation]);

  const handleReadCode = useCallback((event: any) => {
    if (handledRef.current) return;
    const data = event?.nativeEvent?.codeStringValue;
    if (!data) return;
    handledRef.current = true;
    try { onScanned?.(String(data)); } finally { navigation.goBack(); }
  }, [onScanned, navigation]);

  if (granted === undefined) {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>Opening camera…</Text>
      </View>
    );
  }

  if (!granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Camera permission needed</Text>
        <Text style={styles.msg}>Enable camera access to scan a QR code, then try again.</Text>
        <TouchableOpacity style={styles.button} onPress={goBack} accessibilityRole="button" accessibilityLabel="Go back">
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <CameraScreen onCancelButtonPress={goBack} onReadCode={handleReadCode} />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BCH2Colors.background,
    padding: BCH2Spacing.xl,
  },
  title: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.textPrimary,
    marginBottom: BCH2Spacing.sm,
    textAlign: 'center',
  },
  msg: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.textSecondary,
    textAlign: 'center',
    marginBottom: BCH2Spacing.lg,
  },
  button: {
    paddingVertical: BCH2Spacing.md,
    paddingHorizontal: BCH2Spacing.xl,
    borderRadius: BCH2BorderRadius.md,
    borderWidth: 1,
    borderColor: BCH2Colors.primary,
  },
  buttonText: {
    color: BCH2Colors.primary,
    fontWeight: BCH2Typography.fontWeight.semibold,
    fontSize: BCH2Typography.fontSize.base,
  },
});

export default BCH2ScanQRScreen;
