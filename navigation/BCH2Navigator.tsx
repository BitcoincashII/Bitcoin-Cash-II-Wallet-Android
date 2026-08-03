/**
 * BCH2 Stack Navigator
 * Main navigation for BCH2 wallet screens
 */

import React from 'react';
import { View, Text } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BCH2Colors, BCH2Typography } from '../components/BCH2Theme';
import { BCH2RootStackParamList } from './BCH2NavigationTypes';

// Import screens
import BCH2WalletList from '../screen/bch2/BCH2WalletList';
import ClaimAirdrop from '../screen/bch2/ClaimAirdrop';
import BCH2Receive from '../screen/bch2/BCH2Receive';
import BCH2Send from '../screen/bch2/BCH2Send';
import BCH2Settings from '../screen/bch2/BCH2Settings';
import BCH2WalletDetail from '../screen/bch2/BCH2WalletDetail';
import AddWallet from '../screen/bch2/AddWallet';
import BCH2AppPassword from '../screen/bch2/BCH2AppPassword';
import { getWallet, getWalletMnemonic, updateWalletBalance, StoredWallet } from '../class/bch2-wallet-storage';
import { getTransactionsByAddress, getBC2Transactions, getBalanceByAddress, getBC2Balance, getBalanceByScripthash, getTransactionsByScripthash } from '../blue_modules/BCH2Electrum';
import { sendTransaction, sendFromBech32, sendFromP2SH, sendBC2NativeHd, bc2ScriptTypeFromAddress, getBC2HdBalance, scanBC2Hd } from '../class/bch2-transaction';
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

      <Stack.Screen
        name="BCH2AppPassword"
        component={BCH2AppPassword}
        options={{
          title: 'App Password',
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
  const { address, walletLabel, isBC2, walletId } = route.params;
  // For BC2 (HD) wallets, show the next UNUSED receive address instead of always
  // reusing the primary one. Falls back to the stored address on any failure.
  const [displayAddress, setDisplayAddress] = React.useState(address);
  React.useEffect(() => {
    let cancelled = false;
    if (isBC2 && walletId) {
      (async () => {
        try {
          const mnemonic = await getWalletMnemonic(walletId);
          if (!mnemonic || cancelled) return;
          const scan = await scanBC2Hd(mnemonic, bc2ScriptTypeFromAddress(address));
          if (!cancelled && scan.receiveAddress) setDisplayAddress(scan.receiveAddress);
        } catch { /* keep the stored address */ }
      })();
    }
    return () => { cancelled = true; };
  }, [isBC2, walletId, address]);

  return (
    <BCH2Receive
      address={displayAddress}
      walletLabel={walletLabel}
      isBC2={isBC2}
    />
  );
};

const BCH2SendWrapper: React.FC = () => {
  const route = useRoute<BCH2SendRouteProp>();
  const navigation = useNavigation();
  const { walletId, walletBalance, walletAddress, isBC2 } = route.params;

  const handleSend = async (toAddress: string, amount: number, feePerByte: number): Promise<{ txid: string }> => {
    const mnemonic = await getWalletMnemonic(walletId);
    if (!mnemonic) {
      throw new Error('Could not retrieve wallet keys');
    }

    const addr = walletAddress.toLowerCase();
    const isBech32Source = addr.startsWith('bc1');
    const isP2SHSource = walletAddress.startsWith('3');

    let result;
    if (isBC2) {
      // Native BC2 (real SegWit/Taproot witness), full HD: spends across every
      // address of the account and sends change to a fresh change address. Script
      // type is inferred from the wallet address prefix.
      result = await sendBC2NativeHd(mnemonic, bc2ScriptTypeFromAddress(walletAddress), toAddress, amount, feePerByte);
    } else if (isBech32Source) {
      // BCH2 SegWit *recovery* of pre-fork coins (scriptSig + FORKID).
      result = await sendFromBech32(mnemonic, walletAddress, toAddress, amount, feePerByte);
    } else if (isP2SHSource) {
      result = await sendFromP2SH(mnemonic, walletAddress, toAddress, amount, feePerByte);
    } else {
      result = await sendTransaction(mnemonic, toAddress, amount, feePerByte, false, walletAddress);
    }

    return { txid: result.txid };
  };

  return (
    <BCH2Send
      walletBalance={walletBalance}
      walletAddress={walletAddress}
      isBC2={isBC2}
      onSend={handleSend}
      navigation={navigation}
    />
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
        // HD-aggregate balance across the whole account; fall back to the primary
        // address if the seed can't be read (e.g. locked) or the scan fails.
        const scriptType = bc2ScriptTypeFromAddress(w.address);
        try {
          const mnemonic = await getWalletMnemonic(w.id);
          balance = mnemonic ? await getBC2HdBalance(mnemonic, scriptType) : await getBC2Balance(w.address);
        } catch {
          balance = await getBC2Balance(w.address);
        }
        txHistory = await getBC2Transactions(w.address); // history shown for the primary address
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

      // Update wallet with new balance (both React state and persistent storage)
      setWallet(prev => prev ? {
        ...prev,
        balance: balance.confirmed,
        unconfirmedBalance: balance.unconfirmed,
      } : null);
      updateWalletBalance(w.id, balance.confirmed, balance.unconfirmed).catch(() => {});
    } catch (error) {
      __DEV__ && console.log('Failed to fetch wallet data:', error);
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
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a0a0a' }}>
        <Text style={{ color: '#888', fontSize: 16 }}>Loading wallet...</Text>
      </View>
    );
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
