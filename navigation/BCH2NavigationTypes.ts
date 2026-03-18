/**
 * BCH2 Navigation Types
 * Type definitions for BCH2-specific navigation
 */

export type BCH2RootStackParamList = {
  BCH2WalletList: undefined;
  ClaimAirdrop: undefined;
  BCH2Receive: {
    address: string;
    walletLabel?: string;
    isBC2?: boolean;
    walletId?: string;
  };
  BCH2Send: {
    walletId: string;
    walletBalance: number;
    walletAddress: string;
    isBC2?: boolean;
  };
  BCH2Settings: undefined;
  WalletDetail: {
    walletId: string;
  };
  AddWallet: undefined;
  BCH2AppPassword: undefined;
};

// Navigation prop types
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';

export type BCH2WalletListNavigationProp = NativeStackNavigationProp<BCH2RootStackParamList, 'BCH2WalletList'>;
export type ClaimAirdropNavigationProp = NativeStackNavigationProp<BCH2RootStackParamList, 'ClaimAirdrop'>;
export type BCH2ReceiveNavigationProp = NativeStackNavigationProp<BCH2RootStackParamList, 'BCH2Receive'>;
export type BCH2SendNavigationProp = NativeStackNavigationProp<BCH2RootStackParamList, 'BCH2Send'>;
export type BCH2SettingsNavigationProp = NativeStackNavigationProp<BCH2RootStackParamList, 'BCH2Settings'>;

export type BCH2ReceiveRouteProp = RouteProp<BCH2RootStackParamList, 'BCH2Receive'>;
export type BCH2SendRouteProp = RouteProp<BCH2RootStackParamList, 'BCH2Send'>;
export type WalletDetailRouteProp = RouteProp<BCH2RootStackParamList, 'WalletDetail'>;
