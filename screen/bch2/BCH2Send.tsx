/**
 * BCH2 Send Screen
 * Send BCH2 or BC2 to another address
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
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
import { decodeCashAddr, isValidRecipientAddress } from '../../class/bch2-transaction';
import { getUtxosByAddress, getBC2Utxos, filterMatureUtxos } from '../../blue_modules/BCH2Electrum';

// Per-input (v)byte weight by script type, mirroring class/bch2-transaction.ts. Legacy/BCH2 = 148; BC2 native
// SegWit/Taproot/P2SH-SegWit use the witness-discounted vbytes the real signer (sendBC2NativeHd.estimateBytes) charges.
const perInputBytesFor = (isBC2: boolean, bc2ScriptType?: string): number =>
  !isBC2 ? 148 : bc2ScriptType === 'taproot' ? 58 : bc2ScriptType === 'native-segwit' ? 68 : bc2ScriptType === 'p2sh-segwit' ? 91 : 148;

// Tx-size estimate replicated (read-only) from class/bch2-transaction.ts. overhead + perInput/input + perOutput/output.
// BC2 uses overhead 11 (matches sendBC2NativeHd) and a conservative 43-byte output (covers legacy/P2TR/P2WSH) so a
// BC2 MAX/near-max send never UNDER-estimates the fee below the signer's model and gets min-relay rejected.
const estimateTxSize = (inputCount: number, outputCount: number, perInput = 148, perOutput = 34, overhead = 10): number =>
  overhead + perInput * inputCount + perOutput * outputCount;

// Replicates the coin-selection in class/bch2-transaction.ts so the confirm screen's fee/total reflect the REAL
// number of inputs that will be signed (not a fixed 1-input assumption). utxoValues must be sorted largest-first
// to match the tx builder's ordering; perInput/perOutput/overhead are the script-type-aware size weights.
const computeSelectedFee = (
  utxoValues: number[],
  amountSats: number,
  feePerByte: number,
  perInput = 148,
  perOutput = 34,
  overhead = 10,
): { fee: number; sufficient: boolean } => {
  let totalInput = 0;
  let count = 0;
  for (const v of utxoValues) {
    count++;
    totalInput += v;
    const runningFee = estimateTxSize(count, 2, perInput, perOutput, overhead) * feePerByte;
    if (totalInput >= amountSats + runningFee || count >= 500) break;
  }
  const fee2out = estimateTxSize(count, 2, perInput, perOutput, overhead) * feePerByte;
  const tentativeChange = totalInput - amountSats - fee2out;
  const hasChange = tentativeChange > 546; // matches builder dust threshold
  const fee = estimateTxSize(count, hasChange ? 2 : 1, perInput, perOutput, overhead) * feePerByte;
  return { fee, sufficient: totalInput >= amountSats + fee };
};

interface BCH2SendProps {
  walletBalance: number;
  walletAddress: string;
  isBC2?: boolean;
  bc2ScriptType?: string; // 'legacy'|'p2sh-segwit'|'native-segwit'|'taproot' — for the correct per-input fee weight
  // For BC2 (HD, account-wide signer): loads the ACCOUNT's mature UTXO values (largest-first), not just the
  // primary address's, so coin-selection/MAX/sufficiency match what sendBC2NativeHd actually spends.
  loadUtxoValues?: () => Promise<number[]>;
  onSend?: (toAddress: string, amount: number, fee: number) => Promise<{ txid: string }>;
  navigation?: any;
  prefillAddress?: string; // from a bitcoincashii: deep link
  prefillAmount?: string;  // BCH2 units (decimal string)
}

export const BCH2SendScreen: React.FC<BCH2SendProps> = ({
  walletBalance,
  walletAddress,
  isBC2 = false,
  bc2ScriptType,
  loadUtxoValues,
  onSend,
  navigation,
  prefillAddress,
  prefillAmount,
}) => {
  const perInput = perInputBytesFor(isBC2, bc2ScriptType);
  const perOutput = isBC2 ? 43 : 34; // conservative for BC2 (covers legacy/P2TR/P2WSH) so MAX never underpays
  const overhead = isBC2 ? 11 : 10;  // matches sendBC2NativeHd's size() overhead
  const [toAddress, setToAddress] = useState(prefillAddress || '');
  const [amount, setAmount] = useState(prefillAmount || '');
  const [fee, setFee] = useState('1'); // sat/byte
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'input' | 'confirm' | 'success'>('input');
  const [txid, setTxid] = useState('');
  // Mature UTXO values (largest-first) for this wallet; null until loaded/unavailable.
  // Fetched here so fee/total and MAX can be computed from the ACTUAL input count.
  const [utxoValues, setUtxoValues] = useState<number[] | null>(null);
  const sendingRef = useRef(false);

  // Load the wallet's mature UTXO set the same way class/bch2-transaction.ts does,
  // so the confirm total matches what actually gets signed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // BC2 wallets are HD/account-wide: use the provided account loader (all receive+change addresses), not just
        // the primary address, so coin-selection/MAX/sufficiency match the real signer and don't wrongly block sends.
        if (loadUtxoValues) {
          const vals = await loadUtxoValues();
          if (!cancelled) setUtxoValues(vals);
          return;
        }
        const raw = isBC2
          ? await getBC2Utxos(walletAddress)
          : await getUtxosByAddress(walletAddress);
        const mature = await filterMatureUtxos(raw, isBC2);
        if (cancelled) return;
        const vals = mature
          .map((u: any) => u.value)
          .filter((v: any) => Number.isInteger(v) && v > 0)
          .sort((a: number, b: number) => b - a); // largest-first, matching the builder
        setUtxoValues(vals);
      } catch {
        if (!cancelled) setUtxoValues(null); // fall back to a labeled single-input estimate
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, isBC2, loadUtxoValues]);

  const primaryColor = isBC2 ? BCH2Colors.bc2Primary : BCH2Colors.primary;
  const coinSymbol = isBC2 ? 'BC2' : 'BCH2';
  const addressPrefix = isBC2 ? '' : 'bitcoincashii:';

  const formatBalance = (sats: number): string => {
    return (sats / 100000000).toFixed(8);
  };

  const parseAmount = (amountStr: string): number => {
    // Normalize comma decimal separator for European locales
    const normalized = amountStr.replace(',', '.');
    // Reject scientific notation and non-numeric input
    if (!/^\d*\.?\d*$/.test(normalized) || normalized === '' || normalized === '.') return 0;
    const parsed = parseFloat(normalized);
    if (isNaN(parsed) || !isFinite(parsed)) return 0;
    const sats = Math.round(parsed * 100000000);
    if (!Number.isSafeInteger(sats) || sats < 0) return 0;
    return sats;
  };

  const amountInSats = parseAmount(amount);
  const feePerByte = Math.min(1000, Math.max(1, parseInt(fee) || 1));
  // Compute fee/total from the ACTUAL inputs coin-selection will pick for this
  // amount (mirrors class/bch2-transaction.ts) so the approved total matches the
  // signed tx. Until the UTXO set loads we fall back to a single-input estimate
  // that is clearly labeled as "may increase".
  const selection =
    utxoValues !== null && utxoValues.length > 0 && amountInSats > 0
      ? computeSelectedFee(utxoValues, amountInSats, feePerByte, perInput, perOutput, overhead)
      : null;
  const feeIsExact = selection !== null;
  const feeInSats = selection ? selection.fee : feePerByte * estimateTxSize(1, 2, perInput, perOutput, overhead);
  const totalInSats = amountInSats + feeInSats;

  const validateAddress = (addr: string): boolean => {
    if (!addr) return false;
    if (isBC2) {
      // BC2 has SegWit + Taproot: accept legacy base58 (1.../3...) AND bc1/bc1p.
      // Validate via the tx builder's own rules so the UI accepts exactly what
      // can actually be sent (previously this rejected all bc1/bc1p recipients).
      return isValidRecipientAddress(addr, true);
    } else {
      // BCH2 CashAddr format with full polymod checksum verification
      const normalizedAddr = addr.toLowerCase();
      // Reject BCH addresses (wrong chain)
      if (normalizedAddr.startsWith('bitcoincash:') || normalizedAddr.startsWith('bchtest:')) {
        return false;
      }
      // Require bitcoincashii: prefix for BCH2 addresses
      if (!normalizedAddr.startsWith('bitcoincashii:')) {
        return false;
      }
      // Validate CashAddr checksum using decodeCashAddr
      try {
        decodeCashAddr(addr);
        return true;
      } catch {
        return false;
      }
    }
  };

  const handleMaxAmount = useCallback(() => {
    if (utxoValues && utxoValues.length > 0) {
      // MAX spends ALL mature UTXOs into one recipient output (no change), so
      // subtract the fee for the ACTUAL input count. A 1-input fee underestimates
      // and makes MAX fail for wallets with 2+ UTXOs (LOW #32).
      const total = utxoValues.reduce((s, v) => s + v, 0);
      const maxFee = estimateTxSize(utxoValues.length, 1, perInput, perOutput, overhead) * feePerByte;
      const maxSats = total - maxFee;
      if (maxSats > 0) setAmount(formatBalance(maxSats));
      return;
    }
    // Fallback (UTXO set unavailable): conservative single-input estimate.
    const maxSats = walletBalance - feePerByte * estimateTxSize(1, 1, perInput, perOutput, overhead);
    if (maxSats > 0) {
      setAmount(formatBalance(maxSats));
    }
  }, [utxoValues, walletBalance, feePerByte, perInput]);

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

    // Block if the real (multi-input) total exceeds balance, or coin-selection
    // cannot cover amount+fee with the available UTXOs.
    if (totalInSats > walletBalance || (selection !== null && !selection.sufficient)) {
      Alert.alert('Insufficient Balance', 'You do not have enough balance for this transaction');
      return;
    }

    if (amountInSats < 546) {
      Alert.alert('Dust Amount', 'Amount is too small. Minimum is 546 satoshis');
      return;
    }

    setStep('confirm');
  }, [toAddress, amountInSats, totalInSats, walletBalance, coinSymbol, selection]);

  const handleSend = useCallback(async () => {
    if (!onSend) {
      Alert.alert('Error', 'Send function not configured');
      return;
    }
    if (sendingRef.current) return; // Prevent double-tap
    sendingRef.current = true;

    setLoading(true);
    try {
      const clampedFee = Math.min(1000, Math.max(1, parseInt(fee) || 1));
      const result = await onSend(toAddress, amountInSats, clampedFee);
      setTxid(result.txid);
      setStep('success');
    } catch (error: any) {
      if (!error?.__cancelled) {
        const msg = error?.message || '';
        const safeMsg = msg.includes('dust') ? 'Transaction amount is too small'
          : msg.includes('insufficient') ? 'Insufficient funds for this transaction'
          : msg.includes('mempool') ? 'Transaction rejected by network. Please try again.'
          : 'Failed to broadcast transaction. Please check your connection and try again.';
        Alert.alert('Transaction Failed', safeMsg);
      }
    } finally {
      setLoading(false);
      sendingRef.current = false;
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
            <Text style={[styles.balanceValue, { color: primaryColor }]} numberOfLines={1} adjustsFontSizeToFit>
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
            maxLength={120}
            accessibilityLabel={`Recipient ${coinSymbol} address`}
          />
        </View>

        {/* Amount */}
        <View style={styles.inputGroup}>
          <View style={styles.inputLabelRow}>
            <Text style={styles.inputLabel}>Amount ({coinSymbol})</Text>
            <TouchableOpacity onPress={handleMaxAmount} accessibilityLabel="Set maximum amount" accessibilityRole="button">
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
            maxLength={18}
            accessibilityLabel={`Amount in ${coinSymbol}`}
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
                accessibilityLabel={`Fee: ${feeOption} satoshi per byte${fee === feeOption ? ', selected' : ''}`}
                accessibilityRole="button"
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
            Estimated fee: ~{feeInSats} sats ({formatBalance(feeInSats)} {coinSymbol}){!feeIsExact ? ' (may increase)' : ''}
          </Text>
        </View>

        {/* Summary */}
        {amountInSats > 0 && (
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Amount</Text>
              <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit>{formatBalance(amountInSats)} {coinSymbol}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Fee</Text>
              <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit>{formatBalance(feeInSats)} {coinSymbol}</Text>
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
          accessibilityLabel="Continue to confirm transaction"
          accessibilityRole="button"
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
              <Text style={[styles.confirmValue, { fontSize: 12, flex: 1, textAlign: 'right' }]} selectable numberOfLines={3} adjustsFontSizeToFit>{toAddress}</Text>
            </View>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Amount</Text>
              <Text style={[styles.confirmValueLarge, { color: primaryColor }]} numberOfLines={1} adjustsFontSizeToFit>
                {formatBalance(amountInSats)} {coinSymbol}
              </Text>
            </View>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Fee</Text>
              <Text style={styles.confirmValue}>{formatBalance(feeInSats)} {coinSymbol}{!feeIsExact ? ' (est.)' : ''}</Text>
            </View>
            <View style={[styles.confirmRow, styles.confirmTotal]}>
              <Text style={styles.confirmTotalLabel}>Total</Text>
              <Text style={styles.confirmTotalValue} numberOfLines={1} adjustsFontSizeToFit>
                {formatBalance(totalInSats)} {coinSymbol}
              </Text>
            </View>
          </View>

          <View style={styles.confirmActions}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setStep('input')}
              disabled={loading}
              accessibilityLabel="Go back to edit transaction"
              accessibilityRole="button"
            >
              <Text style={styles.cancelButtonText}>Back</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.confirmButton, { backgroundColor: primaryColor }]}
              onPress={handleSend}
              disabled={loading}
              accessibilityLabel={`Send ${formatBalance(amountInSats)} ${coinSymbol}`}
              accessibilityRole="button"
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
          accessibilityLabel="Done, return to wallet"
          accessibilityRole="button"
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
    flexShrink: 0,
  },
  balanceValue: {
    fontSize: BCH2Typography.fontSize.base,
    fontWeight: BCH2Typography.fontWeight.semibold,
    fontFamily: 'monospace',
    flexShrink: 1,
    textAlign: 'right',
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
    flexShrink: 0,
  },
  summaryValue: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textSecondary,
    fontFamily: 'monospace',
    flexShrink: 1,
    textAlign: 'right',
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
    flexShrink: 0,
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
    flexShrink: 1,
    textAlign: 'right',
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
    flexShrink: 0,
  },
  confirmTotalValue: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.textPrimary,
    fontFamily: 'monospace',
    flexShrink: 1,
    textAlign: 'right',
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
