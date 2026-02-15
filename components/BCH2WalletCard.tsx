/**
 * BCH2 Wallet Card Component
 * Displays wallet balance with BCH2 branding
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Image } from 'react-native';
import { BCH2Colors, BCH2Spacing, BCH2Typography, BCH2Shadows, BCH2BorderRadius } from './BCH2Theme';

// Coin logos
const BCH2_LOGO = require('../img/bch2-logo-small.png');
const BC2_LOGO = require('../img/bc2-logo-small.png');

interface BCH2WalletCardProps {
  balance: number;
  unconfirmedBalance?: number;
  address?: string;
  onPress?: () => void;
  onReceive?: () => void;
  onSend?: () => void;
  isBC2?: boolean; // Show as BC2 wallet (orange theme)
}

export const BCH2WalletCard: React.FC<BCH2WalletCardProps> = ({
  balance,
  unconfirmedBalance = 0,
  address,
  onPress,
  onReceive,
  onSend,
  isBC2 = false,
}) => {
  const primaryColor = isBC2 ? BCH2Colors.bc2Primary : BCH2Colors.primary;
  const coinSymbol = isBC2 ? 'BC2' : 'BCH2';

  const formatBalance = (sats: number): string => {
    return (sats / 100000000).toFixed(8);
  };

  const formatAddress = (addr: string): string => {
    if (!addr) return '';
    if (addr.length <= 20) return addr;
    return `${addr.slice(0, 14)}...${addr.slice(-8)}`;
  };

  return (
    <TouchableOpacity
      style={[styles.container, { borderColor: primaryColor }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* Header */}
      <View style={styles.header}>
        <Image
          source={isBC2 ? BC2_LOGO : BCH2_LOGO}
          style={styles.coinLogo}
          resizeMode="contain"
        />
        <View style={styles.headerText}>
          <Text style={styles.label}>
            {isBC2 ? 'Bitcoin Core 2' : 'Bitcoin Cash II'}
          </Text>
          <View style={[styles.coinBadge, { backgroundColor: primaryColor }]}>
            <Text style={styles.coinBadgeText}>{coinSymbol}</Text>
          </View>
        </View>
      </View>

      {/* Balance */}
      <View style={styles.balanceContainer}>
        <Text style={[styles.balance, { color: primaryColor }]}>
          {formatBalance(balance)}
        </Text>
        <Text style={styles.balanceSymbol}>{coinSymbol}</Text>
      </View>

      {/* Unconfirmed */}
      {unconfirmedBalance !== 0 && (
        <Text style={styles.unconfirmed}>
          {unconfirmedBalance > 0 ? '+' : ''}{formatBalance(unconfirmedBalance)} pending
        </Text>
      )}

      {/* Address */}
      {address && (
        <Text style={styles.address}>
          {formatAddress(address)}
        </Text>
      )}

      {/* Action Buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, { borderColor: primaryColor }]}
          onPress={onReceive}
        >
          <Text style={[styles.actionButtonText, { color: primaryColor }]}>
            Receive
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionButtonFilled, { backgroundColor: primaryColor }]}
          onPress={onSend}
        >
          <Text style={[styles.actionButtonText, styles.actionButtonTextFilled]}>
            Send
          </Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.lg,
    borderWidth: 1,
    padding: BCH2Spacing.lg,
    marginHorizontal: BCH2Spacing.md,
    marginVertical: BCH2Spacing.sm,
    ...BCH2Shadows.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: BCH2Spacing.md,
  },
  coinLogo: {
    width: 48,
    height: 48,
    marginRight: BCH2Spacing.md,
  },
  headerText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  coinBadge: {
    paddingHorizontal: BCH2Spacing.sm,
    paddingVertical: BCH2Spacing.xs,
    borderRadius: BCH2BorderRadius.sm,
  },
  coinBadgeText: {
    color: BCH2Colors.textPrimary,
    fontSize: BCH2Typography.fontSize.sm,
    fontWeight: BCH2Typography.fontWeight.bold,
  },
  label: {
    color: BCH2Colors.textSecondary,
    fontSize: BCH2Typography.fontSize.base,
    fontWeight: BCH2Typography.fontWeight.medium,
  },
  balanceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: BCH2Spacing.xs,
  },
  balance: {
    fontSize: BCH2Typography.fontSize.xxl,
    fontWeight: BCH2Typography.fontWeight.bold,
    fontFamily: 'monospace',
  },
  balanceSymbol: {
    color: BCH2Colors.textSecondary,
    fontSize: BCH2Typography.fontSize.lg,
    marginLeft: BCH2Spacing.sm,
  },
  unconfirmed: {
    color: BCH2Colors.warning,
    fontSize: BCH2Typography.fontSize.sm,
    marginBottom: BCH2Spacing.sm,
  },
  address: {
    color: BCH2Colors.textMuted,
    fontSize: BCH2Typography.fontSize.xs,
    fontFamily: 'monospace',
    marginBottom: BCH2Spacing.md,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: BCH2Spacing.md,
  },
  actionButton: {
    flex: 1,
    paddingVertical: BCH2Spacing.sm,
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
    color: BCH2Colors.textPrimary,
  },
});

export default BCH2WalletCard;
