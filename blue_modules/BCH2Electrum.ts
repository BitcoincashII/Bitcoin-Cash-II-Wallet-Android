/**
 * BCH2 Electrum Module
 * Handles connections to BCH2 Electrum servers (Fulcrum)
 * Falls back to direct RPC if Electrum unavailable
 */

import DefaultPreference from 'react-native-default-preference';

const ElectrumClient = require('electrum-client');
const net = require('net');
const tls = require('tls');

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
// TCP first as fallback since SSL uses self-signed cert which may fail on some devices
const defaultPeer: Peer = { host: 'electrum.bch2.org', tcp: 50001, ssl: 50002 };
export const hardcodedPeers: Peer[] = [
  { host: 'electrum.bch2.org', tcp: 50001, ssl: 50002 },
  { host: 'electrum2.bch2.org', tcp: 50001, ssl: 50002 },
];

// BC2 Electrum servers (for airdrop balance checking)
export const bc2Peers: Peer[] = [
  { host: 'infra1.bitcoin-ii.org', ssl: 50009, tcp: 50008 },
  { host: 'explorer.bitcoin-ii.org', tcp: 5008 },
];

let mainClient: typeof ElectrumClient | undefined;
let mainConnected: boolean = false;
let serverName: string | false = false;
let currentPeerIndex = 0;
let latestBlock: { height: number; time: number } | { height: undefined; time: undefined } = { height: undefined, time: undefined };

// BC2 client for airdrop balance checking
let bc2Client: typeof ElectrumClient | undefined;
let bc2Connected: boolean = false;
let bc2PeerIndex = 0;

async function connectMain(): Promise<void> {
  if (mainConnected) return;

  const peer = hardcodedPeers[currentPeerIndex];
  currentPeerIndex = (currentPeerIndex + 1) % hardcodedPeers.length;

  try {
    // Prefer TCP over SSL since BCH2 Electrum uses self-signed certs
    const useSSL = !peer.tcp && peer.ssl;
    mainClient = new ElectrumClient(
      useSSL ? tls : net,
      peer.tcp || peer.ssl,
      peer.host,
      useSSL ? 'tls' : 'tcp'
    );

    mainClient.onError = (e: Error) => {
      console.log('BCH2 Electrum error:', e.message);
      mainConnected = false;
    };

    await mainClient.initElectrum({ client: 'bluewallet-bch2', version: '1.4' });
    mainConnected = true;
    serverName = peer.host;
    console.log('Connected to BCH2 Electrum:', peer.host);

    // Subscribe to headers
    const header = await mainClient.blockchainHeaders_subscribe();
    if (header && header.height) {
      latestBlock = { height: header.height, time: Math.floor(Date.now() / 1000) };
    }
  } catch (e) {
    console.log('BCH2 Electrum connection failed:', e);
    mainConnected = false;
    throw e;
  }
}

export async function getBalanceByAddress(address: string): Promise<{ confirmed: number; unconfirmed: number }> {
  await connectMain();
  const script = addressToScriptHash(address);
  const balance = await mainClient.blockchainScripthash_getBalance(script);
  return {
    confirmed: balance.confirmed,
    unconfirmed: balance.unconfirmed,
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
    confirmed: balance.confirmed,
    unconfirmed: balance.unconfirmed,
  };
}

/**
 * Get UTXOs by scripthash directly (for SegWit addresses)
 */
export async function getUtxosByScripthash(scripthash: string): Promise<any[]> {
  await connectMain();
  const utxos = await mainClient.blockchainScripthash_listunspent(scripthash);
  return utxos.map((utxo: any) => ({
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
  return history;
}

export async function getTransactionsByAddress(address: string): Promise<any[]> {
  await connectMain();
  const script = addressToScriptHash(address);
  const history = await mainClient.blockchainScripthash_getHistory(script);
  return history;
}

export async function getUtxosByAddress(address: string): Promise<any[]> {
  await connectMain();
  const script = addressToScriptHash(address);
  const utxos = await mainClient.blockchainScripthash_listunspent(script);
  return utxos.map((utxo: any) => ({
    txid: utxo.tx_hash,
    vout: utxo.tx_pos,
    value: utxo.value,
    height: utxo.height,
  }));
}

export async function broadcastTransaction(hex: string): Promise<string> {
  await connectMain();
  return mainClient.blockchainTransaction_broadcast(hex);
}

export async function getTransaction(txid: string): Promise<any> {
  await connectMain();
  return mainClient.blockchainTransaction_get(txid, true);
}

export async function estimateFee(blocks: number = 6): Promise<number> {
  await connectMain();
  const fee = await mainClient.blockchainEstimatefee(blocks);
  return fee > 0 ? fee : 0.00001; // Default 1 sat/byte if estimation fails
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
  // Remove prefix if present
  let addr = address;
  const prefixes = ['bitcoincashii:', 'bitcoincash:', 'bchtest:'];
  for (const prefix of prefixes) {
    if (address.toLowerCase().startsWith(prefix)) {
      addr = address.slice(prefix.length);
      break;
    }
  }

  // Decode CashAddr and convert to scripthash
  const decoded = decodeCashAddr(addr);
  if (!decoded) {
    throw new Error('Invalid BCH2 address');
  }

  // Create P2PKH script: OP_DUP OP_HASH160 <pubkeyhash> OP_EQUALVERIFY OP_CHECKSIG
  const script = Buffer.concat([
    Buffer.from([0x76, 0xa9, 0x14]), // OP_DUP OP_HASH160 PUSH20
    decoded.hash,
    Buffer.from([0x88, 0xac]), // OP_EQUALVERIFY OP_CHECKSIG
  ]);

  // Double SHA256 and reverse
  const crypto = require('crypto');
  const hash1 = crypto.createHash('sha256').update(script).digest();
  const hash2 = crypto.createHash('sha256').update(hash1).digest();
  return Buffer.from(hash2).reverse().toString('hex');
}

// CashAddr decoder
function decodeCashAddr(addr: string): { type: number; hash: Buffer } | null {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

  let data: number[] = [];
  for (const char of addr.toLowerCase()) {
    const idx = CHARSET.indexOf(char);
    if (idx === -1) return null;
    data.push(idx);
  }

  if (data.length < 8) return null;

  // Remove checksum
  data = data.slice(0, -8);

  // Convert from 5-bit to 8-bit
  let acc = 0;
  let bits = 0;
  const result: number[] = [];

  for (const value of data) {
    acc = (acc << 5) | value;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      result.push((acc >> bits) & 0xff);
    }
  }

  if (result.length < 21) return null;

  return {
    type: result[0] & 0x0f,
    hash: Buffer.from(result.slice(1, 21)),
  };
}

// BC2 connection for airdrop balance checking
async function connectBC2(): Promise<void> {
  if (bc2Connected) return;

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
      console.log('BC2 Electrum error:', e.message);
      bc2Connected = false;
    };

    await bc2Client.initElectrum({ client: 'bluewallet-bch2', version: '1.4' });
    bc2Connected = true;
    console.log('Connected to BC2 Electrum:', peer.host);
  } catch (e) {
    console.log('BC2 Electrum connection failed:', e);
    bc2Connected = false;
    throw e;
  }
}

// Get BC2 balance using explorer API (Electrum server has indexing issues)
export async function getBC2Balance(address: string): Promise<{ confirmed: number; unconfirmed: number }> {
  try {
    // Use explorer API as primary method (more reliable than Electrum)
    const response = await fetch(`https://explorer.bitcoin-ii.org/api/address/${address}`);
    if (!response.ok) {
      throw new Error(`Explorer API error: ${response.status}`);
    }
    const data = await response.json();

    // chain_stats contains confirmed, mempool_stats contains unconfirmed
    const confirmed = data.chain_stats?.funded_txo_sum - data.chain_stats?.spent_txo_sum || 0;
    const unconfirmed = data.mempool_stats?.funded_txo_sum - data.mempool_stats?.spent_txo_sum || 0;

    return { confirmed, unconfirmed };
  } catch (apiError) {
    console.log('BC2 Explorer API failed, falling back to Electrum:', apiError);

    // Fallback to Electrum (may not work due to indexing issues)
    try {
      await connectBC2();
      const script = addressToScriptHashLegacy(address);
      const balance = await bc2Client.blockchainScripthash_getBalance(script);
      return {
        confirmed: balance.confirmed,
        unconfirmed: balance.unconfirmed,
      };
    } catch (electrumError) {
      console.log('BC2 Electrum also failed:', electrumError);
      return { confirmed: 0, unconfirmed: 0 };
    }
  }
}

// Get BC2 balance by scripthash (for bc1 addresses)
export async function getBC2BalanceByScripthash(scripthash: string): Promise<{ confirmed: number; unconfirmed: number }> {
  try {
    await connectBC2();
    const balance = await bc2Client.blockchainScripthash_getBalance(scripthash);
    return {
      confirmed: balance.confirmed,
      unconfirmed: balance.unconfirmed,
    };
  } catch (e) {
    console.log('BC2 scripthash balance check failed:', e);
    return { confirmed: 0, unconfirmed: 0 };
  }
}

// Get BC2 UTXOs using explorer API
export async function getBC2Utxos(address: string): Promise<any[]> {
  console.log(`[BC2] Fetching UTXOs for address: ${address}`);
  try {
    // Use explorer API as primary method
    const url = `https://explorer.bitcoin-ii.org/api/address/${address}/utxo`;
    console.log(`[BC2] Explorer API URL: ${url}`);
    const response = await fetch(url);
    console.log(`[BC2] Explorer API response status: ${response.status}`);
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`[BC2] Explorer API error response: ${errorText}`);
      throw new Error(`Explorer API error: ${response.status} - ${errorText}`);
    }
    const utxos = await response.json();
    console.log(`[BC2] Explorer API returned ${utxos.length} UTXOs`);
    if (utxos.length > 0) {
      console.log(`[BC2] First UTXO:`, JSON.stringify(utxos[0]));
    }

    return utxos.map((utxo: any) => ({
      txid: utxo.txid,
      vout: utxo.vout,
      value: utxo.value,
      height: utxo.status?.block_height || 0,
    }));
  } catch (apiError) {
    console.log('[BC2] Explorer API failed, falling back to Electrum:', apiError);

    // Fallback to Electrum
    try {
      await connectBC2();
      const script = addressToScriptHashLegacy(address);
      const utxos = await bc2Client.blockchainScripthash_listunspent(script);
      return utxos.map((utxo: any) => ({
        txid: utxo.tx_hash,
        vout: utxo.tx_pos,
        value: utxo.value,
        height: utxo.height,
      }));
    } catch (electrumError) {
      console.log('BC2 Electrum also failed:', electrumError);
      return [];
    }
  }
}

// Get BC2 transaction history using explorer API
export async function getBC2Transactions(address: string): Promise<any[]> {
  try {
    const response = await fetch(`https://explorer.bitcoin-ii.org/api/address/${address}/txs`);
    if (!response.ok) {
      throw new Error(`Explorer API error: ${response.status}`);
    }
    const txs = await response.json();

    return txs.map((tx: any) => ({
      tx_hash: tx.txid,
      height: tx.status?.block_height || 0,
      confirmed: tx.status?.confirmed || false,
    }));
  } catch (apiError) {
    console.log('BC2 Explorer API failed:', apiError);
    return [];
  }
}

// Broadcast BC2 transaction using explorer API
export async function broadcastBC2Transaction(hex: string): Promise<string> {
  console.log(`[BC2] Broadcasting transaction, hex length: ${hex.length}`);
  console.log(`[BC2] Transaction hex: ${hex.substring(0, 100)}...`);

  try {
    const response = await fetch('https://explorer.bitcoin-ii.org/api/tx', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: hex,
    });

    const responseText = await response.text();
    console.log(`[BC2] Broadcast response status: ${response.status}`);
    console.log(`[BC2] Broadcast response: ${responseText}`);

    if (!response.ok) {
      throw new Error(`Broadcast failed: ${responseText}`);
    }

    // Validate that response looks like a txid (64 hex chars)
    if (!/^[a-fA-F0-9]{64}$/.test(responseText.trim())) {
      console.log(`[BC2] WARNING: Response does not look like a txid: ${responseText}`);
      throw new Error(`Broadcast may have failed: ${responseText}`);
    }

    return responseText.trim();
  } catch (apiError: any) {
    console.log('[BC2] Explorer broadcast failed:', apiError.message);

    // Fallback to Electrum
    console.log('[BC2] Trying Electrum fallback...');
    try {
      await connectBC2();
      const txid = await bc2Client.blockchainTransaction_broadcast(hex);
      console.log(`[BC2] Electrum broadcast result: ${txid}`);
      return txid;
    } catch (electrumError: any) {
      console.log('[BC2] Electrum broadcast also failed:', electrumError.message);
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
      decoded = Buffer.concat([Buffer.from([0x00]), cashDecoded.hash]);
    } else {
      throw new Error('Invalid address format');
    }
  }

  // Create P2PKH script
  const pubkeyHash = decoded.slice(1); // Remove version byte
  const script = Buffer.concat([
    Buffer.from([0x76, 0xa9, 0x14]), // OP_DUP OP_HASH160 PUSH20
    pubkeyHash,
    Buffer.from([0x88, 0xac]), // OP_EQUALVERIFY OP_CHECKSIG
  ]);

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

  const response = await fetch(`http://${rpcConfig.host}:${rpcConfig.port}/`, {
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
      return { confirmed: Math.floor(balance * 100000000), unconfirmed: 0 };
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
    console.log('RPC balance check failed, addressindex may not be enabled');
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
