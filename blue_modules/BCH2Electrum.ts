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
  { host: 'electrum2.bch2.org', ssl: 50002, tcp: 50001 },
];

// BC2 Electrum servers (for airdrop balance checking)
export const bc2Peers: Peer[] = [
  { host: 'infra1.bitcoin-ii.org', ssl: 50009, tcp: 50008 },
  { host: 'explorer.bitcoin-ii.org', tcp: 50008 },
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
  if (mainConnected) return;

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
      mainClient = new ElectrumClient(
        useSSL ? tls : net,
        useSSL ? peer.ssl : peer.tcp,
        peer.host,
        useSSL ? 'tls' : 'tcp'
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
      if (header && header.height) {
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
  return {
    confirmed: Math.max(0, Math.floor(Number(balance.confirmed) || 0)),
    unconfirmed: Math.floor(Number(balance.unconfirmed) || 0),
  };
}

/**
 * Get balance by scripthash directly (for SegWit addresses)
 * scripthash should be a 64-char hex string (SHA256 of scriptPubKey, reversed)
 */
export async function getBalanceByScripthash(scripthash: string): Promise<{ confirmed: number; unconfirmed: number }> {
  await connectMain();
  const balance = await mainClient.blockchainScripthash_getBalance(scripthash);
  return {
    confirmed: Math.max(0, Math.floor(Number(balance.confirmed) || 0)),
    unconfirmed: Math.floor(Number(balance.unconfirmed) || 0),
  };
}

/**
 * Get UTXOs by scripthash directly (for SegWit addresses)
 */
export async function getUtxosByScripthash(scripthash: string): Promise<any[]> {
  await connectMain();
  const utxos = await mainClient.blockchainScripthash_listunspent(scripthash);
  const seen = new Set<string>();
  return utxos
    .filter((utxo: any) => typeof utxo.value === 'number' && Number.isInteger(utxo.value) && utxo.value > 0)
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
      height: utxo.height,
    }));
}

/**
 * Get transaction history by scripthash (for SegWit addresses)
 */
export async function getTransactionsByScripthash(scripthash: string): Promise<any[]> {
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
  const seen = new Set<string>();
  return utxos
    .filter((utxo: any) => typeof utxo.value === 'number' && Number.isInteger(utxo.value) && utxo.value > 0)
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
      height: utxo.height,
    }));
}

export async function broadcastTransaction(hex: string): Promise<string> {
  await connectMain();
  const result = await mainClient.blockchainTransaction_broadcast(hex);
  // Validate that the server returned a valid txid (64-char hex)
  if (typeof result !== 'string' || !/^[a-fA-F0-9]{64}$/.test(result.trim())) {
    throw new Error(`Broadcast failed: ${String(result).substring(0, 200)}`);
  }
  return result.trim();
}

export async function getTransaction(txid: string): Promise<any> {
  await connectMain();
  return mainClient.blockchainTransaction_get(txid, true);
}

/**
 * Estimate fee in sat/byte.
 * Electrum returns BTC/kB; we convert to sat/byte (1 BTC/kB = 100000 sat/kB = 100 sat/byte).
 */
export async function estimateFee(blocks: number = 6): Promise<number> {
  await connectMain();
  const feePerKB = await mainClient.blockchainEstimatefee(blocks);
  if (feePerKB > 0) {
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
      versionExtracted = true;
    }

    while (versionExtracted && bits >= 8) {
      bits -= 8;
      hashBytes.push((acc >> bits) & 0xff);
    }
  }

  // CashAddr spec: padding bits must be zero
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) return null;

  const type = versionByte >> 3;
  const encodedSize = versionByte & 0x07;
  const expectedSizes = [20, 24, 28, 32, 40, 48, 56, 64];
  const expectedSize = expectedSizes[encodedSize] || 20;

  return {
    type,
    hash: Buffer.from(hashBytes.slice(0, expectedSize)),
  };
}

// BC2 connection for airdrop balance checking
let bc2ConnectingPromise: Promise<void> | null = null;

async function connectBC2(): Promise<void> {
  if (bc2Connected) return;
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
        peer.ssl ? tls : net,
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
  try {
    // Use explorer API as primary method (more reliable than Electrum)
    const response = await fetch(`https://explorer.bitcoin-ii.org/api/address/${encodeURIComponent(address)}`);
    if (!response.ok) {
      throw new Error(`Explorer API error: ${response.status}`);
    }
    const data = await response.json();

    // chain_stats contains confirmed, mempool_stats contains unconfirmed
    const confirmed = (data.chain_stats?.funded_txo_sum ?? 0) - (data.chain_stats?.spent_txo_sum ?? 0);
    const unconfirmed = (data.mempool_stats?.funded_txo_sum ?? 0) - (data.mempool_stats?.spent_txo_sum ?? 0);

    return { confirmed, unconfirmed };
  } catch (apiError) {
    DEBUG && console.log('BC2 Explorer API failed, falling back to Electrum:', apiError);

    // Fallback to Electrum (may not work due to indexing issues)
    try {
      await connectBC2();
      const script = addressToScriptHashLegacy(address);
      const balance = await bc2Client.blockchainScripthash_getBalance(script);
      const confirmed = typeof balance.confirmed === 'number' && Number.isFinite(balance.confirmed) ? balance.confirmed : 0;
      const unconfirmed = typeof balance.unconfirmed === 'number' && Number.isFinite(balance.unconfirmed) ? balance.unconfirmed : 0;
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
  try {
    await connectBC2();
    const balance = await bc2Client.blockchainScripthash_getBalance(scripthash);
    return {
      confirmed: typeof balance.confirmed === 'number' && Number.isFinite(balance.confirmed) ? balance.confirmed : 0,
      unconfirmed: typeof balance.unconfirmed === 'number' && Number.isFinite(balance.unconfirmed) ? balance.unconfirmed : 0,
    };
  } catch (e) {
    DEBUG && console.log('BC2 scripthash balance check failed:', e);
    throw new Error('BC2 scripthash balance check failed: Electrum unavailable');
  }
}

// Get BC2 UTXOs using explorer API
export async function getBC2Utxos(address: string): Promise<any[]> {
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
    DEBUG && console.log(`[BC2] Explorer API returned ${utxos.length} UTXOs`);
    if (utxos.length > 0) {
      DEBUG && console.log(`[BC2] First UTXO:`, JSON.stringify(utxos[0]));
    }

    const seen = new Set<string>();
    return utxos
      .filter((utxo: any) => typeof utxo.value === 'number' && Number.isInteger(utxo.value) && utxo.value > 0)
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
        height: utxo.status?.block_height || 0,
      }));
  } catch (apiError) {
    DEBUG && console.log('[BC2] Explorer API failed, falling back to Electrum:', apiError);

    // Fallback to Electrum
    try {
      await connectBC2();
      const script = addressToScriptHashLegacy(address);
      const utxos = await bc2Client.blockchainScripthash_listunspent(script);
      const seen2 = new Set<string>();
      return utxos
        .filter((utxo: any) => typeof utxo.value === 'number' && Number.isInteger(utxo.value) && utxo.value > 0)
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
          height: utxo.height,
        }));
    } catch (electrumError) {
      DEBUG && console.log('BC2 Electrum also failed:', electrumError);
      return [];
    }
  }
}

// Get BC2 transaction history using explorer API
export async function getBC2Transactions(address: string): Promise<any[]> {
  try {
    const response = await fetch(`https://explorer.bitcoin-ii.org/api/address/${encodeURIComponent(address)}/txs`);
    if (!response.ok) {
      throw new Error(`Explorer API error: ${response.status}`);
    }
    const txs = await response.json();

    return (Array.isArray(txs) ? txs.slice(0, 500) : []).map((tx: any) => ({
      tx_hash: tx.txid,
      height: tx.status?.block_height || 0,
      confirmed: tx.status?.confirmed || false,
    }));
  } catch (apiError) {
    DEBUG && console.log('BC2 Explorer API failed:', apiError);
    return [];
  }
}

// Broadcast BC2 transaction using explorer API
export async function broadcastBC2Transaction(hex: string): Promise<string> {
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
      throw new Error(`Broadcast failed: ${apiError.message}. Electrum: ${electrumError.message}`);
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
  } catch (e) {
    // Try CashAddr format and convert
    const cashDecoded = decodeCashAddr(address.replace(/^bitcoincash(ii)?:/, ''));
    if (cashDecoded) {
      // type 0 = P2PKH (version 0x00), type 1 = P2SH (version 0x05)
      const versionByte = cashDecoded.type === 1 ? 0x05 : 0x00;
      decoded = Buffer.concat([Buffer.from([versionByte]), cashDecoded.hash]);
    } else {
      throw new Error('Invalid address format');
    }
  }

  const versionByte = decoded[0];
  const hashData = decoded.slice(1); // Remove version byte

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
  rpcConfig = { host, port, user, password };
}

export function enableRpcFallback(enable: boolean): void {
  useRpcFallback = enable;
}

async function rpcCall(method: string, params: any[] = []): Promise<any> {
  if (!rpcConfig) {
    throw new Error('RPC not configured');
  }

  const body = JSON.stringify({
    jsonrpc: '1.0',
    id: Date.now(),
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

  // Import address to wallet (watch-only) and check balance
  // This is a simplified version - full implementation would need address indexing
  try {
    // Try to get balance from wallet
    const result = await rpcCall('getaddressinfo', [address]);
    if (result.ismine || result.iswatchonly) {
      const balance = await rpcCall('getbalance');
      return { confirmed: Math.round(balance * 100000000), unconfirmed: 0 };
    }
  } catch (e) {
    // Address not in wallet
  }

  // Fallback: scan UTXOs (requires addressindex)
  try {
    const utxos = await rpcCall('getaddressutxos', [{ addresses: [address] }]);
    let confirmed = 0;
    for (const utxo of utxos) {
      confirmed += utxo.satoshis;
    }
    return { confirmed, unconfirmed: 0 };
  } catch (e) {
    // addressindex not enabled
    DEBUG && console.log('RPC balance check failed, addressindex may not be enabled');
    return { confirmed: 0, unconfirmed: 0 };
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
};
