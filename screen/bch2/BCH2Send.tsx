/**
 * BCH2 Send Screen
 * Send BCH2 or BC2 to another address
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Keyboard,
} from 'react-native';
import { BCH2Colors, BCH2Spacing, BCH2Typography, BCH2Shadows, BCH2BorderRadius } from '../../components/BCH2Theme';

interface BCH2SendProps {
  walletBalance: number;
  walletAddress: string;
  isBC2?: boolean;
  onSend?: (toAddress: string, amount: number, fee: number) => Promise<{ txid: string }>;
  navigation?: any;
}

export const BCH2SendScreen: React.FC<BCH2SendProps> = ({
  walletBalance,
  walletAddress,
  isBC2 = false,
  onSend,
  navigation,
}) => {
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('1'); // sat/byte
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'input' | 'confirm' | 'success'>('input');
  const [txid, setTxid] = useState('');

  const primaryColor = isBC2 ? BCH2Colors.bc2Primary : BCH2Colors.primary;
  const coinSymbol = isBC2 ? 'BC2' : 'BCH2';
  const addressPrefix = isBC2 ? '' : 'bitcoincashii:';

  const formatBalance = (sats: number): string => {
    return (sats / 100000000).toFixed(8);
  };

  const parseAmount = (amountStr: string): number => {
    const parsed = parseFloat(amountStr);
    if (isNaN(parsed)) return 0;
    return Math.floor(parsed * 100000000); // Convert to satoshis
  };

  const amountInSats = parseAmount(amount);
  const feeInSats = parseInt(fee) * 226; // Estimate 226 bytes for typical P2PKH tx
  const totalInSats = amountInSats + feeInSats;

  const validateAddress = (addr: string): boolean => {
    if (!addr) return false;
    // Basic validation - proper validation would check checksum
    if (isBC2) {
      return addr.length >= 26 && addr.length <= 35;
    } else {
      // BCH2 CashAddr format
      const normalizedAddr = addr.toLowerCase();
      if (normalizedAddr.startsWith('bitcoincashii:')) {
        return normalizedAddr.length >= 42;
      }
      // Also accept without prefix
      return addr.length >= 42;
    }
  };

  const handleMaxAmount = useCallback(() => {
    const maxSats = walletBalance - feeInSats;
    if (maxSats > 0) {
      setAmount(formatBalance(maxSats));
    }
  }, [walletBalance, feeInSats]);

  const handleContinue = useCallback(() => {
    Keyboard.dismiss();

    if (!validateAddress(toAddress)) {
      Alert.alert('Invalid Address', `Please enter a valid ${coinSymbol} address`);
      return;
    }

    if (amountInSats <= 0) {
      Alert.alert('Invalid Amount', 'Please enter an amount greater than 0');
      return;
    }

    if (totalInSats > walletBalance) {
      Alert.alert('Insufficient Balance', 'You do not have enough balance for this transaction');
      return;
    }

    if (amountInSats < 546) {
      Alert.alert('Dust Amount', 'Amount is too small. Minimum is 546 satoshis');
      return;
    }

    setStep('confirm');
  }, [toAddress, amountInSats, totalInSats, walletBalance, coinSymbol]);

  const handleSend = useCallback(async () => {
    if (!onSend) {
      Alert.alert('Error', 'Send function not configured');
      return;
    }

    setLoading(true);
    try {
      const result = await onSend(toAddress, amountInSats, parseInt(fee));
      setTxid(result.txid);
      setStep('success');
    } catch (error: any) {
      if (!error?.__cancelled) {
        Alert.alert('Transaction Failed', error.message || 'Failed to broadcast transaction');
      }
    } finally {
      setLoading(false);
    }
  }, [onSend, toAddress, amountInSats, fee]);

  const handleDone = useCallback(() => {
    navigation?.goBack();
  }, [navigation]);

  const formatAddress = (addr: string): string => {
    if (!addr) return '';
    if (addr.length <= 20) return addr;
    return `${addr.slice(0, 12)}...${addr.slice(-8)}`;
  };

  // Input Step
  if (step === 'input') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Send {coinSymbol}</Text>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>Available:</Text>
            <Text style={[styles.balanceValue, { color: primaryColor }]}>
              {formatBalance(walletBalance)} {coinSymbol}
            </Text>
          </View>
        </View>

        {/* To Address */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>To Address</Text>
          <TextInput
            style={styles.input}
            value={toAddress}
            onChangeText={setToAddress}
            placeholder={`${addressPrefix}q...`}
            placeholderTextColor={BCH2Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Amount */}
        <View style={styles.inputGroup}>
          <View style={styles.inputLabelRow}>
            <Text style={styles.inputLabel}>Amount ({coinSymbol})</Text>
            <TouchableOpacity onPress={handleMaxAmount}>
              <Text style={[styles.maxButton, { color: primaryColor }]}>MAX</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00000000"
            placeholderTextColor={BCH2Colors.textMuted}
            keyboardType="decimal-pad"
          />
        </View>

        {/* Fee */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Fee (sat/byte)</Text>
          <View style={styles.feeSelector}>
            {['1', '2', '5'].map((feeOption) => (
              <TouchableOpacity
                key={feeOption}
                style={[
                  styles.feeButton,
                  fee === feeOption && { backgroundColor: primaryColor, borderColor: primaryColor },
                ]}
                onPress={() => setFee(feeOption)}
              >
                <Text style={[
                  styles.feeButtonText,
                  fee === feeOption && styles.feeButtonTextActive,
                ]}>
                  {feeOption}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.feeEstimate}>
            Estimated fee: ~{feeInSats} sats ({formatBalance(feeInSats)} {coinSymbol})
          </Text>
        </View>

        {/* Summary */}
        {amountInSats > 0 && (
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Amount</Text>
              <Text style={styles.summaryValue}>{formatBalance(amountInSats)} {coinSymbol}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Fee</Text>
              <Text style={styles.summaryValue}>{formatBalance(feeInSats)} {coinSymbol}</Text>
            </View>
            <View style={[styles.summaryRow, styles.summaryTotal]}>
              <Text style={styles.summaryTotalLabel}>Total</Text>
              <Text style={[styles.summaryTotalValue, { color: primaryColor }]}>
                {formatBalance(totalInSats)} {coinSymbol}
              </Text>
            </View>
          </View>
        )}

        {/* Continue Button */}
        <TouchableOpacity
          style={[styles.sendButton, { backgroundColor: primaryColor }]}
          onPress={handleContinue}
        >
          <Text style={styles.sendButtonText}>Continue</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // Confirm Step
  if (step === 'confirm') {
    return (
      <View style={styles.container}>
        <View style={styles.confirmContent}>
          <Text style={styles.confirmTitle}>Confirm Transaction</Text>

          <View style={styles.confirmCard}>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>To</Text>
              <Text style={styles.confirmValue}>{formatAddress(toAddress)}</Text>
            </View>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Amount</Text>
              <Text style={[styles.confirmValueLarge, { color: primaryColor }]}>
                {formatBalance(amountInSats)} {coinSymbol}
              </Text>
            </View>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Fee</Text>
              <Text style={styles.confirmValue}>{formatBalance(feeInSats)} {coinSymbol}</Text>
            </View>
            <View style={[styles.confirmRow, styles.confirmTotal]}>
              <Text style={styles.confirmTotalLabel}>Total</Text>
              <Text style={styles.confirmTotalValue}>
                {formatBalance(totalInSats)} {coinSymbol}
              </Text>
            </View>
          </View>

          <View style={styles.confirmActions}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setStep('input')}
              disabled={loading}
            >
              <Text style={styles.cancelButtonText}>Back</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.confirmButton, { backgroundColor: primaryColor }]}
              onPress={handleSend}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={BCH2Colors.textPrimary} />
              ) : (
                <Text style={styles.confirmButtonText}>Send {coinSymbol}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // Success Step
  return (
    <View style={styles.container}>
      <View style={styles.successContent}>
        <View style={[styles.successIcon, { borderColor: primaryColor }]}>
          <Text style={styles.successIconText}>✓</Text>
        </View>

        <Text style={styles.successTitle}>Transaction Sent!</Text>
        <Text style={styles.successAmount}>
          {formatBalance(amountInSats)} {coinSymbol}
        </Text>

        <View style={styles.txidCard}>
          <Text style={styles.txidLabel}>Transaction ID</Text>
          <Text style={styles.txidValue} selectable>
            {txid}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.doneButton, { backgroundColor: primaryColor }]}
          onPress={handleDone}
        >
          <Text style={styles.doneButtonText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BCH2Colors.background,
  },
  content: {
    padding: BCH2Spacing.lg,
  },
  header: {
    marginBottom: BCH2Spacing.xl,
  },
  title: {
    fontSize: BCH2Typography.fontSize.xxl,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.textPrimary,
    marginBottom: BCH2Spacing.sm,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.textSecondary,
    marginRight: BCH2Spacing.sm,
  },
  balanceValue: {
    fontSize: BCH2Typography.fontSize.base,
    fontWeight: BCH2Typography.fontWeight.semibold,
    fontFamily: 'monospace',
  },
  inputGroup: {
    marginBottom: BCH2Spacing.lg,
  },
  inputLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: BCH2Spacing.sm,
  },
  inputLabel: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textSecondary,
    marginBottom: BCH2Spacing.sm,
  },
  maxButton: {
    fontSize: BCH2Typography.fontSize.sm,
    fontWeight: BCH2Typography.fontWeight.bold,
  },
  input: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.md,
    borderWidth: 1,
    borderColor: BCH2Colors.border,
    padding: BCH2Spacing.md,
    color: BCH2Colors.textPrimary,
    fontSize: BCH2Typography.fontSize.base,
    fontFamily: 'monospace',
  },
  feeSelector: {
    flexDirection: 'row',
    gap: BCH2Spacing.sm,
    marginBottom: BCH2Spacing.sm,
  },
  feeButton: {
    flex: 1,
    paddingVertical: BCH2Spacing.sm,
    alignItems: 'center',
    borderRadius: BCH2BorderRadius.md,
    borderWidth: 1,
    borderColor: BCH2Colors.border,
    backgroundColor: BCH2Colors.backgroundCard,
  },
  feeButtonText: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.textSecondary,
    fontWeight: BCH2Typography.fontWeight.medium,
  },
  feeButtonTextActive: {
    color: BCH2Colors.textPrimary,
  },
  feeEstimate: {
    fontSize: BCH2Typography.fontSize.xs,
    color: BCH2Colors.textMuted,
  },
  summaryCard: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.md,
    marginBottom: BCH2Spacing.xl,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: BCH2Spacing.xs,
  },
  summaryLabel: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textMuted,
  },
  summaryValue: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textSecondary,
    fontFamily: 'monospace',
  },
  summaryTotal: {
    borderTopWidth: 1,
    borderTopColor: BCH2Colors.border,
    marginTop: BCH2Spacing.sm,
    paddingTop: BCH2Spacing.sm,
  },
  summaryTotalLabel: {
    fontSize: BCH2Typography.fontSize.base,
    fontWeight: BCH2Typography.fontWeight.semibold,
    color: BCH2Colors.textPrimary,
  },
  summaryTotalValue: {
    fontSize: BCH2Typography.fontSize.base,
    fontWeight: BCH2Typography.fontWeight.bold,
    fontFamily: 'monospace',
  },
  sendButton: {
    borderRadius: BCH2BorderRadius.md,
    paddingVertical: BCH2Spacing.md,
    alignItems: 'center',
    ...BCH2Shadows.glow,
  },
  sendButtonText: {
    color: BCH2Colors.textPrimary,
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
  },
  // Confirm styles
  confirmContent: {
    flex: 1,
    padding: BCH2Spacing.lg,
    justifyContent: 'center',
  },
  confirmTitle: {
    fontSize: BCH2Typography.fontSize.xl,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.textPrimary,
    textAlign: 'center',
    marginBottom: BCH2Spacing.xl,
  },
  confirmCard: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.lg,
    padding: BCH2Spacing.lg,
    marginBottom: BCH2Spacing.xl,
  },
  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: BCH2Spacing.sm,
  },
  confirmLabel: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.textMuted,
  },
  confirmValue: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.textSecondary,
    fontFamily: 'monospace',
  },
  confirmValueLarge: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
    fontFamily: 'monospace',
  },
  confirmTotal: {
    borderTopWidth: 1,
    borderTopColor: BCH2Colors.border,
    marginTop: BCH2Spacing.sm,
    paddingTop: BCH2Spacing.md,
  },
  confirmTotalLabel: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.textPrimary,
  },
  confirmTotalValue: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.textPrimary,
    fontFamily: 'monospace',
  },
  confirmActions: {
    flexDirection: 'row',
    gap: BCH2Spacing.md,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: BCH2Spacing.md,
    alignItems: 'center',
    borderRadius: BCH2BorderRadius.md,
    borderWidth: 1,
    borderColor: BCH2Colors.border,
  },
  cancelButtonText: {
    color: BCH2Colors.textSecondary,
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.semibold,
  },
  confirmButton: {
    flex: 2,
    paddingVertical: BCH2Spacing.md,
    alignItems: 'center',
    borderRadius: BCH2BorderRadius.md,
    ...BCH2Shadows.glow,
  },
  confirmButtonText: {
    color: BCH2Colors.textPrimary,
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
  },
  // Success styles
  successContent: {
    flex: 1,
    padding: BCH2Spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: BCH2Spacing.xl,
  },
  successIconText: {
    fontSize: 40,
    color: BCH2Colors.success,
  },
  successTitle: {
    fontSize: BCH2Typography.fontSize.xl,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.textPrimary,
    marginBottom: BCH2Spacing.sm,
  },
  successAmount: {
    fontSize: BCH2Typography.fontSize.xxl,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.success,
    fontFamily: 'monospace',
    marginBottom: BCH2Spacing.xl,
  },
  txidCard: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.md,
    width: '100%',
    marginBottom: BCH2Spacing.xl,
  },
  txidLabel: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textMuted,
    marginBottom: BCH2Spacing.xs,
  },
  txidValue: {
    fontSize: BCH2Typography.fontSize.xs,
    color: BCH2Colors.textSecondary,
    fontFamily: 'monospace',
  },
  doneButton: {
    paddingVertical: BCH2Spacing.md,
    paddingHorizontal: BCH2Spacing.xxl,
    borderRadius: BCH2BorderRadius.md,
    ...BCH2Shadows.glow,
  },
  doneButtonText: {
    color: BCH2Colors.textPrimary,
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
  },
});

export default BCH2SendScreen;
