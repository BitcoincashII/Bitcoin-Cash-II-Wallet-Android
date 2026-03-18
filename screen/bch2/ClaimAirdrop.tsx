/**
 * BCH2 Airdrop Claim Wizard
 * Guided 5-step flow to claim BCH2 from BC2 wallets
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
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
} from 'react-native';

const BC2_LOGO = require('../../img/bc2-logo-small.png');
const BCH2_LOGO = require('../../img/bch2-logo-small.png');
import { BCH2Colors, BCH2Spacing, BCH2Typography, BCH2Shadows, BCH2BorderRadius } from '../../components/BCH2Theme';
import {
  claimFromWIF,
  claimFromMnemonic,
  scanDescriptorForAirdrop,
  getAntiGamingStatus,
  buildScanResult,
  AirdropClaimResult,
  AirdropScanResult,
} from '../../class/bch2-airdrop';
import { saveWallet } from '../../class/bch2-wallet-storage';
import { useNavigation } from '@react-navigation/native';
import { PasswordInput, PasswordInputHandle } from '../../components/PasswordInput';
import { useScreenProtect } from '../../hooks/useScreenProtect';

// ============================================================================
// Types & Config
// ============================================================================

type WalletTypeId = 'bitcoin-core' | 'electrum' | 'mobile-bip39' | 'hardware' | 'paper-wallet' | 'other';
type InputMode = 'wif' | 'phrase' | 'descriptor';

interface WalletTypeConfig {
  id: WalletTypeId;
  label: string;
  icon: string;
  description: string;
  inputMode: InputMode;
  inputLabel: string;
  inputPlaceholder: string;
  multiline: boolean;
  warning?: string;
  helperText: string;
  instructions: string[];
}

const WALLET_TYPES: WalletTypeConfig[] = [
  {
    id: 'bitcoin-core',
    label: 'Bitcoin Core',
    icon: '>_',
    description: 'Full node wallet',
    inputMode: 'descriptor',
    inputLabel: 'Descriptor or WIF',
    inputPlaceholder: 'Paste listdescriptors output, xprv, or WIF...',
    multiline: true,
    helperText: 'Accepts listdescriptors JSON, xprv key, or single WIF',
    instructions: [
      'Open Bitcoin Core and go to Window > Console',
      'If encrypted, run: walletpassphrase "your-passphrase" 60',
      'Run: listdescriptors true',
      'Copy the entire JSON output and paste it below',
    ],
  },
  {
    id: 'electrum',
    label: 'Electrum',
    icon: '\u26A1',
    description: 'Desktop wallet',
    inputMode: 'phrase',
    inputLabel: '12-Word Recovery Phrase',
    inputPlaceholder: 'Enter your 12 words separated by spaces',
    multiline: true,
    helperText: 'Scans BIP44, BIP84, BIP49, BIP86 paths',
    instructions: [
      'Open Electrum and go to Wallet > Seed',
      'Enter your wallet password when prompted',
      'Copy the 12-word seed phrase shown',
      'Paste it into the field below',
    ],
  },
  {
    id: 'mobile-bip39',
    label: 'Mobile / BIP39',
    icon: '\uD83D\uDCF1',
    description: 'Trust Wallet, Coinomi, etc.',
    inputMode: 'phrase',
    inputLabel: '12/24-Word Recovery Phrase',
    inputPlaceholder: 'Enter your recovery words separated by spaces',
    multiline: true,
    helperText: 'Scans BIP44, BIP84, BIP49, BIP86 paths',
    instructions: [
      'Open your wallet app and go to Settings > Security',
      'Find "Show Recovery Phrase" or "Backup Wallet"',
      'Authenticate and copy your 12 or 24 word phrase',
      'Paste it into the field below',
    ],
  },
  {
    id: 'hardware',
    label: 'Hardware Wallet',
    icon: '\uD83D\uDD11',
    description: 'Ledger, Trezor, etc.',
    inputMode: 'phrase',
    inputLabel: 'Recovery Phrase',
    inputPlaceholder: 'Enter the recovery phrase from your hardware wallet backup',
    multiline: true,
    warning: 'Entering your hardware wallet recovery phrase into any software reduces its security. Only proceed if you understand the risk and plan to move funds to a new wallet afterward.',
    helperText: 'Use the 24-word backup phrase that came with your device',
    instructions: [
      'Locate the recovery phrase card that came with your device',
      'Carefully type each word in order into the field below',
      'After claiming, consider generating a new wallet on the device',
    ],
  },
  {
    id: 'paper-wallet',
    label: 'Paper Wallet',
    icon: '\uD83D\uDCC4',
    description: 'Single private key (WIF)',
    inputMode: 'wif',
    inputLabel: 'Private Key (WIF)',
    inputPlaceholder: '5K... or L... or K...',
    multiline: false,
    helperText: 'Checks Legacy, bc1, 3xxx, and bc1p addresses',
    instructions: [
      'Find your paper wallet or backup with the private key',
      'The key starts with 5, K, or L',
      'Type or paste the full WIF private key into the field below',
    ],
  },
  {
    id: 'other',
    label: 'Other / Unsure',
    icon: '?',
    description: 'Choose input format',
    inputMode: 'wif',
    inputLabel: 'Private Key (WIF)',
    inputPlaceholder: '5K... or L... or K...',
    multiline: false,
    helperText: 'Select the tab matching your input type',
    instructions: [
      'Choose the input type that matches what you have',
      'WIF: a single private key starting with 5, K, or L',
      'Phrase: a 12 or 24-word BIP39 recovery phrase',
      'Descriptor: Bitcoin Core descriptor output or xprv key',
    ],
  },
];

// ============================================================================
// Step Progress Component
// ============================================================================

function StepProgress({ current }: { current: number }) {
  const totalSteps = 5;
  const elements: React.ReactNode[] = [];
  for (let i = 0; i < totalSteps; i++) {
    if (i > 0) {
      elements.push(
        <View
          key={`line-${i}`}
          style={[styles.stepLine, i <= current && styles.stepLineCompleted]}
        />,
      );
    }
    elements.push(
      <View
        key={`dot-${i}`}
        style={[
          styles.stepDot,
          i === current && styles.stepDotActive,
          i < current && styles.stepDotCompleted,
        ]}
      />,
    );
  }
  return <View style={styles.stepProgress}>{elements}</View>;
}

// ============================================================================
// Main Component
// ============================================================================

export const ClaimAirdropScreen: React.FC = () => {
  const navigation = useNavigation();
  const { enableScreenProtect, disableScreenProtect } = useScreenProtect();

  // Wizard state
  const [step, setStep] = useState(0);
  const [walletType, setWalletType] = useState<WalletTypeId | null>(null);
  const [otherInputType, setOtherInputType] = useState<InputMode>('wif');

  // Input state
  const [wifInput, setWifInput] = useState('');
  const [phraseInput, setPhraseInput] = useState('');
  const [descriptorInput, setDescriptorInput] = useState('');
  const [passphrase, setPassphrase] = useState('');

  // Scan results
  const [scanResult, setScanResult] = useState<AirdropScanResult | null>(null);
  const [scanProgress, setScanProgress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [antiGamingWarning, setAntiGamingWarning] = useState<string | null>(null);
  const [antiGamingBlocked, setAntiGamingBlocked] = useState(false);

  // Import state
  const [storedCredentials, setStoredCredentials] = useState<{ type: InputMode; value: string } | null>(null);
  const [showPasswordStep, setShowPasswordStep] = useState(false);
  const [walletPassword, setWalletPassword] = useState('');
  const [walletConfirmPassword, setWalletConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [importing, setImporting] = useState(false);

  const claimPasswordRef = useRef<PasswordInputHandle>(null);
  const claimConfirmPasswordRef = useRef<PasswordInputHandle>(null);

  // Refs to avoid stale closures
  const wifRef = useRef(wifInput);
  wifRef.current = wifInput;
  const phraseRef = useRef(phraseInput);
  phraseRef.current = phraseInput;
  const descriptorRef = useRef(descriptorInput);
  descriptorRef.current = descriptorInput;

  // Enable screenshot protection when sensitive inputs have content
  useEffect(() => {
    const hasSensitiveInput = !!(wifInput || phraseInput || descriptorInput);
    if (hasSensitiveInput) {
      enableScreenProtect();
    } else {
      disableScreenProtect();
    }
    return () => { disableScreenProtect(); };
  }, [wifInput, phraseInput, descriptorInput]);

  // Clear sensitive state on unmount
  useEffect(() => {
    return () => {
      setWifInput('');
      setPhraseInput('');
      setDescriptorInput('');
      setPassphrase('');
      setWalletPassword('');
      setWalletConfirmPassword('');
      setStoredCredentials(null);
    };
  }, []);

  // ============================================================================
  // Helpers
  // ============================================================================

  const getEffectiveInputMode = (): InputMode => {
    if (!walletType) return 'wif';
    if (walletType === 'other') return otherInputType;
    const config = WALLET_TYPES.find(w => w.id === walletType);
    return config?.inputMode ?? 'wif';
  };

  const getWalletConfig = (): WalletTypeConfig | undefined => {
    return WALLET_TYPES.find(w => w.id === walletType);
  };

  const getEffectiveConfig = () => {
    if (walletType === 'other') {
      if (otherInputType === 'phrase') {
        return { inputLabel: 'Recovery Phrase', inputPlaceholder: 'Enter your recovery words...', multiline: true, helperText: 'BIP39 12 or 24 word phrase' };
      }
      if (otherInputType === 'descriptor') {
        return { inputLabel: 'Descriptor or xprv', inputPlaceholder: 'Paste descriptor JSON, xprv, or WIF...', multiline: true, helperText: 'Bitcoin Core descriptor, xprv, or WIF' };
      }
      return { inputLabel: 'Private Key (WIF)', inputPlaceholder: '5K... or L... or K...', multiline: false, helperText: 'Single WIF private key' };
    }
    const config = getWalletConfig();
    return config;
  };

  const hasInput = (): boolean => {
    const mode = getEffectiveInputMode();
    switch (mode) {
      case 'wif': return !!wifRef.current.trim();
      case 'phrase': return !!phraseRef.current.trim();
      case 'descriptor': return !!descriptorRef.current.trim();
    }
  };

  const formatBalance = (sats: number): string => {
    return (sats / 100000000).toFixed(8);
  };

  const getAddressTypeLabel = (type?: string) => {
    switch (type) {
      case 'legacy': return 'Legacy (1xxx)';
      case 'bc1': return 'SegWit (bc1)';
      case 'p2sh-segwit': return 'Wrapped SegWit (3xxx)';
      case 'p2tr': return 'Taproot (bc1p)';
      default: return 'Address';
    }
  };

  // ============================================================================
  // Scan Handlers
  // ============================================================================

  const handleScan = useCallback(async () => {
    const mode = getEffectiveInputMode();
    const currentWif = wifRef.current.trim();
    const currentPhrase = phraseRef.current.trim();
    const currentDescriptor = descriptorRef.current.trim();

    setError('');
    setStep(2);
    setLoading(true);
    setScanProgress('Preparing scan...');

    try {
      if (mode === 'wif') {
        setScanProgress('Scanning for claimable balances...');
        const result = await claimFromWIF(currentWif);
        const scanRes = buildScanResult([result]);
        const agStatus = getAntiGamingStatus(scanRes);
        setAntiGamingWarning(agStatus.warning);
        setAntiGamingBlocked(agStatus.blocked);
        setScanResult(scanRes);
        setStoredCredentials({ type: 'wif', value: currentWif });
        setStep(3);
      } else if (mode === 'phrase') {
        setScanProgress('Scanning addresses (BIP44, BIP84, BIP49, BIP86)...');
        const results = await claimFromMnemonic(currentPhrase, passphrase);
        const scanRes = buildScanResult(results);
        const agStatus = getAntiGamingStatus(scanRes);
        setAntiGamingWarning(agStatus.warning);
        setAntiGamingBlocked(agStatus.blocked);
        setScanResult(scanRes);
        setStoredCredentials({ type: 'phrase', value: currentPhrase });
        setStep(3);
      } else {
        // Descriptor mode — auto-detect WIF
        const wifPattern = /^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/;
        if (wifPattern.test(currentDescriptor)) {
          setScanProgress('Detected WIF key, scanning...');
          const result = await claimFromWIF(currentDescriptor);
          const scanRes = buildScanResult([result]);
          const agStatus = getAntiGamingStatus(scanRes);
          setAntiGamingWarning(agStatus.warning);
          setAntiGamingBlocked(agStatus.blocked);
          setScanResult(scanRes);
          setStoredCredentials({ type: 'wif', value: currentDescriptor });
          setStep(3);
        } else {
          setScanProgress('Parsing descriptors...');
          const scanRes = await scanDescriptorForAirdrop(currentDescriptor);
          const agStatus = getAntiGamingStatus(scanRes);
          setAntiGamingWarning(agStatus.warning);
          setAntiGamingBlocked(agStatus.blocked);
          setScanResult(scanRes);
          setStoredCredentials({ type: 'descriptor', value: currentDescriptor });
          setStep(3);
        }
      }
    } catch (err: any) {
      setError('Failed to scan for airdrop');
      setWifInput('');
      setPhraseInput('');
      setDescriptorInput('');
      setPassphrase('');
      setStep(1);
    } finally {
      setLoading(false);
      setScanProgress('');
    }
  }, [passphrase, walletType, otherInputType]);

  // ============================================================================
  // Import Handler
  // ============================================================================

  const handleImportWallet = useCallback(async () => {
    if (!storedCredentials || !scanResult || scanResult.totalBalance === 0) {
      Alert.alert('Error', 'No wallet to import');
      return;
    }

    if (storedCredentials.type === 'phrase') {
      setWalletPassword('');
      setWalletConfirmPassword('');
      setPasswordError('');
      setShowPasswordStep(true);
    } else if (storedCredentials.type === 'wif') {
      Alert.alert(
        'WIF Import',
        'To import a WIF private key, please use the "Add Wallet" screen and select "Import BCH2 Wallet".',
        [{ text: 'OK' }],
      );
    } else {
      // Descriptor — can't directly import, guide user
      Alert.alert(
        'Descriptor Wallet',
        'Descriptor wallets cannot be directly imported. To claim your BCH2:\n\n' +
        '1. Open Bitcoin Core console\n' +
        '2. Run: dumpprivkey <address>\n' +
        '3. Use the WIF key with "Add Wallet" > "Import BCH2"',
        [{ text: 'OK' }],
      );
    }
  }, [storedCredentials, scanResult]);

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
      await saveWallet('Claimed BCH2 Wallet', storedCredentials!.value, 'bch2', walletPassword);
      // Clear sensitive data
      setWifInput('');
      setPhraseInput('');
      setDescriptorInput('');
      setPassphrase('');
      setWalletPassword('');
      setWalletConfirmPassword('');
      setStoredCredentials(null);
      setShowPasswordStep(false);
      setStep(4);
    } catch (error: any) {
      Alert.alert('Import Failed', 'Failed to import wallet');
    } finally {
      setImporting(false);
    }
  }, [walletPassword, walletConfirmPassword, storedCredentials, navigation]);

  // ============================================================================
  // Step 0: Wallet Selection
  // ============================================================================

  if (step === 0) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.headerCenter}>
          <Image source={BCH2_LOGO} style={styles.headerLogo} resizeMode="contain" />
          <Text style={styles.title}>Claim BCH2 Airdrop</Text>
          <Text style={styles.subtitle}>
            What wallet software holds your BC2/BTC keys?
          </Text>
        </View>

        {/* Coin Conversion Visual */}
        <View style={styles.conversionCard}>
          <View style={styles.conversionCoin}>
            <Image source={BC2_LOGO} style={styles.coinLogo} resizeMode="contain" />
            <Text style={styles.coinLabel}>BC2</Text>
          </View>
          <Text style={styles.conversionArrow}>{'\u2192'}</Text>
          <View style={styles.conversionCoin}>
            <Image source={BCH2_LOGO} style={styles.coinLogo} resizeMode="contain" />
            <Text style={styles.coinLabelAccent}>BCH2</Text>
          </View>
        </View>

        {/* Wallet Type Grid */}
        <View style={styles.walletTypeGrid}>
          {WALLET_TYPES.map(wt => (
            <TouchableOpacity
              key={wt.id}
              style={styles.walletTypeCard}
              onPress={() => {
                setWalletType(wt.id);
                setError('');
                setStep(1);
              }}
              activeOpacity={0.7}
              accessibilityLabel={`${wt.label}, ${wt.description}`}
              accessibilityRole="button"
            >
              <Text style={styles.walletTypeIcon}>{wt.icon}</Text>
              <Text style={styles.walletTypeName}>{wt.label}</Text>
              <Text style={styles.walletTypeDesc}>{wt.description}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Back */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ============================================================================
  // Step 1: Instructions + Input
  // ============================================================================

  if (step === 1) {
    const config = getWalletConfig();
    const effectiveMode = getEffectiveInputMode();
    const effectiveConfig = getEffectiveConfig();

    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <StepProgress current={1} />

        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.walletIcon}>{config?.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.stepTitle}>{config?.label || 'Import Keys'}</Text>
            <Text style={styles.stepSubtitle}>{config?.description}</Text>
          </View>
        </View>

        {/* Security Notice */}
        <View style={styles.securityNote}>
          <Text style={styles.securityNoteText}>
            Your keys never leave your device
          </Text>
        </View>

        {/* Hardware Wallet Warning */}
        {config?.warning && (
          <View style={styles.warningCard}>
            <Text style={styles.warningText}>{config.warning}</Text>
          </View>
        )}

        {/* Instructions */}
        <View style={styles.instructionCard}>
          {config?.instructions.map((instruction, index) => (
            <View key={index} style={styles.instructionRow}>
              <View style={styles.instructionNumber}>
                <Text style={styles.instructionNumberText}>{index + 1}</Text>
              </View>
              <Text style={styles.instructionText}>{instruction}</Text>
            </View>
          ))}
        </View>

        {/* Error */}
        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Tab Bar for "Other" mode */}
        {walletType === 'other' && (
          <View style={styles.modeSelector}>
            {(['wif', 'phrase', 'descriptor'] as InputMode[]).map(mode => (
              <TouchableOpacity
                key={mode}
                style={[styles.modeButton, otherInputType === mode && styles.modeButtonActive]}
                onPress={() => setOtherInputType(mode)}
              >
                <Text style={[styles.modeButtonText, otherInputType === mode && styles.modeButtonTextActive]}>
                  {mode === 'wif' ? 'WIF' : mode === 'phrase' ? 'Phrase' : 'Descriptor'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Input Field */}
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>{effectiveConfig?.inputLabel}</Text>
          {effectiveMode === 'wif' && (
            <TextInput
              style={styles.input}
              value={wifInput}
              onChangeText={setWifInput}
              placeholder={effectiveConfig?.inputPlaceholder}
              placeholderTextColor={BCH2Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              importantForAutofill="no"
              spellCheck={false}
              secureTextEntry
              maxLength={60}
            />
          )}
          {effectiveMode === 'phrase' && (
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={phraseInput}
              onChangeText={setPhraseInput}
              placeholder={effectiveConfig?.inputPlaceholder}
              placeholderTextColor={BCH2Colors.textMuted}
              multiline
              numberOfLines={3}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              importantForAutofill="no"
              spellCheck={false}
              maxLength={500}
            />
          )}
          {effectiveMode === 'descriptor' && (
            <TextInput
              style={[styles.input, styles.inputMultiline, { minHeight: 120 }]}
              value={descriptorInput}
              onChangeText={setDescriptorInput}
              placeholder={effectiveConfig?.inputPlaceholder}
              placeholderTextColor={BCH2Colors.textMuted}
              multiline
              numberOfLines={6}
              maxLength={5000}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              importantForAutofill="no"
              spellCheck={false}
            />
          )}
          <Text style={styles.helperText}>{effectiveConfig?.helperText}</Text>
        </View>

        {/* Passphrase (for mnemonic modes) */}
        {effectiveMode === 'phrase' && (
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Passphrase (optional)</Text>
            <TextInput
              style={styles.input}
              value={passphrase}
              onChangeText={setPassphrase}
              placeholder="BIP39 passphrase if used..."
              placeholderTextColor={BCH2Colors.textMuted}
              secureTextEntry
              autoComplete="off"
              importantForAutofill="no"
              spellCheck={false}
              autoCorrect={false}
              maxLength={256}
            />
          </View>
        )}

        {/* Scan Button */}
        <TouchableOpacity
          style={[styles.primaryButton, (!hasInput() || loading) && styles.buttonDisabled]}
          onPress={handleScan}
          disabled={!hasInput() || loading}
        >
          {loading ? (
            <ActivityIndicator color={BCH2Colors.textPrimary} />
          ) : (
            <Text style={styles.primaryButtonText}>Scan for BCH2</Text>
          )}
        </TouchableOpacity>

        {/* Back */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            setError('');
            setWifInput('');
            setPhraseInput('');
            setDescriptorInput('');
            setPassphrase('');
            setStep(0);
          }}
        >
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ============================================================================
  // Step 2: Scanning Progress
  // ============================================================================

  if (step === 2) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <StepProgress current={2} />

        <View style={styles.scanContainer}>
          <ActivityIndicator size="large" color={BCH2Colors.primary} style={styles.scanSpinner} />
          <Text style={styles.scanTitle}>Scanning...</Text>
          <Text style={styles.scanProgressText}>{scanProgress || 'Looking for claimable BCH2...'}</Text>
        </View>
      </ScrollView>
    );
  }

  // ============================================================================
  // Step 3: Results & Import
  // ============================================================================

  if (step === 3) {
    const claims = scanResult?.claims ?? [];
    const hasClaims = claims.length > 0;

    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <StepProgress current={3} />

        <Text style={styles.stepTitle}>
          {hasClaims ? 'BCH2 Found!' : 'No BCH2 Found'}
        </Text>

        {/* Total Card */}
        {hasClaims && scanResult && (
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>Total Claimable</Text>
            <Text style={styles.totalAmount}>
              {formatBalance(scanResult.totalBalance)} BCH2
            </Text>
          </View>
        )}

        {/* Anti-gaming Warning */}
        {antiGamingWarning && (
          <View style={[styles.warningCard, antiGamingBlocked && styles.errorCard]}>
            <Text style={[styles.warningText, antiGamingBlocked && styles.errorText]}>
              {antiGamingWarning}
            </Text>
          </View>
        )}

        {/* Per-address Results */}
        {claims.map((claim, index) => {
          const bc2 = claim.bc2Balance ?? 0;
          const excess = claim.balance - Math.min(claim.balance, bc2);
          return (
            <View key={index} style={styles.resultCard}>
              {/* Address type badge */}
              <View style={styles.addressTypeBadge}>
                <Text style={styles.addressTypeBadgeText}>
                  {getAddressTypeLabel(claim.addressType)}
                </Text>
              </View>

              {excess > 0 && bc2 === 0 && (
                <View style={styles.warningBadge}>
                  <Text style={styles.warningBadgeText}>No matching BC2 balance</Text>
                </View>
              )}
              {excess > 0 && bc2 > 0 && (
                <View style={styles.warningBadge}>
                  <Text style={styles.warningBadgeText}>
                    {formatBalance(excess)} BCH2 exceeds BC2 balance
                  </Text>
                </View>
              )}

              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>BC2 Address</Text>
                <Text style={styles.resultValue} numberOfLines={1} ellipsizeMode="middle">
                  {claim.address}
                </Text>
              </View>
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>BCH2 Address</Text>
                <Text style={styles.resultValueAccent} numberOfLines={1} ellipsizeMode="middle">
                  {claim.bch2Address}
                </Text>
              </View>
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>Balance</Text>
                <Text style={styles.resultBalance}>
                  {formatBalance(claim.balance)} BCH2
                </Text>
              </View>
              {bc2 > 0 && (
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>BC2 Balance</Text>
                  <Text style={styles.resultValue}>{formatBalance(bc2)} BC2</Text>
                </View>
              )}
              {claim.derivationPath && (
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>Path</Text>
                  <Text style={styles.resultValueMono}>{claim.derivationPath}</Text>
                </View>
              )}
            </View>
          );
        })}

        {/* No Results */}
        {!hasClaims && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              No BCH2 balance found for this wallet. Make sure you had BC2 balance at fork block 53,200.
            </Text>
          </View>
        )}

        {/* Import Button */}
        {hasClaims && !showPasswordStep && (
          <TouchableOpacity
            style={[styles.primaryButton, (importing || antiGamingBlocked) && styles.buttonDisabled]}
            onPress={handleImportWallet}
            disabled={importing || antiGamingBlocked}
          >
            {importing ? (
              <ActivityIndicator color={BCH2Colors.textPrimary} />
            ) : (
              <Text style={styles.primaryButtonText}>Import Wallet</Text>
            )}
          </TouchableOpacity>
        )}

        {/* Password Step */}
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
              style={[styles.primaryButton, importing && styles.buttonDisabled]}
              onPress={handleClaimWithPassword}
              disabled={importing}
            >
              {importing ? (
                <ActivityIndicator color={BCH2Colors.textPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>Set Password & Import</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.backButton}
              onPress={() => setShowPasswordStep(false)}
            >
              <Text style={styles.backButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Back */}
        {!showPasswordStep && (
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              setScanResult(null);
              setAntiGamingWarning(null);
              setAntiGamingBlocked(false);
              setStoredCredentials(null);
              setStep(1);
            }}
          >
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    );
  }

  // ============================================================================
  // Step 4: Success
  // ============================================================================

  if (step === 4) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <StepProgress current={4} />

        <View style={styles.successContainer}>
          <Image source={BCH2_LOGO} style={styles.successLogo} resizeMode="contain" />
          <Text style={styles.successTitle}>Wallet Imported!</Text>
          <Text style={styles.successSubtitle}>
            Your BCH2 wallet has been imported with{' '}
            {formatBalance(scanResult?.totalBalance ?? 0)} BCH2
          </Text>
        </View>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.primaryButtonText}>Go to Wallet</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return null;
};

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BCH2Colors.background,
  },
  content: {
    padding: BCH2Spacing.lg,
    paddingBottom: BCH2Spacing.xxl,
  },

  // Header
  headerCenter: {
    alignItems: 'center',
    marginBottom: BCH2Spacing.lg,
  },
  headerLogo: {
    width: 56,
    height: 56,
    marginBottom: BCH2Spacing.md,
  },
  title: {
    fontSize: BCH2Typography.fontSize.xxl,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.textPrimary,
    textAlign: 'center',
    marginBottom: BCH2Spacing.xs,
  },
  subtitle: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: BCH2Spacing.md,
    marginBottom: BCH2Spacing.md,
  },
  walletIcon: {
    fontSize: 32,
    width: 48,
    height: 48,
    textAlign: 'center',
    lineHeight: 48,
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.lg,
    overflow: 'hidden',
  },
  stepTitle: {
    fontSize: BCH2Typography.fontSize.xl,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.textPrimary,
    marginBottom: BCH2Spacing.xs,
  },
  stepSubtitle: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textSecondary,
  },

  // Conversion Card
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
    width: 48,
    height: 48,
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
    fontSize: 28,
    color: BCH2Colors.textMuted,
    marginHorizontal: BCH2Spacing.xl,
  },

  // Wallet Type Grid
  walletTypeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: BCH2Spacing.md,
    marginBottom: BCH2Spacing.lg,
  },
  walletTypeCard: {
    width: '47%',
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.lg,
    padding: BCH2Spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BCH2Colors.border,
  },
  walletTypeIcon: {
    fontSize: 28,
    marginBottom: BCH2Spacing.sm,
    lineHeight: 36,
  },
  walletTypeName: {
    fontSize: BCH2Typography.fontSize.base,
    fontWeight: BCH2Typography.fontWeight.semibold,
    color: BCH2Colors.textPrimary,
    marginBottom: BCH2Spacing.xs,
  },
  walletTypeDesc: {
    fontSize: BCH2Typography.fontSize.xs,
    color: BCH2Colors.textMuted,
    textAlign: 'center',
  },

  // Step Progress
  stepProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: BCH2Spacing.lg,
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: BCH2Colors.border,
    borderWidth: 2,
    borderColor: BCH2Colors.border,
  },
  stepDotActive: {
    backgroundColor: BCH2Colors.primary,
    borderColor: BCH2Colors.primary,
    ...BCH2Shadows.glow,
  },
  stepDotCompleted: {
    backgroundColor: BCH2Colors.primary,
    borderColor: BCH2Colors.primary,
  },
  stepLine: {
    width: 32,
    height: 2,
    backgroundColor: BCH2Colors.border,
  },
  stepLineCompleted: {
    backgroundColor: BCH2Colors.primary,
  },

  // Security Note
  securityNote: {
    backgroundColor: BCH2Colors.primaryGlow,
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.sm,
    marginBottom: BCH2Spacing.md,
    alignItems: 'center',
  },
  securityNoteText: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.primary,
    fontWeight: BCH2Typography.fontWeight.medium,
  },

  // Warning Card
  warningCard: {
    backgroundColor: 'rgba(246, 173, 85, 0.1)',
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.md,
    marginBottom: BCH2Spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: BCH2Colors.warning,
  },
  warningText: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.warning,
    lineHeight: 20,
  },

  // Instructions
  instructionCard: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.lg,
    padding: BCH2Spacing.lg,
    marginBottom: BCH2Spacing.lg,
  },
  instructionRow: {
    flexDirection: 'row',
    marginBottom: BCH2Spacing.md,
    alignItems: 'flex-start',
  },
  instructionNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: BCH2Colors.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: BCH2Spacing.sm,
    marginTop: 1,
  },
  instructionNumberText: {
    fontSize: BCH2Typography.fontSize.xs,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.primary,
  },
  instructionText: {
    flex: 1,
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textSecondary,
    lineHeight: 20,
  },

  // Input
  inputContainer: {
    marginBottom: BCH2Spacing.md,
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
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  helperText: {
    fontSize: BCH2Typography.fontSize.xs,
    color: BCH2Colors.textMuted,
    marginTop: BCH2Spacing.xs,
  },

  // Mode Selector
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
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textMuted,
    fontWeight: BCH2Typography.fontWeight.medium,
  },
  modeButtonTextActive: {
    color: BCH2Colors.textPrimary,
  },

  // Buttons
  primaryButton: {
    backgroundColor: BCH2Colors.primary,
    borderRadius: BCH2BorderRadius.md,
    paddingVertical: BCH2Spacing.md,
    alignItems: 'center',
    marginTop: BCH2Spacing.md,
    ...BCH2Shadows.glow,
  },
  primaryButtonText: {
    color: BCH2Colors.textPrimary,
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  backButton: {
    paddingVertical: BCH2Spacing.md,
    alignItems: 'center',
    marginTop: BCH2Spacing.sm,
  },
  backButtonText: {
    color: BCH2Colors.textSecondary,
    fontSize: BCH2Typography.fontSize.base,
  },

  // Error
  errorCard: {
    backgroundColor: 'rgba(252, 129, 129, 0.1)',
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.md,
    marginBottom: BCH2Spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: BCH2Colors.error,
  },
  errorText: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.error,
    lineHeight: 20,
  },

  // Scanning
  scanContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: BCH2Spacing.xxl,
  },
  scanSpinner: {
    marginBottom: BCH2Spacing.lg,
  },
  scanTitle: {
    fontSize: BCH2Typography.fontSize.xl,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.textPrimary,
    marginBottom: BCH2Spacing.sm,
  },
  scanProgressText: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textMuted,
  },

  // Results
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
  addressTypeBadge: {
    backgroundColor: BCH2Colors.primaryGlow,
    borderRadius: BCH2BorderRadius.sm,
    paddingHorizontal: BCH2Spacing.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    marginBottom: BCH2Spacing.sm,
  },
  addressTypeBadgeText: {
    fontSize: BCH2Typography.fontSize.xs,
    color: BCH2Colors.primary,
    fontWeight: BCH2Typography.fontWeight.medium,
  },
  warningBadge: {
    backgroundColor: 'rgba(246, 173, 85, 0.15)',
    borderRadius: BCH2BorderRadius.sm,
    paddingHorizontal: BCH2Spacing.sm,
    paddingVertical: BCH2Spacing.xs,
    marginBottom: BCH2Spacing.sm,
  },
  warningBadgeText: {
    color: BCH2Colors.warning,
    fontSize: BCH2Typography.fontSize.xs,
    fontWeight: BCH2Typography.fontWeight.medium,
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
  resultValueMono: {
    fontSize: BCH2Typography.fontSize.xs,
    color: BCH2Colors.textMuted,
    fontFamily: 'monospace',
    maxWidth: '60%',
  },
  resultBalance: {
    fontSize: BCH2Typography.fontSize.md,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.success,
    fontFamily: 'monospace',
  },
  emptyCard: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.lg,
    alignItems: 'center',
    marginBottom: BCH2Spacing.md,
  },
  emptyText: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Password Step
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
    color: BCH2Colors.error,
    fontSize: BCH2Typography.fontSize.sm,
    textAlign: 'center',
    marginBottom: BCH2Spacing.md,
  },

  // Success
  successContainer: {
    alignItems: 'center',
    paddingVertical: BCH2Spacing.xxl,
  },
  successLogo: {
    width: 72,
    height: 72,
    marginBottom: BCH2Spacing.lg,
  },
  successTitle: {
    fontSize: BCH2Typography.fontSize.xxl,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.primary,
    marginBottom: BCH2Spacing.sm,
  },
  successSubtitle: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});

export default ClaimAirdropScreen;
