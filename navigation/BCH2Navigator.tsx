/**
 * BCH2 Stack Navigator
 * Main navigation for BCH2 wallet screens
 */

import React, { useState, useRef, useCallback } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BCH2Colors, BCH2Typography } from '../components/BCH2Theme';
import { BCH2RootStackParamList } from './BCH2NavigationTypes';
import { PasswordModalWithRef, PasswordModalHandle } from '../components/PasswordModal';

// Import screens
import BCH2WalletList from '../screen/bch2/BCH2WalletList';
import ClaimAirdrop from '../screen/bch2/ClaimAirdrop';
import BCH2Receive from '../screen/bch2/BCH2Receive';
import BCH2Send from '../screen/bch2/BCH2Send';
import BCH2Settings from '../screen/bch2/BCH2Settings';
import BCH2WalletDetail from '../screen/bch2/BCH2WalletDetail';
import AddWallet from '../screen/bch2/AddWallet';
import { getWallet, getWalletMnemonic, isWalletEncrypted, verifyWalletPassword, StoredWallet } from '../class/bch2-wallet-storage';
import { getTransactionsByAddress, getBC2Transactions, getBalanceByAddress, getBC2Balance, getBalanceByScripthash, getTransactionsByScripthash } from '../blue_modules/BCH2Electrum';
import { sendTransaction, sendFromBech32 } from '../class/bch2-transaction';
import { bc1AddressToScripthash } from '../class/bch2-airdrop';

const Stack = createNativeStackNavigator<BCH2RootStackParamList>();

const defaultScreenOptions = {
  headerStyle: {
    backgroundColor: BCH2Colors.backgroundSecondary,
  },
  headerTintColor: BCH2Colors.textPrimary,
  headerTitleStyle: {
    fontWeight: BCH2Typography.fontWeight.semibold,
    fontSize: BCH2Typography.fontSize.lg,
  },
  headerShadowVisible: false,
  contentStyle: {
    backgroundColor: BCH2Colors.background,
  },
  animation: 'slide_from_right' as const,
};

export const BCH2Navigator: React.FC = () => {
  return (
    <Stack.Navigator
      initialRouteName="BCH2WalletList"
      screenOptions={defaultScreenOptions}
    >
      <Stack.Screen
        name="BCH2WalletList"
        component={BCH2WalletList}
        options={{
          headerShown: false,
          title: 'BCH2 Wallet',
        }}
      />

      <Stack.Screen
        name="ClaimAirdrop"
        component={ClaimAirdrop}
        options={{
          title: 'Claim BCH2',
          headerBackTitle: 'Back',
        }}
      />

      <Stack.Screen
        name="BCH2Receive"
        component={BCH2ReceiveWrapper}
        options={{
          title: 'Receive',
          headerBackTitle: 'Back',
        }}
      />

      <Stack.Screen
        name="BCH2Send"
        component={BCH2SendWrapper}
        options={{
          title: 'Send',
          headerBackTitle: 'Back',
        }}
      />

      <Stack.Screen
        name="BCH2Settings"
        component={BCH2Settings}
        options={{
          title: 'Settings',
          headerBackTitle: 'Back',
        }}
      />

      <Stack.Screen
        name="WalletDetail"
        component={BCH2WalletDetailWrapper}
        options={{
          title: 'Wallet',
          headerBackTitle: 'Back',
        }}
      />

      <Stack.Screen
        name="AddWallet"
        component={AddWallet}
        options={{
          title: 'Add Wallet',
          headerBackTitle: 'Back',
        }}
      />
    </Stack.Navigator>
  );
};

// Wrapper components to handle route params
import { useRoute, useNavigation } from '@react-navigation/native';
import { BCH2ReceiveRouteProp, BCH2SendRouteProp, WalletDetailRouteProp } from './BCH2NavigationTypes';

const BCH2ReceiveWrapper: React.FC = () => {
  const route = useRoute<BCH2ReceiveRouteProp>();
  const { address, walletLabel, isBC2 } = route.params;

  return (
    <BCH2Receive
      address={address}
      walletLabel={walletLabel}
      isBC2={isBC2}
    />
  );
};

const BCH2SendWrapper: React.FC = () => {
  const route = useRoute<BCH2SendRouteProp>();
  const navigation = useNavigation();
  const { walletId, walletBalance, walletAddress, isBC2 } = route.params;

  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const passwordModalRef = useRef<PasswordModalHandle>(null);
  const pendingSendRef = useRef<{
    resolve: (value: { txid: string }) => void;
    reject: (error: Error) => void;
    toAddress: string;
    amount: number;
    feePerByte: number;
  } | null>(null);

  const handlePasswordSubmit = useCallback(async (password: string) => {
    const pending = pendingSendRef.current;
    if (!pending) return;

    try {
      const mnemonic = await getWalletMnemonic(walletId, password);
      if (!mnemonic) {
        passwordModalRef.current?.showError();
        return;
      }

      passwordModalRef.current?.showSuccess();

      // Small delay to show success animation
      setTimeout(async () => {
        // Check if the send was cancelled during the animation
        if (pendingSendRef.current !== pending) return;

        setPasswordModalVisible(false);

        try {
          const isBech32Source = walletAddress.toLowerCase().startsWith('bc1');

          let result;
          if (isBech32Source && !isBC2) {
            result = await sendFromBech32(
              mnemonic,
              walletAddress,
              pending.toAddress,
              pending.amount,
              pending.feePerByte
            );
          } else {
            result = await sendTransaction(
              mnemonic,
              pending.toAddress,
              pending.amount,
              pending.feePerByte,
              isBC2 || false,
              walletAddress
            );
          }

          pending.resolve({ txid: result.txid });
        } catch (err: any) {
          pending.reject(err);
        }
        pendingSendRef.current = null;
      }, 500);
    } catch {
      // Decryption failed — wrong password
      passwordModalRef.current?.showError();
    }
  }, [walletId, walletAddress, isBC2]);

  const handlePasswordCancel = useCallback(() => {
    setPasswordModalVisible(false);
    if (pendingSendRef.current) {
      const err: any = new Error('Password entry cancelled');
      err.__cancelled = true;
      pendingSendRef.current.reject(err);
      pendingSendRef.current = null;
    }
  }, []);

  const handleSend = async (toAddress: string, amount: number, feePerByte: number): Promise<{ txid: string }> => {
    // Check if wallet is encrypted
    const encrypted = await isWalletEncrypted(walletId);

    if (!encrypted) {
      // Legacy unencrypted wallet — proceed without password
      const mnemonic = await getWalletMnemonic(walletId);
      if (!mnemonic) {
        throw new Error('Could not retrieve wallet keys');
      }

      const isBech32Source = walletAddress.toLowerCase().startsWith('bc1');

      let result;
      if (isBech32Source && !isBC2) {
        result = await sendFromBech32(mnemonic, walletAddress, toAddress, amount, feePerByte);
      } else {
        result = await sendTransaction(mnemonic, toAddress, amount, feePerByte, isBC2 || false, walletAddress);
      }

      return { txid: result.txid };
    }

    // Encrypted wallet — show password modal and wait for resolution
    return new Promise((resolve, reject) => {
      pendingSendRef.current = { resolve, reject, toAddress, amount, feePerByte };
      setPasswordModalVisible(true);
    });
  };

  return (
    <>
      <BCH2Send
        walletBalance={walletBalance}
        walletAddress={walletAddress}
        isBC2={isBC2}
        onSend={handleSend}
        navigation={navigation}
      />
      <PasswordModalWithRef
        ref={passwordModalRef}
        visible={passwordModalVisible}
        title="Unlock Wallet"
        subtitle="Enter your password to sign this transaction"
        onSubmit={handlePasswordSubmit}
        onCancel={handlePasswordCancel}
      />
    </>
  );
};

interface Transaction {
  txid: string;
  confirmations: number;
  amount: number;
  timestamp: number;
  height?: number;
}

const BCH2WalletDetailWrapper: React.FC = () => {
  const route = useRoute<WalletDetailRouteProp>();
  const navigation = useNavigation();
  const { walletId } = route.params;
  const [wallet, setWallet] = React.useState<StoredWallet | null>(null);
  const [transactions, setTransactions] = React.useState<Transaction[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);

  const fetchWalletData = React.useCallback(async (w: StoredWallet) => {
    try {
      const isBC2 = w.type === 'bc2';
      const isBC1 = w.type === 'bc1' || w.address.toLowerCase().startsWith('bc1');

      let balance: { confirmed: number; unconfirmed: number };
      let txHistory: any[];

      if (isBC2) {
        balance = await getBC2Balance(w.address);
        txHistory = await getBC2Transactions(w.address);
      } else if (isBC1) {
        // bc1 addresses need scripthash-based queries
        const scripthash = bc1AddressToScripthash(w.address);
        if (!scripthash) {
          throw new Error('Invalid bc1 address');
        }
        balance = await getBalanceByScripthash(scripthash);
        txHistory = await getTransactionsByScripthash(scripthash);
      } else {
        // Standard BCH2 CashAddr
        balance = await getBalanceByAddress(w.address);
        txHistory = await getTransactionsByAddress(w.address);
      }

      // Convert to Transaction format
      const formattedTxs: Transaction[] = txHistory.map((tx: any) => ({
        txid: tx.tx_hash || tx.txid,
        confirmations: tx.height ? Math.max(0, (tx.height > 0 ? 1 : 0)) : 0, // Simplified - would need current block height
        amount: 0, // Amount requires fetching full tx details
        timestamp: Math.floor(Date.now() / 1000), // Would need tx details for actual time
        height: tx.height,
      }));

      setTransactions(formattedTxs);

      // Update wallet with new balance
      setWallet(prev => prev ? {
        ...prev,
        balance: balance.confirmed,
        unconfirmedBalance: balance.unconfirmed,
      } : null);
    } catch (error) {
      console.log('Failed to fetch wallet data:', error);
    }
  }, []);

  React.useEffect(() => {
    const loadWallet = async () => {
      const w = await getWallet(walletId);
      setWallet(w);
      if (w) {
        await fetchWalletData(w);
      }
      setLoading(false);
    };
    loadWallet();
  }, [walletId, fetchWalletData]);

  const handleRefresh = React.useCallback(async () => {
    if (!wallet) return;
    setRefreshing(true);
    await fetchWalletData(wallet);
    setRefreshing(false);
  }, [wallet, fetchWalletData]);

  if (loading || !wallet) {
    return null;
  }

  return (
    <BCH2WalletDetail
      walletId={walletId}
      label={wallet.label}
      balance={wallet.balance}
      unconfirmedBalance={wallet.unconfirmedBalance}
      address={wallet.address}
      isBC2={wallet.type === 'bc2'}
      transactions={transactions}
      navigation={navigation}
      onRefresh={handleRefresh}
      refreshing={refreshing}
    />
  );
};

export default BCH2Navigator;
