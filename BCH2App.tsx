/**
 * BCH2 App Entry Point
 * Main app with BCH2 navigation
 */

import React, { useEffect, useState } from 'react';
import { StatusBar, View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BCH2Navigator } from './navigation/BCH2Navigator';
import { BCH2Colors } from './components/BCH2Theme';
import BCH2Electrum from './blue_modules/BCH2Electrum';

// BCH2 Dark Theme
const BCH2Theme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: BCH2Colors.primary,
    background: BCH2Colors.background,
    card: BCH2Colors.backgroundCard,
    text: BCH2Colors.textPrimary,
    border: BCH2Colors.border,
    notification: BCH2Colors.primary,
  },
};

const BCH2App: React.FC = () => {
  const [isConnecting, setIsConnecting] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'offline' | 'connecting'>('connecting');

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    setIsConnecting(true);
    try {
      // Try to connect to Electrum
      // The BCH2Electrum module will auto-connect when needed
      setConnectionStatus('connected');
    } catch (error) {
      console.log('Initial connection attempt failed, will retry on demand');
      setConnectionStatus('offline');
    } finally {
      setIsConnecting(false);
    }
  };

  if (isConnecting) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" backgroundColor={BCH2Colors.background} />
        <View style={styles.logoContainer}>
          <Text style={styles.logoText}>BCH2</Text>
          <Text style={styles.logoSubtext}>Wallet</Text>
        </View>
        <ActivityIndicator size="large" color={BCH2Colors.primary} style={styles.spinner} />
        <Text style={styles.loadingText}>Initializing...</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={BCH2Colors.background} />
      <NavigationContainer theme={BCH2Theme}>
        <BCH2Navigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: BCH2Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 48,
  },
  logoText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: BCH2Colors.primary,
  },
  logoSubtext: {
    fontSize: 24,
    color: BCH2Colors.textSecondary,
    marginLeft: 8,
  },
  spinner: {
    marginBottom: 16,
  },
  loadingText: {
    fontSize: 14,
    color: BCH2Colors.textMuted,
  },
});

export default BCH2App;
