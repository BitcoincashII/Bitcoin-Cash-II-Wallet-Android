/**
 * BCH2 Settings Screen
 * Configure Electrum servers for BCH2 and BC2
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
  Image,
  Linking,
} from 'react-native';
import { BCH2Colors, BCH2Spacing, BCH2Typography, BCH2Shadows, BCH2BorderRadius } from '../../components/BCH2Theme';

// Coin logos
const BCH2_LOGO = require('../../img/bch2-logo-small.png');
const BC2_LOGO = require('../../img/bc2-logo-small.png');

interface ElectrumServer {
  host: string;
  port: number;
  ssl: boolean;
}

interface BCH2SettingsProps {
  navigation?: any;
}

// BCH2 Electrum Servers
const BCH2_SERVERS: ElectrumServer[] = [
  { host: 'electrum.bch2.org', port: 50001, ssl: false },
  { host: 'electrum.bch2.org', port: 50002, ssl: true },
];

// BC2 Electrum Servers
const BC2_SERVERS: ElectrumServer[] = [
  { host: 'infra1.bitcoin-ii.org', port: 50008, ssl: false },
  { host: 'infra1.bitcoin-ii.org', port: 50009, ssl: true },
];

export const BCH2SettingsScreen: React.FC<BCH2SettingsProps> = ({ navigation }) => {
  // BCH2 Server State
  const [bch2SelectedServer, setBch2SelectedServer] = useState(0);
  const [bch2CustomHost, setBch2CustomHost] = useState('');
  const [bch2CustomPort, setBch2CustomPort] = useState('50002');
  const [bch2UseSSL, setBch2UseSSL] = useState(true);
  const [bch2Testing, setBch2Testing] = useState(false);
  const [bch2Status, setBch2Status] = useState<'unknown' | 'connected' | 'failed'>('unknown');

  // BC2 Server State
  const [bc2SelectedServer, setBc2SelectedServer] = useState(0);
  const [bc2CustomHost, setBc2CustomHost] = useState('');
  const [bc2CustomPort, setBc2CustomPort] = useState('50009');
  const [bc2UseSSL, setBc2UseSSL] = useState(true);
  const [bc2Testing, setBc2Testing] = useState(false);
  const [bc2Status, setBc2Status] = useState<'unknown' | 'connected' | 'failed'>('unknown');

  // Load previously saved custom server settings on mount
  useEffect(() => {
    (async () => {
      try {
        const DefaultPreference = require('react-native-default-preference').default;
        const bch2Host = await DefaultPreference.get('bch2_electrum_host');
        if (bch2Host) {
          setBch2CustomHost(bch2Host);
          setBch2SelectedServer(-1);
          const bch2Port = await DefaultPreference.get('bch2_electrum_port');
          if (bch2Port) setBch2CustomPort(bch2Port);
          const bch2Ssl = await DefaultPreference.get('bch2_electrum_ssl');
          if (bch2Ssl !== null) setBch2UseSSL(bch2Ssl === '1');
        }
        const bc2Host = await DefaultPreference.get('bc2_electrum_host');
        if (bc2Host) {
          setBc2CustomHost(bc2Host);
          setBc2SelectedServer(-1);
          const bc2Port = await DefaultPreference.get('bc2_electrum_port');
          if (bc2Port) setBc2CustomPort(bc2Port);
          const bc2Ssl = await DefaultPreference.get('bc2_electrum_ssl');
          if (bc2Ssl !== null) setBc2UseSSL(bc2Ssl === '1');
        }
      } catch {
        // Silently ignore load failures — defaults are already set
      }
    })();
  }, []);

  const testConnection = useCallback(async (
    server: ElectrumServer,
    setTesting: (v: boolean) => void,
    setStatus: (v: 'unknown' | 'connected' | 'failed') => void,
    coinName: string
  ) => {
    setTesting(true);
    setStatus('unknown');

    let client: any = null;
    try {
      // Use the raw electrum-client npm package directly for connection test
      const ElectrumClient = require('electrum-client');
      const net = require('net');
      const tls = require('tls');

      client = new ElectrumClient(
        net,
        tls,
        server.port,
        server.host,
        server.ssl ? 'tls' : 'tcp',
      );

      // Connect with 10s timeout
      await Promise.race([
        client.initElectrum({ client: 'bch2-wallet-test', version: '1.4' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout (10s)')), 10000)),
      ]);

      // Request server version to verify it responds
      const versionResult = await Promise.race([
        client.server_version('BCH2Wallet', '1.4'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout (5s)')), 5000)),
      ]);

      client.close();
      client = null;

      if (versionResult) {
        const serverVersion = Array.isArray(versionResult) ? versionResult.join(' / ') : String(versionResult);
        setStatus('connected');
        Alert.alert('Success', `Connected to ${coinName} server: ${server.host}:${server.port}\nServer: ${serverVersion}`);
      } else {
        setStatus('failed');
        Alert.alert('Failed', `Server did not respond to version request`);
      }
    } catch (error: any) {
      setStatus('failed');
      const msg = error.message || '';
      // Only show safe, user-facing messages — suppress raw network/TLS details
      const safeMsg = msg.includes('timeout') ? 'Connection timed out'
        : msg.includes('ECONNREFUSED') ? 'Connection refused'
        : msg.includes('ENOTFOUND') ? 'Server not found'
        : 'Connection test failed';
      Alert.alert('Error', safeMsg);
    } finally {
      if (client) { try { client.close(); } catch {} }
      setTesting(false);
    }
  }, []);

  const validateHostname = (host: string): boolean => {
    // Allow hostnames (letters, digits, dots, hyphens) and IPv4 addresses
    return /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host) && host.length <= 253;
  };

  const validatePort = (portStr: string): boolean => {
    const port = parseInt(portStr);
    return !isNaN(port) && port >= 1 && port <= 65535;
  };

  const handleTestBCH2 = useCallback(() => {
    if (bch2SelectedServer === -1) {
      const host = bch2CustomHost.trim();
      if (!host) { Alert.alert('Error', 'Please enter a server hostname'); return; }
      if (!validateHostname(host)) { Alert.alert('Error', 'Invalid hostname format'); return; }
      if (!validatePort(bch2CustomPort)) { Alert.alert('Error', 'Port must be between 1 and 65535'); return; }
    }
    const server = bch2SelectedServer === -1
      ? { host: bch2CustomHost.trim(), port: parseInt(bch2CustomPort) || 50002, ssl: bch2UseSSL }
      : BCH2_SERVERS[bch2SelectedServer];
    testConnection(server, setBch2Testing, setBch2Status, 'BCH2');
  }, [bch2SelectedServer, bch2CustomHost, bch2CustomPort, bch2UseSSL, testConnection]);

  const handleTestBC2 = useCallback(() => {
    if (bc2SelectedServer === -1) {
      const host = bc2CustomHost.trim();
      if (!host) { Alert.alert('Error', 'Please enter a server hostname'); return; }
      if (!validateHostname(host)) { Alert.alert('Error', 'Invalid hostname format'); return; }
      if (!validatePort(bc2CustomPort)) { Alert.alert('Error', 'Port must be between 1 and 65535'); return; }
    }
    const server = bc2SelectedServer === -1
      ? { host: bc2CustomHost.trim(), port: parseInt(bc2CustomPort) || 50009, ssl: bc2UseSSL }
      : BC2_SERVERS[bc2SelectedServer];
    testConnection(server, setBc2Testing, setBc2Status, 'BC2');
  }, [bc2SelectedServer, bc2CustomHost, bc2CustomPort, bc2UseSSL, testConnection]);

  const handleSaveSettings = useCallback(async () => {
    try {
      // Validate custom hostnames before saving
      if (bch2SelectedServer === -1 && bch2CustomHost.trim() && !validateHostname(bch2CustomHost.trim())) {
        Alert.alert('Error', 'Invalid BCH2 server hostname'); return;
      }
      if (bc2SelectedServer === -1 && bc2CustomHost.trim() && !validateHostname(bc2CustomHost.trim())) {
        Alert.alert('Error', 'Invalid BC2 server hostname'); return;
      }
      // Validate custom ports before saving
      if (bch2SelectedServer === -1 && bch2CustomPort && !validatePort(bch2CustomPort)) {
        Alert.alert('Error', 'BCH2 port must be between 1 and 65535'); return;
      }
      if (bc2SelectedServer === -1 && bc2CustomPort && !validatePort(bc2CustomPort)) {
        Alert.alert('Error', 'BC2 port must be between 1 and 65535'); return;
      }
      const DefaultPreference = require('react-native-default-preference').default;
      // Save BCH2 server settings
      if (bch2SelectedServer === -1 && bch2CustomHost.trim()) {
        await DefaultPreference.set('bch2_electrum_host', bch2CustomHost.trim());
        await DefaultPreference.set('bch2_electrum_port', bch2CustomPort);
        await DefaultPreference.set('bch2_electrum_ssl', bch2UseSSL ? '1' : '0');
      }
      // Save BC2 server settings
      if (bc2SelectedServer === -1 && bc2CustomHost.trim()) {
        await DefaultPreference.set('bc2_electrum_host', bc2CustomHost.trim());
        await DefaultPreference.set('bc2_electrum_port', bc2CustomPort);
        await DefaultPreference.set('bc2_electrum_ssl', bc2UseSSL ? '1' : '0');
      }
      Alert.alert('Settings Saved', 'Your Electrum server settings have been saved. Restart the app for changes to take effect.');
    } catch (error: any) {
      Alert.alert('Error', 'Failed to save settings. Please try again.');
    }
  }, [bch2SelectedServer, bch2CustomHost, bch2CustomPort, bch2UseSSL, bc2SelectedServer, bc2CustomHost, bc2CustomPort, bc2UseSSL]);

  const renderServerSection = (
    title: string,
    logo: any,
    primaryColor: string,
    servers: ElectrumServer[],
    selectedServer: number,
    setSelectedServer: (v: number) => void,
    customHost: string,
    setCustomHost: (v: string) => void,
    customPort: string,
    setCustomPort: (v: string) => void,
    useSSL: boolean,
    setUseSSL: (v: boolean) => void,
    testing: boolean,
    status: 'unknown' | 'connected' | 'failed',
    onTest: () => void
  ) => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Image source={logo} style={styles.sectionLogo} resizeMode="contain" />
        <Text style={[styles.sectionTitle, { color: primaryColor }]}>{title} Electrum Server</Text>
      </View>
      <Text style={styles.sectionDescription}>
        Connect to a {title} Electrum server to fetch balances and broadcast transactions
      </Text>

      {/* Server List */}
      <View style={styles.serverList}>
        {servers.map((server, index) => (
          <TouchableOpacity
            key={index}
            style={[
              styles.serverOption,
              selectedServer === index && [styles.serverOptionSelected, { borderColor: primaryColor }],
            ]}
            onPress={() => setSelectedServer(index)}
          accessibilityLabel={`Server ${server.host} port ${server.port} ${server.ssl ? 'SSL' : 'TCP'}${selectedServer === index ? ', selected' : ''}`}
          accessibilityRole="radio"
          accessibilityState={{ selected: selectedServer === index }}
          >
            <View style={[styles.serverRadio, { borderColor: selectedServer === index ? primaryColor : BCH2Colors.textMuted }]}>
              {selectedServer === index && <View style={[styles.serverRadioInner, { backgroundColor: primaryColor }]} />}
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
            selectedServer === -1 && [styles.serverOptionSelected, { borderColor: primaryColor }],
          ]}
          onPress={() => setSelectedServer(-1)}
          accessibilityLabel={`Custom server${selectedServer === -1 ? ', selected' : ''}`}
          accessibilityRole="radio"
          accessibilityState={{ selected: selectedServer === -1 }}
        >
          <View style={[styles.serverRadio, { borderColor: selectedServer === -1 ? primaryColor : BCH2Colors.textMuted }]}>
            {selectedServer === -1 && <View style={[styles.serverRadioInner, { backgroundColor: primaryColor }]} />}
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
              maxLength={253}
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
                maxLength={5}
              />
            </View>

            <View style={[styles.inputGroup, { flex: 1, marginLeft: BCH2Spacing.md }]}>
              <Text style={styles.inputLabel}>Use SSL</Text>
              <View style={styles.switchContainer}>
                <Switch
                  value={useSSL}
                  onValueChange={setUseSSL}
                  trackColor={{ false: BCH2Colors.border, true: primaryColor + '40' }}
                  thumbColor={useSSL ? primaryColor : BCH2Colors.textMuted}
                  accessibilityLabel={`Use SSL encryption, currently ${useSSL ? 'enabled' : 'disabled'}`}
                />
                <Text style={styles.switchLabel}>{useSSL ? 'Yes' : 'No'}</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Test Connection Button */}
      <TouchableOpacity
        style={[styles.testButton, { borderColor: primaryColor }, testing && styles.testButtonDisabled]}
        onPress={onTest}
        disabled={testing}
        accessibilityLabel={testing ? `Testing ${title} server connection` : `Test ${title} server connection`}
        accessibilityRole="button"
        accessibilityState={{ busy: testing }}
      >
        {testing ? (
          <ActivityIndicator color={primaryColor} size="small" />
        ) : (
          <Text style={[styles.testButtonText, { color: primaryColor }]}>Test Connection</Text>
        )}
      </TouchableOpacity>

      {/* Connection Status */}
      {status !== 'unknown' && (
        <View style={[
          styles.statusBadge,
          status === 'connected' ? styles.statusConnected : styles.statusFailed,
        ]}>
          <Text style={styles.statusText}>
            {status === 'connected' ? '✓ Connected' : '✗ Connection Failed'}
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>Configure your wallet connections</Text>
      </View>

      {/* BCH2 Electrum Server Section */}
      {renderServerSection(
        'BCH2',
        BCH2_LOGO,
        BCH2Colors.primary,
        BCH2_SERVERS,
        bch2SelectedServer,
        setBch2SelectedServer,
        bch2CustomHost,
        setBch2CustomHost,
        bch2CustomPort,
        setBch2CustomPort,
        bch2UseSSL,
        setBch2UseSSL,
        bch2Testing,
        bch2Status,
        handleTestBCH2
      )}

      {/* BC2 Electrum Server Section */}
      {renderServerSection(
        'BC2',
        BC2_LOGO,
        BCH2Colors.bc2Primary,
        BC2_SERVERS,
        bc2SelectedServer,
        setBc2SelectedServer,
        bc2CustomHost,
        setBc2CustomHost,
        bc2CustomPort,
        setBc2CustomPort,
        bc2UseSSL,
        setBc2UseSSL,
        bc2Testing,
        bc2Status,
        handleTestBC2
      )}

      {/* Block Explorers Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: BCH2Colors.textPrimary }]}>Block Explorers</Text>

        <View style={styles.explorerCard}>
          <TouchableOpacity
            style={styles.explorerRow}
            onPress={() => Linking.openURL('https://explorer.bch2.org').catch(() => {})}
            accessibilityLabel="Open BCH2 block explorer"
            accessibilityRole="link"
          >
            <Image source={BCH2_LOGO} style={styles.explorerLogo} resizeMode="contain" />
            <View style={styles.explorerInfo}>
              <Text style={styles.explorerLabel}>BCH2 Explorer</Text>
              <Text style={[styles.explorerUrl, { color: BCH2Colors.primary }]}>explorer.bch2.org</Text>
            </View>
            <Text style={styles.explorerArrow}>→</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.explorerRow}
            onPress={() => Linking.openURL('https://explorer.bitcoin-ii.org').catch(() => {})}
            accessibilityLabel="Open BC2 block explorer"
            accessibilityRole="link"
          >
            <Image source={BC2_LOGO} style={styles.explorerLogo} resizeMode="contain" />
            <View style={styles.explorerInfo}>
              <Text style={styles.explorerLabel}>BC2 Explorer</Text>
              <Text style={[styles.explorerUrl, { color: BCH2Colors.bc2Primary }]}>explorer.bitcoin-ii.org</Text>
            </View>
            <Text style={styles.explorerArrow}>→</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Network Info Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: BCH2Colors.textPrimary }]}>Network Information</Text>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>BCH2 Fork Height</Text>
            <Text style={styles.infoValue}>Block 53,200</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>BCH2 Address Format</Text>
            <Text style={[styles.infoValue, { color: BCH2Colors.primary }]}>bitcoincashii:</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>BC2 Address Format</Text>
            <Text style={[styles.infoValue, { color: BCH2Colors.bc2Primary }]}>Legacy (1...)</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Derivation Path</Text>
            <Text style={[styles.infoValue, styles.infoValueMono]}>m/44'/145'/0'</Text>
          </View>
        </View>
      </View>

      {/* Support Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: BCH2Colors.textPrimary }]}>Support</Text>

        <TouchableOpacity
          style={styles.supportButton}
          onPress={() => {
            const subject = encodeURIComponent('Bitcoin Cash II Wallet - Bug Report');
            const body = encodeURIComponent(
              `\n\n` +
              `-------------------\n` +
              `App Version: 1.1.0\n` +
              `Platform: Android\n` +
              `Date: ${new Date().toISOString()}\n` +
              `-------------------\n` +
              `Please describe the issue above this line.`
            );
            Linking.openURL(`mailto:dev@bitcoincashii.org?subject=${subject}&body=${body}`).catch(() => {});
          }}
        >
          <Text style={styles.supportIcon}>🐛</Text>
          <View style={styles.supportText}>
            <Text style={styles.supportTitle}>Report a Bug</Text>
            <Text style={styles.supportDesc}>Send an email to dev@bitcoincashii.org</Text>
          </View>
          <Text style={styles.explorerArrow}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.supportButton}
          onPress={() => {
            const subject = encodeURIComponent('Bitcoin Cash II Wallet - Feature Request');
            const body = encodeURIComponent(
              `\n\n` +
              `-------------------\n` +
              `App Version: 1.1.0\n` +
              `-------------------\n` +
              `Please describe your feature request above this line.`
            );
            Linking.openURL(`mailto:dev@bitcoincashii.org?subject=${subject}&body=${body}`).catch(() => {});
          }}
        >
          <Text style={styles.supportIcon}>💡</Text>
          <View style={styles.supportText}>
            <Text style={styles.supportTitle}>Request a Feature</Text>
            <Text style={styles.supportDesc}>Share your ideas with us</Text>
          </View>
          <Text style={styles.explorerArrow}>→</Text>
        </TouchableOpacity>
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: BCH2Colors.textPrimary }]}>About</Text>

        <View style={styles.aboutCard}>
          <Text style={styles.aboutTitle}>Bitcoin Cash II Wallet</Text>
          <Text style={styles.aboutVersion}>Version 1.1.0</Text>
          <Text style={styles.aboutDescription}>
            A mobile wallet for Bitcoin Cash II (BCH2) and BitcoinII (BC2) with full support for both chains.
          </Text>

          <View style={styles.aboutLinks}>
            <TouchableOpacity
              style={styles.aboutLink}
              onPress={() => Linking.openURL('https://bch2.org').catch(() => {})}
            >
              <Text style={styles.aboutLinkText}>bch2.org</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.aboutLink}
              onPress={() => Linking.openURL('https://bitcoin-ii.org').catch(() => {})}
            >
              <Text style={[styles.aboutLinkText, { color: BCH2Colors.bc2Primary }]}>bitcoin-ii.org</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Save Button */}
      <TouchableOpacity style={styles.saveButton} onPress={handleSaveSettings} accessibilityLabel="Save server settings" accessibilityRole="button">
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: BCH2Spacing.xs,
  },
  sectionLogo: {
    width: 28,
    height: 28,
    marginRight: BCH2Spacing.sm,
  },
  sectionTitle: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.semibold,
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
    backgroundColor: BCH2Colors.primaryGlow,
  },
  serverRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    marginRight: BCH2Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serverRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
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
    marginBottom: BCH2Spacing.md,
  },
  testButtonDisabled: {
    opacity: 0.6,
  },
  testButtonText: {
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
  explorerCard: {
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.md,
  },
  explorerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: BCH2Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: BCH2Colors.border,
  },
  explorerLogo: {
    width: 32,
    height: 32,
    marginRight: BCH2Spacing.md,
  },
  explorerInfo: {
    flex: 1,
  },
  explorerLabel: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textMuted,
  },
  explorerUrl: {
    fontSize: BCH2Typography.fontSize.base,
    fontFamily: 'monospace',
  },
  explorerArrow: {
    fontSize: BCH2Typography.fontSize.xl,
    color: BCH2Colors.textMuted,
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
  supportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BCH2Colors.backgroundCard,
    borderRadius: BCH2BorderRadius.md,
    padding: BCH2Spacing.md,
    marginBottom: BCH2Spacing.sm,
    borderWidth: 1,
    borderColor: BCH2Colors.border,
  },
  supportIcon: {
    fontSize: 28,
    marginRight: BCH2Spacing.md,
  },
  supportText: {
    flex: 1,
  },
  supportTitle: {
    fontSize: BCH2Typography.fontSize.base,
    fontWeight: BCH2Typography.fontWeight.semibold,
    color: BCH2Colors.textPrimary,
  },
  supportDesc: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textMuted,
    marginTop: 2,
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
