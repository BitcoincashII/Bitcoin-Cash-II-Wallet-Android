/**
 * BCH2 Receive Screen
 * Displays QR code and address for receiving BCH2
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
  Clipboard,
  Alert,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { BCH2Colors, BCH2Spacing, BCH2Typography, BCH2Shadows, BCH2BorderRadius } from '../../components/BCH2Theme';

interface BCH2ReceiveProps {
  address: string;
  walletLabel?: string;
  isBC2?: boolean;
  navigation?: any;
}

export const BCH2ReceiveScreen: React.FC<BCH2ReceiveProps> = ({
  address,
  walletLabel = 'BCH2 Wallet',
  isBC2 = false,
  navigation,
}) => {
  const [copied, setCopied] = useState(false);
  const primaryColor = isBC2 ? BCH2Colors.bc2Primary : BCH2Colors.primary;
  const coinSymbol = isBC2 ? 'BC2' : 'BCH2';

  const handleCopyAddress = useCallback(() => {
    Clipboard.setString(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [address]);

  const handleShare = useCallback(async () => {
    try {
      await Share.share({
        message: `My ${coinSymbol} address: ${address}`,
        title: `${coinSymbol} Address`,
      });
    } catch (error: any) {
      Alert.alert('Error', 'Failed to share address');
    }
  }, [address, coinSymbol]);

  const formatAddress = (addr: string): string => {
    if (!addr) return '';
    // Split long addresses into two lines for readability
    const midpoint = Math.floor(addr.length / 2);
    return `${addr.slice(0, midpoint)}\n${addr.slice(midpoint)}`;
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Receive {coinSymbol}</Text>
        <Text style={styles.subtitle}>{walletLabel}</Text>
      </View>

      {/* QR Code Card */}
      <View style={[styles.qrCard, { borderColor: primaryColor }]}>
        <View style={styles.qrContainer}>
          <QRCode
            value={address}
            size={200}
            color={BCH2Colors.textPrimary}
            backgroundColor={BCH2Colors.backgroundCard}
            logo={undefined}
          />
        </View>

        {/* Address Display */}
        <View style={styles.addressContainer}>
          <Text style={[styles.addressLabel, { color: primaryColor }]}>
            {coinSymbol} Address
          </Text>
          <Text style={styles.address} selectable>
            {formatAddress(address)}
          </Text>
        </View>

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, { borderColor: primaryColor }]}
            onPress={handleCopyAddress}
          >
            <Text style={[styles.actionButtonText, { color: primaryColor }]}>
              {copied ? '✓ Copied!' : 'Copy Address'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.actionButtonFilled, { backgroundColor: primaryColor }]}
            onPress={handleShare}
          >
            <Text style={styles.actionButtonTextFilled}>
              Share
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Info */}
      <View style={styles.infoCard}>
        <Text style={styles.infoText}>
          Send only {coinSymbol} to this address. Sending other coins may result in permanent loss.
        </Text>
      </View>

      {/* Address Format Info */}
      {!isBC2 && (
        <View style={styles.formatInfo}>
          <Text style={styles.formatTitle}>CashAddr Format</Text>
          <Text style={styles.formatText}>
            BCH2 uses the CashAddr format with the{'\n'}
            <Text style={styles.formatHighlight}>bitcoincashii:</Text> prefix
          </Text>
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
  header: {
    alignItems: 'center',
    marginBottom: BCH2Spacing.xl,
    paddingTop: BCH2Spacing.lg,
  },
  title: {
    fontSize: BCH2Typography.fontSize.xxl,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.textPrimary,
    marginBottom: BCH2Spacing.xs,
  },
  subtitle: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.textSecondary,
  },
  qrCard: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.lg,
    borderWidth: 1,
    padding: BCH2Spacing.xl,
    alignItems: 'center',
    ...BCH2Shadows.md,
  },
  qrContainer: {
    padding: BCH2Spacing.md,
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.md,
    marginBottom: BCH2Spacing.lg,
  },
  addressContainer: {
    alignItems: 'center',
    marginBottom: BCH2Spacing.lg,
    width: '100%',
  },
  addressLabel: {
    fontSize: BCH2Typography.fontSize.sm,
    fontWeight: BCH2Typography.fontWeight.semibold,
    marginBottom: BCH2Spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  address: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textPrimary,
    fontFamily: 'monospace',
    textAlign: 'center',
    lineHeight: 22,
  },
  actions: {
    flexDirection: 'row',
    gap: BCH2Spacing.md,
    width: '100%',
  },
  actionButton: {
    flex: 1,
    paddingVertical: BCH2Spacing.md,
    paddingHorizontal: BCH2Spacing.md,
    borderRadius: BCH2BorderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  actionButtonFilled: {
    borderWidth: 0,
  },
  actionButtonText: {
    fontSize: BCH2Typography.fontSize.base,
    fontWeight: BCH2Typography.fontWeight.semibold,
  },
  actionButtonTextFilled: {
    fontSize: BCH2Typography.fontSize.base,
    fontWeight: BCH2Typography.fontWeight.semibold,
    color: BCH2Colors.textPrimary,
  },
  infoCard: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.md,
    marginTop: BCH2Spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: BCH2Colors.warning,
  },
  infoText: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textSecondary,
    lineHeight: 20,
  },
  formatInfo: {
    alignItems: 'center',
    marginTop: BCH2Spacing.xl,
    paddingTop: BCH2Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: BCH2Colors.border,
  },
  formatTitle: {
    fontSize: BCH2Typography.fontSize.sm,
    fontWeight: BCH2Typography.fontWeight.semibold,
    color: BCH2Colors.textMuted,
    marginBottom: BCH2Spacing.xs,
  },
  formatText: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  formatHighlight: {
    color: BCH2Colors.primary,
    fontFamily: 'monospace',
  },
});

export default BCH2ReceiveScreen;
