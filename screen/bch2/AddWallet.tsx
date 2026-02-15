/**
 * Add BCH2 Wallet Screen
 * Create new or import existing BCH2 wallet
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
} from 'react-native';
import { BCH2Colors, BCH2Spacing, BCH2Typography, BCH2BorderRadius, BCH2Shadows } from '../../components/BCH2Theme';
import * as bip39 from 'bip39';

interface AddWalletProps {
  navigation: any;
}

export const AddWalletScreen: React.FC<AddWalletProps> = ({ navigation }) => {
  const [mode, setMode] = useState<'select' | 'create' | 'import'>('select');
  const [loading, setLoading] = useState(false);
  const [mnemonic, setMnemonic] = useState('');
  const [importMnemonic, setImportMnemonic] = useState('');
  const [walletLabel, setWalletLabel] = useState('');

  const generateNewWallet = async () => {
    setLoading(true);
    try {
      // Generate 12-word mnemonic
      const newMnemonic = bip39.generateMnemonic(128);
      setMnemonic(newMnemonic);
      setMode('create');
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
    
    setLoading(true);
    try {
      // TODO: Save wallet to storage
      // For now, just show success and go back
      Alert.alert(
        'Wallet Created',
        'Your BCH2 wallet has been created. Make sure to backup your recovery phrase!',
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

    setLoading(true);
    try {
      // TODO: Import wallet and save to storage
      Alert.alert(
        'Wallet Imported',
        'Your BCH2 wallet has been imported successfully!',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to import wallet');
    } finally {
      setLoading(false);
    }
  };

  if (mode === 'select') {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.title}>Add BCH2 Wallet</Text>
          <Text style={styles.subtitle}>Create a new wallet or import an existing one</Text>

          <TouchableOpacity style={styles.optionCard} onPress={generateNewWallet} disabled={loading}>
            {loading ? (
              <ActivityIndicator color={BCH2Colors.primary} />
            ) : (
              <>
                <Text style={styles.optionIcon}>✨</Text>
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>Create New Wallet</Text>
                  <Text style={styles.optionDesc}>Generate a new BCH2 wallet with a recovery phrase</Text>
                </View>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.optionCard} onPress={() => setMode('import')}>
            <Text style={styles.optionIcon}>📥</Text>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Import Wallet</Text>
              <Text style={styles.optionDesc}>Restore using your 12 or 24 word recovery phrase</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (mode === 'create') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Your Recovery Phrase</Text>
        <Text style={styles.subtitle}>Write down these 12 words and keep them safe. Never share them!</Text>

        <View style={styles.mnemonicBox}>
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
            placeholder="My BCH2 Wallet"
            placeholderTextColor={BCH2Colors.textMuted}
          />
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={confirmNewWallet} disabled={loading}>
          {loading ? (
            <ActivityIndicator color={BCH2Colors.textPrimary} />
          ) : (
            <Text style={styles.primaryButtonText}>I've Saved My Phrase</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // Import mode
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.title}>Import Wallet</Text>
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
          placeholder="My BCH2 Wallet"
          placeholderTextColor={BCH2Colors.textMuted}
        />
      </View>

      <TouchableOpacity style={styles.primaryButton} onPress={importWallet} disabled={loading}>
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
  content: {
    flex: 1,
    padding: BCH2Spacing.lg,
    justifyContent: 'center',
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
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.lg,
    padding: BCH2Spacing.lg,
    marginBottom: BCH2Spacing.md,
    borderWidth: 1,
    borderColor: BCH2Colors.border,
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
  mnemonicBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.lg,
    padding: BCH2Spacing.md,
    marginBottom: BCH2Spacing.xl,
    borderWidth: 1,
    borderColor: BCH2Colors.primary,
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
    backgroundColor: BCH2Colors.primary,
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
