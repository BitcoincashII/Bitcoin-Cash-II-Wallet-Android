/**
 * BCH2 Electrum Module
 * Handles connections to BCH2 Electrum servers (Fulcrum)
 * Falls back to direct RPC if Electrum unavailable
 */

import DefaultPreference from 'react-native-default-preference';

const ElectrumClient = require('electrum-client');
const net = require('net');
const tls = require('tls');

const DEBUG = __DEV__ || false;

// RPC fallback configuration
let rpcConfig: { host: string; port: number; user: string; password: string } | null = null;
let useRpcFallback = false;

type Peer = {
  host: string;
  ssl?: number;
  tcp?: number;
};

// BCH2 Electrum servers
export const BCH2_ELECTRUM_HOST = 'bch2_electrum_host';
export const BCH2_ELECTRUM_TCP_PORT = 'bch2_electrum_tcp_port';
export const BCH2_ELECTRUM_SSL_PORT = 'bch2_electrum_ssl_port';

// Default BCH2 Electrum servers (post-fork chain)
// SSL preferred for security; TCP available as fallback
const defaultPeer: Peer = { host: 'electrum.bch2.org', ssl: 50002, tcp: 50001 };
export const hardcodedPeers: Peer[] = [
  { host: 'electrum.bch2.org', ssl: 50002, tcp: 50001 },
];

// BC2 Electrum servers (for airdrop balance checking)
export const bc2Peers: Peer[] = [
  { host: 'infra1.bitcoin-ii.org', ssl: 50009, tcp: 50008 },
  // TODO: Add explorer.bitcoin-ii.org:50008 when Electrum is deployed on that host
];

let mainClient: typeof ElectrumClient | undefined;
let mainConnected: boolean = false;
let connectingPromise: Promise<void> | null = null; // Mutex to prevent concurrent connection attempts
let serverName: string | false = false;
let currentPeerIndex = 0;
let latestBlock: { height: number; time: number } | { height: undefined; time: undefined } = { height: undefined, time: undefined };

// BC2 client for airdrop balance checking
let bc2Client: typeof ElectrumClient | undefined;
let bc2Connected: boolean = false;
let bc2PeerIndex = 0;

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

async function connectMain(): Promise<void> {
  // Check both flag and client liveness — if disconnected, client ref may be stale
  if (mainConnected && mainClient) return;

  // If disconnected, clear stale client to force fresh connection
  if (!mainConnected && mainClient) {
    try { mainClient.close(); } catch {}
    mainClient = undefined;
  }

  // Prevent concurrent connection attempts (race condition)
  if (connectingPromise) return connectingPromise;

  connectingPromise = _doConnectMain();
  try {
    await connectingPromise;
  } finally {
    connectingPromise = null;
  }
}

async function _doConnectMain(): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const peer = hardcodedPeers[currentPeerIndex];
    currentPeerIndex = (currentPeerIndex + 1) % hardcodedPeers.length;

    try {
      const useSSL = !!peer.ssl;
      // BCH2 Electrum servers use self-signed certs — disable TLS verification for known hosts
      const isSelfSigned = peer.host === 'electrum.bch2.org' || peer.host === 'electrum2.bch2.org';
      mainClient = new ElectrumClient(
        net,
        tls,
        useSSL ? peer.ssl : peer.tcp,
        peer.host,
        useSSL ? 'tls' : 'tcp',
        useSSL && isSelfSigned ? { rejectUnauthorized: false } : undefined
      );

      mainClient.onError = (e: Error) => {
        mainConnected = false;
      };

      mainClient.onClose = () => {
        mainConnected = false;
        DEBUG && console.log('[BCH2Electrum] Connection closed, will reconnect on next request');
      };

      await mainClient.initElectrum({ client: 'bluewallet-bch2', version: '1.4' });
      mainConnected = true;
      serverName = peer.host;

      // Subscribe to headers
      const header = await mainClient.blockchainHeaders_subscribe();
      if (header && typeof header.height === 'number' && Number.isInteger(header.height) && header.height >= 0) {
        latestBlock = { height: header.height, time: Math.floor(Date.now() / 1000) };
      }
      return; // Success
    } catch (e) {
      mainConnected = false;
      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw e;
      }
    }
  }
}

export async function getBalanceByAddress(address: string): Promise<{ confirmed: number; unconfirmed: number }> {
  await connectMain();
  const script = addressToScriptHash(address);
  const balance = await mainClient.blockchainScripthash_getBalance(script);
  const MAX_BALANCE = 21_000_000 * 100_000_000; // 21M coins in sats
  const confirmed = Math.max(0, Math.floor(Number(balance.confirmed) || 0));
  const unconfirmed = Math.floor(Number(balance.unconfirmed) || 0);
  if (confirmed > MAX_BALANCE || Math.abs(unconfirmed) > MAX_BALANCE) {
    throw new Error('Balance exceeds maximum supply — possible server error');
  }
  return { confirmed, unconfirmed };
}

/**
 * Get balance by scripthash directly (for SegWit addresses)
 * scripthash should be a 64-char hex string (SHA256 of scriptPubKey, reversed)
 */
export async function getBalanceByScripthash(scripthash: string): Promise<{ confirmed: number; unconfirmed: number }> {
  if (typeof scripthash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(scripthash)) {
    throw new Error('Invalid scripthash: expected 64-char hex string');
  }
  await connectMain();
  const balance = await mainClient.blockchainScripthash_getBalance(scripthash);
  const MAX_BALANCE = 21_000_000 * 100_000_000;
  const confirmed = Math.max(0, Math.floor(Number(balance.confirmed) || 0));
  const unconfirmed = Math.floor(Number(balance.unconfirmed) || 0);
  if (confirmed > MAX_BALANCE || Math.abs(unconfirmed) > MAX_BALANCE) {
    throw new Error('Balance exceeds maximum supply — possible server error');
  }
  return { confirmed, unconfirmed };
}

/**
 * Get UTXOs by scripthash directly (for SegWit addresses)
 */
export async function getUtxosByScripthash(scripthash: string): Promise<any[]> {
  if (typeof scripthash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(scripthash)) {
    throw new Error('Invalid scripthash: expected 64-char hex string');
  }
  await connectMain();
  const utxos = await mainClient.blockchainScripthash_listunspent(scripthash);
  if (!Array.isArray(utxos)) return [];
  const MAX_UTXO_VALUE = 21_000_000 * 100_000_000; // 21M coins in sats
  const seen = new Set<string>();
  const txidRegex = /^[a-fA-F0-9]{64}$/;
  return utxos
    .filter((utxo: any) => typeof utxo.tx_hash === 'string' && txidRegex.test(utxo.tx_hash))
    .filter((utxo: any) => typeof utxo.value === 'number' && Number.isInteger(utxo.value) && utxo.value > 0 && utxo.value <= MAX_UTXO_VALUE)
    .filter((utxo: any) => typeof utxo.tx_pos === 'number' && Number.isInteger(utxo.tx_pos) && utxo.tx_pos >= 0 && utxo.tx_pos <= 0xFFFFFFFF)
    .filter((utxo: any) => {
      const key = `${utxo.tx_hash}:${utxo.tx_pos}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((utxo: any) => ({
      txid: utxo.tx_hash,
      vout: utxo.tx_pos,
      value: utxo.value,
      height: typeof utxo.height === 'number' && Number.isInteger(utxo.height) && utxo.height >= 0 ? utxo.height : 0,
    }));
}

/**
 * Get transaction history by scripthash (for SegWit addresses)
 */
export async function getTransactionsByScripthash(scripthash: string): Promise<any[]> {
  if (typeof scripthash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(scripthash)) {
    throw new Error('Invalid scripthash: expected 64-char hex string');
  }
  await connectMain();
  const history = await mainClient.blockchainScripthash_getHistory(scripthash);
  return Array.isArray(history) ? history.slice(0, 500) : [];
}

export async function getTransactionsByAddress(address: string): Promise<any[]> {
  await connectMain();
  const script = addressToScriptHash(address);
  const history = await mainClient.blockchainScripthash_getHistory(script);
  return Array.isArray(history) ? history.slice(0, 500) : [];
}

export async function getUtxosByAddress(address: string): Promise<any[]> {
  await connectMain();
  const script = addressToScriptHash(address);
  const utxos = await mainClient.blockchainScripthash_listunspent(script);
  if (!Array.isArray(utxos)) return [];
  const MAX_UTXO_VALUE = 21_000_000 * 100_000_000; // 21M coins in sats
  const seen = new Set<string>();
  const txidRegex2 = /^[a-fA-F0-9]{64}$/;
  return utxos
    .filter((utxo: any) => typeof utxo.tx_hash === 'string' && txidRegex2.test(utxo.tx_hash))
    .filter((utxo: any) => typeof utxo.value === 'number' && Number.isInteger(utxo.value) && utxo.value > 0 && utxo.value <= MAX_UTXO_VALUE)
    .filter((utxo: any) => typeof utxo.tx_pos === 'number' && Number.isInteger(utxo.tx_pos) && utxo.tx_pos >= 0 && utxo.tx_pos <= 0xFFFFFFFF)
    .filter((utxo: any) => {
      const key = `${utxo.tx_hash}:${utxo.tx_pos}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((utxo: any) => ({
      txid: utxo.tx_hash,
      vout: utxo.tx_pos,
      value: utxo.value,
      height: typeof utxo.height === 'number' && Number.isInteger(utxo.height) && utxo.height >= 0 ? utxo.height : 0,
    }));
}

export async function broadcastTransaction(hex: string): Promise<string> {
  // Max 32MB block = 64M hex chars; cap at 2MB tx (4M hex) as practical limit
  if (typeof hex !== 'string' || hex.length < 20 || hex.length > 4_000_000 || !/^[a-fA-F0-9]+$/.test(hex)) {
    throw new Error('Invalid transaction hex');
  }
  await connectMain();
  const result = await mainClient.blockchainTransaction_broadcast(hex);
  // Validate that the server returned a valid txid (64-char hex)
  if (typeof result !== 'string' || !/^[a-fA-F0-9]{64}$/.test(result.trim())) {
    throw new Error(`Broadcast failed: ${String(result).substring(0, 200)}`);
  }
  return result.trim();
}

export async function getTransaction(txid: string): Promise<any> {
  if (typeof txid !== 'string' || !/^[a-fA-F0-9]{64}$/.test(txid)) {
    throw new Error('Invalid txid: expected 64-char hex string');
  }
  await connectMain();
  return mainClient.blockchainTransaction_get(txid, true);
}

/**
 * Get raw transaction hex (for coinbase detection)
 */
export async function getRawTransaction(txid: string): Promise<string> {
  if (typeof txid !== 'string' || !/^[a-fA-F0-9]{64}$/.test(txid)) {
    throw new Error('Invalid txid: expected 64-char hex string');
  }
  await connectMain();
  return mainClient.blockchainTransaction_get(txid, false);
}

/**
 * Check if a transaction is a coinbase by examining its first input's prevout hash
 */
export async function isCoinbaseTx(txid: string): Promise<boolean> {
  const rawHex = await getRawTransaction(txid);
  if (typeof rawHex !== 'string' || rawHex.length < 20 || !/^[a-fA-F0-9]+$/.test(rawHex)) {
    throw new Error('Invalid raw transaction data from server');
  }
  // Raw tx: [version:4bytes][input_count:varint][first_input_prevout_hash:32bytes]
  // Minimum: 8 (version) + 2 (varint) + 64 (prevout hash) = 74 hex chars
  if (rawHex.length < 74) {
    throw new Error('Raw transaction too short to parse');
  }
  // Parse varint to find prevout start correctly
  let offset = 8; // Skip version (4 bytes = 8 hex chars)
  const varintByte = parseInt(rawHex.substring(offset, offset + 2), 16);
  if (isNaN(varintByte)) {
    throw new Error('Invalid varint in raw transaction');
  }
  if (varintByte < 0xfd) {
    offset += 2; // 1-byte varint
  } else if (varintByte === 0xfd) {
    offset += 6; // 1 + 2-byte varint
  } else if (varintByte === 0xfe) {
    offset += 10; // 1 + 4-byte varint
  } else {
    offset += 18; // 1 + 8-byte varint
  }
  // Prevout hash is 32 bytes (64 hex chars) of zeros for coinbase
  if (offset + 64 > rawHex.length) {
    throw new Error('Raw transaction too short to contain prevout hash');
  }
  const prevoutHash = rawHex.substring(offset, offset + 64);
  return prevoutHash === '0'.repeat(64);
}

/**
 * Filter out immature coinbase UTXOs (need 100 confirmations).
 * Coinbase outputs cannot be spent until 100 blocks have passed.
 */
export async function filterMatureUtxos(utxos: any[]): Promise<any[]> {
  const COINBASE_MATURITY = 100;
  const currentHeight = latestBlock.height;
  if (!currentHeight) return utxos; // Can't filter without block height

  const mature: any[] = [];
  for (const utxo of utxos) {
    const height = utxo.height ?? 0;
    const confirmations = height > 0 ? currentHeight - height + 1 : 0;
    if (confirmations < COINBASE_MATURITY) {
      // Only fetch raw tx for UTXOs under 100 confirmations
      try {
        const txid = utxo.txid || utxo.tx_hash;
        if (txid && await isCoinbaseTx(txid)) continue; // Skip immature coinbase
      } catch {
        // If we can't determine coinbase status and confirmations are very low,
        // fail-closed (exclude) to prevent spending immature coinbase
        if (confirmations < 10) continue;
      }
    }
    mature.push(utxo);
  }
  return mature;
}

/**
 * Estimate fee in sat/byte.
 * Electrum returns BTC/kB; we convert to sat/byte (1 BTC/kB = 100000 sat/kB = 100 sat/byte).
 */
export async function estimateFee(blocks: number = 6): Promise<number> {
  if (typeof blocks !== 'number' || !Number.isInteger(blocks) || blocks < 1) blocks = 6;
  blocks = Math.min(blocks, 144);
  await connectMain();
  const feePerKB = await mainClient.blockchainEstimatefee(blocks);
  if (typeof feePerKB === 'number' && Number.isFinite(feePerKB) && feePerKB > 0) {
    // BTC/kB → sat/byte: multiply by 100_000_000 (sat/BTC) / 1000 (bytes/kB) = 100_000
    // Cap at 100 sat/byte to prevent fee-drain from malicious Electrum server
    const satPerByte = Math.ceil(feePerKB * 100000);
    return Math.min(Math.max(1, satPerByte), 100);
  }
  return 1; // Default 1 sat/byte if estimation fails
}

export function getLatestBlock(): { height: number; time: number } | { height: undefined; time: undefined } {
  return latestBlock;
}

export function isConnected(): boolean {
  return mainConnected;
}

export function getServerName(): string | false {
  return serverName;
}

// CashAddr to scripthash conversion
function addressToScriptHash(address: string): string {
  if (typeof address !== 'string' || address.length === 0 || address.length > 150) {
    throw new Error('Invalid BCH2 address: empty, too long, or invalid type');
  }
  // Reject non-BCH2 prefixes to prevent cross-chain address confusion
  const lowerAddr = address.toLowerCase();
  if (lowerAddr.startsWith('bitcoincash:') || lowerAddr.startsWith('bchtest:')) {
    throw new Error('Invalid BCH2 address: wrong prefix (expected bitcoincashii:)');
  }
  // Remove BCH2 prefix if present
  let addr = address;
  if (lowerAddr.startsWith('bitcoincashii:')) {
    addr = address.slice('bitcoincashii:'.length);
  }

  // Decode CashAddr and convert to scripthash
  const decoded = decodeCashAddr(addr);
  if (!decoded) {
    throw new Error('Invalid BCH2 address');
  }

  // BCH2 only uses 20-byte hashes (P2PKH type=0 and P2SH type=1)
  if (decoded.hash.length !== 20) {
    throw new Error('Invalid BCH2 address: unsupported hash size');
  }
  if (decoded.type !== 0 && decoded.type !== 1) {
    throw new Error('Invalid BCH2 address: unsupported address type');
  }

  // Create script based on address type
  let script: Buffer;
  if (decoded.type === 1) {
    // P2SH: OP_HASH160 <scripthash> OP_EQUAL
    script = Buffer.concat([
      Buffer.from([0xa9, 0x14]),
      decoded.hash,
      Buffer.from([0x87]),
    ]);
  } else {
    // P2PKH: OP_DUP OP_HASH160 <pubkeyhash> OP_EQUALVERIFY OP_CHECKSIG
    script = Buffer.concat([
      Buffer.from([0x76, 0xa9, 0x14]),
      decoded.hash,
      Buffer.from([0x88, 0xac]),
    ]);
  }

  // Single SHA256 and reverse (Electrum protocol standard)
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(script).digest();
  return Buffer.from(hash).reverse().toString('hex');
}

// CashAddr decoder with checksum validation
function decodeCashAddr(addr: string): { type: number; hash: Buffer } | null {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const GENERATORS = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];

  const values: number[] = [];
  for (const char of addr.toLowerCase()) {
    const idx = CHARSET.indexOf(char);
    if (idx === -1) return null;
    values.push(idx);
  }

  if (values.length < 8) return null;

  // Validate checksum (polymod must equal 1)
  // Use bitcoincashii prefix for checksum computation
  const prefix = 'bitcoincashii';
  const prefixData: number[] = [];
  for (const char of prefix) {
    prefixData.push(char.charCodeAt(0) & 0x1f);
  }
  prefixData.push(0);

  let chk = 1n;
  for (const value of [...prefixData, ...values]) {
    const top = chk >> 35n;
    chk = ((chk & 0x07ffffffffn) << 5n) ^ BigInt(value);
    for (let i = 0; i < 5; i++) {
      if ((top >> BigInt(i)) & 1n) {
        chk ^= GENERATORS[i];
      }
    }
  }
  if (chk !== 1n) return null;

  // Remove checksum (last 8 values)
  const data = values.slice(0, -8);

  // Unpack: convert 5-bit groups to 8-bit version byte + hash
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
      acc &= (1 << bits) - 1;
      versionExtracted = true;
    }

    while (versionExtracted && bits >= 8) {
      bits -= 8;
      hashBytes.push((acc >> bits) & 0xff);
      acc &= (1 << bits) - 1;
    }
  }

  // CashAddr spec: padding bits must be zero
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) return null;

  const type = versionByte >> 3;
  const encodedSize = versionByte & 0x07;
  const expectedSizes = [20, 24, 28, 32, 40, 48, 56, 64];
  const expectedSize = expectedSizes[encodedSize] || 20;

  // Reject if decoded hash bytes are fewer than expected (malformed address)
  if (hashBytes.length < expectedSize) return null;

  return {
    type,
    hash: Buffer.from(hashBytes.slice(0, expectedSize)),
  };
}

// BC2 connection for airdrop balance checking
let bc2ConnectingPromise: Promise<void> | null = null;

async function connectBC2(): Promise<void> {
  if (bc2Connected && bc2Client) return;
  // Clear stale client on disconnect (same pattern as connectMain)
  if (!bc2Connected && bc2Client) {
    try { bc2Client.close(); } catch {}
    bc2Client = undefined;
  }
  if (bc2ConnectingPromise) return bc2ConnectingPromise;

  bc2ConnectingPromise = _doConnectBC2();
  try {
    await bc2ConnectingPromise;
  } finally {
    bc2ConnectingPromise = null;
  }
}

async function _doConnectBC2(): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const peer = bc2Peers[bc2PeerIndex];
    bc2PeerIndex = (bc2PeerIndex + 1) % bc2Peers.length;

    try {
      bc2Client = new ElectrumClient(
        net,
        tls,
        peer.ssl || peer.tcp,
        peer.host,
        peer.ssl ? 'tls' : 'tcp'
      );

      bc2Client.onError = (e: Error) => {
        bc2Connected = false;
      };
      bc2Client.onClose = () => {
        bc2Connected = false;
      };

      await bc2Client.initElectrum({ client: 'bluewallet-bch2', version: '1.4' });
      bc2Connected = true;
      return; // Success
    } catch (e) {
      bc2Connected = false;
      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw e;
      }
    }
  }
}

// Get BC2 balance using explorer API (Electrum server has indexing issues)
export async function getBC2Balance(address: string): Promise<{ confirmed: number; unconfirmed: number }> {
  if (typeof address !== 'string' || address.length === 0 || address.length > 150) {
    throw new Error('Invalid BC2 address');
  }
  try {
    // Use explorer API as primary method (more reliable than Electrum)
    const response = await fetch(`https://explorer.bitcoin-ii.org/api/address/${encodeURIComponent(address)}`);
    if (!response.ok) {
      throw new Error(`Explorer API error: ${response.status}`);
    }
    const data = await response.json();

    // chain_stats contains confirmed, mempool_stats contains unconfirmed
    const funded = Number(data.chain_stats?.funded_txo_sum ?? 0);
    const spent = Number(data.chain_stats?.spent_txo_sum ?? 0);
    const mFunded = Number(data.mempool_stats?.funded_txo_sum ?? 0);
    const mSpent = Number(data.mempool_stats?.spent_txo_sum ?? 0);
    if (!Number.isFinite(funded) || !Number.isFinite(spent) || !Number.isFinite(mFunded) || !Number.isFinite(mSpent)) {
      throw new Error('Invalid balance data from explorer');
    }
    const MAX_BALANCE = 21_000_000 * 100_000_000;
    const confirmed = Math.max(0, funded - spent);
    const unconfirmed = mFunded - mSpent;
    if (confirmed > MAX_BALANCE || Math.abs(unconfirmed) > MAX_BALANCE) {
      throw new Error('Balance exceeds maximum supply — possible server error');
    }

    return { confirmed, unconfirmed };
  } catch (apiError) {
    DEBUG && console.log('BC2 Explorer API failed, falling back to Electrum:', apiError);

    // Fallback to Electrum (may not work due to indexing issues)
    try {
      await connectBC2();
      const script = addressToScriptHashLegacy(address);
      const balance = await bc2Client.blockchainScripthash_getBalance(script);
      const MAX_BAL = 21_000_000 * 100_000_000;
      const confirmed = typeof balance.confirmed === 'number' && Number.isFinite(balance.confirmed) ? Math.max(0, balance.confirmed) : 0;
      const unconfirmed = typeof balance.unconfirmed === 'number' && Number.isFinite(balance.unconfirmed) ? balance.unconfirmed : 0;
      if (confirmed > MAX_BAL || Math.abs(unconfirmed) > MAX_BAL) {
        throw new Error('Balance exceeds maximum supply — possible server error');
      }
      return {
        confirmed,
        unconfirmed,
      };
    } catch (electrumError) {
      DEBUG && console.log('BC2 Electrum also failed:', electrumError);
      // Throw instead of silently returning zero, so callers know the balance is unknown
      throw new Error('BC2 balance check failed: both Explorer API and Electrum unavailable');
    }
  }
}

// Get BC2 balance by scripthash (for bc1 addresses)
export async function getBC2BalanceByScripthash(scripthash: string): Promise<{ confirmed: number; unconfirmed: number }> {
  if (typeof scripthash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(scripthash)) {
    throw new Error('Invalid scripthash: expected 64-char hex string');
  }
  try {
    await connectBC2();
    const balance = await bc2Client.blockchainScripthash_getBalance(scripthash);
    const MAX_BALANCE = 21_000_000 * 100_000_000;
    const confirmed = typeof balance.confirmed === 'number' && Number.isFinite(balance.confirmed) ? Math.max(0, balance.confirmed) : 0;
    const unconfirmed = typeof balance.unconfirmed === 'number' && Number.isFinite(balance.unconfirmed) ? balance.unconfirmed : 0;
    if (confirmed > MAX_BALANCE || Math.abs(unconfirmed) > MAX_BALANCE) {
      throw new Error('Balance exceeds maximum supply — possible server error');
    }
    return { confirmed, unconfirmed };
  } catch (e: any) {
    if (e.message?.includes('maximum supply')) throw e;
    DEBUG && console.log('BC2 scripthash balance check failed:', e);
    throw new Error('BC2 scripthash balance check failed: Electrum unavailable');
  }
}

// Get BC2 UTXOs using explorer API
export async function getBC2Utxos(address: string): Promise<any[]> {
  if (typeof address !== 'string' || address.length === 0 || address.length > 150) {
    throw new Error('Invalid BC2 address');
  }
  const MAX_UTXO_VALUE = 21_000_000 * 100_000_000;
  DEBUG && console.log(`[BC2] Fetching UTXOs for address: ${address}`);
  try {
    // Use explorer API as primary method
    const url = `https://explorer.bitcoin-ii.org/api/address/${encodeURIComponent(address)}/utxo`;
    DEBUG && console.log(`[BC2] Explorer API URL: ${url}`);
    const response = await fetch(url);
    DEBUG && console.log(`[BC2] Explorer API response status: ${response.status}`);
    if (!response.ok) {
      const errorText = await response.text();
      DEBUG && console.log(`[BC2] Explorer API error response: ${errorText}`);
      throw new Error(`Explorer API error: ${response.status} - ${errorText}`);
    }
    const utxos = await response.json();
    if (!Array.isArray(utxos)) {
      throw new Error('Explorer API returned invalid UTXO data');
    }
    DEBUG && console.log(`[BC2] Explorer API returned ${utxos.length} UTXOs`);
    if (utxos.length > 0) {
      DEBUG && console.log(`[BC2] First UTXO:`, JSON.stringify(utxos[0]));
    }

    const txidRegex3 = /^[a-fA-F0-9]{64}$/;
    const seen = new Set<string>();
    return utxos
      .filter((utxo: any) => typeof utxo.txid === 'string' && txidRegex3.test(utxo.txid))
      .filter((utxo: any) => typeof utxo.value === 'number' && Number.isInteger(utxo.value) && utxo.value > 0 && utxo.value <= MAX_UTXO_VALUE)
      .filter((utxo: any) => typeof utxo.vout === 'number' && Number.isInteger(utxo.vout) && utxo.vout >= 0 && utxo.vout <= 0xFFFFFFFF)
      .filter((utxo: any) => {
        const key = `${utxo.txid}:${utxo.vout}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((utxo: any) => ({
        txid: utxo.txid,
        vout: utxo.vout,
        value: utxo.value,
        height: typeof utxo.status?.block_height === 'number' && Number.isInteger(utxo.status.block_height) && utxo.status.block_height >= 0 ? utxo.status.block_height : 0,
      }));
  } catch (apiError) {
    DEBUG && console.log('[BC2] Explorer API failed, falling back to Electrum:', apiError);

    // Fallback to Electrum
    try {
      await connectBC2();
      const script = addressToScriptHashLegacy(address);
      const utxos = await bc2Client.blockchainScripthash_listunspent(script);
      if (!Array.isArray(utxos)) return [];
      const txidRegex4 = /^[a-fA-F0-9]{64}$/;
      const seen2 = new Set<string>();
      return utxos
        .filter((utxo: any) => typeof utxo.tx_hash === 'string' && txidRegex4.test(utxo.tx_hash))
        .filter((utxo: any) => typeof utxo.value === 'number' && Number.isInteger(utxo.value) && utxo.value > 0 && utxo.value <= MAX_UTXO_VALUE)
        .filter((utxo: any) => typeof utxo.tx_pos === 'number' && Number.isInteger(utxo.tx_pos) && utxo.tx_pos >= 0 && utxo.tx_pos <= 0xFFFFFFFF)
        .filter((utxo: any) => {
          const key = `${utxo.tx_hash}:${utxo.tx_pos}`;
          if (seen2.has(key)) return false;
          seen2.add(key);
          return true;
        })
        .map((utxo: any) => ({
          txid: utxo.tx_hash,
          vout: utxo.tx_pos,
          value: utxo.value,
          height: typeof utxo.height === 'number' && Number.isInteger(utxo.height) && utxo.height >= 0 ? utxo.height : 0,
        }));
    } catch (electrumError) {
      DEBUG && console.log('BC2 Electrum also failed:', electrumError);
      throw new Error('BC2 UTXO fetch failed: both Explorer API and Electrum unavailable');
    }
  }
}

// Get BC2 transaction history using explorer API
export async function getBC2Transactions(address: string): Promise<any[]> {
  if (typeof address !== 'string' || address.length === 0 || address.length > 150) {
    throw new Error('Invalid BC2 address');
  }
  try {
    const response = await fetch(`https://explorer.bitcoin-ii.org/api/address/${encodeURIComponent(address)}/txs`);
    if (!response.ok) {
      throw new Error(`Explorer API error: ${response.status}`);
    }
    const txs = await response.json();

    return (Array.isArray(txs) ? txs.slice(0, 500) : []).map((tx: any) => {
      const txid = typeof tx.txid === 'string' && /^[a-fA-F0-9]{64}$/.test(tx.txid) ? tx.txid : '';
      return {
        tx_hash: txid,
        height: typeof tx.status?.block_height === 'number' && Number.isInteger(tx.status.block_height) && tx.status.block_height >= 0 ? tx.status.block_height : 0,
        confirmed: tx.status?.confirmed === true,
      };
    }).filter((tx: any) => tx.tx_hash !== '');
  } catch (apiError) {
    DEBUG && console.log('BC2 Explorer API failed:', apiError);
    throw new Error('BC2 transaction history fetch failed: Explorer API unavailable');
  }
}

// Broadcast BC2 transaction using explorer API
export async function broadcastBC2Transaction(hex: string): Promise<string> {
  // Max 32MB block = 64M hex chars; cap at 2MB tx (4M hex) as practical limit
  if (typeof hex !== 'string' || hex.length < 20 || hex.length > 4_000_000 || !/^[a-fA-F0-9]+$/.test(hex)) {
    throw new Error('Invalid transaction hex');
  }
  DEBUG && console.log(`[BC2] Broadcasting transaction, hex length: ${hex.length}`);

  try {
    const response = await fetch('https://explorer.bitcoin-ii.org/api/tx', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: hex,
    });

    const responseText = await response.text();
    DEBUG && console.log(`[BC2] Broadcast response status: ${response.status}`);
    DEBUG && console.log(`[BC2] Broadcast response: ${responseText}`);

    if (!response.ok) {
      throw new Error(`Broadcast failed: ${responseText}`);
    }

    // Validate that response looks like a txid (64 hex chars)
    // Also try to extract txid from JSON wrapper (some explorers return {"txid":"..."})
    let txidResult = responseText.trim();
    if (!/^[a-fA-F0-9]{64}$/.test(txidResult)) {
      try {
        const parsed = JSON.parse(responseText);
        if (parsed.txid && /^[a-fA-F0-9]{64}$/.test(parsed.txid)) {
          txidResult = parsed.txid;
        }
      } catch { /* not JSON */ }
    }
    if (!/^[a-fA-F0-9]{64}$/.test(txidResult)) {
      DEBUG && console.log(`[BC2] WARNING: Response does not look like a txid: ${responseText}`);
      throw new Error(`Broadcast may have failed: ${responseText}`);
    }

    return txidResult;
  } catch (apiError: any) {
    DEBUG && console.log('[BC2] Explorer broadcast failed:', apiError.message);

    // Fallback to Electrum
    DEBUG && console.log('[BC2] Trying Electrum fallback...');
    try {
      await connectBC2();
      const txid = await bc2Client.blockchainTransaction_broadcast(hex);
      DEBUG && console.log(`[BC2] Electrum broadcast result: ${txid}`);
      if (typeof txid !== 'string' || !/^[a-fA-F0-9]{64}$/.test(txid)) {
        throw new Error(`Unexpected Electrum response: ${String(txid).substring(0, 200)}`);
      }
      return txid;
    } catch (electrumError: any) {
      DEBUG && console.log('[BC2] Electrum broadcast also failed:', electrumError.message);
      DEBUG && console.log(`[BC2] Full broadcast errors - API: ${apiError.message}, Electrum: ${electrumError.message}`);
      throw new Error('BC2 broadcast failed — check network connection and try again');
    }
  }
}

// Legacy address to scripthash (for BC2)
// NOTE: BC2 Electrum uses single SHA256, not double SHA256 like standard Bitcoin
function addressToScriptHashLegacy(address: string): string {
  const crypto = require('crypto');
  const bs58check = require('bs58check');

  // Decode legacy address
  let decoded;
  try {
    decoded = bs58check.decode(address);
    if (decoded.length !== 21) {
      throw new Error('Invalid address: expected 21 bytes (1 version + 20 hash)');
    }
  } catch (e: any) {
    if (e.message?.includes('expected 21 bytes')) throw e;
    // Reject plain BCH CashAddr prefix (must be bitcoincashii: or no prefix)
    const lower = address.toLowerCase();
    if (lower.startsWith('bitcoincash:') && !lower.startsWith('bitcoincashii:')) {
      throw new Error('Invalid address: wrong prefix (bitcoincash: is BCH, not BC2/BCH2)');
    }
    // Try CashAddr format and convert
    const cashDecoded = decodeCashAddr(address.replace(/^bitcoincashii:/, ''));
    if (cashDecoded) {
      // Only P2PKH (type 0) and P2SH (type 1) are supported
      if (cashDecoded.type !== 0 && cashDecoded.type !== 1) {
        throw new Error('Invalid address: unsupported CashAddr type');
      }
      const versionByte = cashDecoded.type === 1 ? 0x05 : 0x00;
      decoded = Buffer.concat([Buffer.from([versionByte]), cashDecoded.hash]);
    } else {
      throw new Error('Invalid address format');
    }
  }

  const versionByte = decoded[0];

  // Validate version byte: only P2PKH (0x00) and P2SH (0x05) are supported
  if (versionByte !== 0x00 && versionByte !== 0x05) {
    throw new Error('Invalid address: unsupported version byte');
  }

  const hashData = decoded.slice(1); // Remove version byte

  // Validate hash is exactly 20 bytes (P2PKH/P2SH use HASH160)
  if (hashData.length !== 20) {
    throw new Error('Invalid address: unexpected hash length');
  }

  // Create appropriate script based on address version
  let script: Buffer;
  if (versionByte === 0x05) {
    // P2SH: OP_HASH160 <scripthash> OP_EQUAL
    script = Buffer.concat([
      Buffer.from([0xa9, 0x14]),
      hashData,
      Buffer.from([0x87]),
    ]);
  } else {
    // P2PKH: OP_DUP OP_HASH160 <pubkeyhash> OP_EQUALVERIFY OP_CHECKSIG
    script = Buffer.concat([
      Buffer.from([0x76, 0xa9, 0x14]),
      hashData,
      Buffer.from([0x88, 0xac]),
    ]);
  }

  // Single SHA256 and reverse (BC2 Electrum uses single SHA256, not double)
  const hash = crypto.createHash('sha256').update(script).digest();
  return Buffer.from(hash).reverse().toString('hex');
}

// RPC Fallback functions
export function setRpcConfig(host: string, port: number, user: string, password: string): void {
  if (typeof host !== 'string' || host.length === 0 || host.length > 255) {
    throw new Error('Invalid RPC host');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid RPC port');
  }
  if (typeof user !== 'string' || typeof password !== 'string') {
    throw new Error('Invalid RPC credentials');
  }
  rpcConfig = { host, port, user, password };
}

export function enableRpcFallback(enable: boolean): void {
  useRpcFallback = enable;
}

let rpcIdCounter = 0;

async function rpcCall(method: string, params: any[] = []): Promise<any> {
  if (!rpcConfig) {
    throw new Error('RPC not configured');
  }

  const body = JSON.stringify({
    jsonrpc: '1.0',
    id: ++rpcIdCounter,
    method,
    params,
  });

  const auth = Buffer.from(`${rpcConfig.user}:${rpcConfig.password}`).toString('base64');

  // Use HTTPS for RPC to protect auth credentials in transit.
  // Only allow plaintext HTTP for localhost connections.
  const isLocalhost = rpcConfig.host === '127.0.0.1' || rpcConfig.host === 'localhost';
  const protocol = isLocalhost ? 'http' : 'https';
  const response = await fetch(`${protocol}://${rpcConfig.host}:${rpcConfig.port}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`,
    },
    body,
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || 'RPC error');
  }
  return data.result;
}

// RPC-based balance fetch (slower but works without Electrum)
export async function getBalanceByAddressRpc(address: string): Promise<{ confirmed: number; unconfirmed: number }> {
  if (!rpcConfig) {
    throw new Error('RPC not configured');
  }

  const MAX_BALANCE = 21_000_000 * 100_000_000; // 21M coins in sats

  // Import address to wallet (watch-only) and check balance
  // This is a simplified version - full implementation would need address indexing
  try {
    // Try to get balance from wallet
    const result = await rpcCall('getaddressinfo', [address]);
    if (result.ismine || result.iswatchonly) {
      const balance = await rpcCall('getbalance');
      const balSats = typeof balance === 'number' && Number.isFinite(balance) ? Math.max(0, Math.round(balance * 100000000)) : 0;
      if (balSats > MAX_BALANCE) {
        throw new Error('Balance exceeds maximum supply — possible RPC error');
      }
      return { confirmed: balSats, unconfirmed: 0 };
    }
  } catch (e: any) {
    if (e.message?.includes('maximum supply')) throw e;
    // Address not in wallet
  }

  // Fallback: scan UTXOs (requires addressindex)
  try {
    const utxos = await rpcCall('getaddressutxos', [{ addresses: [address] }]);
    if (!Array.isArray(utxos)) throw new Error('Invalid UTXO response from RPC');
    let confirmed = 0;
    for (const utxo of utxos) {
      const sats = typeof utxo.satoshis === 'number' && Number.isFinite(utxo.satoshis) ? Math.max(0, utxo.satoshis) : 0;
      confirmed += sats;
      if (confirmed > MAX_BALANCE) {
        throw new Error('Balance exceeds maximum supply — possible RPC error');
      }
    }
    return { confirmed, unconfirmed: 0 };
  } catch (e) {
    // addressindex not enabled — throw so caller knows balance is unknown
    DEBUG && console.log('RPC balance check failed, addressindex may not be enabled');
    throw new Error('RPC balance check failed: address not indexed');
  }
}

/**
 * Disconnect Electrum clients and clean up resources.
 * Call after airdrop scan or when shutting down.
 */
export function disconnectAll(): void {
  if (mainClient) {
    try { mainClient.close(); } catch {}
    mainClient = undefined;
    mainConnected = false;
  }
  if (bc2Client) {
    try { bc2Client.close(); } catch {}
    bc2Client = undefined;
    bc2Connected = false;
  }
}

export default {
  // BCH2 functions
  getBalanceByAddress,
  getTransactionsByAddress,
  getUtxosByAddress,
  broadcastTransaction,
  getTransaction,
  estimateFee,
  getLatestBlock,
  isConnected,
  getServerName,
  // Scripthash functions (for SegWit bc1 addresses)
  getBalanceByScripthash,
  getUtxosByScripthash,
  getTransactionsByScripthash,
  // BC2 functions (uses explorer API due to Electrum indexing issues)
  getBC2Balance,
  getBC2BalanceByScripthash,
  getBC2Utxos,
  getBC2Transactions,
  broadcastBC2Transaction,
  // RPC fallback
  setRpcConfig,
  enableRpcFallback,
  getBalanceByAddressRpc,
  // Cleanup
  disconnectAll,
};
