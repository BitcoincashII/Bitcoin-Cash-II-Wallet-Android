/**
 * Add Wallet Screen
 * Create new or import existing BCH2 or BC2 wallet
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  Image,
} from 'react-native';
import { BCH2Colors, BCH2Spacing, BCH2Typography, BCH2BorderRadius, BCH2Shadows } from '../../components/BCH2Theme';
import * as bip39 from 'bip39';
import { saveWallet, deriveBC2AccountXpub, BC2ScriptType } from '../../class/bch2-wallet-storage';
import { getBC2HdBalance } from '../../class/bch2-transaction';
import { useScreenProtect } from '../../hooks/useScreenProtect';

// BC2 script-type choices shown in the create/import picker. Native SegWit is the
// modern default; legacy stays available for compatibility.
const BC2_SCRIPT_TYPES: { key: BC2ScriptType; label: string; hint: string }[] = [
  { key: 'native-segwit', label: 'SegWit', hint: 'bc1…  (recommended)' },
  { key: 'legacy', label: 'Legacy', hint: '1…' },
  { key: 'p2sh-segwit', label: 'SegWit (P2SH)', hint: '3…' },
  { key: 'taproot', label: 'Taproot', hint: 'bc1p…' },
];

/**
 * BlueWallet-style import discovery: HD-scan the seed across every address (gap
 * limit) for each BC2 script type and return the one holding the most funds.
 * Returns null when nothing is found or the network is unreachable, so the caller
 * falls back to the user's chosen type. Per-type failures never block the import.
 */
async function discoverBc2ScriptType(mnemonic: string): Promise<BC2ScriptType | null> {
  const types: BC2ScriptType[] = ['native-segwit', 'legacy', 'p2sh-segwit', 'taproot'];
  let best: { type: BC2ScriptType; total: number } | null = null;
  for (const t of types) {
    try {
      const bal = await getBC2HdBalance(deriveBC2AccountXpub(mnemonic, t), t);
      const total = (bal.confirmed || 0) + (bal.unconfirmed || 0);
      if (total > 0 && (!best || total > best.total)) best = { type: t, total };
    } catch {
      // skip this type — never block the import on a single lookup failure
    }
  }
  return best ? best.type : null;
}

// Coin logos
const BCH2_LOGO = require('../../img/bch2-logo-small.png');
const BC2_LOGO = require('../../img/bc2-logo-small.png');

interface AddWalletProps {
  navigation: any;
}

type WalletType = 'bch2' | 'bc2' | 'bc1';
type Mode = 'select' | 'create-bch2' | 'create-bc2' | 'import-bch2' | 'import-bc2';

export const AddWalletScreen: React.FC<AddWalletProps> = ({ navigation }) => {
  const [mode, setMode] = useState<Mode>('select');
  const [loading, setLoading] = useState(false);
  const [mnemonic, setMnemonic] = useState('');
  const [importMnemonic, setImportMnemonic] = useState('');
  const [walletLabel, setWalletLabel] = useState('');
  const [bc2ScriptType, setBc2ScriptType] = useState<BC2ScriptType>('native-segwit');
  const [scanning, setScanning] = useState(false);
  const { enableScreenProtect } = useScreenProtect();

  // Ensure screenshot protection while a mnemonic is displayed or imported.
  // NOTE: we never call disableScreenProtect() here — MainActivity sets
  // FLAG_SECURE app-wide, and toggling it off would clear that baseline
  // protection for the entire app (not just this screen).
  useEffect(() => {
    const showsMnemonic = mnemonic && (mode === 'create-bch2' || mode === 'create-bc2');
    const importingMnemonic = importMnemonic && (mode === 'import-bch2' || mode === 'import-bc2');
    if (showsMnemonic || importingMnemonic) {
      enableScreenProtect();
    }
  }, [mnemonic, importMnemonic, mode]);

  // Clear sensitive state on unmount
  useEffect(() => {
    return () => {
      setMnemonic('');
      setImportMnemonic('');
    };
  }, []);

  const getCurrentWalletType = (): WalletType => {
    if (mode === 'create-bc2' || mode === 'import-bc2') return 'bc2';
    return 'bch2';
  };

  const generateNewWallet = async (walletType: WalletType) => {
    setLoading(true);
    try {
      // Generate 12-word mnemonic
      const newMnemonic = bip39.generateMnemonic(128);
      setMnemonic(newMnemonic);
      setWalletLabel('');
      setMode(walletType === 'bc2' ? 'create-bc2' : 'create-bch2');
    } catch (error: any) {
      Alert.alert('Error', 'Failed to generate wallet');
    } finally {
      setLoading(false);
    }
  };

  const confirmNewWallet = async () => {
    if (!walletLabel.trim()) {
      Alert.alert('Error', 'Please enter a wallet name');
      return;
    }

    const walletType = getCurrentWalletType();
    const coinName = walletType === 'bc2' ? 'BC2' : 'BCH2';

    setLoading(true);
    try {
      const wallet = await saveWallet(walletLabel, mnemonic, walletType, bc2ScriptType);
      setMnemonic('');

      Alert.alert(
        'Wallet Created',
        `Your ${coinName} wallet has been created. Make sure to backup your recovery phrase!`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to save wallet');
    } finally {
      setLoading(false);
    }
  };

  const importWallet = async () => {
    if (!importMnemonic.trim()) {
      Alert.alert('Error', 'Please enter your recovery phrase');
      return;
    }

    const words = importMnemonic.trim().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      Alert.alert('Error', 'Recovery phrase must be 12 or 24 words');
      return;
    }

    if (!bip39.validateMnemonic(importMnemonic.trim())) {
      Alert.alert('Error', 'Invalid recovery phrase');
      return;
    }

    if (!walletLabel.trim()) {
      Alert.alert('Error', 'Please enter a wallet name');
      return;
    }

    const walletType = getCurrentWalletType();
    const coinName = walletType === 'bc2' ? 'BC2' : 'BCH2';

    setLoading(true);
    try {
      // BlueWallet-style discovery for BC2: scan the seed across all four address
      // types and import the one that actually holds funds. Falls back to the
      // user's picked type when nothing (or the network) turns up.
      let importedType: BC2ScriptType = bc2ScriptType;
      if (walletType === 'bc2') {
        setScanning(true);
        try {
          const found = await discoverBc2ScriptType(importMnemonic.trim());
          if (found) importedType = found;
        } finally {
          setScanning(false);
        }
      }

      const wallet = await saveWallet(walletLabel, importMnemonic.trim(), walletType, importedType);
      setImportMnemonic('');

      const typeNote = walletType === 'bc2'
        ? `\n\nAddress type: ${BC2_SCRIPT_TYPES.find(t => t.key === importedType)?.label || importedType} (${wallet.address.slice(0, 10)}…)`
        : '';
      Alert.alert(
        'Wallet Imported',
        `Your ${coinName} wallet has been imported successfully!${typeNote}`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to import wallet');
    } finally {
      setLoading(false);
    }
  };

  const goToImport = (walletType: WalletType) => {
    setImportMnemonic('');
    setWalletLabel('');
    setMode(walletType === 'bc2' ? 'import-bc2' : 'import-bch2');
  };

  // BC2 address-type picker (chips). On create it chooses the wallet's type; on
  // import it is the fallback used only when discovery finds no funds.
  const renderBc2Picker = (title: string, subtitle?: string) => (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{title}</Text>
      {subtitle ? <Text style={{ color: BCH2Colors.textMuted, fontSize: 12, marginBottom: 8 }}>{subtitle}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {BC2_SCRIPT_TYPES.map(t => {
          const selected = bc2ScriptType === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setBc2ScriptType(t.key)}
              style={{
                paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginRight: 8, marginBottom: 8,
                borderWidth: 1.5, borderColor: selected ? BCH2Colors.bc2Primary : BCH2Colors.textMuted,
                backgroundColor: selected ? BCH2Colors.bc2Primary + '22' : 'transparent',
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${t.label} address type ${t.hint}`}
            >
              <Text style={{ color: selected ? BCH2Colors.bc2Primary : BCH2Colors.textPrimary, fontWeight: selected ? '700' : '500' }}>{t.label}</Text>
              <Text style={{ color: BCH2Colors.textMuted, fontSize: 11 }}>{t.hint}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  // Main selection screen
  if (mode === 'select') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Add Wallet</Text>
        <Text style={styles.subtitle}>Choose which wallet to create or import</Text>

        {/* BCH2 Section */}
        <View style={styles.sectionHeader}>
          <Image source={BCH2_LOGO} style={styles.sectionLogo} resizeMode="contain" />
          <Text style={[styles.sectionTitle, { color: BCH2Colors.primary }]}>Bitcoin Cash II (BCH2)</Text>
        </View>

        <TouchableOpacity
          style={[styles.optionCard, { borderColor: BCH2Colors.primary }]}
          onPress={() => generateNewWallet('bch2')}
          disabled={loading}
          accessibilityLabel="Create a new BCH2 wallet with recovery phrase"
          accessibilityRole="button"
        >
          {loading ? (
            <ActivityIndicator color={BCH2Colors.primary} />
          ) : (
            <>
              <Text style={styles.optionIcon}>✨</Text>
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>Create BCH2 Wallet</Text>
                <Text style={styles.optionDesc}>Generate a new BCH2 wallet with recovery phrase</Text>
              </View>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.optionCard, { borderColor: BCH2Colors.primary }]}
          onPress={() => goToImport('bch2')}
          accessibilityLabel="Import a BCH2 wallet using recovery phrase"
          accessibilityRole="button"
        >
          <Text style={styles.optionIcon}>📥</Text>
          <View style={styles.optionText}>
            <Text style={styles.optionTitle}>Import BCH2 Wallet</Text>
            <Text style={styles.optionDesc}>Restore using your 12 or 24 word recovery phrase</Text>
          </View>
        </TouchableOpacity>

        {/* BC2 Section */}
        <View style={[styles.sectionHeader, { marginTop: BCH2Spacing.xl }]}>
          <Image source={BC2_LOGO} style={styles.sectionLogo} resizeMode="contain" />
          <Text style={[styles.sectionTitle, { color: BCH2Colors.bc2Primary }]}>BitcoinII (BC2)</Text>
        </View>

        <TouchableOpacity
          style={[styles.optionCard, { borderColor: BCH2Colors.bc2Primary }]}
          onPress={() => generateNewWallet('bc2')}
          disabled={loading}
          accessibilityLabel="Create a new BC2 wallet with recovery phrase"
          accessibilityRole="button"
        >
          {loading ? (
            <ActivityIndicator color={BCH2Colors.bc2Primary} />
          ) : (
            <>
              <Text style={styles.optionIcon}>✨</Text>
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>Create BC2 Wallet</Text>
                <Text style={styles.optionDesc}>Generate a new BC2 wallet with recovery phrase</Text>
              </View>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.optionCard, { borderColor: BCH2Colors.bc2Primary }]}
          onPress={() => goToImport('bc2')}
          accessibilityLabel="Import a BC2 wallet using recovery phrase"
          accessibilityRole="button"
        >
          <Text style={styles.optionIcon}>📥</Text>
          <View style={styles.optionText}>
            <Text style={styles.optionTitle}>Import BC2 Wallet</Text>
            <Text style={styles.optionDesc}>Restore using your 12 or 24 word recovery phrase</Text>
          </View>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // Create wallet screen (BCH2 or BC2)
  if (mode === 'create-bch2' || mode === 'create-bc2') {
    const walletType = getCurrentWalletType();
    const coinName = walletType === 'bc2' ? 'BC2' : 'BCH2';
    const primaryColor = walletType === 'bc2' ? BCH2Colors.bc2Primary : BCH2Colors.primary;
    const logo = walletType === 'bc2' ? BC2_LOGO : BCH2_LOGO;

    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <View style={styles.createHeader}>
          <Image source={logo} style={styles.createLogo} resizeMode="contain" />
          <Text style={styles.title}>New {coinName} Wallet</Text>
        </View>
        <Text style={styles.subtitle}>Write down these 12 words and keep them safe. Never share them!</Text>

        <View style={[styles.mnemonicBox, { borderColor: primaryColor }]}>
          {mnemonic.split(' ').map((word, index) => (
            <View key={index} style={styles.wordChip}>
              <Text style={styles.wordNumber}>{index + 1}</Text>
              <Text style={styles.wordText}>{word}</Text>
            </View>
          ))}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Wallet Name</Text>
          <TextInput
            style={styles.input}
            value={walletLabel}
            onChangeText={setWalletLabel}
            placeholder={`My ${coinName} Wallet`}
            placeholderTextColor={BCH2Colors.textMuted}
            maxLength={50}
          />
        </View>

        {walletType === 'bc2' && renderBc2Picker('Address Type')}

        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: primaryColor }]}
          onPress={confirmNewWallet}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={BCH2Colors.textPrimary} />
          ) : (
            <Text style={styles.primaryButtonText}>I've Saved My Phrase</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={() => { setMnemonic(''); setMode('select'); }}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // Import wallet screen (BCH2 or BC2)
  const walletType = getCurrentWalletType();
  const coinName = walletType === 'bc2' ? 'BC2' : 'BCH2';
  const primaryColor = walletType === 'bc2' ? BCH2Colors.bc2Primary : BCH2Colors.primary;
  const logo = walletType === 'bc2' ? BC2_LOGO : BCH2_LOGO;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.createHeader}>
        <Image source={logo} style={styles.createLogo} resizeMode="contain" />
        <Text style={styles.title}>Import {coinName} Wallet</Text>
      </View>
      <Text style={styles.subtitle}>Enter your 12 or 24 word recovery phrase</Text>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Recovery Phrase</Text>
        <TextInput
          style={[styles.input, styles.mnemonicInput]}
          value={importMnemonic}
          onChangeText={setImportMnemonic}
          placeholder="Enter your recovery phrase..."
          placeholderTextColor={BCH2Colors.textMuted}
          multiline
          numberOfLines={4}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          importantForAutofill="no"
          spellCheck={false}
          maxLength={500}
          accessibilityLabel="Recovery phrase, enter 12 or 24 words separated by spaces"
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Wallet Name</Text>
        <TextInput
          style={styles.input}
          value={walletLabel}
          onChangeText={setWalletLabel}
          placeholder={`My ${coinName} Wallet`}
          placeholderTextColor={BCH2Colors.textMuted}
          maxLength={50}
        />
      </View>

      {walletType === 'bc2' && renderBc2Picker(
        'Default Address Type',
        'On import we scan your seed for legacy and SegWit funds and pick the one that holds a balance. This default is used only if none is found.'
      )}

      {scanning ? (
        <Text style={{ color: BCH2Colors.textMuted, textAlign: 'center', marginBottom: 8 }}>
          Scanning addresses for funds…
        </Text>
      ) : null}

      <TouchableOpacity
        style={[styles.primaryButton, { backgroundColor: primaryColor }]}
        onPress={importWallet}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={BCH2Colors.textPrimary} />
        ) : (
          <Text style={styles.primaryButtonText}>Import Wallet</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryButton} onPress={() => { setImportMnemonic(''); setWalletLabel(''); setMode('select'); }}>
        <Text style={styles.secondaryButtonText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BCH2Colors.background,
  },
  scrollContent: {
    padding: BCH2Spacing.lg,
    paddingBottom: BCH2Spacing.xxl,
  },
  title: {
    fontSize: BCH2Typography.fontSize.xxl,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.textPrimary,
    textAlign: 'center',
    marginBottom: BCH2Spacing.sm,
  },
  subtitle: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.textSecondary,
    textAlign: 'center',
    marginBottom: BCH2Spacing.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: BCH2Spacing.md,
    marginTop: BCH2Spacing.md,
  },
  sectionLogo: {
    width: 32,
    height: 32,
    marginRight: BCH2Spacing.sm,
  },
  sectionTitle: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.lg,
    padding: BCH2Spacing.lg,
    marginBottom: BCH2Spacing.md,
    borderWidth: 1,
  },
  optionIcon: {
    fontSize: 32,
    marginRight: BCH2Spacing.md,
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.semibold,
    color: BCH2Colors.textPrimary,
    marginBottom: BCH2Spacing.xs,
  },
  optionDesc: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textSecondary,
  },
  createHeader: {
    alignItems: 'center',
    marginBottom: BCH2Spacing.md,
  },
  createLogo: {
    width: 64,
    height: 64,
    marginBottom: BCH2Spacing.sm,
  },
  mnemonicBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.lg,
    padding: BCH2Spacing.md,
    marginBottom: BCH2Spacing.xl,
    borderWidth: 1,
  },
  wordChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BCH2Colors.backgroundElevated,
    borderRadius: BCH2BorderRadius.sm,
    paddingVertical: BCH2Spacing.sm,
    paddingHorizontal: BCH2Spacing.md,
    margin: BCH2Spacing.xs,
  },
  wordNumber: {
    fontSize: BCH2Typography.fontSize.xs,
    color: BCH2Colors.textMuted,
    marginRight: BCH2Spacing.xs,
  },
  wordText: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.textPrimary,
    fontFamily: 'monospace',
  },
  inputGroup: {
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
  },
  mnemonicInput: {
    height: 100,
    textAlignVertical: 'top',
  },
  primaryButton: {
    borderRadius: BCH2BorderRadius.md,
    paddingVertical: BCH2Spacing.md,
    alignItems: 'center',
    marginBottom: BCH2Spacing.md,
    ...BCH2Shadows.glow,
  },
  primaryButtonText: {
    color: BCH2Colors.textPrimary,
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
  },
  secondaryButton: {
    paddingVertical: BCH2Spacing.md,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: BCH2Colors.textSecondary,
    fontSize: BCH2Typography.fontSize.base,
  },
  errorText: {
    color: BCH2Colors.error,
    fontSize: BCH2Typography.fontSize.sm,
    textAlign: 'center',
    marginBottom: BCH2Spacing.md,
  },
});

export default AddWalletScreen;
