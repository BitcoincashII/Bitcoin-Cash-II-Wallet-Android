/**
 * Add Wallet Screen
 * Create new or import existing BCH2 or BC2 wallet
 */

import React, { useState } from 'react';
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
import { saveWallet } from '../../class/bch2-wallet-storage';

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
      Alert.alert('Error', error.message || 'Failed to generate wallet');
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
      // Save wallet to storage
      const wallet = await saveWallet(walletLabel, mnemonic, walletType);
      console.log('Wallet created:', wallet.id, wallet.address);

      Alert.alert(
        'Wallet Created',
        `Your ${coinName} wallet has been created. Make sure to backup your recovery phrase!`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create wallet');
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
      // Save imported wallet to storage
      const wallet = await saveWallet(walletLabel, importMnemonic.trim(), walletType);
      console.log('Wallet imported:', wallet.id, wallet.address);

      Alert.alert(
        'Wallet Imported',
        `Your ${coinName} wallet has been imported successfully!`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to import wallet');
    } finally {
      setLoading(false);
    }
  };

  const goToImport = (walletType: WalletType) => {
    setImportMnemonic('');
    setWalletLabel('');
    setMode(walletType === 'bc2' ? 'import-bc2' : 'import-bch2');
  };

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
          />
        </View>

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

        <TouchableOpacity style={styles.secondaryButton} onPress={() => setMode('select')}>
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
        />
      </View>

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

      <TouchableOpacity style={styles.secondaryButton} onPress={() => setMode('select')}>
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
});

export default AddWalletScreen;
