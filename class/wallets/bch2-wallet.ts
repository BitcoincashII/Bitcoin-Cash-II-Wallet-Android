/**
 * BCH2 Wallet (P2PKH Legacy)
 * Bitcoin Cash II wallet using CashAddr format
 */

import { ECPairAPI, ECPairFactory } from 'ecpair';
import ecc from '../../blue_modules/noble_ecc';
import * as BCH2Electrum from '../../blue_modules/BCH2Electrum';
import { AbstractWallet } from './abstract-wallet';
import { Transaction, Utxo } from './types';
import { randomBytes } from '../rng';

const ECPair: ECPairAPI = ECPairFactory(ecc);
const crypto = require('crypto');

// CashAddr character set
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/**
 * BCH2 Legacy Wallet (P2PKH with CashAddr)
 */
export class BCH2Wallet extends AbstractWallet {
  static readonly type = 'bch2Legacy';
  static readonly typeReadable = 'BCH2 (CashAddr)';
  // @ts-ignore: override
  public readonly type = BCH2Wallet.type;
  // @ts-ignore: override
  public readonly typeReadable = BCH2Wallet.typeReadable;

  _transactions: Transaction[] = [];

  async generate(): Promise<void> {
    const buf = await randomBytes(32);
    this.secret = ECPair.makeRandom({ rng: () => buf }).toWIF();
  }

  /**
   * Import from WIF private key
   */
  setSecret(newSecret: string): this {
    this.secret = newSecret.trim();
    return this;
  }

  /**
   * Get BCH2 CashAddr format address
   */
  getAddress(): string | false {
    if (this._address) return this._address;

    try {
      const keyPair = ECPair.fromWIF(this.secret);
      const pubkeyHash = hash160(Buffer.from(keyPair.publicKey));
      this._address = encodeCashAddr('bitcoincashii', 0, pubkeyHash);
      return this._address;
    } catch (err) {
      return false;
    }
  }

  /**
   * Get all addresses (single address wallet)
   */
  getAllExternalAddresses(): string[] {
    const address = this.getAddress();
    return address ? [address] : [];
  }

  /**
   * Fetch balance from BCH2 Electrum server
   */
  async fetchBalance(): Promise<void> {
    const address = this.getAddress();
    if (!address) return;

    try {
      const balance = await BCH2Electrum.getBalanceByAddress(address);
      this.balance = balance.confirmed;
      this.unconfirmed_balance = balance.unconfirmed;
      this._lastBalanceFetch = Date.now();
    } catch (err) {
      console.log('BCH2 fetchBalance error:', err);
    }
  }

  /**
   * Fetch transactions from BCH2 Electrum server
   */
  async fetchTransactions(): Promise<void> {
    const address = this.getAddress();
    if (!address) return;

    try {
      const history = await BCH2Electrum.getTransactionsByAddress(address);
      const transactions: Transaction[] = [];

      for (const tx of history) {
        const fullTx = await BCH2Electrum.getTransaction(tx.tx_hash);
        if (fullTx) {
          const blockHeight = BCH2Electrum.getLatestBlock().height || 0;
          transactions.push({
            txid: tx.tx_hash,
            hash: tx.tx_hash,
            version: fullTx.version || 1,
            size: fullTx.size || 0,
            vsize: fullTx.vsize || fullTx.size || 0,
            weight: fullTx.weight || 0,
            locktime: fullTx.locktime || 0,
            value: 0, // Will be calculated
            time: fullTx.blocktime || Math.floor(Date.now() / 1000),
            blocktime: fullTx.blocktime || Math.floor(Date.now() / 1000),
            timestamp: fullTx.blocktime || Math.floor(Date.now() / 1000),
            blockhash: fullTx.blockhash || '',
            confirmations: tx.height > 0 ? blockHeight - tx.height + 1 : 0,
            inputs: fullTx.vin || [],
            outputs: fullTx.vout || [],
          });
        }
      }

      this._transactions = transactions;
      this._lastTxFetch = Date.now();
    } catch (err) {
      console.log('BCH2 fetchTransactions error:', err);
    }
  }

  getTransactions(): Transaction[] {
    return this._transactions;
  }

  /**
   * Fetch UTXOs for transaction building
   */
  async fetchUtxos(): Promise<Utxo[]> {
    const address = this.getAddress();
    if (!address) return [];

    try {
      const utxos = await BCH2Electrum.getUtxosByAddress(address);
      this._utxo = utxos.map(u => ({
        ...u,
        address,
        wif: this.secret,
      }));
      return this._utxo;
    } catch (err) {
      console.log('BCH2 fetchUtxos error:', err);
      return [];
    }
  }

  getUtxos(): Utxo[] {
    return this._utxo;
  }

  /**
   * Check if address belongs to this wallet
   */
  weOwnAddress(address: string): boolean {
    const ourAddress = this.getAddress();
    if (!ourAddress) return false;

    // Normalize addresses for comparison
    const normalize = (addr: string) => {
      return addr.toLowerCase().replace('bitcoincashii:', '').replace('bitcoincash:', '');
    };

    return normalize(ourAddress) === normalize(address);
  }

  /**
   * Validate BCH2 address
   */
  static isValidAddress(address: string): boolean {
    try {
      let addr = address.toLowerCase();
      let prefix = 'bitcoincashii';
      const knownPrefixes = ['bitcoincashii:', 'bitcoincash:', 'bchtest:'];
      for (const p of knownPrefixes) {
        if (addr.startsWith(p)) {
          prefix = p.slice(0, -1); // Remove trailing ':'
          addr = addr.slice(p.length);
          break;
        }
      }

      // Decode payload
      const data: number[] = [];
      for (const char of addr) {
        const idx = CHARSET.indexOf(char);
        if (idx === -1) return false;
        data.push(idx);
      }

      if (data.length < 34 || data.length > 42) return false;

      // Verify polymod checksum
      const prefixData: number[] = [];
      for (const char of prefix) {
        prefixData.push(char.charCodeAt(0) & 0x1f);
      }
      prefixData.push(0);

      return cashAddrPolymod([...prefixData, ...data]) === 1;
    } catch {
      return false;
    }
  }

  isSegwit(): boolean {
    return false; // BCH2 doesn't support SegWit
  }

  allowRBF(): boolean {
    return false; // BCH2 doesn't support RBF
  }
}

/**
 * Hash160 (RIPEMD160(SHA256(data)))
 */
function hash160(data: Buffer): Buffer {
  const sha256Hash = crypto.createHash('sha256').update(data).digest();
  const ripemd160Hash = crypto.createHash('ripemd160').update(sha256Hash).digest();
  return ripemd160Hash;
}

/**
 * Encode pubkey hash to CashAddr format
 */
function encodeCashAddr(prefix: string, type: number, hash: Buffer): string {
  // Determine size code from hash length
  const sizeMap: Record<number, number> = { 20: 0, 24: 1, 28: 2, 32: 3, 40: 4, 48: 5, 56: 6, 64: 7 };
  const sizeCode = sizeMap[hash.length] ?? 0;

  // Pack version byte (type << 3 | sizeCode) as 8 bits with hash into 5-bit groups
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

  // Add checksum
  const checksum = calculateCashAddrChecksum(prefix, payload);
  const fullPayload = [...payload, ...checksum];

  // Encode to string
  let result = prefix + ':';
  for (const value of fullPayload) {
    result += CHARSET[value];
  }

  return result;
}

/**
 * Calculate CashAddr checksum
 */
function calculateCashAddrChecksum(prefix: string, payload: number[]): number[] {
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

/**
 * CashAddr polymod function
 */
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

export default BCH2Wallet;
