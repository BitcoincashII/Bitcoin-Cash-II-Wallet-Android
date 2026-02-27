/**
 * BCH2 Wallet List Screen
 * Main screen showing BC2 and BCH2 wallets
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { BCH2Colors, BCH2Spacing, BCH2Typography, BCH2BorderRadius, BCH2Shadows } from '../../components/BCH2Theme';
import BCH2WalletCard from '../../components/BCH2WalletCard';
import { getWallets, StoredWallet, updateWalletBalance } from '../../class/bch2-wallet-storage';
import { getBalanceByAddress, getBC2Balance, getBalanceByScripthash, isConnected as isElectrumConnected } from '../../blue_modules/BCH2Electrum';
import { bc1AddressToScripthash } from '../../class/bch2-airdrop';

interface Wallet {
  id: string;
  type: 'bc2' | 'bch2' | 'bc1';
  label: string;
  balance: number;
  unconfirmedBalance: number;
  address: string;
}

export const BCH2WalletListScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [refreshing, setRefreshing] = useState(false);
  const [wallets, setWallets] = useState<Wallet[]>([]);

  // Load wallets from storage
  const loadWallets = useCallback(async () => {
    try {
      const storedWallets = await getWallets();
      const mappedWallets: Wallet[] = storedWallets.map((w: StoredWallet) => ({
        id: w.id,
        type: w.type,
        label: w.label,
        balance: w.balance,
        unconfirmedBalance: w.unconfirmedBalance,
        address: w.address,
      }));
      setWallets(mappedWallets);
    } catch (error) {
      console.error('Failed to load wallets:', error);
    }
  }, []);

  // Load wallets and fetch balances when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      const fetchBalances = async () => {
        await loadWallets();
        // Fetch balances in background
        const storedWallets = await getWallets();
        for (const wallet of storedWallets) {
          try {
            let balance;
            if (wallet.type === 'bc2') {
              balance = await getBC2Balance(wallet.address);
            } else if (wallet.type === 'bc1' || wallet.address.toLowerCase().startsWith('bc1')) {
              const scripthash = bc1AddressToScripthash(wallet.address);
              if (!scripthash) throw new Error('Invalid bc1 address');
              balance = await getBalanceByScripthash(scripthash);
            } else {
              balance = await getBalanceByAddress(wallet.address);
            }
            await updateWalletBalance(wallet.id, balance.confirmed, balance.unconfirmed);
          } catch (error) {
            console.error(`Failed to fetch balance for ${wallet.label}:`, error);
          }
        }
        // Reload with updated balances
        await loadWallets();
      };
      fetchBalances();
    }, [loadWallets])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const storedWallets = await getWallets();

      // Fetch updated balances from Electrum for each wallet
      for (const wallet of storedWallets) {
        try {
          let balance;
          if (wallet.type === 'bc2') {
            balance = await getBC2Balance(wallet.address);
          } else if (wallet.type === 'bc1' || wallet.address.toLowerCase().startsWith('bc1')) {
            const scripthash = bc1AddressToScripthash(wallet.address);
            if (!scripthash) throw new Error('Invalid bc1 address');
            balance = await getBalanceByScripthash(scripthash);
          } else {
            balance = await getBalanceByAddress(wallet.address);
          }

          await updateWalletBalance(wallet.id, balance.confirmed, balance.unconfirmed);
        } catch (error) {
          console.error(`Failed to fetch balance for ${wallet.label}:`, error);
        }
      }

      // Reload wallets with updated balances
      await loadWallets();
    } catch (error) {
      console.error('Failed to refresh wallets:', error);
    }
    setRefreshing(false);
  }, [loadWallets]);

  const navigateToClaimAirdrop = () => {
    navigation.navigate('ClaimAirdrop');
  };

  const navigateToAddWallet = () => {
    navigation.navigate('AddWallet');
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.logoContainer}>
          <Image
            source={require('../../img/bch2-logo-small.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
          <Text style={styles.logoSubtext}>Wallet</Text>
        </View>
        <TouchableOpacity onPress={() => navigation.navigate('BCH2Settings')}>
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={BCH2Colors.primary}
          />
        }
      >
        {/* Airdrop Banner */}
        <TouchableOpacity style={styles.airdropBanner} onPress={navigateToClaimAirdrop}>
          <View style={styles.airdropContent}>
            <Text style={styles.airdropTitle}>🎉 Claim Your BCH2 Airdrop</Text>
            <Text style={styles.airdropText}>
              Import your BC2 wallet to claim your BCH2
            </Text>
          </View>
          <Text style={styles.airdropArrow}>→</Text>
        </TouchableOpacity>

        {/* Wallets */}
        {wallets.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>💰</Text>
            <Text style={styles.emptyTitle}>No Wallets Yet</Text>
            <Text style={styles.emptyText}>
              Create a new wallet or import an existing one to get started
            </Text>
            <View style={styles.emptyActions}>
              <TouchableOpacity
                style={styles.createButton}
                onPress={navigateToAddWallet}
              >
                <Text style={styles.createButtonText}>Create Wallet</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.importButton}
                onPress={navigateToClaimAirdrop}
              >
                <Text style={styles.importButtonText}>Import BC2 Wallet</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            {/* BC2 Wallets Section */}
            {wallets.filter(w => w.type === 'bc2').length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>BC2 Wallets</Text>
                {wallets.filter(w => w.type === 'bc2').map(wallet => (
                  <BCH2WalletCard
                    key={wallet.id}
                    walletLabel={wallet.label}
                    balance={wallet.balance}
                    unconfirmedBalance={wallet.unconfirmedBalance}
                    address={wallet.address}
                    isBC2={true}
                    onPress={() => navigation.navigate('WalletDetail', { walletId: wallet.id })}
                    onReceive={() => navigation.navigate('BCH2Receive', { address: wallet.address, walletLabel: wallet.label, isBC2: true })}
                    onSend={() => navigation.navigate('BCH2Send', { walletId: wallet.id, walletBalance: wallet.balance, walletAddress: wallet.address, isBC2: true })}
                  />
                ))}
              </View>
            )}

            {/* bc1 SegWit Wallets Section (airdrop claims) */}
            {wallets.filter(w => w.type === 'bc1').length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>SegWit Wallets (Airdrop)</Text>
                {wallets.filter(w => w.type === 'bc1').map(wallet => (
                  <BCH2WalletCard
                    key={wallet.id}
                    walletLabel={wallet.label}
                    balance={wallet.balance}
                    unconfirmedBalance={wallet.unconfirmedBalance}
                    address={wallet.address}
                    isBC2={false}
                    onPress={() => navigation.navigate('WalletDetail', { walletId: wallet.id })}
                    onReceive={() => navigation.navigate('BCH2Receive', { address: wallet.address, walletLabel: wallet.label, isBC2: false })}
                    onSend={() => navigation.navigate('BCH2Send', { walletId: wallet.id, walletBalance: wallet.balance, walletAddress: wallet.address, isBC2: false })}
                  />
                ))}
              </View>
            )}

            {/* BCH2 Wallets Section */}
            {wallets.filter(w => w.type === 'bch2').length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>BCH2 Wallets</Text>
                {wallets.filter(w => w.type === 'bch2').map(wallet => (
                  <BCH2WalletCard
                    key={wallet.id}
                    walletLabel={wallet.label}
                    balance={wallet.balance}
                    unconfirmedBalance={wallet.unconfirmedBalance}
                    address={wallet.address}
                    isBC2={false}
                    onPress={() => navigation.navigate('WalletDetail', { walletId: wallet.id })}
                    onReceive={() => navigation.navigate('BCH2Receive', { address: wallet.address, walletLabel: wallet.label, isBC2: false })}
                    onSend={() => navigation.navigate('BCH2Send', { walletId: wallet.id, walletBalance: wallet.balance, walletAddress: wallet.address, isBC2: false })}
                  />
                ))}
              </View>
            )}
          </>
        )}

        {/* Network Status */}
        <View style={styles.networkStatus}>
          <View style={[styles.statusDot, !isElectrumConnected() && { backgroundColor: '#f85149' }]} />
          <Text style={styles.statusText}>{isElectrumConnected() ? 'Connected to BCH2 Network' : 'Disconnected'}</Text>
        </View>
      </ScrollView>

      {/* Add Wallet FAB */}
      {wallets.length > 0 && (
        <TouchableOpacity style={styles.fab} onPress={navigateToAddWallet}>
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BCH2Colors.background,
  },
  header: {
    paddingTop: 60,
    paddingBottom: BCH2Spacing.lg,
    paddingHorizontal: BCH2Spacing.lg,
    backgroundColor: BCH2Colors.backgroundSecondary,
    borderBottomWidth: 1,
    borderBottomColor: BCH2Colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoImage: {
    width: 40,
    height: 40,
    marginRight: BCH2Spacing.sm,
  },
  logoSubtext: {
    fontSize: BCH2Typography.fontSize.xl,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.textPrimary,
  },
  settingsIcon: {
    fontSize: 24,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: BCH2Spacing.md,
    paddingBottom: 100,
  },
  airdropBanner: {
    backgroundColor: BCH2Colors.primaryGlow,
    borderRadius: BCH2BorderRadius.lg,
    padding: BCH2Spacing.lg,
    marginBottom: BCH2Spacing.lg,
    borderWidth: 1,
    borderColor: BCH2Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
  },
  airdropContent: {
    flex: 1,
  },
  airdropTitle: {
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.primary,
    marginBottom: BCH2Spacing.xs,
  },
  airdropText: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textSecondary,
  },
  airdropArrow: {
    fontSize: BCH2Typography.fontSize.xl,
    color: BCH2Colors.primary,
  },
  section: {
    marginBottom: BCH2Spacing.lg,
  },
  sectionTitle: {
    fontSize: BCH2Typography.fontSize.sm,
    fontWeight: BCH2Typography.fontWeight.semibold,
    color: BCH2Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginLeft: BCH2Spacing.md,
    marginBottom: BCH2Spacing.sm,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: BCH2Spacing.xxl,
    paddingHorizontal: BCH2Spacing.lg,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: BCH2Spacing.lg,
  },
  emptyTitle: {
    fontSize: BCH2Typography.fontSize.xl,
    fontWeight: BCH2Typography.fontWeight.bold,
    color: BCH2Colors.textPrimary,
    marginBottom: BCH2Spacing.sm,
  },
  emptyText: {
    fontSize: BCH2Typography.fontSize.base,
    color: BCH2Colors.textSecondary,
    textAlign: 'center',
    marginBottom: BCH2Spacing.xl,
  },
  emptyActions: {
    width: '100%',
    gap: BCH2Spacing.md,
  },
  createButton: {
    backgroundColor: BCH2Colors.primary,
    borderRadius: BCH2BorderRadius.md,
    paddingVertical: BCH2Spacing.md,
    alignItems: 'center',
    ...BCH2Shadows.glow,
  },
  createButtonText: {
    color: BCH2Colors.textPrimary,
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.bold,
  },
  importButton: {
    backgroundColor: 'transparent',
    borderRadius: BCH2BorderRadius.md,
    paddingVertical: BCH2Spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BCH2Colors.primary,
  },
  importButtonText: {
    color: BCH2Colors.primary,
    fontSize: BCH2Typography.fontSize.lg,
    fontWeight: BCH2Typography.fontWeight.semibold,
  },
  networkStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: BCH2Spacing.md,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: BCH2Colors.success,
    marginRight: BCH2Spacing.sm,
  },
  statusText: {
    fontSize: BCH2Typography.fontSize.sm,
    color: BCH2Colors.textMuted,
  },
  fab: {
    position: 'absolute',
    bottom: BCH2Spacing.xl,
    right: BCH2Spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: BCH2Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...BCH2Shadows.lg,
  },
  fabText: {
    fontSize: 32,
    color: BCH2Colors.textPrimary,
    marginTop: -2,
  },
});

export default BCH2WalletListScreen;
