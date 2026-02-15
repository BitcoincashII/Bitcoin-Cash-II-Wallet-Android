/**
 * BCH2 Airdrop Claim
 *
 * Since BCH2 forks from BC2 at block 53,200, any BC2 wallet with balance
 * at that block automatically has the same balance on BCH2.
 *
 * This module handles:
 * 1. Importing BC2 private keys/seeds
 * 2. Deriving BCH2 addresses from the same keys
 * 3. Checking and displaying BCH2 balances
 */

import { ECPairAPI, ECPairFactory } from 'ecpair';
import * as bip39 from 'bip39';
import BIP32Factory, { BIP32Interface } from 'bip32';
import ecc from '../blue_modules/noble_ecc';
import * as BCH2Electrum from '../blue_modules/BCH2Electrum';
import { BCH2Wallet } from './wallets/bch2-wallet';

const ECPair: ECPairAPI = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);
const crypto = require('crypto');

// CashAddr character set
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

export interface AirdropClaimResult {
  success: boolean;
  address: string;
  bch2Address: string;
  balance: number;
  bc2Balance?: number; // Current BC2 balance (may differ from BCH2 if spent post-fork)
  error?: string;
}

export interface WalletImportResult {
  wallet: BCH2Wallet;
  bc2Address: string;
  bch2Address: string;
  balance: {
    confirmed: number;
    unconfirmed: number;
  };
}

/**
 * Claim BCH2 airdrop from BC2 WIF private key
 */
export async function claimFromWIF(wif: string, checkBC2Balance: boolean = false): Promise<AirdropClaimResult> {
  try {
    const keyPair = ECPair.fromWIF(wif);
    const pubkeyHash = hash160(keyPair.publicKey);

    // Get BC2 legacy address (for display)
    const bc2Address = getLegacyAddress(pubkeyHash);

    // Get BCH2 CashAddr
    const bch2Address = encodeCashAddr('bitcoincashii', 0, pubkeyHash);

    // Check BCH2 balance
    const balance = await BCH2Electrum.getBalanceByAddress(bch2Address);

    const result: AirdropClaimResult = {
      success: true,
      address: bc2Address,
      bch2Address: bch2Address,
      balance: balance.confirmed + balance.unconfirmed,
    };

    // Optionally check BC2 balance for comparison
    if (checkBC2Balance) {
      try {
        const bc2BalanceResult = await BCH2Electrum.getBC2Balance(bc2Address);
        result.bc2Balance = bc2BalanceResult.confirmed + bc2BalanceResult.unconfirmed;
      } catch (e) {
        // BC2 balance check failed, continue without it
        console.log('BC2 balance check failed:', e);
      }
    }

    return result;
  } catch (err: any) {
    return {
      success: false,
      address: '',
      bch2Address: '',
      balance: 0,
      error: err.message || 'Invalid private key',
    };
  }
}

/**
 * Claim BCH2 airdrop from BIP39 mnemonic seed phrase
 * Derives addresses using standard BIP44 path: m/44'/145'/0'/0/0 (BCH path)
 */
export async function claimFromMnemonic(mnemonic: string, passphrase: string = ''): Promise<AirdropClaimResult[]> {
  try {
    if (!bip39.validateMnemonic(mnemonic)) {
      return [{
        success: false,
        address: '',
        bch2Address: '',
        balance: 0,
        error: 'Invalid mnemonic phrase',
      }];
    }

    const seed = await bip39.mnemonicToSeed(mnemonic, passphrase);
    const root = bip32.fromSeed(seed);

    const results: AirdropClaimResult[] = [];

    // Check first 20 addresses on standard derivation paths
    const paths = [
      "m/44'/145'/0'/0", // BCH standard
      "m/44'/0'/0'/0",   // BTC standard (some wallets use this)
      "m/44'/145'/0'/1", // BCH change addresses
    ];

    for (const basePath of paths) {
      for (let i = 0; i < 20; i++) {
        const path = `${basePath}/${i}`;
        const child = root.derivePath(path);
        const pubkeyHash = hash160(child.publicKey);

        const bc2Address = getLegacyAddress(pubkeyHash);
        const bch2Address = encodeCashAddr('bitcoincashii', 0, pubkeyHash);

        try {
          const balance = await BCH2Electrum.getBalanceByAddress(bch2Address);
          const total = balance.confirmed + balance.unconfirmed;

          if (total > 0) {
            results.push({
              success: true,
              address: bc2Address,
              bch2Address: bch2Address,
              balance: total,
            });
          }
        } catch (err) {
          // Skip failed address checks
          continue;
        }
      }
    }

    if (results.length === 0) {
      return [{
        success: true,
        address: '',
        bch2Address: '',
        balance: 0,
        error: 'No BCH2 balance found for this seed',
      }];
    }

    return results;
  } catch (err: any) {
    return [{
      success: false,
      address: '',
      bch2Address: '',
      balance: 0,
      error: err.message || 'Failed to process mnemonic',
    }];
  }
}

/**
 * Import BC2 wallet and create BCH2 wallet with same keys
 */
export async function importBC2Wallet(wif: string): Promise<WalletImportResult> {
  const wallet = new BCH2Wallet();
  wallet.setSecret(wif);

  const keyPair = ECPair.fromWIF(wif);
  const pubkeyHash = hash160(keyPair.publicKey);

  const bc2Address = getLegacyAddress(pubkeyHash);
  const bch2Address = wallet.getAddress() as string;

  await wallet.fetchBalance();

  return {
    wallet,
    bc2Address,
    bch2Address,
    balance: {
      confirmed: wallet.balance,
      unconfirmed: wallet.unconfirmed_balance,
    },
  };
}

/**
 * Get total claimable BCH2 from multiple BC2 addresses
 */
export async function getTotalClaimable(addresses: string[]): Promise<number> {
  let total = 0;

  for (const address of addresses) {
    try {
      // Convert BC2 address to BCH2 CashAddr format
      const bch2Address = convertToCashAddr(address);
      const balance = await BCH2Electrum.getBalanceByAddress(bch2Address);
      total += balance.confirmed + balance.unconfirmed;
    } catch (err) {
      // Skip invalid addresses
      continue;
    }
  }

  return total;
}

// Helper functions

function hash160(data: Buffer): Buffer {
  const sha256Hash = crypto.createHash('sha256').update(data).digest();
  const ripemd160Hash = crypto.createHash('ripemd160').update(sha256Hash).digest();
  return ripemd160Hash;
}

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

function convertToCashAddr(legacyAddress: string): string {
  // Decode base58 address
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = 0n;

  for (const char of legacyAddress) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid address character');
    num = num * 58n + BigInt(idx);
  }

  // Convert to bytes
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const bytes = Buffer.from(hex, 'hex');

  // Extract pubkey hash (skip version byte, remove checksum)
  const pubkeyHash = bytes.slice(1, 21);

  return encodeCashAddr('bitcoincashii', 0, pubkeyHash);
}

export default {
  claimFromWIF,
  claimFromMnemonic,
  importBC2Wallet,
  getTotalClaimable,
};
