/**
 * BCH2 Stack Navigator
 * Main navigation for BCH2 wallet screens
 */

import React from 'react';
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

const Stack = createNativeStackNavigator<BCH2RootStackParamList>();

const defaultScreenOptions = {
  headerStyle: {
    backgroundColor: BCH2Colors.backgroundSecondary,
  },
  headerTintColor: BCH2Colors.textPrimary,
  headerTitleStyle: {
    fontWeight: BCH2Typography.fontWeight.semibold as const,
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
  const { walletBalance, walletAddress, isBC2 } = route.params;

  // TODO: Connect to actual send function
  const handleSend = async (toAddress: string, amount: number, fee: number) => {
    // This will be implemented with actual wallet transaction logic
    console.log('Sending:', { toAddress, amount, fee });
    throw new Error('Send not yet implemented');
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

const BCH2WalletDetailWrapper: React.FC = () => {
  const route = useRoute<WalletDetailRouteProp>();
  const navigation = useNavigation();
  const { walletId } = route.params;

  // TODO: Fetch actual wallet data from storage
  // For now, use placeholder data
  const walletData = {
    label: 'BCH2 Wallet',
    balance: 0,
    unconfirmedBalance: 0,
    address: 'bitcoincashii:qr...',
    isBC2: false,
    transactions: [],
  };

  return (
    <BCH2WalletDetail
      walletId={walletId}
      label={walletData.label}
      balance={walletData.balance}
      unconfirmedBalance={walletData.unconfirmedBalance}
      address={walletData.address}
      isBC2={walletData.isBC2}
      transactions={walletData.transactions}
      navigation={navigation}
    />
  );
};

export default BCH2Navigator;
