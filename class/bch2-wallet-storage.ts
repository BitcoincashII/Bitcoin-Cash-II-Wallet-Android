/**
 * BCH2 Wallet Storage
 * Handles saving and loading BCH2 wallets using AsyncStorage
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import * as bip39 from 'bip39';
import BIP32Factory, { BIP32Interface } from 'bip32';
import ecc from '../blue_modules/noble_ecc';
const bip32 = BIP32Factory(ecc);
const crypto = require('crypto');

// AsyncStorage holds only non-secret wallet METADATA. The recovery phrase for
// each wallet lives in the hardware-backed Android Keystore (react-native-
// keychain), one entry per wallet keyed by `seedService(id)`. Legacy installs
// stored the mnemonic inline in this metadata blob; getWallets/getWalletMnemonic
// migrate those into the Keystore on read and only drop the plaintext copy once
// the Keystore copy is verified readable (see migrateSeedsToKeystore).
const WALLETS_KEY = '@bch2_wallets';
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function seedService(id: string): string {
  return 'bch2_seed_' + id;
}

// Stable Android value; falls back to the literal if the enum is unavailable.
const ACCESSIBLE_WHEN_UNLOCKED_THIS_DEVICE_ONLY =
  (Keychain.ACCESSIBLE && Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY) ||
  ('AccessibleWhenUnlockedThisDeviceOnly' as Keychain.ACCESSIBLE);

async function storeSeed(id: string, mnemonic: string): Promise<boolean> {
  const res = await Keychain.setGenericPassword('bch2', mnemonic, {
    service: seedService(id),
    accessible: ACCESSIBLE_WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return res !== false;
}

async function readSeed(id: string): Promise<string | null> {
  const cred = await Keychain.getGenericPassword({ service: seedService(id) });
  return cred && cred.password ? cred.password : null;
}

// Simple async mutex to prevent concurrent read-modify-write races on wallet storage
let _storageLock: Promise<void> = Promise.resolve();
function withStorageLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _storageLock;
  let release: () => void;
  _storageLock = new Promise<void>(r => { release = r; });
  // Catch prev rejection so a failed holder doesn't permanently block the lock
  return prev.catch(() => {}).then(fn).finally(() => release!());
}

// BC2 (Bitcoin-Core lineage) address flavour. Only meaningful when type==='bc2';
// absent/legacy on existing wallets stays m/44' P2PKH for backward compatibility.
export type BC2ScriptType = 'legacy' | 'p2sh-segwit' | 'native-segwit' | 'taproot';

export interface StoredWallet {
  id: string;
  type: 'bch2' | 'bc2' | 'bc1';  // bc1 = Native SegWit for BCH2 airdrop claims
  scriptType?: BC2ScriptType;    // BC2 only; undefined === 'legacy'
  xpub?: string;                 // BC2 only: account xpub m/purpose'/0'/0' — enables
                                 // watch-only balance/scan/receive WITHOUT reading the
                                 // seed. The seed (Keystore) is read only to SIGN.
  label: string;
  mnemonic: string;
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
  walletType: 'bch2' | 'bc2' | 'bc1' = 'bch2',
  scriptType: BC2ScriptType = 'legacy'
): Promise<StoredWallet> {
  // Trim mnemonic once — must use same value for address derivation and storage
  const trimmedMnemonic = mnemonic.trim();

  if (!bip39.validateMnemonic(trimmedMnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  // Derive address from mnemonic
  const address = deriveAddress(trimmedMnemonic, walletType, scriptType);
  // BC2: also derive the account xpub now so reads never need the seed later.
  const bc2Xpub = walletType === 'bc2' ? deriveBC2AccountXpub(trimmedMnemonic, scriptType) : undefined;
  const id = generateId();

  // Store the recovery phrase in the Keystore FIRST. If that fails, do not
  // persist a wallet whose seed we could not securely save.
  if (!(await storeSeed(id, trimmedMnemonic))) {
    throw new Error('Could not securely store the recovery phrase (Keystore unavailable)');
  }

  const wallet: StoredWallet = {
    id,
    type: walletType,
    ...(walletType === 'bc2' ? { scriptType, xpub: bc2Xpub } : {}),
    label: label.trim(),
    mnemonic: trimmedMnemonic,
    address,
    balance: 0,
    unconfirmedBalance: 0,
    createdAt: Date.now(),
  };

  // Serialized via lock to prevent concurrent read-modify-write races.
  // The persisted metadata never contains the mnemonic (secret is in Keystore).
  await withStorageLock(async () => {
    const wallets = await getWalletsRaw();
    wallets.push({ ...wallet, mnemonic: '' });
    await AsyncStorage.setItem(WALLETS_KEY, JSON.stringify(wallets));
  });

  return wallet;
}

/**
 * Read the raw metadata array from AsyncStorage. May contain legacy inline
 * mnemonics for wallets not yet migrated. Internal use only — never returns
 * to callers without stripping the secret.
 */
async function getWalletsRaw(): Promise<StoredWallet[]> {
  const data = await AsyncStorage.getItem(WALLETS_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch (error) {
    // Do NOT return [] on parse error — that would cause saveWallet to
    // overwrite all existing wallets with just the new one.
    throw new Error(`Wallet data corrupted (${data.length} bytes). Backup @bch2_wallets before clearing.`);
  }
}

/**
 * Migrate any legacy inline plaintext mnemonics into the Keystore. Non-
 * destructive: the plaintext copy is only removed after the Keystore write is
 * verified readable, so a Keystore failure never loses a seed.
 */
async function migrateSeedsToKeystore(): Promise<void> {
  await withStorageLock(async () => {
    const wallets = await getWalletsRaw();
    let changed = false;
    for (const w of wallets) {
      if (!w.mnemonic) continue;
      try {
        if (!(await storeSeed(w.id, w.mnemonic))) continue; // keep plaintext, retry later
        if ((await readSeed(w.id)) !== w.mnemonic) continue; // verify before dropping plaintext
        w.mnemonic = '';
        changed = true;
      } catch {
        // Keystore unavailable right now — leave plaintext intact, retry later.
      }
    }
    if (changed) await AsyncStorage.setItem(WALLETS_KEY, JSON.stringify(wallets));
  });
}

/**
 * Get all stored wallets (metadata only; mnemonic is always empty here).
 * Triggers a lazy migration of any legacy plaintext seeds into the Keystore.
 */
export async function getWallets(): Promise<StoredWallet[]> {
  const wallets = await getWalletsRaw();
  if (wallets.some(w => w.mnemonic)) {
    await migrateSeedsToKeystore();
    return (await getWalletsRaw()).map(w => ({ ...w, mnemonic: '' }));
  }
  return wallets.map(w => ({ ...w, mnemonic: '' }));
}

/**
 * Get a single wallet by ID
 */
export async function getWallet(id: string): Promise<StoredWallet | null> {
  const wallets = await getWallets();
  return wallets.find(w => w.id === id) || null;
}

/**
 * Delete every wallet and its Keystore seed. Used by the authenticated
 * "wipe all data" flow. Callers MUST authenticate the user first.
 */
export async function wipeAllWallets(): Promise<void> {
  const wallets = await getWalletsRaw();
  for (const w of wallets) {
    try { await Keychain.resetGenericPassword({ service: seedService(w.id) }); } catch {}
  }
  await AsyncStorage.removeItem(WALLETS_KEY);
}

/**
 * Update wallet balance
 */
export async function updateWalletBalance(
  id: string,
  balance: number,
  unconfirmedBalance: number
): Promise<void> {
  // Reject non-finite values to prevent NaN/Infinity from corrupting storage
  if (!Number.isFinite(balance) || !Number.isFinite(unconfirmedBalance)) return;
  balance = Math.max(0, Math.floor(balance));
  unconfirmedBalance = Math.floor(unconfirmedBalance); // Can be negative (pending spend)
  await withStorageLock(async () => {
    const wallets = await getWalletsRaw();
    const index = wallets.findIndex(w => w.id === id);

    if (index !== -1) {
      wallets[index].balance = balance;
      wallets[index].unconfirmedBalance = unconfirmedBalance;
      await AsyncStorage.setItem(WALLETS_KEY, JSON.stringify(wallets));
    }
  });
}

/**
 * Delete a wallet: remove its Keystore seed and its metadata entry.
 */
export async function deleteWallet(id: string): Promise<void> {
  try { await Keychain.resetGenericPassword({ service: seedService(id) }); } catch {}
  await withStorageLock(async () => {
    const wallets = await getWalletsRaw();
    const filtered = wallets.filter(w => w.id !== id);
    await AsyncStorage.setItem(WALLETS_KEY, JSON.stringify(filtered));
  });
}

/**
 * Derive address from mnemonic (BCH2 CashAddr, BC2 legacy, or bc1 SegWit)
 */
function deriveAddress(
  mnemonic: string,
  walletType: 'bch2' | 'bc2' | 'bc1' = 'bch2',
  scriptType: BC2ScriptType = 'legacy'
): string {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  // Hoisted so the finally can zero them — deriveAddress runs on every wallet
  // create/derive, so the BIP32 master + child private keys must not linger.
  let root: BIP32Interface | undefined;
  let child: BIP32Interface | undefined;
  try {
    root = bip32.fromSeed(seed);

    if (walletType === 'bc2') {
      // BC2 (Bitcoin-Core lineage) — path depends on the chosen script type; the
      // address encoding is centralised in bc2AddressFromPubkey (single source of
      // truth, shared with HD scanning) so the two never diverge.
      const purpose = scriptType === 'p2sh-segwit' ? 49 : scriptType === 'native-segwit' ? 84 : scriptType === 'taproot' ? 86 : 44;
      child = root.derivePath(`m/${purpose}'/0'/0'/0/0`);
      return bc2AddressFromPubkey(scriptType, Buffer.from(child.publicKey));
    }

    if (walletType === 'bc1') {
      // Native SegWit uses BIP84 path: m/84'/0'/0'/0/0
      child = root.derivePath("m/84'/0'/0'/0/0");
      const pubkeyHash = hash160(Buffer.from(child.publicKey));
      return encodeBech32('bc', 0, pubkeyHash);
    }

    // BCH2 uses BCH derivation path: m/44'/145'/0'/0/0
    child = root.derivePath("m/44'/145'/0'/0/0");
    const pubkeyHash = hash160(Buffer.from(child.publicKey));
    return encodeCashAddr('bitcoincashii', 0, pubkeyHash);
  } finally {
    // Zero seed + BIP32 master/child private keys regardless of success/failure.
    if (seed instanceof Buffer || seed instanceof Uint8Array) {
      seed.fill(0);
    }
    if (root?.privateKey) { try { root.privateKey.fill(0); } catch {} }
    if (child?.privateKey) { try { child.privateKey.fill(0); } catch {} }
  }
}

/**
 * Encode a BC2 address from a compressed public key for a given script type.
 * Single source of truth for BC2 address encoding — used by deriveAddress and by
 * HD scanning so a derived receive/change address always matches what is stored.
 */
export function bc2AddressFromPubkey(scriptType: BC2ScriptType, publicKey: Buffer): string {
  switch (scriptType) {
    case 'native-segwit':
      return encodeBech32('bc', 0, hash160(publicKey));                 // bc1 P2WPKH
    case 'p2sh-segwit':
      return getP2SHP2WPKHAddress(hash160(publicKey));                  // 3xxx P2SH-P2WPKH
    case 'taproot': {
      const xonly = publicKey.subarray(1, 33);
      const tweak = taggedHash('TapTweak', xonly);
      const tr = ecc.xOnlyPointAddTweak(xonly, tweak);
      if (!tr) throw new Error('Taproot key tweak failed');
      return encodeBech32m('bc', 1, Buffer.from(tr.xOnlyPubkey));       // bc1p P2TR
    }
    case 'legacy':
    default:
      return getLegacyAddress(hash160(publicKey));                      // 1xxx P2PKH
  }
}

/**
 * Derive the BC2 receive address for a given script type. Used by the import
 * flow to scan a seed across legacy / wrapped-segwit / native-segwit / taproot
 * (BlueWallet-style) and by any caller needing a non-persisted address.
 */
export function deriveBC2Address(mnemonic: string, scriptType: BC2ScriptType): string {
  return deriveAddress(mnemonic.trim(), 'bc2', scriptType);
}

function bc2PurposeFor(scriptType: BC2ScriptType): number {
  return scriptType === 'p2sh-segwit' ? 49 : scriptType === 'native-segwit' ? 84 : scriptType === 'taproot' ? 86 : 44;
}

/**
 * Derive the BC2 account extended PUBLIC key (xpub at m/purpose'/0'/0'). This is
 * public-only — it can derive every receive/change address for watch-only
 * balance/scan/receive, but CANNOT sign. Stored so the seed is not read for reads.
 * The seed is used here (create/import/migration) and then wiped.
 */
export function deriveBC2AccountXpub(mnemonic: string, scriptType: BC2ScriptType): string {
  const purpose = bc2PurposeFor(scriptType);
  const seed = bip39.mnemonicToSeedSync(mnemonic.trim());
  const root = bip32.fromSeed(seed);
  try {
    const account = root.derivePath(`m/${purpose}'/0'/0'`);
    const xpub = account.neutered().toBase58();
    if (account.privateKey) { try { account.privateKey.fill(0); } catch {} }
    return xpub;
  } finally {
    if (seed instanceof Buffer || seed instanceof Uint8Array) seed.fill(0);
    if (root.privateKey) { try { root.privateKey.fill(0); } catch {} }
  }
}

/**
 * Return a BC2 wallet's account xpub. If not yet stored (older wallet), derive it
 * from the seed ONCE and persist it — the last seed read for read-only operations;
 * every later balance/scan/receive uses the stored xpub with no seed access.
 */
export async function getBC2AccountXpub(wallet: StoredWallet, scriptType: BC2ScriptType): Promise<string> {
  if (wallet.xpub) return wallet.xpub;
  const mnemonic = await getWalletMnemonic(wallet.id);
  if (!mnemonic) throw new Error('Cannot derive account xpub — wallet seed unavailable');
  const xpub = deriveBC2AccountXpub(mnemonic, scriptType);
  await updateWalletXpub(wallet.id, xpub);
  return xpub;
}

/** Persist the account xpub for a wallet (one-time backfill; never overwrites). */
export async function updateWalletXpub(id: string, xpub: string): Promise<void> {
  await withStorageLock(async () => {
    const wallets = await getWalletsRaw();
    const idx = wallets.findIndex(w => w.id === id);
    if (idx !== -1 && !wallets[idx].xpub) {
      wallets[idx].xpub = xpub;
      await AsyncStorage.setItem(WALLETS_KEY, JSON.stringify(wallets));
    }
  });
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

/**
 * Get P2SH-P2WPKH (wrapped SegWit, 3xxx) address for BC2.
 * redeemScript = OP_0 PUSH20 <pubkeyhash>; address = Base58Check(0x05 || HASH160(redeemScript)).
 */
function getP2SHP2WPKHAddress(pubkeyHash: Buffer): string {
  const redeemScript = Buffer.concat([Buffer.from([0x00, 0x14]), pubkeyHash]);
  const scriptHash = hash160(redeemScript);
  const versionedHash = Buffer.concat([Buffer.from([0x05]), scriptHash]);
  const checksum = doubleHash(versionedHash).slice(0, 4);
  return base58Encode(Buffer.concat([versionedHash, checksum]));
}

/** BIP340/341 tagged hash: SHA256(SHA256(tag) || SHA256(tag) || data). */
function taggedHash(tag: string, data: Buffer): Buffer {
  const t = crypto.createHash('sha256').update(Buffer.from(tag, 'utf8')).digest();
  return crypto.createHash('sha256').update(Buffer.concat([t, t, data])).digest();
}

function base58Encode(data: Buffer): string {
  if (data.length === 0) return '';
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
  // Keystore is the source of truth.
  try {
    const seed = await readSeed(id);
    if (seed) return seed;
  } catch {
    // fall through to legacy path
  }
  // Legacy fallback: un-migrated plaintext still in metadata. Return it and
  // kick off migration so the next read comes from the Keystore.
  const wallets = await getWalletsRaw();
  const w = wallets.find(x => x.id === id);
  if (w?.mnemonic) {
    migrateSeedsToKeystore().catch(() => {});
    return w.mnemonic;
  }
  return null;
}


// Helper functions

function generateId(): string {
  const randomHex = crypto.randomBytes(8).toString('hex');
  return 'bch2_' + Date.now().toString(36) + randomHex;
}

function hash160(data: Buffer): Buffer {
  const sha256Hash = crypto.createHash('sha256').update(data).digest();
  const ripemd160Hash = crypto.createHash('ripemd160').update(sha256Hash).digest();
  return ripemd160Hash;
}

function encodeCashAddr(prefix: string, type: number, hash: Buffer): string {
  if (type !== 0 && type !== 1) throw new Error(`Invalid CashAddr type: ${type}`);
  // Determine size code from hash length
  const sizeMap: Record<number, number> = { 20: 0, 24: 1, 28: 2, 32: 3, 40: 4, 48: 5, 56: 6, 64: 7 };
  if (!(hash.length in sizeMap)) throw new Error(`Invalid hash length for CashAddr: ${hash.length}`);
  const sizeCode = sizeMap[hash.length];

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
  const polymod = cashAddrPolymod(values) ^ 1n;

  const checksum = [];
  for (let i = 0; i < 8; i++) {
    checksum.push(Number((polymod >> BigInt(5 * (7 - i))) & 0x1fn));
  }
  return checksum;
}

function cashAddrPolymod(values: number[]): bigint {
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

  return chk;
}

// Bech32 encoding for Native SegWit (bc1) addresses
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

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

// Bech32m encoding (BIP350) for Taproot (bc1p, witness version 1). Identical to
// bech32 except the checksum constant is XORed with 0x2bc830a3 instead of 1.
function encodeBech32m(hrp: string, version: number, program: Buffer): string {
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
  const hrpExpanded = bech32HrpExpand(hrp);
  const polymod = (bech32Polymod([...hrpExpanded, ...data, 0, 0, 0, 0, 0, 0]) ^ 0x2bc830a3) >>> 0;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) {
    checksum.push((polymod >> (5 * (5 - i))) & 0x1f);
  }
  let result = hrp + '1';
  for (const v of [...data, ...checksum]) {
    result += BECH32_CHARSET[v];
  }
  return result;
}

export default {
  saveWallet,
  getWallets,
  getWallet,
  updateWalletBalance,
  deleteWallet,
  getWalletMnemonic,
  wipeAllWallets,
};
