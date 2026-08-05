/**
 * BCH2 Stack Navigator
 * Main navigation for BCH2 wallet screens
 */

import React from 'react';
import { View, Text, Alert, TouchableOpacity, ActivityIndicator } from 'react-native';
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
import BCH2ScanQR from '../screen/bch2/BCH2ScanQR';
import { getWallet, getWallets, getWalletMnemonic, updateWalletBalance, getBC2AccountXpub, StoredWallet } from '../class/bch2-wallet-storage';
import { parseBCH2PaymentUri } from '../class/bch2-uri';
import { getTransactionsByAddress, getBC2Transactions, getBalanceByAddress, getBC2Balance, getBalanceByScripthash, getTransactionsByScripthash, getLatestBlock, getTipHeight } from '../blue_modules/BCH2Electrum';
import * as BCH2Spv from '../blue_modules/bch2-spv';
import { sendTransaction, sendFromBech32, sendFromP2SH, sendFromP2WSH, sendFromP2TR, decodeBech32, sendBC2NativeHd, bc2ScriptTypeFromAddress, getBC2HdBalance, scanBC2Hd } from '../class/bch2-transaction';
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
        name="BCH2SendRoot"
        component={BCH2SendRootWrapper}
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

      <Stack.Screen
        name="BCH2ScanQR"
        component={BCH2ScanQR}
        options={{
          headerShown: false, // full-screen camera with its own Cancel button
          title: 'Scan',
        }}
      />
    </Stack.Navigator>
  );
};

// Wrapper components to handle route params
import { useRoute, useNavigation } from '@react-navigation/native';
import { BCH2ReceiveRouteProp, BCH2SendRouteProp, BCH2SendRootRouteProp, WalletDetailRouteProp } from './BCH2NavigationTypes';

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
          const wallet = await getWallet(walletId);
          if (!wallet || cancelled) return;
          const scriptType = bc2ScriptTypeFromAddress(address);
          const xpub = await getBC2AccountXpub(wallet, scriptType); // seed touched at most once (backfill)
          const scan = await scanBC2Hd(xpub, scriptType);
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
  const { walletId, walletBalance, walletAddress, isBC2, prefillAddress, prefillAmount } = route.params;

  const handleSend = async (toAddress: string, amount: number, feePerByte: number): Promise<{ txid: string }> => {
    const mnemonic = await getWalletMnemonic(walletId);
    if (!mnemonic) {
      throw new Error('Could not retrieve wallet keys');
    }

    const addr = walletAddress.toLowerCase();
    // NB: check bc1p (Taproot) BEFORE bc1 — 'bc1p'.startsWith('bc1') is true.
    const isTaprootSource = addr.startsWith('bc1p');
    const isBech32Source = addr.startsWith('bc1') && !isTaprootSource; // bc1q (P2WPKH or P2WSH)
    const isP2SHSource = walletAddress.startsWith('3');

    let result;
    if (isBC2) {
      // Native BC2 (real SegWit/Taproot witness), full HD: spends across every
      // address of the account and sends change to a fresh change address. Script
      // type is inferred from the wallet address prefix.
      result = await sendBC2NativeHd(mnemonic, bc2ScriptTypeFromAddress(walletAddress), toAddress, amount, feePerByte);
    } else if (isTaprootSource) {
      // BCH2 Taproot *recovery* of pre-fork coins (BIP341 Schnorr via scriptSig).
      result = await sendFromP2TR(mnemonic, walletAddress, toAddress, amount, feePerByte);
    } else if (isBech32Source) {
      // BCH2 SegWit *recovery* of pre-fork coins (scriptSig + FORKID). A bc1q
      // address is P2WPKH (20-byte program) or, rarely, P2WSH (32-byte program).
      const decoded = decodeBech32(walletAddress);
      if (decoded && decoded.program.length === 32) {
        result = await sendFromP2WSH(mnemonic, walletAddress, toAddress, amount, feePerByte);
      } else {
        result = await sendFromBech32(mnemonic, walletAddress, toAddress, amount, feePerByte);
      }
    } else if (isP2SHSource) {
      result = await sendFromP2SH(mnemonic, walletAddress, toAddress, amount, feePerByte);
    } else {
      result = await sendTransaction(mnemonic, toAddress, amount, feePerByte, false, walletAddress);
    }

    return { txid: result.txid };
  };

  // BC2 wallets are HD/account-wide. Load the ACCOUNT's mature UTXO values (all receive+change addresses) so the
  // send screen's coin-selection / MAX / sufficiency match what sendBC2NativeHd actually spends — a single-address
  // UTXO set wrongly blocks a valid send once change has moved off the primary address.
  const bc2ScriptType = isBC2 ? bc2ScriptTypeFromAddress(walletAddress) : undefined;
  const loadBc2AccountUtxoValues = React.useCallback(async (): Promise<number[]> => {
    const w = await getWallet(walletId);
    if (!w || !bc2ScriptType) return [];
    const xpub = await getBC2AccountXpub(w, bc2ScriptType);
    const scan = await scanBC2Hd(xpub, bc2ScriptType);
    return scan.utxos
      .map((u: any) => u.value)
      .filter((v: any) => Number.isInteger(v) && v > 0)
      .sort((a: number, b: number) => b - a);
  }, [walletId, bc2ScriptType]);

  return (
    <BCH2Send
      walletBalance={walletBalance}
      walletAddress={walletAddress}
      isBC2={isBC2}
      bc2ScriptType={bc2ScriptType}
      loadUtxoValues={isBC2 ? loadBc2AccountUtxoValues : undefined}
      onSend={handleSend}
      navigation={navigation}
      prefillAddress={prefillAddress}
      prefillAmount={prefillAmount}
    />
  );
};

/**
 * Deep-link entry: a bitcoincashii: payment URI arrived. Parse it, pick which BCH2
 * wallet to pay from (auto if there's exactly one; a chooser if several; a prompt
 * to create one if none), then forward to BCH2Send with the recipient prefilled.
 */
const BCH2SendRootWrapper: React.FC = () => {
  const route = useRoute<BCH2SendRootRouteProp>();
  const navigation = useNavigation<any>();
  const [wallets, setWallets] = React.useState<StoredWallet[] | null>(null);
  const payment = React.useMemo(() => parseBCH2PaymentUri(route.params?.uri || ''), [route.params?.uri]);

  const goToSend = React.useCallback((w: StoredWallet) => {
    navigation.replace('BCH2Send', {
      walletId: w.id,
      walletBalance: w.balance,
      walletAddress: w.address,
      isBC2: false,
      prefillAddress: payment?.address,
      prefillAmount: payment?.amount,
    });
  }, [navigation, payment]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!payment) { navigation.replace('BCH2WalletList'); return; }
      const bch2 = (await getWallets()).filter(w => w.type === 'bch2');
      if (cancelled) return;
      if (bch2.length === 0) {
        Alert.alert('No BCH2 wallet', 'Create or import a BCH2 wallet to receive this payment request.', [
          { text: 'OK', onPress: () => navigation.replace('BCH2WalletList') },
        ]);
      } else if (bch2.length === 1) {
        goToSend(bch2[0]);
      } else {
        setWallets(bch2); // show the chooser
      }
    })();
    return () => { cancelled = true; };
  }, [payment, navigation, goToSend]);

  if (!wallets) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BCH2Colors.background }}>
        <ActivityIndicator color={BCH2Colors.primary} />
      </View>
    );
  }

  // Multiple wallets — let the user choose which one pays.
  return (
    <View style={{ flex: 1, padding: 20, backgroundColor: BCH2Colors.background }}>
      <Text style={{ color: BCH2Colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 4 }}>Pay from which wallet?</Text>
      <Text style={{ color: BCH2Colors.textMuted, marginBottom: 16 }} numberOfLines={2}>
        {payment?.amount ? `${payment.amount} BCH2 to ` : 'To '}{payment?.address}
      </Text>
      {wallets.map(w => (
        <TouchableOpacity
          key={w.id}
          onPress={() => goToSend(w)}
          style={{ padding: 16, borderRadius: 10, borderWidth: 1, borderColor: BCH2Colors.textMuted, marginBottom: 10 }}
          accessibilityRole="button"
          accessibilityLabel={`Pay from ${w.label}`}
        >
          <Text style={{ color: BCH2Colors.textPrimary, fontWeight: '600' }}>{w.label}</Text>
          <Text style={{ color: BCH2Colors.textMuted, fontSize: 12 }}>{(w.balance / 1e8).toFixed(8)} BCH2</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

interface Transaction {
  txid: string;
  confirmations: number;
  amount: number;
  timestamp: number;
  height?: number;
  verified?: 'unverified' | 'verified' | 'failed';
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
      let resolvedXpub: string | undefined; // cache a backfilled xpub into state so refresh doesn't re-read the seed
      let bc2BalancePartial = false; // true if the BC2 balance is the primary-address-only fallback (don't persist)

      if (isBC2) {
        // HD: one account scan drives both the aggregate balance AND the tx history
        // (across every used address, deduped). Fall back to the primary address if
        // the seed can't be read (e.g. locked) or the scan fails.
        const scriptType = bc2ScriptTypeFromAddress(w.address);
        try {
          // Watch-only: derive/read the account xpub (seed touched at most once, to
          // backfill an older wallet), then scan without the seed.
          const xpub = await getBC2AccountXpub(w, scriptType);
          resolvedXpub = xpub;
          const scan = await scanBC2Hd(xpub, scriptType);
          balance = { confirmed: scan.confirmed, unconfirmed: scan.unconfirmed };
          const seen = new Set<string>();
          const merged: any[] = [];
          for (const addr of scan.usedAddresses) {
            try {
              for (const t of await getBC2Transactions(addr)) {
                if (t.tx_hash && !seen.has(t.tx_hash)) { seen.add(t.tx_hash); merged.push(t); }
              }
            } catch { /* skip one address's history, don't block */ }
          }
          merged.sort((a, b) => (b.height || Number.MAX_SAFE_INTEGER) - (a.height || Number.MAX_SAFE_INTEGER));
          txHistory = merged;
        } catch {
          // HD scan failed (locked seed / network): primary-address-only fallback UNDER-reports (0 when funds are
          // on change addresses). Show it this session but do NOT persist it over the last-known-good aggregate.
          balance = await getBC2Balance(w.address);
          txHistory = await getBC2Transactions(w.address);
          bc2BalancePartial = true;
        }
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
      const isPlainBCH2 = !isBC2 && !isBC1; // SPV applies to mainnet BCH2 CashAddr txs only
      const formattedTxs: Transaction[] = txHistory.map((tx: any) => ({
        txid: tx.tx_hash || tx.txid,
        confirmations: tx.height ? Math.max(0, (tx.height > 0 ? 1 : 0)) : 0, // optimistic; upgraded by the SPV pass below
        amount: 0, // Amount requires fetching full tx details
        timestamp: Math.floor(Date.now() / 1000), // Would need tx details for actual time
        height: tx.height,
        // Only txs SPV can actually cover (mainnet, above the checkpoint) start 'unverified'; others get no badge.
        verified: (isPlainBCH2 && tx.height > 0 && BCH2Spv.isInSpvScope(tx.height)) ? 'unverified' : undefined,
      }));

      setTransactions(formattedTxs);

      // L1: fire-and-forget client-side SPV verification of confirmed BCH2 txs (merkle + PoW header chain), so the
      // confirmation is trust-minimised rather than server-reported. Non-blocking; fail-closed per tx; mainnet only.
      if (isPlainBCH2 && BCH2Spv.spvSupported()) {
        (async () => {
          const tip = await getTipHeight(); // FRESH tip (getLatestBlock can be stale for a long session)
          if (!tip || tip <= 0) return;
          // get_history is oldest-first; verify the MOST RECENT confirmed txs (highest height) so recent
          // payments don't stay stuck on 'verifying…' when the history is long.
          const targets = formattedTxs
            .filter(t => t.verified === 'unverified' && t.height && t.height > 0)
            .sort((a, b) => (b.height || 0) - (a.height || 0))
            .slice(0, 25);
          const results = new Map<string, { verified: Transaction['verified']; confirmations?: number }>();
          await Promise.all(targets.map(async (t) => {
            try {
              const depth = await BCH2Spv.verifyConfirmations(t.txid, t.height!, tip);
              // null = out of scope / not verifiable yet → neutral (no badge); number = proven depth.
              results.set(t.txid, depth === null ? { verified: undefined } : { verified: 'verified', confirmations: depth });
            } catch {
              results.set(t.txid, { verified: 'failed' }); // definitive forgery
            }
          }));
          const updated = formattedTxs.map(t => (results.has(t.txid) ? { ...t, ...results.get(t.txid)! } : t));
          setTransactions(prev => (prev === formattedTxs ? updated : prev));
        })().catch(() => {});
      }

      // Update wallet with new balance (both React state and persistent storage).
      // Also cache a freshly-backfilled xpub so pull-to-refresh short-circuits the
      // getBC2AccountXpub seed read instead of re-reading the Keystore each time.
      setWallet(prev => prev ? {
        ...prev,
        balance: balance.confirmed,
        unconfirmedBalance: balance.unconfirmed,
        ...(resolvedXpub && !prev.xpub ? { xpub: resolvedXpub } : {}),
      } : null);
      // Don't persist a partial (primary-address-only) BC2 balance over the last-known-good aggregate (round-5 LOW).
      if (!bc2BalancePartial) updateWalletBalance(w.id, balance.confirmed, balance.unconfirmed).catch(() => {});
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
