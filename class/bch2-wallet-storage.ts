/**
 * BCH2 Wallet Storage
 * Handles saving and loading BCH2 wallets using AsyncStorage
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';
import ecc from '../blue_modules/noble_ecc';

const bip32 = BIP32Factory(ecc);
const crypto = require('crypto');

const WALLETS_KEY = '@bch2_wallets';
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

export interface StoredWallet {
  id: string;
  type: 'bch2' | 'bc2';
  label: string;
  mnemonic: string; // Encrypted in production, plain for now
  address: string;
  balance: number;
  unconfirmedBalance: number;
  createdAt: number;
}

/**
 * Save a new wallet to storage
 */
export async function saveWallet(
  label: string,
  mnemonic: string,
  walletType: 'bch2' | 'bc2' = 'bch2'
): Promise<StoredWallet> {
  // Derive address from mnemonic
  const address = await deriveAddress(mnemonic, walletType);

  const wallet: StoredWallet = {
    id: generateId(),
    type: walletType,
    label: label.trim(),
    mnemonic: mnemonic.trim(),
    address,
    balance: 0,
    unconfirmedBalance: 0,
    createdAt: Date.now(),
  };

  // Get existing wallets
  const wallets = await getWallets();

  // Add new wallet
  wallets.push(wallet);

  // Save to storage
  await AsyncStorage.setItem(WALLETS_KEY, JSON.stringify(wallets));

  return wallet;
}

/**
 * Get all stored wallets
 */
export async function getWallets(): Promise<StoredWallet[]> {
  try {
    const data = await AsyncStorage.getItem(WALLETS_KEY);
    if (!data) return [];
    return JSON.parse(data);
  } catch (error) {
    console.error('Failed to load wallets:', error);
    return [];
  }
}

/**
 * Get a single wallet by ID
 */
export async function getWallet(id: string): Promise<StoredWallet | null> {
  const wallets = await getWallets();
  return wallets.find(w => w.id === id) || null;
}

/**
 * Update wallet balance
 */
export async function updateWalletBalance(
  id: string,
  balance: number,
  unconfirmedBalance: number
): Promise<void> {
  const wallets = await getWallets();
  const index = wallets.findIndex(w => w.id === id);

  if (index !== -1) {
    wallets[index].balance = balance;
    wallets[index].unconfirmedBalance = unconfirmedBalance;
    await AsyncStorage.setItem(WALLETS_KEY, JSON.stringify(wallets));
  }
}

/**
 * Delete a wallet
 */
export async function deleteWallet(id: string): Promise<void> {
  const wallets = await getWallets();
  const filtered = wallets.filter(w => w.id !== id);
  await AsyncStorage.setItem(WALLETS_KEY, JSON.stringify(filtered));
}

/**
 * Derive address from mnemonic (BCH2 CashAddr or BC2 legacy)
 */
async function deriveAddress(mnemonic: string, walletType: 'bch2' | 'bc2' = 'bch2'): Promise<string> {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const root = bip32.fromSeed(seed);

  // Use BCH derivation path: m/44'/145'/0'/0/0
  const child = root.derivePath("m/44'/145'/0'/0/0");
  const pubkeyHash = hash160(child.publicKey);

  if (walletType === 'bc2') {
    // BC2 uses legacy address format
    return getLegacyAddress(pubkeyHash);
  }

  // BCH2 uses CashAddr format
  return encodeCashAddr('bitcoincashii', 0, pubkeyHash);
}

/**
 * Get legacy P2PKH address (for BC2)
 */
function getLegacyAddress(pubkeyHash: Buffer): string {
  // Version byte 0x00 for mainnet P2PKH
  const versionedHash = Buffer.concat([Buffer.from([0x00]), pubkeyHash]);
  const checksum = doubleHash(versionedHash).slice(0, 4);
  const address = Buffer.concat([versionedHash, checksum]);
  return base58Encode(address);
}

function doubleHash(data: Buffer): Buffer {
  const hash1 = crypto.createHash('sha256').update(data).digest();
  const hash2 = crypto.createHash('sha256').update(hash1).digest();
  return hash2;
}

function base58Encode(data: Buffer): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = BigInt('0x' + data.toString('hex'));
  let result = '';

  while (num > 0n) {
    const remainder = Number(num % 58n);
    num = num / 58n;
    result = ALPHABET[remainder] + result;
  }

  // Add leading zeros
  for (const byte of data) {
    if (byte === 0) {
      result = '1' + result;
    } else {
      break;
    }
  }

  return result;
}

/**
 * Get mnemonic for a wallet (for sending transactions)
 */
export async function getWalletMnemonic(id: string): Promise<string | null> {
  const wallet = await getWallet(id);
  return wallet?.mnemonic || null;
}

// Helper functions

function generateId(): string {
  return 'bch2_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function hash160(data: Buffer): Buffer {
  const sha256Hash = crypto.createHash('sha256').update(data).digest();
  const ripemd160Hash = crypto.createHash('ripemd160').update(sha256Hash).digest();
  return ripemd160Hash;
}

function encodeCashAddr(prefix: string, type: number, hash: Buffer): string {
  const payload = [type];
  let acc = 0;
  let bits = 0;

  for (const byte of hash) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      payload.push((acc >> bits) & 0x1f);
    }
  }
  if (bits > 0) {
    payload.push((acc << (5 - bits)) & 0x1f);
  }

  const checksum = calculateChecksum(prefix, payload);
  const fullPayload = [...payload, ...checksum];

  let result = prefix + ':';
  for (const value of fullPayload) {
    result += CHARSET[value];
  }

  return result;
}

function calculateChecksum(prefix: string, payload: number[]): number[] {
  const prefixData = [];
  for (const char of prefix) {
    prefixData.push(char.charCodeAt(0) & 0x1f);
  }
  prefixData.push(0);

  const values = [...prefixData, ...payload, 0, 0, 0, 0, 0, 0, 0, 0];
  const polymod = cashAddrPolymod(values) ^ 1;

  const checksum = [];
  for (let i = 0; i < 8; i++) {
    checksum.push((polymod >> (5 * (7 - i))) & 0x1f);
  }
  return checksum;
}

function cashAddrPolymod(values: number[]): number {
  const GENERATORS = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];
  let chk = 1n;

  for (const value of values) {
    const top = chk >> 35n;
    chk = ((chk & 0x07ffffffffn) << 5n) ^ BigInt(value);
    for (let i = 0; i < 5; i++) {
      if ((top >> BigInt(i)) & 1n) {
        chk ^= GENERATORS[i];
      }
    }
  }

  return Number(chk);
}

export default {
  saveWallet,
  getWallets,
  getWallet,
  updateWalletBalance,
  deleteWallet,
  getWalletMnemonic,
};
