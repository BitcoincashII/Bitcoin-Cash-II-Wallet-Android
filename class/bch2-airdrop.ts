/**
 * BCH2 Airdrop Claim
 *
 * Since BCH2 forks from BC2 at block 53,200, any BC2 wallet with balance
 * at that block automatically has the same balance on BCH2.
 *
 * This module handles:
 * 1. Importing BC2 private keys/seeds
 * 2. Deriving BCH2 addresses from the same keys (including SegWit bc1 addresses)
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

// Bech32 character set
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

export interface AirdropClaimResult {
  success: boolean;
  address: string;
  bch2Address: string;
  balance: number;
  bc2Balance?: number; // Current BC2 balance (for anti-gaming comparison)
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
 * Checks both legacy (P2PKH) and SegWit (P2WPKH) addresses
 */
export async function claimFromWIF(wif: string, checkBC2Balance: boolean = false): Promise<AirdropClaimResult> {
  try {
    const keyPair = ECPair.fromWIF(wif);
    const pubkeyHash = hash160(Buffer.from(keyPair.publicKey));

    // Get BC2 legacy address (for display)
    const bc2Address = getLegacyAddress(pubkeyHash);

    // Get BCH2 CashAddr
    const bch2Address = encodeCashAddr('bitcoincashii', 0, pubkeyHash);

    // Check BCH2 balance for legacy address
    const balance = await BCH2Electrum.getBalanceByAddress(bch2Address);
    let totalBalance = balance.confirmed + balance.unconfirmed;

    // Also check SegWit (bc1) address balance
    const bc1Address = encodeBech32('bc', 0, pubkeyHash);
    const segwitScripthash = getSegwitScripthash(pubkeyHash);
    let segwitBalance = 0;

    try {
      const segwitResult = await BCH2Electrum.getBalanceByScripthash(segwitScripthash);
      segwitBalance = segwitResult.confirmed + segwitResult.unconfirmed;
      totalBalance += segwitBalance;
    } catch (e) {
      // console.log('SegWit balance check failed:', e);
    }

    // Check BC2 balance for anti-gaming comparison
    let bc2TotalBalance = 0;
    try {
      const bc2BalanceResult = await BCH2Electrum.getBC2Balance(bc2Address);
      bc2TotalBalance = bc2BalanceResult.confirmed + bc2BalanceResult.unconfirmed;

      // Also check SegWit BC2 balance if applicable
      if (segwitBalance > 0) {
        try {
          const bc2SegwitBalance = await BCH2Electrum.getBC2BalanceByScripthash(segwitScripthash);
          bc2TotalBalance += bc2SegwitBalance.confirmed + bc2SegwitBalance.unconfirmed;
        } catch (e) {
          // BC2 SegWit balance check failed
        }
      }
    } catch (e) {
      // console.log('BC2 balance check failed:', e);
    }

    return {
      success: true,
      address: segwitBalance > 0 ? bc1Address : bc2Address,
      bch2Address: bch2Address,
      balance: totalBalance,
      bc2Balance: bc2TotalBalance,
    };
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
 * Derives addresses using:
 * - BIP44 path: m/44'/145'/0'/0/x (BCH) and m/44'/0'/0'/0/x (BTC legacy)
 * - BIP84 path: m/84'/0'/0'/0/x (Native SegWit bc1 addresses)
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

    // Check first 20 addresses on standard legacy derivation paths (BIP44)
    const legacyPaths = [
      "m/44'/145'/0'/0", // BCH standard
      "m/44'/0'/0'/0",   // BTC standard (some wallets use this)
      "m/44'/145'/0'/1", // BCH change addresses
      "m/44'/0'/0'/1",   // BTC change addresses
    ];

    for (const basePath of legacyPaths) {
      for (let i = 0; i < 20; i++) {
        const path = `${basePath}/${i}`;
        const child = root.derivePath(path);
        const pubkeyHash = hash160(Buffer.from(child.publicKey));

        const bc2Address = getLegacyAddress(pubkeyHash);
        const bch2Address = encodeCashAddr('bitcoincashii', 0, pubkeyHash);

        try {
          const balance = await BCH2Electrum.getBalanceByAddress(bch2Address);
          const total = balance.confirmed + balance.unconfirmed;

          if (total > 0) {
            let bc2Balance = 0;
            try {
              const bc2Result = await BCH2Electrum.getBC2Balance(bc2Address);
              bc2Balance = bc2Result.confirmed + bc2Result.unconfirmed;
            } catch (e) {
              // BC2 check failed
            }

            results.push({
              success: true,
              address: bc2Address,
              bch2Address: bch2Address,
              balance: total,
              bc2Balance,
            });
          }
        } catch (err) {
          // Skip failed address checks
          continue;
        }
      }
    }

    // Check BIP49 wrapped SegWit paths (3xxx P2SH-P2WPKH addresses)
    const wrappedSegwitPaths = [
      "m/49'/0'/0'/0",   // BIP49 P2SH-P2WPKH receive
      "m/49'/0'/0'/1",   // BIP49 P2SH-P2WPKH change
    ];

    for (const basePath of wrappedSegwitPaths) {
      for (let i = 0; i < 20; i++) {
        const path = `${basePath}/${i}`;
        const child = root.derivePath(path);
        const pubkeyHash = hash160(Buffer.from(child.publicKey));

        const p2shAddress = getP2SHP2WPKHAddress(pubkeyHash);
        const bch2Address = encodeCashAddr('bitcoincashii', 0, pubkeyHash);
        const scripthash = getP2SHP2WPKHScripthash(pubkeyHash);

        try {
          const balance = await BCH2Electrum.getBalanceByScripthash(scripthash);
          const total = balance.confirmed + balance.unconfirmed;

          if (total > 0) {
            let bc2Balance = 0;
            try {
              const bc2Result = await BCH2Electrum.getBC2BalanceByScripthash(scripthash);
              bc2Balance = bc2Result.confirmed + bc2Result.unconfirmed;
            } catch (e) {
              // BC2 check failed
            }

            results.push({
              success: true,
              address: p2shAddress,
              bch2Address: bch2Address,
              balance: total,
              bc2Balance,
            });
          }
        } catch (err) {
          continue;
        }
      }
    }

    // Check BIP84 SegWit paths (bc1 addresses)
    const segwitPaths = [
      "m/84'/0'/0'/0",   // BIP84 Native SegWit receive
      "m/84'/0'/0'/1",   // BIP84 Native SegWit change
    ];

    for (const basePath of segwitPaths) {
      for (let i = 0; i < 20; i++) {
        const path = `${basePath}/${i}`;
        const child = root.derivePath(path);
        const pubkeyHash = hash160(Buffer.from(child.publicKey));

        const bc1Address = encodeBech32('bc', 0, pubkeyHash);
        const bch2Address = encodeCashAddr('bitcoincashii', 0, pubkeyHash);
        const scripthash = getSegwitScripthash(pubkeyHash);

        try {
          const balance = await BCH2Electrum.getBalanceByScripthash(scripthash);
          const total = balance.confirmed + balance.unconfirmed;

          if (total > 0) {
            let bc2Balance = 0;
            try {
              const bc2Result = await BCH2Electrum.getBC2BalanceByScripthash(scripthash);
              bc2Balance = bc2Result.confirmed + bc2Result.unconfirmed;
            } catch (e) {
              // BC2 check failed
            }

            results.push({
              success: true,
              address: bc1Address,
              bch2Address: bch2Address,
              balance: total,
              bc2Balance,
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
  const pubkeyHash = hash160(Buffer.from(keyPair.publicKey));

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
  // Determine size code from hash length
  const sizeMap: Record<number, number> = { 20: 0, 24: 1, 28: 2, 32: 3, 40: 4, 48: 5, 56: 6, 64: 7 };
  const sizeCode = sizeMap[hash.length] ?? 0;

  // Pack version byte (type << 3 | size_code) with hash into 5-bit groups
  const versionByte = (type << 3) | sizeCode;
  const payload: number[] = [];
  let acc = versionByte;
  let bits = 8;

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

  // Count leading '1' characters (each represents a leading 0x00 byte)
  let leadingZeros = 0;
  for (const char of legacyAddress) {
    if (char === '1') leadingZeros++;
    else break;
  }

  let num = 0n;
  for (const char of legacyAddress) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid address character');
    num = num * 58n + BigInt(idx);
  }

  // Convert to bytes, restoring leading zero bytes
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const decoded = Buffer.from(hex, 'hex');
  const bytes = Buffer.concat([Buffer.alloc(leadingZeros), decoded]);

  // Extract pubkey hash (skip version byte, remove checksum)
  const pubkeyHash = bytes.slice(1, 21);

  return encodeCashAddr('bitcoincashii', 0, pubkeyHash);
}

// ============================================================================
// Bech32 (SegWit bc1) Support
// ============================================================================

/**
 * Encode a bech32 address (bc1...)
 */
function encodeBech32(hrp: string, version: number, data: Buffer): string {
  const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

  // Convert 8-bit data to 5-bit
  const converted: number[] = [version];
  let acc = 0;
  let bits = 0;

  for (const byte of data) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      converted.push((acc >> bits) & 0x1f);
    }
  }
  if (bits > 0) {
    converted.push((acc << (5 - bits)) & 0x1f);
  }

  // Calculate checksum
  const checksum = bech32Checksum(hrp, converted);

  // Encode
  let result = hrp + '1';
  for (const value of [...converted, ...checksum]) {
    result += BECH32_CHARSET[value];
  }

  return result;
}

/**
 * Decode a bech32 address to get the witness program
 */
function decodeBech32(address: string): { version: number; program: Buffer } | null {
  const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

  const lower = address.toLowerCase();
  const pos = lower.lastIndexOf('1');
  if (pos < 1 || pos + 7 > lower.length) return null;

  const hrp = lower.slice(0, pos);
  const dataStr = lower.slice(pos + 1);

  const data: number[] = [];
  for (const char of dataStr) {
    const idx = BECH32_CHARSET.indexOf(char);
    if (idx === -1) return null;
    data.push(idx);
  }

  // Verify checksum
  if (!verifyBech32Checksum(hrp, data)) return null;

  // Remove checksum (last 6 chars)
  const payload = data.slice(0, -6);
  if (payload.length < 1) return null;

  const version = payload[0];

  // Convert 5-bit to 8-bit
  const program: number[] = [];
  let acc = 0;
  let bits = 0;
  for (let i = 1; i < payload.length; i++) {
    acc = (acc << 5) | payload[i];
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      program.push((acc >> bits) & 0xff);
    }
  }

  return { version, program: Buffer.from(program) };
}

/**
 * Bech32 polymod for checksum calculation
 */
function bech32Polymod(values: number[]): number {
  const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;

  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) {
        chk ^= GENERATOR[i];
      }
    }
  }

  return chk;
}

/**
 * Expand HRP for checksum calculation
 */
function bech32HrpExpand(hrp: string): number[] {
  const result: number[] = [];
  for (const char of hrp) {
    result.push(char.charCodeAt(0) >> 5);
  }
  result.push(0);
  for (const char of hrp) {
    result.push(char.charCodeAt(0) & 31);
  }
  return result;
}

/**
 * Calculate bech32 checksum
 */
function bech32Checksum(hrp: string, data: number[]): number[] {
  const values = [...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const polymod = bech32Polymod(values) ^ 1;

  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) {
    checksum.push((polymod >> (5 * (5 - i))) & 31);
  }
  return checksum;
}

/**
 * Verify bech32 checksum
 */
function verifyBech32Checksum(hrp: string, data: number[]): boolean {
  return bech32Polymod([...bech32HrpExpand(hrp), ...data]) === 1;
}

/**
 * Calculate scripthash for a SegWit P2WPKH address
 * Used for Electrum queries
 */
function getSegwitScripthash(pubkeyHash: Buffer): string {
  // P2WPKH scriptPubKey: OP_0 PUSH_20 <20-byte-pubkeyhash>
  const scriptPubKey = Buffer.concat([
    Buffer.from([0x00, 0x14]),  // OP_0, PUSH_20
    pubkeyHash,
  ]);

  // SHA256 and reverse for Electrum
  const hash = crypto.createHash('sha256').update(scriptPubKey).digest();
  return Buffer.from(hash).reverse().toString('hex');
}

/**
 * Get P2SH-P2WPKH address (3xxx wrapped SegWit)
 * BIP49 format used by many wallets
 */
function getP2SHP2WPKHAddress(pubkeyHash: Buffer): string {
  // redeemScript = OP_0 PUSH_20 <pubkeyhash>
  const redeemScript = Buffer.concat([
    Buffer.from([0x00, 0x14]),
    pubkeyHash,
  ]);

  // P2SH address = Base58Check(0x05 || HASH160(redeemScript))
  const scriptHash = hash160(redeemScript);
  const versionedHash = Buffer.concat([Buffer.from([0x05]), scriptHash]);

  // Base58Check encode
  const checksum = doubleHash(versionedHash).slice(0, 4);
  const addressBytes = Buffer.concat([versionedHash, checksum]);
  return base58Encode(addressBytes);
}

/**
 * Calculate scripthash for P2SH-P2WPKH address
 */
function getP2SHP2WPKHScripthash(pubkeyHash: Buffer): string {
  // redeemScript = OP_0 PUSH_20 <pubkeyhash>
  const redeemScript = Buffer.concat([
    Buffer.from([0x00, 0x14]),
    pubkeyHash,
  ]);

  // P2SH scriptPubKey = OP_HASH160 PUSH_20 <HASH160(redeemScript)> OP_EQUAL
  const scriptHash = hash160(redeemScript);
  const scriptPubKey = Buffer.concat([
    Buffer.from([0xa9, 0x14]),  // OP_HASH160, PUSH_20
    scriptHash,
    Buffer.from([0x87]),  // OP_EQUAL
  ]);

  // SHA256 and reverse for Electrum
  const hash = crypto.createHash('sha256').update(scriptPubKey).digest();
  return Buffer.from(hash).reverse().toString('hex');
}

/**
 * Convert a bc1 address to scripthash for Electrum queries
 */
export function bc1AddressToScripthash(address: string): string | null {
  const decoded = decodeBech32(address);
  if (!decoded || decoded.version !== 0 || decoded.program.length !== 20) {
    return null;
  }
  return getSegwitScripthash(decoded.program);
}

export default {
  claimFromWIF,
  claimFromMnemonic,
  importBC2Wallet,
  getTotalClaimable,
  bc1AddressToScripthash,
};
