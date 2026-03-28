/**
 * BCH2 Wallet Detail Screen
 * Shows wallet details, transactions, and actions
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Linking,
} from 'react-native';
import { BCH2Colors, BCH2Spacing, BCH2Typography, BCH2Shadows, BCH2BorderRadius } from '../../components/BCH2Theme';
import { getWalletMnemonic } from '../../class/bch2-wallet-storage';
import { useScreenProtect } from '../../hooks/useScreenProtect';
import { getBCH2TransactionUrl, getBC2TransactionUrl, getBCH2BlockUrl, getBC2BlockUrl } from '../../class/bch2-constants';

interface Transaction {
  txid: string;
  confirmations: number;
  amount: number; // In satoshis, positive = received, negative = sent
  timestamp: number;
  fee?: number;
  height?: number;
}

interface BCH2WalletDetailProps {
  walletId: string;
  label?: string;
  balance: number;
  unconfirmedBalance: number;
  address: string;
  isBC2?: boolean;
  transactions?: Transaction[];
  navigation?: any;
  onRefresh?: () => Promise<void>;
  refreshing?: boolean;
}

export const BCH2WalletDetailScreen: React.FC<BCH2WalletDetailProps> = ({
  walletId,
  label = 'BCH2 Wallet',
  balance,
  unconfirmedBalance,
  address,
  isBC2 = false,
  transactions = [],
  navigation,
  onRefresh: externalRefresh,
  refreshing: externalRefreshing,
}) => {
  const [internalRefreshing, setInternalRefreshing] = useState(false);
  const refreshing = externalRefreshing ?? internalRefreshing;
  const primaryColor = isBC2 ? BCH2Colors.bc2Primary : BCH2Colors.primary;
  const coinSymbol = isBC2 ? 'BC2' : 'BCH2';

  const onRefresh = useCallback(async () => {
    if (externalRefresh) {
      await externalRefresh();
    } else {
      setInternalRefreshing(true);
      await new Promise(resolve => setTimeout(resolve, 1000));
      setInternalRefreshing(false);
    }
  }, [externalRefresh]);

  const openTransactionInExplorer = (txid: string) => {
    const url = isBC2 ? getBC2TransactionUrl(txid) : getBCH2TransactionUrl(txid);
    Linking.openURL(url).catch(() => { /* silently ignore link-open failures */ });
  };

  const formatBalance = (sats: number): string => {
    return (sats / 100000000).toFixed(8);
  };

  const formatAddress = (addr: string): string => {
    if (!addr) return '';
    if (addr.length <= 24) return addr;
    return `${addr.slice(0, 14)}...${addr.slice(-10)}`;
  };

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const navigateToReceive = () => {
    navigation?.navigate('BCH2Receive', {
      address,
      walletLabel: label,
      isBC2,
      walletId,
    });
  };

  const navigateToSend = () => {
    navigation?.navigate('BCH2Send', {
      walletId: walletId,
      walletBalance: balance,
      walletAddress: address,
      isBC2: isBC2,
    });
  };

  const { enableScreenProtect, disableScreenProtect } = useScreenProtect();

  const showMnemonicAlert = (mnemonic: string) => {
    enableScreenProtect();
    Alert.alert(
      '⚠️ Backup Recovery Phrase',
      `WRITE THIS DOWN AND KEEP IT SAFE!\n\nYour recovery phrase:\n\n${mnemonic}\n\nAnyone with this phrase can access your funds. Never share it.`,
      [
        { text: 'I\'ve Saved It', style: 'default', onPress: () => disableScreenProtect() },
      ],
      { onDismiss: () => disableScreenProtect() }
    );
  };

  const handleBackupWallet = async () => {
    try {
      const mnemonic = await getWalletMnemonic(walletId);
      if (mnemonic) {
        showMnemonicAlert(mnemonic);
      } else {
        Alert.alert('Error', 'Could not retrieve wallet backup phrase.');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to export wallet backup.');
    }
  };

  const formatTxid = (txid: string): string => {
    if (!txid || txid.length <= 16) return txid;
    return `${txid.slice(0, 8)}...${txid.slice(-8)}`;
  };

  const renderTransaction = ({ item }: { item: Transaction }) => {
    const isReceived = item.amount >= 0;
    const absAmount = Math.abs(item.amount);
    const hasHeight = item.height && item.height > 0;

    return (
      <TouchableOpacity style={styles.txItem} onPress={() => openTransactionInExplorer(item.txid)} accessibilityLabel={`Transaction ${formatTxid(item.txid)}, ${isReceived ? 'received' : 'sent'} ${formatBalance(absAmount)} ${coinSymbol}, ${hasHeight ? `confirmed at block ${item.height}` : 'pending'}. Tap to view in explorer.`} accessibilityRole="button">
        <View style={styles.txLeft}>
          <View style={[styles.txIcon, { backgroundColor: hasHeight ? BCH2Colors.success : BCH2Colors.warning }]}>
            <Text style={styles.txIconText}>{hasHeight ? '✓' : '⏳'}</Text>
          </View>
          <View style={styles.txInfo}>
            <Text style={styles.txId}>{formatTxid(item.txid)}</Text>
            <Text style={styles.txDate}>
              {hasHeight ? `Block ${item.height}` : 'Pending'}
            </Text>
          </View>
        </View>
        <View style={styles.txRight}>
          {absAmount > 0 ? (
            <Text style={[styles.txAmount, { color: isReceived ? BCH2Colors.success : BCH2Colors.error }]}>
              {isReceived ? '+' : '-'}{formatBalance(absAmount)}
            </Text>
          ) : (
            <Text style={styles.txViewLink}>View →</Text>
          )}
          <Text style={styles.txConfirmations}>
            Tap to view in explorer
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={primaryColor}
        />
      }
    >
      {/* Balance Card */}
      <View style={[styles.balanceCard, { borderColor: primaryColor }]}>
        <View style={[styles.coinBadge, { backgroundColor: primaryColor }]}>
          <Text style={styles.coinBadgeText}>{coinSymbol}</Text>
        </View>

        <Text style={styles.walletLabel}>{label}</Text>

        <View style={styles.balanceContainer}>
          <Text style={[styles.balance, { color: primaryColor }]}>
            {formatBalance(balance)}
          </Text>
          <Text style={styles.balanceSymbol}>{coinSymbol}</Text>
        </View>

        {unconfirmedBalance !== 0 && (
          <Text style={styles.unconfirmed}>
            {unconfirmedBalance > 0 ? '+' : ''}{formatBalance(unconfirmedBalance)} pending
          </Text>
        )}

        <TouchableOpacity style={styles.addressContainer}>
          <Text style={styles.address}>{formatAddress(address)}</Text>
        </TouchableOpacity>

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, { borderColor: primaryColor }]}
            onPress={navigateToReceive}
            accessibilityLabel={`Receive ${coinSymbol}`}
            accessibilityRole="button"
          >
            <Text style={[styles.actionIcon, { color: primaryColor }]}>↓</Text>
            <Text style={[styles.actionText, { color: primaryColor }]}>Receive</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.actionButtonFilled, { backgroundColor: primaryColor }]}
            onPress={navigateToSend}
            accessibilityLabel={`Send ${coinSymbol}`}
            accessibilityRole="button"
          >
            <Text style={styles.actionIconFilled}>↑</Text>
            <Text style={styles.actionTextFilled}>Send</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Transactions */}
      <View style={styles.transactionsSection}>
        <Text style={styles.sectionTitle}>Transactions</Text>

        {transactions.length === 0 ? (
          <View style={styles.emptyTx}>
            <Text style={styles.emptyTxIcon}>📜</Text>
            <Text style={styles.emptyTxText}>No transactions yet</Text>
            <Text style={styles.emptyTxSubtext}>
              Receive some {coinSymbol} to get started
            </Text>
          </View>
        ) : (
          <View style={styles.txList}>
            {transactions.map((tx, index) => (
              <View key={tx.txid || index}>
                {renderTransaction({ item: tx })}
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Wallet Info */}
      <View style={styles.infoSection}>
        <Text style={styles.sectionTitle}>Wallet Info</Text>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Type</Text>
            <Text style={styles.infoValue}>
              {isBC2 ? 'BC2 Legacy (P2PKH)' : 'BCH2 (CashAddr)'}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Full Address</Text>
            <Text style={[styles.infoValue, styles.infoValueMono]} numberOfLines={2}>
              {address}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Derivation Path</Text>
            <Text style={[styles.infoValue, styles.infoValueMono]}>
              {isBC2 ? "m/44'/0'/0'" : "m/44'/145'/0'"}
            </Text>
          </View>
        </View>
      </View>

      {/* Export/Backup Button */}
      <TouchableOpacity style={styles.exportButton} onPress={handleBackupWallet} accessibilityLabel="Export wallet backup recovery phrase" accessibilityRole="button">
        <Text style={styles.exportButtonText}>Export Wallet Backup</Text>
      </TouchableOpacity>
    </ScrollView>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BCH2Colors.background,
  },
  content: {
    padding: BCH2Spacing.lg,
    paddingBottom: BCH2Spacing.xxl,
  },
  balanceCard: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.lg,
    borderWidth: 1,
    padding: BCH2Spacing.xl,
    alignItems: 'center',
    marginBottom: BCH2Spacing.xl,
    ...BCH2Shadows.md,
  },
  coinBadge: {
    paddingHorizontal: BCH2Spacing.md,
    paddingVertical: BCH2Spacing.xs,
    borderRadius: BCH2BorderRadius.sm,
    marginBottom: BCH2Spacing.sm,
  },
  coinBadgeText: {
    color: BCH2Colors.textPrimary,
    fontSize: BCH2Typography.fontSize.sm,
    fontWeight: BCH2Typography.fontWeight.bold,
  },
  walletLabel: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.textSecondary,
    marginBottom: BCH2Spacing.md,
  },
  balanceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: BCH2Spacing.xs,
  },
  balance: {
    fontSize: BCH2Typography.fontSize.xxxl,
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
    marginBottom: BCH2Spacing.md,
  },
  addressContainer: {
    backgroundColor: BCH2Colors.backgroundElevated,
    borderRadius: BCH2BorderRadius.sm,
    paddingVertical: BCH2Spacing.xs,
    paddingHorizontal: BCH2Spacing.md,
    marginBottom: BCH2Spacing.lg,
  },
  address: {
    color: BCH2Colors.textMuted,
    fontSize: BCH2Typography.fontSize.sm,
    fontFamily: 'monospace',
  },
  actions: {
    flexDirection: 'row',
    gap: BCH2Spacing.md,
    width: '100%',
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: BCH2Spacing.md,
    borderRadius: BCH2BorderRadius.md,
    borderWidth: 1,
    gap: BCH2Spacing.sm,
  },
  actionButtonFilled: {
    borderWidth: 0,
  },
  actionIcon: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
  },
  actionIconFilled: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.textPrimary,
  },
  actionText: {
    fontSize: BCH2Typography.fontSize.base,
    fontWeight: BCH2Typography.fontWeight.semibold,
  },
  actionTextFilled: {
    fontSize: BCH2Typography.fontSize.base,
    fontWeight: BCH2Typography.fontWeight.semibold,
    color: BCH2Colors.textPrimary,
  },
  transactionsSection: {
    marginBottom: BCH2Spacing.xl,
  },
  sectionTitle: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.semibold,
    color: BCH2Colors.textPrimary,
    marginBottom: BCH2Spacing.md,
  },
  emptyTx: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.xl,
    alignItems: 'center',
  },
  emptyTxIcon: {
    fontSize: 40,
    marginBottom: BCH2Spacing.md,
  },
  emptyTxText: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.textSecondary,
    marginBottom: BCH2Spacing.xs,
  },
  emptyTxSubtext: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textMuted,
  },
  txList: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.md,
    overflow: 'hidden',
  },
  txItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: BCH2Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: BCH2Colors.border,
  },
  txLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  txIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: BCH2Spacing.md,
  },
  txIconText: {
    color: BCH2Colors.textPrimary,
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
  },
  txInfo: {},
  txType: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.textPrimary,
    fontWeight: BCH2Typography.fontWeight.medium,
  },
  txId: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textPrimary,
    fontWeight: BCH2Typography.fontWeight.medium,
    fontFamily: 'monospace',
  },
  txViewLink: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.primary,
    fontWeight: BCH2Typography.fontWeight.medium,
  },
  txDate: {
    fontSize: BCH2Typography.fontSize.xs,
    color: BCH2Colors.textMuted,
    marginTop: 2,
  },
  txRight: {
    alignItems: 'flex-end',
  },
  txAmount: {
    fontSize: BCH2Typography.fontSize.base,
    fontWeight: BCH2Typography.fontWeight.semibold,
    fontFamily: 'monospace',
  },
  txConfirmations: {
    fontSize: BCH2Typography.fontSize.xs,
    color: BCH2Colors.textMuted,
    marginTop: 2,
  },
  infoSection: {
    marginBottom: BCH2Spacing.xl,
  },
  infoCard: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: BCH2Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: BCH2Colors.border,
  },
  infoLabel: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textMuted,
    flex: 1,
  },
  infoValue: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textPrimary,
    flex: 2,
    textAlign: 'right',
  },
  infoValueMono: {
    fontFamily: 'monospace',
    fontSize: BCH2Typography.fontSize.xs,
  },
  exportButton: {
    backgroundColor: 'transparent',
    borderRadius: BCH2BorderRadius.md,
    paddingVertical: BCH2Spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BCH2Colors.warning,
  },
  exportButtonText: {
    color: BCH2Colors.warning,
    fontSize: BCH2Typography.fontSize.base,
    fontWeight: BCH2Typography.fontWeight.semibold,
  },
});

export default BCH2WalletDetailScreen;
