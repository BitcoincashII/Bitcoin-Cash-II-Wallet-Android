/**
 * BCH2/BC2 Transaction Builder
 * Builds and signs transactions for BCH2 and BC2
 *
 * Supported input types:
 * - P2PKH (legacy 1xxx addresses)
 * - CashAddr (bitcoincashii: format)
 * - P2WPKH (bc1 SegWit addresses via BCH2's SegWit recovery)
 *
 * BCH2 SegWit Recovery:
 * After fork height, BCH2 nodes accept spending of P2WPKH outputs using
 * scriptSig instead of witness data. This enables claiming coins from
 * bc1 addresses using BIP84 derivation paths.
 */

import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';
import ecc from '../blue_modules/noble_ecc';
import {
  getUtxosByAddress,
  getBC2Utxos,
  getUtxosByScripthash,
  broadcastTransaction,
  broadcastBC2Transaction,
} from '../blue_modules/BCH2Electrum';

const bip32 = BIP32Factory(ecc);
const crypto = require('crypto');
const bs58check = require('bs58check');

// Bech32 constants
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

interface UTXO {
  txid: string;
  vout: number;
  value: number;
  height?: number;
}

interface TransactionResult {
  txid: string;
  hex: string;
}

/**
 * Build and broadcast a BCH2 or BC2 transaction
 */
export async function sendTransaction(
  mnemonic: string,
  toAddress: string,
  amountSats: number,
  feePerByte: number,
  isBC2: boolean,
  expectedAddress?: string // Optional: pass stored address to verify derivation
): Promise<TransactionResult> {
  // Derive private key from mnemonic
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const root = bip32.fromSeed(seed);

  // Different derivation paths for BCH2 vs BC2
  const derivationPath = isBC2 ? "m/44'/0'/0'/0/0" : "m/44'/145'/0'/0/0";
  const child = root.derivePath(derivationPath);

  if (!child.privateKey) {
    throw new Error('Failed to derive private key');
  }

  // Get from address
  const fromAddress = isBC2
    ? getLegacyAddress(hash160(Buffer.from(child.publicKey)))
    : getCashAddr(hash160(Buffer.from(child.publicKey)));

  console.log(`[TX] Derived ${isBC2 ? 'BC2' : 'BCH2'} address: ${fromAddress}`);
  console.log(`[TX] Using derivation path: ${derivationPath}`);

  // Verify address matches if provided
  if (expectedAddress) {
    const normalizedExpected = expectedAddress.toLowerCase().replace(/^bitcoincash(ii)?:/, '');
    const normalizedDerived = fromAddress.toLowerCase().replace(/^bitcoincash(ii)?:/, '');
    if (normalizedExpected !== normalizedDerived) {
      console.log(`[TX] WARNING: Address mismatch! Expected: ${expectedAddress}, Derived: ${fromAddress}`);
      // Try alternate derivation paths for BC2
      if (isBC2) {
        console.log('[TX] Trying alternate BC2 derivation paths...');
        const altPaths = [
          "m/44'/145'/0'/0/0",  // BCH path (some wallets use this)
          "m/44'/0'/0'/0/1",    // Second address
          "m/44'/0'/0'/1/0",    // Change address
        ];
        for (const altPath of altPaths) {
          const altChild = root.derivePath(altPath);
          const altAddress = getLegacyAddress(hash160(Buffer.from(altChild.publicKey)));
          if (altAddress === expectedAddress) {
            console.log(`[TX] Found matching address at path: ${altPath}`);
            // Use this key instead
            return sendTransactionWithKey(
              Buffer.from(altChild.privateKey!),
              Buffer.from(altChild.publicKey),
              altAddress,
              toAddress,
              amountSats,
              feePerByte,
              isBC2
            );
          }
        }
      }
    }
  }

  // Fetch UTXOs
  console.log(`[TX] Fetching UTXOs for address: ${fromAddress}`);
  const utxos: UTXO[] = isBC2
    ? await getBC2Utxos(fromAddress)
    : await getUtxosByAddress(fromAddress);

  console.log(`[TX] Found ${utxos.length} UTXOs`);
  if (utxos.length > 0) {
    console.log(`[TX] UTXOs:`, JSON.stringify(utxos.slice(0, 5))); // Log first 5
  }

  if (utxos.length === 0) {
    const coinType = isBC2 ? 'BC2' : 'BCH2';
    throw new Error(`No UTXOs available for ${coinType} address ${fromAddress}. The address may have no confirmed balance, or the coins may have already been spent.`);
  }

  // Sort UTXOs by value (largest first for efficiency)
  utxos.sort((a, b) => b.value - a.value);

  // Estimate transaction size: ~10 (overhead) + 148 (per input) + 34 (per output)
  // We'll use 1 input initially and add more if needed
  const estimateTxSize = (inputCount: number, outputCount: number): number => {
    return 10 + (148 * inputCount) + (34 * outputCount);
  };

  // Coin selection - simple approach: add UTXOs until we have enough
  let selectedUtxos: UTXO[] = [];
  let totalInput = 0;
  const outputCount = 2; // recipient + change (or 1 if no change needed)

  for (const utxo of utxos) {
    selectedUtxos.push(utxo);
    totalInput += utxo.value;

    const estimatedSize = estimateTxSize(selectedUtxos.length, outputCount);
    const estimatedFee = estimatedSize * feePerByte;

    if (totalInput >= amountSats + estimatedFee) {
      break;
    }
  }

  const txSize = estimateTxSize(selectedUtxos.length, outputCount);
  const fee = txSize * feePerByte;
  const changeAmount = totalInput - amountSats - fee;

  if (changeAmount < 0) {
    throw new Error(`Insufficient funds. Need ${amountSats + fee} sats, have ${totalInput} sats`);
  }

  // Build raw transaction
  console.log(`[TX] Building transaction:`);
  console.log(`[TX]   To: ${toAddress}`);
  console.log(`[TX]   Amount: ${amountSats} sats`);
  console.log(`[TX]   Fee: ${fee} sats (${feePerByte} sat/byte)`);
  console.log(`[TX]   Change: ${changeAmount > 546 ? changeAmount : 0} sats`);
  console.log(`[TX]   Inputs: ${selectedUtxos.length}`);

  const txHex = buildTransaction(
    selectedUtxos,
    toAddress,
    amountSats,
    changeAmount > 546 ? fromAddress : null, // Only include change if > dust
    changeAmount > 546 ? changeAmount : 0,
    Buffer.from(child.privateKey),
    Buffer.from(child.publicKey),
    isBC2
  );

  console.log(`[TX] Transaction hex (${txHex.length} chars): ${txHex}`);

  // Broadcast
  console.log(`[TX] Broadcasting to ${isBC2 ? 'BC2' : 'BCH2'} network...`);
  const txid = isBC2
    ? await broadcastBC2Transaction(txHex)
    : await broadcastTransaction(txHex);

  console.log(`[TX] Broadcast successful, txid: ${txid}`);
  return { txid, hex: txHex };
}

/**
 * Build a raw P2PKH transaction
 */
function buildTransaction(
  utxos: UTXO[],
  toAddress: string,
  amount: number,
  changeAddress: string | null,
  changeAmount: number,
  privateKey: Buffer,
  publicKey: Buffer,
  isBC2: boolean
): string {
  // Transaction components
  let tx = Buffer.alloc(0);

  // Version (4 bytes, little-endian)
  const version = Buffer.alloc(4);
  version.writeUInt32LE(1, 0);
  tx = Buffer.concat([tx, version]);

  // Input count (varint)
  tx = Buffer.concat([tx, encodeVarInt(utxos.length)]);

  // We need to sign each input, so we'll build the transaction in stages
  // First, collect all the unsigned input data
  const inputs: Buffer[] = [];
  for (const utxo of utxos) {
    const input = Buffer.alloc(0);
    // Previous txid (32 bytes, reversed)
    const txidBytes = Buffer.from(utxo.txid, 'hex').reverse();
    // Previous vout (4 bytes)
    const voutBytes = Buffer.alloc(4);
    voutBytes.writeUInt32LE(utxo.vout, 0);
    // Sequence (4 bytes)
    const sequence = Buffer.from('ffffffff', 'hex');

    inputs.push(Buffer.concat([txidBytes, voutBytes, sequence]));
  }

  // Build outputs
  let outputs = Buffer.alloc(0);
  let outputCount = 1;

  // Output 1: recipient
  const recipientScript = addressToScript(toAddress, isBC2);
  const amountBytes = Buffer.alloc(8);
  amountBytes.writeBigUInt64LE(BigInt(amount), 0);
  outputs = Buffer.concat([outputs, amountBytes, encodeVarInt(recipientScript.length), recipientScript]);

  // Output 2: change (if any)
  if (changeAddress && changeAmount > 0) {
    outputCount++;
    const changeScript = addressToScript(changeAddress, isBC2);
    const changeBytes = Buffer.alloc(8);
    changeBytes.writeBigUInt64LE(BigInt(changeAmount), 0);
    outputs = Buffer.concat([outputs, changeBytes, encodeVarInt(changeScript.length), changeScript]);
  }

  // Now sign each input
  const signedInputs: Buffer[] = [];
  for (let i = 0; i < utxos.length; i++) {
    const utxo = utxos[i];

    // Create the signing preimage
    // For BCH2, we use BIP143 (segwit-style) sighash for replay protection
    // For BC2, we use legacy sighash
    const sighash = isBC2
      ? createLegacySighash(utxos, i, publicKey, outputCount, outputs, utxo.value)
      : createBIP143Sighash(utxos, i, publicKey, outputCount, outputs, utxo.value);

    // Sign
    const signature = signWithPrivateKey(sighash, privateKey);

    // Build scriptSig: <sig> <pubkey>
    const sigWithHashType = Buffer.concat([signature, Buffer.from([isBC2 ? 0x01 : 0x41])]); // SIGHASH_ALL (0x41 for BCH with FORKID)
    const scriptSig = Buffer.concat([
      encodeVarInt(sigWithHashType.length),
      sigWithHashType,
      encodeVarInt(publicKey.length),
      publicKey
    ]);

    // Build signed input
    const txidBytes = Buffer.from(utxo.txid, 'hex').reverse();
    const voutBytes = Buffer.alloc(4);
    voutBytes.writeUInt32LE(utxo.vout, 0);
    const sequence = Buffer.from('ffffffff', 'hex');

    signedInputs.push(Buffer.concat([
      txidBytes,
      voutBytes,
      encodeVarInt(scriptSig.length),
      scriptSig,
      sequence
    ]));
  }

  // Rebuild transaction with signed inputs
  tx = Buffer.concat([version, encodeVarInt(utxos.length)]);
  for (const input of signedInputs) {
    tx = Buffer.concat([tx, input]);
  }

  // Output count and outputs
  tx = Buffer.concat([tx, encodeVarInt(outputCount), outputs]);

  // Locktime (4 bytes)
  const locktime = Buffer.alloc(4);
  locktime.writeUInt32LE(0, 0);
  tx = Buffer.concat([tx, locktime]);

  return tx.toString('hex');
}

/**
 * Create BIP143 sighash for BCH2 (with FORKID)
 */
function createBIP143Sighash(
  utxos: UTXO[],
  inputIndex: number,
  publicKey: Buffer,
  outputCount: number,
  serializedOutputs: Buffer,
  inputValue: number
): Buffer {
  const utxo = utxos[inputIndex];

  // 1. nVersion
  const version = Buffer.alloc(4);
  version.writeUInt32LE(1, 0);

  // 2. hashPrevouts (double SHA256 of all input outpoints)
  let prevouts = Buffer.alloc(0);
  for (const u of utxos) {
    const txid = Buffer.from(u.txid, 'hex').reverse();
    const vout = Buffer.alloc(4);
    vout.writeUInt32LE(u.vout, 0);
    prevouts = Buffer.concat([prevouts, txid, vout]);
  }
  const hashPrevouts = doubleSha256(prevouts);

  // 3. hashSequence (double SHA256 of all input sequences)
  let sequences = Buffer.alloc(0);
  for (const _ of utxos) {
    sequences = Buffer.concat([sequences, Buffer.from('ffffffff', 'hex')]);
  }
  const hashSequence = doubleSha256(sequences);

  // 4. outpoint (txid + vout of this input)
  const outpoint = Buffer.concat([
    Buffer.from(utxo.txid, 'hex').reverse(),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(utxo.vout, 0); return b; })()
  ]);

  // 5. scriptCode (P2PKH script for this input)
  // For BCH/BCH2, scriptCode is the script itself with a varint length prefix
  const pubkeyHash = hash160(publicKey);
  const script = Buffer.concat([
    Buffer.from([0x76, 0xa9, 0x14]), // OP_DUP OP_HASH160 PUSH20
    pubkeyHash,
    Buffer.from([0x88, 0xac]) // OP_EQUALVERIFY OP_CHECKSIG
  ]);
  // Prefix with length (25 bytes = 0x19)
  const scriptCode = Buffer.concat([encodeVarInt(script.length), script]);

  // 6. value (8 bytes)
  const value = Buffer.alloc(8);
  value.writeBigUInt64LE(BigInt(inputValue), 0);

  // 7. nSequence
  const nSequence = Buffer.from('ffffffff', 'hex');

  // 8. hashOutputs
  const hashOutputs = doubleSha256(serializedOutputs);

  // 9. nLocktime
  const locktime = Buffer.alloc(4);
  locktime.writeUInt32LE(0, 0);

  // 10. sighash type (SIGHASH_ALL | FORKID = 0x41)
  const hashType = Buffer.alloc(4);
  hashType.writeUInt32LE(0x41, 0);

  // Combine all parts
  const preimage = Buffer.concat([
    version,
    hashPrevouts,
    hashSequence,
    outpoint,
    scriptCode,
    value,
    nSequence,
    hashOutputs,
    locktime,
    hashType
  ]);

  return doubleSha256(preimage);
}

/**
 * Create legacy sighash for BC2
 */
function createLegacySighash(
  utxos: UTXO[],
  inputIndex: number,
  publicKey: Buffer,
  outputCount: number,
  serializedOutputs: Buffer,
  inputValue: number
): Buffer {
  // Build transaction copy for signing
  const version = Buffer.alloc(4);
  version.writeUInt32LE(1, 0);

  let inputs = Buffer.alloc(0);
  for (let i = 0; i < utxos.length; i++) {
    const utxo = utxos[i];
    const txid = Buffer.from(utxo.txid, 'hex').reverse();
    const vout = Buffer.alloc(4);
    vout.writeUInt32LE(utxo.vout, 0);

    let scriptSig: Buffer;
    if (i === inputIndex) {
      // For the input being signed, use the scriptPubKey
      const pubkeyHash = hash160(publicKey);
      scriptSig = Buffer.concat([
        Buffer.from([0x76, 0xa9, 0x14]), // OP_DUP OP_HASH160 PUSH20
        pubkeyHash,
        Buffer.from([0x88, 0xac]) // OP_EQUALVERIFY OP_CHECKSIG
      ]);
    } else {
      // For other inputs, empty script
      scriptSig = Buffer.alloc(0);
    }

    const sequence = Buffer.from('ffffffff', 'hex');
    inputs = Buffer.concat([
      inputs,
      txid,
      vout,
      encodeVarInt(scriptSig.length),
      scriptSig,
      sequence
    ]);
  }

  const locktime = Buffer.alloc(4);
  locktime.writeUInt32LE(0, 0);

  // SIGHASH_ALL
  const hashType = Buffer.alloc(4);
  hashType.writeUInt32LE(0x01, 0);

  const preimage = Buffer.concat([
    version,
    encodeVarInt(utxos.length),
    inputs,
    encodeVarInt(outputCount),
    serializedOutputs,
    locktime,
    hashType
  ]);

  return doubleSha256(preimage);
}

/**
 * Sign a hash with a private key using secp256k1
 * Returns DER-encoded signature as required by Bitcoin
 */
function signWithPrivateKey(hash: Buffer, privateKey: Buffer): Buffer {
  // Use signDER to get DER-encoded signature (required for Bitcoin transactions)
  const signature = ecc.signDER(hash, privateKey);
  return Buffer.from(signature);
}

/**
 * Convert address to scriptPubKey
 */
function addressToScript(address: string, isBC2: boolean): Buffer {
  // Check for bech32 address (bc1)
  if (isBech32Address(address)) {
    const decoded = decodeBech32(address);
    if (!decoded) {
      throw new Error('Invalid bech32 address');
    }
    if (decoded.version === 0 && decoded.program.length === 20) {
      // P2WPKH: OP_0 PUSH_20 <pubkeyhash>
      return Buffer.concat([
        Buffer.from([0x00, 0x14]),
        decoded.program
      ]);
    } else if (decoded.version === 0 && decoded.program.length === 32) {
      // P2WSH: OP_0 PUSH_32 <scripthash>
      return Buffer.concat([
        Buffer.from([0x00, 0x20]),
        decoded.program
      ]);
    } else {
      throw new Error('Unsupported bech32 witness version or program length');
    }
  }

  let pubkeyHash: Buffer;

  if (isBC2) {
    // BC2 uses legacy P2PKH addresses (starts with 1)
    if (!address.startsWith('1')) {
      throw new Error('BC2 addresses must be legacy format (starting with 1)');
    }
    pubkeyHash = decodeLegacyAddress(address);
  } else {
    // BCH2 uses CashAddr format
    pubkeyHash = decodeCashAddr(address);
  }

  // P2PKH script: OP_DUP OP_HASH160 <pubkeyhash> OP_EQUALVERIFY OP_CHECKSIG
  return Buffer.concat([
    Buffer.from([0x76, 0xa9, 0x14]), // OP_DUP OP_HASH160 PUSH20
    pubkeyHash,
    Buffer.from([0x88, 0xac]) // OP_EQUALVERIFY OP_CHECKSIG
  ]);
}

/**
 * Decode legacy base58check address to pubkey hash
 */
function decodeLegacyAddress(address: string): Buffer {
  // Trim any whitespace
  address = address.trim();
  console.log(`[TX] Decoding legacy address: ${address}`);

  try {
    // Use bs58check for reliable decoding
    const decoded = bs58check.decode(address);
    console.log(`[TX] Decoded ${decoded.length} bytes: ${decoded.toString('hex')}`);

    // First byte is version, rest is pubkey hash
    if (decoded.length !== 21) {
      throw new Error(`Invalid address length: expected 21 bytes, got ${decoded.length}`);
    }

    // Return pubkey hash (skip version byte)
    return decoded.slice(1);
  } catch (err: any) {
    console.log(`[TX] bs58check decode failed: ${err.message}`);
    throw new Error(`Invalid legacy address: ${err.message}`);
  }
}

/**
 * Decode CashAddr to pubkey hash
 */
function decodeCashAddr(address: string): Buffer {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

  // Determine prefix
  let addr = address.toLowerCase();
  let prefix: string;
  if (addr.startsWith('bitcoincashii:')) {
    prefix = 'bitcoincashii';
    addr = addr.slice(14);
  } else if (addr.startsWith('bitcoincash:')) {
    prefix = 'bitcoincash';
    addr = addr.slice(12);
  } else {
    // No prefix — assume bitcoincashii
    prefix = 'bitcoincashii';
  }

  // Decode base32
  const values: number[] = [];
  for (const char of addr) {
    const idx = CHARSET.indexOf(char);
    if (idx === -1) throw new Error('Invalid character in address');
    values.push(idx);
  }

  if (values.length < 8) throw new Error('Address too short');

  // Validate checksum: polymod must equal 1 (encode XORs with 1)
  const prefixData: number[] = [];
  for (const char of prefix) {
    prefixData.push(char.charCodeAt(0) & 0x1f);
  }
  prefixData.push(0);
  if (cashAddrPolymod([...prefixData, ...values]) !== 1) {
    throw new Error('Invalid CashAddr checksum');
  }

  // Remove checksum (last 8 values)
  const data = values.slice(0, -8);

  // Unpack: convert 5-bit groups back to 8-bit version byte + hash
  let acc = 0;
  let bits = 0;
  let versionByte = 0;
  let versionExtracted = false;
  const hashBytes: number[] = [];

  for (let i = 0; i < data.length; i++) {
    acc = (acc << 5) | data[i];
    bits += 5;

    if (!versionExtracted && bits >= 8) {
      bits -= 8;
      versionByte = (acc >> bits) & 0xff;
      versionExtracted = true;
    }

    while (versionExtracted && bits >= 8) {
      bits -= 8;
      hashBytes.push((acc >> bits) & 0xff);
    }
  }

  const encodedSize = versionByte & 0x07;
  const expectedSizes = [20, 24, 28, 32, 40, 48, 56, 64];
  const expectedSize = expectedSizes[encodedSize] || 20;

  return Buffer.from(hashBytes.slice(0, expectedSize));
}

/**
 * Get legacy P2PKH address from pubkey hash
 */
function getLegacyAddress(pubkeyHash: Buffer): string {
  // Version byte 0x00 for mainnet P2PKH
  const versionedHash = Buffer.concat([Buffer.from([0x00]), pubkeyHash]);
  return bs58check.encode(versionedHash);
}

/**
 * Get BCH2 CashAddr from pubkey hash
 */
function getCashAddr(pubkeyHash: Buffer): string {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const prefix = 'bitcoincashii';

  // Pack version byte (type << 3 | size_code) with hash into 5-bit groups
  // Type 0 = P2PKH, size_code 0 = 20-byte hash
  const versionByte = (0 << 3) | 0; // type=0, size=0
  const payload: number[] = [];
  let acc = versionByte;
  let bits = 8;

  for (const byte of pubkeyHash) {
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

  // Calculate checksum
  const checksum = cashAddrChecksum(prefix, payload);
  const fullPayload = [...payload, ...checksum];

  // Encode
  let result = prefix + ':';
  for (const value of fullPayload) {
    result += CHARSET[value];
  }

  return result;
}

function cashAddrChecksum(prefix: string, payload: number[]): number[] {
  const prefixData: number[] = [];
  for (const char of prefix) {
    prefixData.push(char.charCodeAt(0) & 0x1f);
  }
  prefixData.push(0);

  const values = [...prefixData, ...payload, 0, 0, 0, 0, 0, 0, 0, 0];
  const polymod = cashAddrPolymod(values) ^ 1;

  const checksum: number[] = [];
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

// Helper functions
function hash160(data: Buffer): Buffer {
  const sha256Hash = crypto.createHash('sha256').update(data).digest();
  const ripemd160Hash = crypto.createHash('ripemd160').update(sha256Hash).digest();
  return ripemd160Hash;
}

function doubleSha256(data: Buffer): Buffer {
  const hash1 = crypto.createHash('sha256').update(data).digest();
  const hash2 = crypto.createHash('sha256').update(hash1).digest();
  return hash2;
}

function encodeVarInt(n: number): Buffer {
  if (n < 0xfd) {
    return Buffer.from([n]);
  } else if (n <= 0xffff) {
    const buf = Buffer.alloc(3);
    buf[0] = 0xfd;
    buf.writeUInt16LE(n, 1);
    return buf;
  } else if (n <= 0xffffffff) {
    const buf = Buffer.alloc(5);
    buf[0] = 0xfe;
    buf.writeUInt32LE(n, 1);
    return buf;
  } else {
    const buf = Buffer.alloc(9);
    buf[0] = 0xff;
    buf.writeBigUInt64LE(BigInt(n), 1);
    return buf;
  }
}

/**
 * Check if address is a bech32 (bc1) address
 */
function isBech32Address(address: string): boolean {
  return address.toLowerCase().startsWith('bc1');
}

/**
 * Bech32 polymod for checksum calculation
 */
function bech32Polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) {
        chk ^= BECH32_GENERATOR[i];
      }
    }
  }
  return chk;
}

/**
 * Expand HRP for bech32 checksum
 */
function bech32HrpExpand(hrp: string): number[] {
  const result: number[] = [];
  for (const c of hrp) {
    result.push(c.charCodeAt(0) >> 5);
  }
  result.push(0);
  for (const c of hrp) {
    result.push(c.charCodeAt(0) & 31);
  }
  return result;
}

/**
 * Decode bech32 address to witness version and program
 * Returns null if invalid
 */
function decodeBech32(address: string): { version: number; program: Buffer } | null {
  const addr = address.toLowerCase();

  // Find separator
  const sepPos = addr.lastIndexOf('1');
  if (sepPos < 1 || sepPos + 7 > addr.length) {
    return null;
  }

  const hrp = addr.slice(0, sepPos);
  const dataStr = addr.slice(sepPos + 1);

  // Decode data part
  const data: number[] = [];
  for (const c of dataStr) {
    const idx = BECH32_CHARSET.indexOf(c);
    if (idx === -1) return null;
    data.push(idx);
  }

  // Verify checksum
  const hrpExpanded = bech32HrpExpand(hrp);
  if (bech32Polymod([...hrpExpanded, ...data]) !== 1) {
    return null;
  }

  // Remove checksum (last 6 values)
  const payload = data.slice(0, -6);
  if (payload.length < 1) return null;

  // First value is witness version
  const version = payload[0];
  if (version > 16) return null;

  // Convert remaining 5-bit values to 8-bit
  const programData = payload.slice(1);
  let acc = 0;
  let bits = 0;
  const program: number[] = [];

  for (const value of programData) {
    acc = (acc << 5) | value;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      program.push((acc >> bits) & 0xff);
    }
  }

  // Validate program length for version 0
  if (version === 0 && program.length !== 20 && program.length !== 32) {
    return null;
  }

  return {
    version,
    program: Buffer.from(program)
  };
}

/**
 * Get scripthash for a P2WPKH address (for Electrum queries)
 * scriptPubKey for P2WPKH: OP_0 PUSH_20 <pubkeyhash>
 */
function getSegwitScripthash(pubkeyHash: Buffer): string {
  // P2WPKH scriptPubKey: 0x00 0x14 <20-byte-hash>
  const scriptPubKey = Buffer.concat([
    Buffer.from([0x00, 0x14]),
    pubkeyHash
  ]);
  const hash = crypto.createHash('sha256').update(scriptPubKey).digest();
  return Buffer.from(hash).reverse().toString('hex');
}

/**
 * Encode bech32 address from witness program
 */
function encodeBech32(hrp: string, version: number, program: Buffer): string {
  // Convert 8-bit to 5-bit
  const data: number[] = [version];
  let acc = 0;
  let bits = 0;

  for (const byte of program) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      data.push((acc >> bits) & 0x1f);
    }
  }
  if (bits > 0) {
    data.push((acc << (5 - bits)) & 0x1f);
  }

  // Calculate checksum
  const hrpExpanded = bech32HrpExpand(hrp);
  const polymod = bech32Polymod([...hrpExpanded, ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) {
    checksum.push((polymod >> (5 * (5 - i))) & 0x1f);
  }

  // Encode
  let result = hrp + '1';
  for (const v of [...data, ...checksum]) {
    result += BECH32_CHARSET[v];
  }
  return result;
}

/**
 * Send transaction with a specific private key (used for alternate derivation paths)
 */
async function sendTransactionWithKey(
  privateKey: Buffer,
  publicKey: Buffer,
  fromAddress: string,
  toAddress: string,
  amountSats: number,
  feePerByte: number,
  isBC2: boolean
): Promise<TransactionResult> {
  // Fetch UTXOs
  console.log(`[TX] Fetching UTXOs for address: ${fromAddress}`);
  const utxos: UTXO[] = isBC2
    ? await getBC2Utxos(fromAddress)
    : await getUtxosByAddress(fromAddress);

  console.log(`[TX] Found ${utxos.length} UTXOs`);

  if (utxos.length === 0) {
    const coinType = isBC2 ? 'BC2' : 'BCH2';
    throw new Error(`No UTXOs available for ${coinType} address ${fromAddress}`);
  }

  // Sort UTXOs by value (largest first for efficiency)
  utxos.sort((a, b) => b.value - a.value);

  // Estimate transaction size
  const estimateTxSize = (inputCount: number, outputCount: number): number => {
    return 10 + (148 * inputCount) + (34 * outputCount);
  };

  // Coin selection
  let selectedUtxos: UTXO[] = [];
  let totalInput = 0;
  const outputCount = 2;

  for (const utxo of utxos) {
    selectedUtxos.push(utxo);
    totalInput += utxo.value;

    const estimatedSize = estimateTxSize(selectedUtxos.length, outputCount);
    const estimatedFee = estimatedSize * feePerByte;

    if (totalInput >= amountSats + estimatedFee) {
      break;
    }
  }

  const txSize = estimateTxSize(selectedUtxos.length, outputCount);
  const fee = txSize * feePerByte;
  const changeAmount = totalInput - amountSats - fee;

  if (changeAmount < 0) {
    throw new Error(`Insufficient funds. Need ${amountSats + fee} sats, have ${totalInput} sats`);
  }

  // Build raw transaction
  const txHex = buildTransaction(
    selectedUtxos,
    toAddress,
    amountSats,
    changeAmount > 546 ? fromAddress : null,
    changeAmount > 546 ? changeAmount : 0,
    privateKey,
    publicKey,
    isBC2
  );

  // Broadcast
  const txid = isBC2
    ? await broadcastBC2Transaction(txHex)
    : await broadcastTransaction(txHex);

  return { txid, hex: txHex };
}

/**
 * Send transaction from a bc1 (P2WPKH/SegWit) address
 * BCH2 supports SegWit recovery - spending P2WPKH outputs via scriptSig
 */
export async function sendFromBech32(
  mnemonic: string,
  expectedAddress: string,
  toAddress: string,
  amountSats: number,
  feePerByte: number
): Promise<TransactionResult> {
  console.log(`[TX] Sending from bech32 address: ${expectedAddress}`);

  // Decode the bc1 address to get the pubkey hash
  const decoded = decodeBech32(expectedAddress);
  if (!decoded || decoded.version !== 0 || decoded.program.length !== 20) {
    throw new Error('Invalid bc1 P2WPKH address');
  }
  const targetPubkeyHash = decoded.program;

  // Derive from mnemonic and search BIP84 paths
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const root = bip32.fromSeed(seed);

  // BIP84 paths: m/84'/0'/0'/0/x (receive) and m/84'/0'/0'/1/x (change)
  const basePaths = ["m/84'/0'/0'/0", "m/84'/0'/0'/1"];
  let matchedChild: ReturnType<typeof root.derivePath> | null = null;
  let matchedPath: string | null = null;

  for (const basePath of basePaths) {
    for (let i = 0; i < 20; i++) {
      const path = `${basePath}/${i}`;
      const child = root.derivePath(path);
      const pubkeyHash = hash160(Buffer.from(child.publicKey));

      if (pubkeyHash.equals(targetPubkeyHash)) {
        matchedChild = child;
        matchedPath = path;
        console.log(`[TX] Found matching key at path: ${path}`);
        break;
      }
    }
    if (matchedChild) break;
  }

  if (!matchedChild || !matchedChild.privateKey) {
    throw new Error('Could not find private key for bc1 address in wallet');
  }

  console.log(`[TX] Using derivation path: ${matchedPath}`);

  // Get scripthash for UTXO lookup
  const scripthash = getSegwitScripthash(targetPubkeyHash);
  console.log(`[TX] Scripthash: ${scripthash}`);

  // Fetch UTXOs using scripthash
  const utxos: UTXO[] = await getUtxosByScripthash(scripthash);
  console.log(`[TX] Found ${utxos.length} UTXOs`);

  if (utxos.length === 0) {
    throw new Error(`No UTXOs available for bc1 address ${expectedAddress}`);
  }

  // Sort UTXOs by value (largest first)
  utxos.sort((a, b) => b.value - a.value);

  // Estimate transaction size
  const estimateTxSize = (inputCount: number, outputCount: number): number => {
    return 10 + (148 * inputCount) + (34 * outputCount);
  };

  // Coin selection
  let selectedUtxos: UTXO[] = [];
  let totalInput = 0;
  const outputCount = 2;

  for (const utxo of utxos) {
    selectedUtxos.push(utxo);
    totalInput += utxo.value;

    const estimatedSize = estimateTxSize(selectedUtxos.length, outputCount);
    const estimatedFee = estimatedSize * feePerByte;

    if (totalInput >= amountSats + estimatedFee) {
      break;
    }
  }

  const txSize = estimateTxSize(selectedUtxos.length, outputCount);
  const fee = txSize * feePerByte;
  const changeAmount = totalInput - amountSats - fee;

  if (changeAmount < 0) {
    throw new Error(`Insufficient funds. Need ${amountSats + fee} sats, have ${totalInput} sats`);
  }

  // Build transaction
  console.log(`[TX] Building SegWit recovery transaction:`);
  console.log(`[TX]   To: ${toAddress}`);
  console.log(`[TX]   Amount: ${amountSats} sats`);
  console.log(`[TX]   Fee: ${fee} sats (${feePerByte} sat/byte)`);
  console.log(`[TX]   Change: ${changeAmount > 546 ? changeAmount : 0} sats`);
  console.log(`[TX]   Inputs: ${selectedUtxos.length}`);

  // For BCH2 SegWit recovery, we use the same BIP143 sighash and scriptSig format
  // as P2PKH. The node's SegWit recovery code detects the P2WPKH scriptPubKey
  // and validates using the scriptSig contents.
  const txHex = buildSegwitRecoveryTransaction(
    selectedUtxos,
    toAddress,
    amountSats,
    changeAmount > 546 ? expectedAddress : null,
    changeAmount > 546 ? changeAmount : 0,
    Buffer.from(matchedChild.privateKey),
    Buffer.from(matchedChild.publicKey),
    targetPubkeyHash
  );

  console.log(`[TX] Transaction hex (${txHex.length} chars): ${txHex}`);

  // Broadcast to BCH2 network
  console.log(`[TX] Broadcasting to BCH2 network...`);
  const txid = await broadcastTransaction(txHex);

  console.log(`[TX] Broadcast successful, txid: ${txid}`);
  return { txid, hex: txHex };
}

/**
 * Build a raw transaction spending P2WPKH outputs via SegWit recovery
 * Uses BIP143 sighash with FORKID, scriptSig contains <sig> <pubkey>
 */
function buildSegwitRecoveryTransaction(
  utxos: UTXO[],
  toAddress: string,
  amount: number,
  changeAddress: string | null,
  changeAmount: number,
  privateKey: Buffer,
  publicKey: Buffer,
  pubkeyHash: Buffer
): string {
  // Transaction version
  const version = Buffer.alloc(4);
  version.writeUInt32LE(1, 0);

  // Build outputs
  let outputs = Buffer.alloc(0);
  let outputCount = 1;

  // Output 1: recipient (always BCH2 CashAddr for sending BCH2)
  const recipientScript = addressToScript(toAddress, false);
  const amountBytes = Buffer.alloc(8);
  amountBytes.writeBigUInt64LE(BigInt(amount), 0);
  outputs = Buffer.concat([outputs, amountBytes, encodeVarInt(recipientScript.length), recipientScript]);

  // Output 2: change (back to bc1 address)
  if (changeAddress && changeAmount > 0) {
    outputCount++;
    // Change goes back to the bc1 address (P2WPKH script)
    const changeScript = Buffer.concat([
      Buffer.from([0x00, 0x14]),
      pubkeyHash
    ]);
    const changeBytes = Buffer.alloc(8);
    changeBytes.writeBigUInt64LE(BigInt(changeAmount), 0);
    outputs = Buffer.concat([outputs, changeBytes, encodeVarInt(changeScript.length), changeScript]);
  }

  // Sign each input using BIP143 sighash
  const signedInputs: Buffer[] = [];
  for (let i = 0; i < utxos.length; i++) {
    const utxo = utxos[i];

    // Create BIP143 sighash for P2WPKH spending
    // scriptCode is the P2PKH script corresponding to the pubkey hash
    const sighash = createBIP143SighashForSegwit(utxos, i, pubkeyHash, outputCount, outputs, utxo.value);

    // Sign
    const signature = signWithPrivateKey(sighash, privateKey);

    // Build scriptSig: <sig_with_FORKID> <pubkey>
    // BCH2 SegWit recovery expects standard P2PKH-style scriptSig
    const sigWithHashType = Buffer.concat([signature, Buffer.from([0x41])]); // SIGHASH_ALL | FORKID
    const scriptSig = Buffer.concat([
      encodeVarInt(sigWithHashType.length),
      sigWithHashType,
      encodeVarInt(publicKey.length),
      publicKey
    ]);

    // Build signed input
    const txidBytes = Buffer.from(utxo.txid, 'hex').reverse();
    const voutBytes = Buffer.alloc(4);
    voutBytes.writeUInt32LE(utxo.vout, 0);
    const sequence = Buffer.from('ffffffff', 'hex');

    signedInputs.push(Buffer.concat([
      txidBytes,
      voutBytes,
      encodeVarInt(scriptSig.length),
      scriptSig,
      sequence
    ]));
  }

  // Assemble full transaction
  let tx = Buffer.concat([version, encodeVarInt(utxos.length)]);
  for (const input of signedInputs) {
    tx = Buffer.concat([tx, input]);
  }
  tx = Buffer.concat([tx, encodeVarInt(outputCount), outputs]);

  // Locktime
  const locktime = Buffer.alloc(4);
  locktime.writeUInt32LE(0, 0);
  tx = Buffer.concat([tx, locktime]);

  return tx.toString('hex');
}

/**
 * Create BIP143 sighash for SegWit spending (P2WPKH)
 * This is similar to regular BIP143 but uses the pubkey hash directly
 */
function createBIP143SighashForSegwit(
  utxos: UTXO[],
  inputIndex: number,
  pubkeyHash: Buffer,
  outputCount: number,
  serializedOutputs: Buffer,
  inputValue: number
): Buffer {
  const utxo = utxos[inputIndex];

  // 1. nVersion
  const version = Buffer.alloc(4);
  version.writeUInt32LE(1, 0);

  // 2. hashPrevouts
  let prevouts = Buffer.alloc(0);
  for (const u of utxos) {
    const txid = Buffer.from(u.txid, 'hex').reverse();
    const vout = Buffer.alloc(4);
    vout.writeUInt32LE(u.vout, 0);
    prevouts = Buffer.concat([prevouts, txid, vout]);
  }
  const hashPrevouts = doubleSha256(prevouts);

  // 3. hashSequence
  let sequences = Buffer.alloc(0);
  for (const _ of utxos) {
    sequences = Buffer.concat([sequences, Buffer.from('ffffffff', 'hex')]);
  }
  const hashSequence = doubleSha256(sequences);

  // 4. outpoint
  const outpoint = Buffer.concat([
    Buffer.from(utxo.txid, 'hex').reverse(),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(utxo.vout, 0); return b; })()
  ]);

  // 5. scriptCode (P2PKH script for this pubkey hash)
  const script = Buffer.concat([
    Buffer.from([0x76, 0xa9, 0x14]), // OP_DUP OP_HASH160 PUSH20
    pubkeyHash,
    Buffer.from([0x88, 0xac]) // OP_EQUALVERIFY OP_CHECKSIG
  ]);
  const scriptCode = Buffer.concat([encodeVarInt(script.length), script]);

  // 6. value
  const value = Buffer.alloc(8);
  value.writeBigUInt64LE(BigInt(inputValue), 0);

  // 7. nSequence
  const nSequence = Buffer.from('ffffffff', 'hex');

  // 8. hashOutputs
  const hashOutputs = doubleSha256(serializedOutputs);

  // 9. nLocktime
  const locktime = Buffer.alloc(4);
  locktime.writeUInt32LE(0, 0);

  // 10. sighash type (SIGHASH_ALL | FORKID = 0x41)
  const hashType = Buffer.alloc(4);
  hashType.writeUInt32LE(0x41, 0);

  // Combine all parts
  const preimage = Buffer.concat([
    version,
    hashPrevouts,
    hashSequence,
    outpoint,
    scriptCode,
    value,
    nSequence,
    hashOutputs,
    locktime,
    hashType
  ]);

  return doubleSha256(preimage);
}

export default {
  sendTransaction,
  sendFromBech32,
};
