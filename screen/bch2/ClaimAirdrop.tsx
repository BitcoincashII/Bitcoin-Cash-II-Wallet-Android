/**
 * BCH2 Airdrop Claim Screen
 * Allows users to claim their BCH2 from BC2 wallets
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  Linking,
} from 'react-native';

// Coin logos
const BC2_LOGO = require('../../img/bc2-logo-small.png');
const BCH2_LOGO = require('../../img/bch2-logo-small.png');
import { BCH2Colors, BCH2Spacing, BCH2Typography, BCH2Shadows, BCH2BorderRadius } from '../../components/BCH2Theme';
import { claimFromWIF, claimFromMnemonic, AirdropClaimResult } from '../../class/bch2-airdrop';
import { saveWallet } from '../../class/bch2-wallet-storage';
import { useNavigation } from '@react-navigation/native';
import { PasswordInput, PasswordInputHandle } from '../../components/PasswordInput';

type ImportMode = 'mnemonic' | 'wif';

export const ClaimAirdropScreen: React.FC = () => {
  const navigation = useNavigation();
  const [mode, setMode] = useState<ImportMode>('mnemonic');
  const [input, setInput] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<AirdropClaimResult[]>([]);
  const [totalClaimable, setTotalClaimable] = useState(0);
  const [showBitcoinCoreHelp, setShowBitcoinCoreHelp] = useState(false);
  const [showPasswordStep, setShowPasswordStep] = useState(false);
  const [walletPassword, setWalletPassword] = useState('');
  const [walletConfirmPassword, setWalletConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const claimPasswordRef = useRef<PasswordInputHandle>(null);
  const claimConfirmPasswordRef = useRef<PasswordInputHandle>(null);

  const handleClaim = useCallback(async () => {
    if (!input.trim()) {
      Alert.alert('Error', 'Please enter your seed phrase or private key');
      return;
    }

    setLoading(true);
    setResults([]);

    try {
      let claimResults: AirdropClaimResult[];

      if (mode === 'mnemonic') {
        claimResults = await claimFromMnemonic(input.trim(), passphrase);
      } else {
        const result = await claimFromWIF(input.trim());
        claimResults = [result];
      }

      setResults(claimResults);

      const total = claimResults
        .filter(r => r.success)
        .reduce((sum, r) => sum + r.balance, 0);
      setTotalClaimable(total);

      // Anti-gaming: airdrop portion = min(bch2, bc2) per address
      const airdropTotal = claimResults
        .filter(r => r.success)
        .reduce((sum, r) => {
          const bc2 = r.bc2Balance ?? 0;
          return sum + Math.min(r.balance, bc2);
        }, 0);
      const postForkTotal = total - airdropTotal;

      if (total > 0) {
        let message = `You have ${(total / 100000000).toFixed(8)} BCH2 available.`;

        if (postForkTotal > 0 && airdropTotal === 0) {
          message += `\n\n⚠️ Warning: No matching BC2 balance found. This BCH2 may have been received after the fork and is not from the airdrop.`;
        } else if (postForkTotal > 0) {
          message += `\n\n${(airdropTotal / 100000000).toFixed(8)} BCH2 from airdrop`;
          message += `\n${(postForkTotal / 100000000).toFixed(8)} BCH2 exceeds BC2 balance (may be post-fork)`;
        }

        Alert.alert('BCH2 Found!', message);
      } else if (claimResults[0]?.error) {
        Alert.alert('Error', claimResults[0].error);
      } else {
        Alert.alert('No Balance', 'No BCH2 balance found for this wallet');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to check balance');
    } finally {
      setLoading(false);
    }
  }, [input, passphrase, mode]);

  const formatBalance = (sats: number): string => {
    return (sats / 100000000).toFixed(8);
  };

  const handleImportWallet = useCallback(async () => {
    if (!input.trim() || totalClaimable === 0) {
      Alert.alert('Error', 'No wallet to import');
      return;
    }

    if (mode === 'mnemonic') {
      // Show password step
      setWalletPassword('');
      setWalletConfirmPassword('');
      setPasswordError('');
      setShowPasswordStep(true);
    } else {
      // WIF import - for now show message that they need to use full import
      Alert.alert(
        'WIF Import',
        'To import a WIF private key, please use the "Add Wallet" screen and select "Import BCH2 Wallet".',
        [{ text: 'OK' }]
      );
    }
  }, [input, mode, totalClaimable]);

  const handleClaimWithPassword = useCallback(async () => {
    setPasswordError('');

    if (walletPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      claimPasswordRef.current?.showError();
      setWalletPassword('');
      return;
    }

    if (walletPassword !== walletConfirmPassword) {
      setPasswordError('Passwords do not match');
      claimConfirmPasswordRef.current?.showError();
      setWalletConfirmPassword('');
      return;
    }

    setImporting(true);
    try {
      const wallet = await saveWallet('Claimed BCH2 Wallet', input.trim(), 'bch2', walletPassword);
      setShowPasswordStep(false);
      Alert.alert(
        'Wallet Imported!',
        `Your BCH2 wallet has been imported with ${formatBalance(totalClaimable)} BCH2`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error: any) {
      Alert.alert('Import Failed', error.message || 'Failed to import wallet');
    } finally {
      setImporting(false);
    }
  }, [input, walletPassword, walletConfirmPassword, totalClaimable, navigation]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Claim Your BCH2</Text>
        <Text style={styles.subtitle}>
          BCH2 forked from BC2 at block 53,200. If you held BC2 at that time,
          you have the same balance on BCH2!
        </Text>
      </View>

      {/* Coin Conversion Visual */}
      <View style={styles.conversionCard}>
        <View style={styles.conversionCoin}>
          <Image source={BC2_LOGO} style={styles.coinLogo} resizeMode="contain" />
          <Text style={styles.coinLabel}>BC2</Text>
        </View>
        <Text style={styles.conversionArrow}>→</Text>
        <View style={styles.conversionCoin}>
          <Image source={BCH2_LOGO} style={styles.coinLogo} resizeMode="contain" />
          <Text style={styles.coinLabelAccent}>BCH2</Text>
        </View>
      </View>

      {/* Info Card */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>How it works</Text>
        <Text style={styles.infoText}>
          1. Enter your BC2 seed phrase or private key{'\n'}
          2. We'll check your BCH2 balance{'\n'}
          3. Import the wallet to send your BCH2
        </Text>
        <View style={styles.securityNote}>
          <Text style={styles.securityNoteText}>
            🔒 Your keys never leave your device
          </Text>
        </View>
      </View>

      {/* Bitcoin Core Help */}
      <TouchableOpacity
        style={styles.helpToggle}
        onPress={() => setShowBitcoinCoreHelp(!showBitcoinCoreHelp)}
      >
        <Text style={styles.helpToggleText}>
          {showBitcoinCoreHelp ? '▼' : '▶'} Using Bitcoin Core? (bc1 addresses)
        </Text>
      </TouchableOpacity>

      {showBitcoinCoreHelp && (
        <View style={styles.bitcoinCoreHelp}>
          <Text style={styles.helpTitle}>Bitcoin Core / BC2 Core Users</Text>
          <Text style={styles.helpText}>
            Bitcoin Core uses descriptors instead of seed phrases. To claim your BCH2 from bc1 addresses:
          </Text>

          <View style={styles.helpStep}>
            <Text style={styles.helpStepNumber}>1</Text>
            <View style={styles.helpStepContent}>
              <Text style={styles.helpStepTitle}>Find addresses with balance</Text>
              <Text style={styles.helpCode}>bitcoin-cli listunspent</Text>
            </View>
          </View>

          <View style={styles.helpStep}>
            <Text style={styles.helpStepNumber}>2</Text>
            <View style={styles.helpStepContent}>
              <Text style={styles.helpStepTitle}>Export private key for each bc1 address</Text>
              <Text style={styles.helpCode}>bitcoin-cli dumpprivkey bc1q...</Text>
              <Text style={styles.helpNote}>Returns WIF like: L1aW4aubDFB7yfras...</Text>
            </View>
          </View>

          <View style={styles.helpStep}>
            <Text style={styles.helpStepNumber}>3</Text>
            <View style={styles.helpStepContent}>
              <Text style={styles.helpStepTitle}>Paste the WIF key above</Text>
              <Text style={styles.helpNote}>Select "Private Key" mode and paste the WIF</Text>
            </View>
          </View>

          <View style={styles.helpWarning}>
            <Text style={styles.helpWarningText}>
              ⚠️ For legacy wallets (non-descriptor), you may need to run:{'\n'}
              <Text style={styles.helpCode}>bitcoin-cli -rpcwallet=wallet_name dumpprivkey "address"</Text>
            </Text>
          </View>

          <Text style={styles.helpText}>
            The same private key works for both bc1 (SegWit) and legacy addresses. We automatically check both.
          </Text>
        </View>
      )}

      {/* Mode Selector */}
      <View style={styles.modeSelector}>
        <TouchableOpacity
          style={[styles.modeButton, mode === 'mnemonic' && styles.modeButtonActive]}
          onPress={() => setMode('mnemonic')}
        >
          <Text style={[styles.modeButtonText, mode === 'mnemonic' && styles.modeButtonTextActive]}>
            Seed Phrase
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeButton, mode === 'wif' && styles.modeButtonActive]}
          onPress={() => setMode('wif')}
        >
          <Text style={[styles.modeButtonText, mode === 'wif' && styles.modeButtonTextActive]}>
            Private Key
          </Text>
        </TouchableOpacity>
      </View>

      {/* Input */}
      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>
          {mode === 'mnemonic' ? '12/24 Word Seed Phrase' : 'WIF Private Key'}
        </Text>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={mode === 'mnemonic'
            ? 'Enter your seed phrase...'
            : 'Enter your private key (WIF format)...'}
          placeholderTextColor={BCH2Colors.textMuted}
          multiline={mode === 'mnemonic'}
          numberOfLines={mode === 'mnemonic' ? 3 : 1}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={mode === 'wif'}
        />
      </View>

      {/* Passphrase (optional for mnemonic) */}
      {mode === 'mnemonic' && (
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Passphrase (optional)</Text>
          <TextInput
            style={styles.input}
            value={passphrase}
            onChangeText={setPassphrase}
            placeholder="BIP39 passphrase if used..."
            placeholderTextColor={BCH2Colors.textMuted}
            secureTextEntry
          />
        </View>
      )}

      {/* Claim Button */}
      <TouchableOpacity
        style={[styles.claimButton, loading && styles.claimButtonDisabled]}
        onPress={handleClaim}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={BCH2Colors.textPrimary} />
        ) : (
          <Text style={styles.claimButtonText}>Check BCH2 Balance</Text>
        )}
      </TouchableOpacity>

      {/* Results */}
      {results.length > 0 && (
        <View style={styles.resultsContainer}>
          <Text style={styles.resultsTitle}>Results</Text>

          {totalClaimable > 0 && (
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Total Claimable</Text>
              <Text style={styles.totalAmount}>{formatBalance(totalClaimable)} BCH2</Text>
            </View>
          )}

          {results.filter(r => r.success && r.balance > 0).map((result, index) => {
            const bc2 = result.bc2Balance ?? 0;
            const excess = result.balance - Math.min(result.balance, bc2);
            return (
              <View key={index} style={styles.resultCard}>
                {excess > 0 && bc2 === 0 && (
                  <View style={styles.warningBadge}>
                    <Text style={styles.warningBadgeText}>⚠️ No matching BC2 balance</Text>
                  </View>
                )}
                {excess > 0 && bc2 > 0 && (
                  <View style={styles.warningBadge}>
                    <Text style={styles.warningBadgeText}>⚠️ {formatBalance(excess)} BCH2 exceeds BC2 balance</Text>
                  </View>
                )}
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>{result.address.startsWith('bc1') ? 'SegWit Address' : 'BC2 Address'}</Text>
                  <Text style={styles.resultValue}>{result.address}</Text>
                </View>
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>BCH2 Address</Text>
                  <Text style={styles.resultValueAccent}>{result.bch2Address}</Text>
                </View>
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>Balance</Text>
                  <Text style={styles.resultBalance}>{formatBalance(result.balance)} BCH2</Text>
                </View>
                {bc2 > 0 && (
                  <View style={styles.resultRow}>
                    <Text style={styles.resultLabel}>BC2 Balance</Text>
                    <Text style={styles.resultValue}>{formatBalance(bc2)} BC2</Text>
                  </View>
                )}
              </View>
            );
          })}

          {totalClaimable > 0 && !showPasswordStep && (
            <TouchableOpacity
              style={[styles.importButton, importing && styles.claimButtonDisabled]}
              onPress={handleImportWallet}
              disabled={importing}
            >
              {importing ? (
                <ActivityIndicator color={BCH2Colors.textPrimary} />
              ) : (
                <Text style={styles.importButtonText}>Import Wallet</Text>
              )}
            </TouchableOpacity>
          )}

          {showPasswordStep && (
            <View style={styles.passwordStepCard}>
              <Text style={styles.passwordStepTitle}>Set Wallet Password</Text>
              <Text style={styles.passwordStepSubtitle}>
                This password encrypts your recovery phrase.
              </Text>

              <View style={styles.passwordInputGroup}>
                <Text style={styles.inputLabel}>Password (min. 8 characters)</Text>
                <PasswordInput
                  ref={claimPasswordRef}
                  onSubmit={() => claimConfirmPasswordRef.current?.focus()}
                  placeholder="Enter password"
                  onChangeText={setWalletPassword}
                />
              </View>

              <View style={styles.passwordInputGroup}>
                <Text style={styles.inputLabel}>Confirm Password</Text>
                <PasswordInput
                  ref={claimConfirmPasswordRef}
                  onSubmit={handleClaimWithPassword}
                  placeholder="Confirm password"
                  onChangeText={setWalletConfirmPassword}
                />
              </View>

              {passwordError ? (
                <Text style={styles.passwordError}>{passwordError}</Text>
              ) : null}

              <TouchableOpacity
                style={[styles.importButton, importing && styles.claimButtonDisabled]}
                onPress={handleClaimWithPassword}
                disabled={importing}
              >
                {importing ? (
                  <ActivityIndicator color={BCH2Colors.textPrimary} />
                ) : (
                  <Text style={styles.importButtonText}>Set Password & Import</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.cancelPasswordButton}
                onPress={() => setShowPasswordStep(false)}
              >
                <Text style={styles.cancelPasswordText}>Back</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </ScrollView>
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
  subtitle: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.textSecondary,
    lineHeight: 22,
  },
  conversionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.lg,
    padding: BCH2Spacing.lg,
    marginBottom: BCH2Spacing.lg,
  },
  conversionCoin: {
    alignItems: 'center',
  },
  coinLogo: {
    width: 56,
    height: 56,
    marginBottom: BCH2Spacing.sm,
  },
  coinLabel: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.bc2Primary,
  },
  coinLabelAccent: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.primary,
  },
  conversionArrow: {
    fontSize: 32,
    color: BCH2Colors.textMuted,
    marginHorizontal: BCH2Spacing.xl,
  },
  infoCard: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.lg,
    padding: BCH2Spacing.lg,
    marginBottom: BCH2Spacing.xl,
    borderLeftWidth: 3,
    borderLeftColor: BCH2Colors.primary,
  },
  infoTitle: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.semibold,
    color: BCH2Colors.textPrimary,
    marginBottom: BCH2Spacing.sm,
  },
  infoText: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.textSecondary,
    lineHeight: 24,
  },
  securityNote: {
    marginTop: BCH2Spacing.md,
    paddingTop: BCH2Spacing.md,
    borderTopWidth: 1,
    borderTopColor: BCH2Colors.border,
  },
  securityNoteText: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.primary,
  },
  modeSelector: {
    flexDirection: 'row',
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.xs,
    marginBottom: BCH2Spacing.lg,
  },
  modeButton: {
    flex: 1,
    paddingVertical: BCH2Spacing.sm,
    alignItems: 'center',
    borderRadius: BCH2BorderRadius.sm,
  },
  modeButtonActive: {
    backgroundColor: BCH2Colors.primary,
  },
  modeButtonText: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.textMuted,
    fontWeight: BCH2Typography.fontWeight.medium,
  },
  modeButtonTextActive: {
    color: BCH2Colors.textPrimary,
  },
  inputContainer: {
    marginBottom: BCH2Spacing.lg,
  },
  inputLabel: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textSecondary,
    marginBottom: BCH2Spacing.sm,
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
  claimButton: {
    backgroundColor: BCH2Colors.primary,
    borderRadius: BCH2BorderRadius.md,
    paddingVertical: BCH2Spacing.md,
    alignItems: 'center',
    ...BCH2Shadows.glow,
  },
  claimButtonDisabled: {
    opacity: 0.7,
  },
  claimButtonText: {
    color: BCH2Colors.textPrimary,
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
  },
  resultsContainer: {
    marginTop: BCH2Spacing.xl,
  },
  resultsTitle: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.semibold,
    color: BCH2Colors.textPrimary,
    marginBottom: BCH2Spacing.md,
  },
  totalCard: {
    backgroundColor: BCH2Colors.primaryGlow,
    borderRadius: BCH2BorderRadius.lg,
    padding: BCH2Spacing.lg,
    marginBottom: BCH2Spacing.md,
    borderWidth: 1,
    borderColor: BCH2Colors.primary,
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textSecondary,
    marginBottom: BCH2Spacing.xs,
  },
  totalAmount: {
    fontSize: BCH2Typography.fontSize.xxl,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.primary,
    fontFamily: 'monospace',
  },
  resultCard: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.md,
    marginBottom: BCH2Spacing.sm,
  },
  warningBadge: {
    backgroundColor: '#FFA500',
    borderRadius: BCH2BorderRadius.sm,
    paddingHorizontal: BCH2Spacing.sm,
    paddingVertical: BCH2Spacing.xs,
    marginBottom: BCH2Spacing.sm,
  },
  warningBadgeText: {
    color: '#000',
    fontSize: BCH2Typography.fontSize.xs,
    fontWeight: BCH2Typography.fontWeight.medium,
    textAlign: 'center',
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: BCH2Spacing.xs,
  },
  resultLabel: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textMuted,
  },
  resultValue: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textSecondary,
    fontFamily: 'monospace',
    maxWidth: '60%',
  },
  resultValueAccent: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.primary,
    fontFamily: 'monospace',
    maxWidth: '60%',
  },
  resultBalance: {
    fontSize: BCH2Typography.fontSize.md,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.success,
    fontFamily: 'monospace',
  },
  importButton: {
    backgroundColor: BCH2Colors.primary,
    borderRadius: BCH2BorderRadius.md,
    paddingVertical: BCH2Spacing.md,
    alignItems: 'center',
    marginTop: BCH2Spacing.md,
  },
  importButtonText: {
    color: BCH2Colors.textPrimary,
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
  },
  passwordStepCard: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.lg,
    padding: BCH2Spacing.lg,
    marginTop: BCH2Spacing.md,
    borderWidth: 1,
    borderColor: BCH2Colors.primary,
  },
  passwordStepTitle: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.textPrimary,
    textAlign: 'center',
    marginBottom: BCH2Spacing.xs,
  },
  passwordStepSubtitle: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textSecondary,
    textAlign: 'center',
    marginBottom: BCH2Spacing.lg,
  },
  passwordInputGroup: {
    marginBottom: BCH2Spacing.md,
  },
  passwordError: {
    color: '#fc8181',
    fontSize: BCH2Typography.fontSize.sm,
    textAlign: 'center',
    marginBottom: BCH2Spacing.md,
  },
  cancelPasswordButton: {
    paddingVertical: BCH2Spacing.md,
    alignItems: 'center',
  },
  cancelPasswordText: {
    color: BCH2Colors.textSecondary,
    fontSize: BCH2Typography.fontSize.base,
  },
  helpToggle: {
    paddingVertical: BCH2Spacing.md,
    marginBottom: BCH2Spacing.sm,
  },
  helpToggleText: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.primary,
    fontWeight: BCH2Typography.fontWeight.medium,
  },
  bitcoinCoreHelp: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.lg,
    padding: BCH2Spacing.lg,
    marginBottom: BCH2Spacing.xl,
    borderWidth: 1,
    borderColor: BCH2Colors.border,
  },
  helpTitle: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.textPrimary,
    marginBottom: BCH2Spacing.md,
  },
  helpText: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textSecondary,
    lineHeight: 20,
    marginBottom: BCH2Spacing.md,
  },
  helpStep: {
    flexDirection: 'row',
    marginBottom: BCH2Spacing.md,
  },
  helpStepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: BCH2Colors.primary,
    color: BCH2Colors.textPrimary,
    textAlign: 'center',
    lineHeight: 24,
    fontSize: BCH2Typography.fontSize.sm,
    fontWeight: BCH2Typography.fontWeight.bold,
    marginRight: BCH2Spacing.sm,
  },
  helpStepContent: {
    flex: 1,
  },
  helpStepTitle: {
    fontSize: BCH2Typography.fontSize.sm,
    fontWeight: BCH2Typography.fontWeight.semibold,
    color: BCH2Colors.textPrimary,
    marginBottom: BCH2Spacing.xs,
  },
  helpCode: {
    fontFamily: 'monospace',
    fontSize: BCH2Typography.fontSize.xs,
    color: BCH2Colors.primary,
    backgroundColor: BCH2Colors.background,
    padding: BCH2Spacing.xs,
    borderRadius: BCH2BorderRadius.sm,
    overflow: 'hidden',
  },
  helpNote: {
    fontSize: BCH2Typography.fontSize.xs,
    color: BCH2Colors.textMuted,
    marginTop: BCH2Spacing.xs,
    fontStyle: 'italic',
  },
  helpWarning: {
    backgroundColor: 'rgba(255, 165, 0, 0.1)',
    borderRadius: BCH2BorderRadius.sm,
    padding: BCH2Spacing.sm,
    marginVertical: BCH2Spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: '#FFA500',
  },
  helpWarningText: {
    fontSize: BCH2Typography.fontSize.xs,
    color: BCH2Colors.textSecondary,
    lineHeight: 18,
  },
});

export default ClaimAirdropScreen;
