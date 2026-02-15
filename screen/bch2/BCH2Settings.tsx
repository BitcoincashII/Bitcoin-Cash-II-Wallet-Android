/**
 * BCH2 Settings Screen
 * Configure Electrum server and wallet settings
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { BCH2Colors, BCH2Spacing, BCH2Typography, BCH2Shadows, BCH2BorderRadius } from '../../components/BCH2Theme';

interface ElectrumServer {
  host: string;
  port: number;
  ssl: boolean;
}

interface BCH2SettingsProps {
  navigation?: any;
}

const DEFAULT_SERVERS: ElectrumServer[] = [
  { host: '144.202.73.66', port: 50002, ssl: true },
  { host: 'electrum.bch2.org', port: 50002, ssl: true },
  { host: 'electrum2.bch2.org', port: 50002, ssl: true },
];

export const BCH2SettingsScreen: React.FC<BCH2SettingsProps> = ({ navigation }) => {
  const [customHost, setCustomHost] = useState('');
  const [customPort, setCustomPort] = useState('50002');
  const [useSSL, setUseSSL] = useState(true);
  const [selectedServer, setSelectedServer] = useState(0);
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'connected' | 'failed'>('unknown');

  const testConnection = useCallback(async (server: ElectrumServer) => {
    setTesting(true);
    setConnectionStatus('unknown');

    try {
      // Simulate connection test - actual implementation would use BCH2Electrum module
      await new Promise(resolve => setTimeout(resolve, 1500));

      // For demo, randomly succeed/fail
      const success = Math.random() > 0.2;

      if (success) {
        setConnectionStatus('connected');
        Alert.alert('Success', `Connected to ${server.host}:${server.port}`);
      } else {
        setConnectionStatus('failed');
        Alert.alert('Failed', `Could not connect to ${server.host}:${server.port}`);
      }
    } catch (error: any) {
      setConnectionStatus('failed');
      Alert.alert('Error', error.message || 'Connection test failed');
    } finally {
      setTesting(false);
    }
  }, []);

  const handleTestServer = useCallback(() => {
    if (selectedServer === -1) {
      // Custom server
      if (!customHost.trim()) {
        Alert.alert('Error', 'Please enter a server hostname');
        return;
      }
      testConnection({
        host: customHost.trim(),
        port: parseInt(customPort) || 50002,
        ssl: useSSL,
      });
    } else {
      testConnection(DEFAULT_SERVERS[selectedServer]);
    }
  }, [selectedServer, customHost, customPort, useSSL, testConnection]);

  const handleSaveSettings = useCallback(() => {
    // Save settings to storage - actual implementation would persist
    Alert.alert('Settings Saved', 'Your Electrum server settings have been saved');
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>Configure your BCH2 wallet</Text>
      </View>

      {/* Electrum Server Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Electrum Server</Text>
        <Text style={styles.sectionDescription}>
          Connect to a BCH2 Electrum server to fetch balances and broadcast transactions
        </Text>

        {/* Default Servers */}
        <View style={styles.serverList}>
          {DEFAULT_SERVERS.map((server, index) => (
            <TouchableOpacity
              key={index}
              style={[
                styles.serverOption,
                selectedServer === index && styles.serverOptionSelected,
              ]}
              onPress={() => setSelectedServer(index)}
            >
              <View style={styles.serverRadio}>
                {selectedServer === index && <View style={styles.serverRadioInner} />}
              </View>
              <View style={styles.serverInfo}>
                <Text style={styles.serverHost}>{server.host}</Text>
                <Text style={styles.serverPort}>
                  Port {server.port} {server.ssl ? '(SSL)' : '(TCP)'}
                </Text>
              </View>
            </TouchableOpacity>
          ))}

          {/* Custom Server Option */}
          <TouchableOpacity
            style={[
              styles.serverOption,
              selectedServer === -1 && styles.serverOptionSelected,
            ]}
            onPress={() => setSelectedServer(-1)}
          >
            <View style={styles.serverRadio}>
              {selectedServer === -1 && <View style={styles.serverRadioInner} />}
            </View>
            <Text style={styles.serverHost}>Custom Server</Text>
          </TouchableOpacity>
        </View>

        {/* Custom Server Input */}
        {selectedServer === -1 && (
          <View style={styles.customServerForm}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Hostname / IP</Text>
              <TextInput
                style={styles.input}
                value={customHost}
                onChangeText={setCustomHost}
                placeholder="electrum.example.com"
                placeholderTextColor={BCH2Colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.inputRow}>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>Port</Text>
                <TextInput
                  style={styles.input}
                  value={customPort}
                  onChangeText={setCustomPort}
                  placeholder="50002"
                  placeholderTextColor={BCH2Colors.textMuted}
                  keyboardType="number-pad"
                />
              </View>

              <View style={[styles.inputGroup, { flex: 1, marginLeft: BCH2Spacing.md }]}>
                <Text style={styles.inputLabel}>Use SSL</Text>
                <View style={styles.switchContainer}>
                  <Switch
                    value={useSSL}
                    onValueChange={setUseSSL}
                    trackColor={{ false: BCH2Colors.border, true: BCH2Colors.primaryGlow }}
                    thumbColor={useSSL ? BCH2Colors.primary : BCH2Colors.textMuted}
                  />
                  <Text style={styles.switchLabel}>{useSSL ? 'Yes' : 'No'}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Test Connection Button */}
        <TouchableOpacity
          style={[styles.testButton, testing && styles.testButtonDisabled]}
          onPress={handleTestServer}
          disabled={testing}
        >
          {testing ? (
            <ActivityIndicator color={BCH2Colors.primary} size="small" />
          ) : (
            <Text style={styles.testButtonText}>Test Connection</Text>
          )}
        </TouchableOpacity>

        {/* Connection Status */}
        {connectionStatus !== 'unknown' && (
          <View style={[
            styles.statusBadge,
            connectionStatus === 'connected' ? styles.statusConnected : styles.statusFailed,
          ]}>
            <Text style={styles.statusText}>
              {connectionStatus === 'connected' ? '✓ Connected' : '✗ Connection Failed'}
            </Text>
          </View>
        )}
      </View>

      {/* Network Info Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Network Information</Text>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Network</Text>
            <Text style={styles.infoValue}>BCH2 Mainnet</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Fork Height</Text>
            <Text style={styles.infoValue}>Block 53,200</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Address Format</Text>
            <Text style={styles.infoValue}>CashAddr (bitcoincashii:)</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Derivation Path</Text>
            <Text style={[styles.infoValue, styles.infoValueMono]}>m/44'/145'/0'</Text>
          </View>
        </View>
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>

        <View style={styles.aboutCard}>
          <Text style={styles.aboutTitle}>BlueWallet BCH2 Edition</Text>
          <Text style={styles.aboutVersion}>Version 1.0.0</Text>
          <Text style={styles.aboutDescription}>
            A mobile wallet for Bitcoin Cash II (BCH2) with support for both BC2 and BCH2 chains.
          </Text>

          <View style={styles.aboutLinks}>
            <TouchableOpacity style={styles.aboutLink}>
              <Text style={styles.aboutLinkText}>bch2.org</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.aboutLink}>
              <Text style={styles.aboutLinkText}>GitHub</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.aboutLink}>
              <Text style={styles.aboutLinkText}>Discord</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Save Button */}
      <TouchableOpacity style={styles.saveButton} onPress={handleSaveSettings}>
        <Text style={styles.saveButtonText}>Save Settings</Text>
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
    padding: BCH2Spacing.lg,
    paddingBottom: BCH2Spacing.xxl,
  },
  header: {
    marginBottom: BCH2Spacing.xl,
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
  section: {
    marginBottom: BCH2Spacing.xl,
  },
  sectionTitle: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.semibold,
    color: BCH2Colors.textPrimary,
    marginBottom: BCH2Spacing.xs,
  },
  sectionDescription: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textSecondary,
    marginBottom: BCH2Spacing.lg,
    lineHeight: 20,
  },
  serverList: {
    marginBottom: BCH2Spacing.lg,
  },
  serverOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.md,
    marginBottom: BCH2Spacing.sm,
    borderWidth: 1,
    borderColor: BCH2Colors.border,
  },
  serverOptionSelected: {
    borderColor: BCH2Colors.primary,
    backgroundColor: BCH2Colors.primaryGlow,
  },
  serverRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: BCH2Colors.textMuted,
    marginRight: BCH2Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serverRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: BCH2Colors.primary,
  },
  serverInfo: {
    flex: 1,
  },
  serverHost: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.textPrimary,
    fontFamily: 'monospace',
  },
  serverPort: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textMuted,
    marginTop: 2,
  },
  customServerForm: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.md,
    marginBottom: BCH2Spacing.lg,
  },
  inputGroup: {
    marginBottom: BCH2Spacing.md,
  },
  inputRow: {
    flexDirection: 'row',
  },
  inputLabel: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textSecondary,
    marginBottom: BCH2Spacing.xs,
  },
  input: {
    backgroundColor: BCH2Colors.backgroundElevated,
    borderRadius: BCH2BorderRadius.md,
    borderWidth: 1,
    borderColor: BCH2Colors.border,
    padding: BCH2Spacing.sm,
    color: BCH2Colors.textPrimary,
    fontSize: BCH2Typography.fontSize.base,
    fontFamily: 'monospace',
  },
  switchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BCH2Colors.backgroundElevated,
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.sm,
    borderWidth: 1,
    borderColor: BCH2Colors.border,
  },
  switchLabel: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.textSecondary,
    marginLeft: BCH2Spacing.sm,
  },
  testButton: {
    backgroundColor: 'transparent',
    borderRadius: BCH2BorderRadius.md,
    paddingVertical: BCH2Spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BCH2Colors.primary,
    marginBottom: BCH2Spacing.md,
  },
  testButtonDisabled: {
    opacity: 0.6,
  },
  testButtonText: {
    color: BCH2Colors.primary,
    fontSize: BCH2Typography.fontSize.base,
    fontWeight: BCH2Typography.fontWeight.semibold,
  },
  statusBadge: {
    paddingVertical: BCH2Spacing.sm,
    paddingHorizontal: BCH2Spacing.md,
    borderRadius: BCH2BorderRadius.md,
    alignItems: 'center',
  },
  statusConnected: {
    backgroundColor: 'rgba(10, 193, 142, 0.2)',
  },
  statusFailed: {
    backgroundColor: 'rgba(252, 129, 129, 0.2)',
  },
  statusText: {
    fontSize: BCH2Typography.fontSize.sm,
    fontWeight: BCH2Typography.fontWeight.semibold,
    color: BCH2Colors.textPrimary,
  },
  infoCard: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: BCH2Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: BCH2Colors.border,
  },
  infoLabel: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textMuted,
  },
  infoValue: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textPrimary,
  },
  infoValueMono: {
    fontFamily: 'monospace',
    color: BCH2Colors.primary,
  },
  aboutCard: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.lg,
    alignItems: 'center',
  },
  aboutTitle: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.primary,
    marginBottom: BCH2Spacing.xs,
  },
  aboutVersion: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textMuted,
    marginBottom: BCH2Spacing.md,
  },
  aboutDescription: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: BCH2Spacing.lg,
  },
  aboutLinks: {
    flexDirection: 'row',
    gap: BCH2Spacing.lg,
  },
  aboutLink: {
    paddingVertical: BCH2Spacing.xs,
    paddingHorizontal: BCH2Spacing.md,
  },
  aboutLinkText: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.primary,
    fontWeight: BCH2Typography.fontWeight.semibold,
  },
  saveButton: {
    backgroundColor: BCH2Colors.primary,
    borderRadius: BCH2BorderRadius.md,
    paddingVertical: BCH2Spacing.md,
    alignItems: 'center',
    ...BCH2Shadows.glow,
  },
  saveButtonText: {
    color: BCH2Colors.textPrimary,
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
  },
});

export default BCH2SettingsScreen;
