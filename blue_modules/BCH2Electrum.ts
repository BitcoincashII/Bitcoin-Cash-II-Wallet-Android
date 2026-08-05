/**
 * BCH2 Electrum Module
 * Handles connections to BCH2 Electrum servers (Fulcrum)
 * Falls back to direct RPC if Electrum unavailable
 */

import DefaultPreference from 'react-native-default-preference';
import { sha256 } from '@noble/hashes/sha256';
import { BC2_EXPLORER_URL } from '../class/bch2-constants';

const ElectrumClient = require('electrum-client');
const net = require('net');
const tls = require('tls');

const DEBUG = __DEV__ || false;

// ---------------------------------------------------------------------------
// TLS certificate pinning (SPKI SHA-256, base64).
//
// react-native-tcp-socket validates the certificate chain but does NOT perform
// hostname verification, so chain validation alone is MITM-able by anyone
// holding any CA-issued cert. We therefore pin in JS after the handshake and
// fail the connection closed on mismatch.
//
// Two pin materials, because getPeerCertificate() exposes different fields by
// OS version:
//  - `pubkey` (base64 SPKI DER) is ONLY populated on API >= 26; the SPKI pin is
//    base64(sha256(SPKI DER)). Renewal-resilient when the key is reused.
//  - `fingerprint256` (full-cert SHA-256, colon hex) is populated on ALL API
//    levels (incl. Android 7.0/7.1 = API 24/25, our minSdk). Full-cert pin —
//    changes on every cert renewal.
// A connection is trusted if EITHER the SPKI pin OR the cert fingerprint
// matches its pinned set, so pinning works on every supported OS.
//
// electrum.bch2.org uses a Let's Encrypt cert whose key+cert rotate on renewal —
// BOTH pins MUST be refreshed each app release (or LE key-reuse enabled server
// side). bc2electrum uses a long-lived self-signed cert (stable). Keep the hex
// mirror in android/app/src/main/java/org/bch2/wallet/ElectrumClient.kt in sync.
const PINNED_SPKI_SHA256: Record<'bch2' | 'bc2', string[]> = {
  bch2: ['FIBCDUGPgBvYIAoNlVmEzwjvk2SW6yDE0bVGOtgs5as='], // electrum.bch2.org (RSA LE, reuse_key → stable SPKI)
  bc2: ['7RZ1HtI370pp2Re06xJ0W1/QGupIq+X94GdRzPY7aT4='],  // bc2electrum (self-signed, 10y)
};
// Full-certificate SHA-256 (lowercase hex, no colons) — the API<26 fallback.
const PINNED_CERT_SHA256: Record<'bch2' | 'bc2', string[]> = {
  bch2: ['622849af0ced546f3ab24870eda5d63e36df7f302892b1cb36a89a73228a8fc6'],
  bc2: ['64660131e5ad82b54c6c88b8131c8931283b197a382fc08c698c73ddc3d58c61'],
};

function b64FromBytes(bytes: Uint8Array): string {
  // RN has global btoa; fall back to a manual encoder if absent.
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  if (typeof btoa === 'function') return btoa(binary);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : NaN;
    const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : NaN;
    out += chars[a >> 2];
    out += chars[((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4)];
    out += isNaN(b) ? '=' : chars[((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6)];
    out += isNaN(c) ? '=' : chars[c & 63];
  }
  return out;
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = typeof atob === 'function'
    ? atob(b64)
    : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Verify the pinned SPKI of an already-connected TLS Electrum client.
 * Throws (fail-closed) if the peer's public key is not in the pinned set.
 * `client.conn` is the react-native-tcp-socket TLSSocket created by
 * electrum-client; getPeerCertificate() resolves after the handshake.
 */
async function verifyPinnedSpki(client: any, serverType: 'bch2' | 'bc2', host: string): Promise<void> {
  const conn = client?.conn;
  if (!conn || typeof conn.getPeerCertificate !== 'function') {
    throw new Error(`Cannot read peer certificate for ${host} — refusing to trust connection`);
  }
  const cert = await conn.getPeerCertificate();

  // Preferred: SPKI pin (API >= 26, where getPeerCertificate exposes `pubkey`).
  const pubkeyB64: string | undefined = cert && cert.pubkey;
  if (pubkeyB64) {
    const spkiPin = b64FromBytes(sha256(b64ToBytes(pubkeyB64)));
    if (PINNED_SPKI_SHA256[serverType].includes(spkiPin)) return;
  }

  // Fallback (works on all API levels, incl. 24/25 where `pubkey` is absent):
  // full-certificate SHA-256 fingerprint.
  const fp: string | undefined = cert && cert.fingerprint256;
  if (fp) {
    const fpNorm = fp.replace(/:/g, '').toLowerCase();
    if (PINNED_CERT_SHA256[serverType].includes(fpNorm)) return;
  }

  if (!pubkeyB64 && !fp) {
    throw new Error(`No peer certificate fingerprint for ${host} — refusing to trust connection`);
  }
  throw new Error(`Certificate pin mismatch for ${host} — possible MITM, connection refused`);
}

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
  { host: '144.202.73.66', ssl: 50002, tcp: 50001 },  // IP fallback if DNS fails
];

// BC2 Electrum servers (for airdrop balance checking) — Dallas server
export const bc2Peers: Peer[] = [
  { host: 'bc2electrum.bch2.org', ssl: 50011, tcp: 50010 },
  { host: '144.202.73.66', ssl: 50011, tcp: 50010 },  // IP fallback if DNS fails
];

// Map a known host to its pinned server type (for the settings test button).
const BCH2_HOSTS = new Set(['electrum.bch2.org']);
const BC2_HOSTS = new Set(['bc2electrum.bch2.org']);

/**
 * For the settings connection-test: if the host is a known BCH2/BC2 server,
 * enforce its SPKI pin (fail-closed) so a "Success" dialog means the genuine
 * server. For arbitrary user hosts we can't pin, so this is a no-op and the
 * test reports reachability only. `client.conn` must be a connected TLSSocket.
 */
export async function verifyKnownHostPin(client: any, host: string): Promise<void> {
  if (BCH2_HOSTS.has(host)) return verifyPinnedSpki(client, 'bch2', host);
  if (BC2_HOSTS.has(host)) return verifyPinnedSpki(client, 'bc2', host);
}

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

  // Prevent concurrent connection attempts — return the in-flight attempt BEFORE any stale-client teardown, else a
  // concurrent caller (e.g. the wallet-list Promise.all) closes the actively-connecting socket out from under the
  // first caller mid-handshake (round-5 LOW).
  if (connectingPromise) return connectingPromise;

  // No attempt in flight: clear any stale (disconnected) client, then connect fresh.
  if (!mainConnected && mainClient) {
    try { mainClient.close(); } catch {}
    mainClient = undefined;
  }

  connectingPromise = _doConnectMain();
  try {
    await connectingPromise;
  } finally {
    connectingPromise = null;
  }
}

async function _doConnectMain(): Promise<void> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const peer = hardcodedPeers[currentPeerIndex];
    currentPeerIndex = (currentPeerIndex + 1) % hardcodedPeers.length;

    // TLS only — no plaintext TCP fallback. A silent downgrade to cleartext is a
    // MITM vector (an attacker who blocks :50002 could otherwise force :50001).
    if (!peer.ssl) continue;
    const protocols: Array<{ port: number; proto: string; opts?: object }> = [
      { port: peer.ssl, proto: 'tls', opts: { rejectUnauthorized: true } },
    ];

    for (const { port, proto, opts } of protocols) {
      try {
        mainClient = new ElectrumClient(net, tls, port, peer.host, proto, opts);

        mainClient.onError = (e: Error) => {
          mainConnected = false;
        };

        mainClient.onClose = () => {
          mainConnected = false;
          DEBUG && console.log('[BCH2Electrum] Connection closed, will reconnect on next request');
        };

        await Promise.race([
          mainClient.initElectrum({ client: 'bluewallet-bch2', version: '1.4' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 10000)),
        ]);
        // Fail closed unless the server presents a pinned public key.
        await verifyPinnedSpki(mainClient, 'bch2', peer.host);
        mainConnected = true;
        serverName = peer.host;

        // Subscribe to headers
        const header = await mainClient.blockchainHeaders_subscribe();
        if (header && typeof header.height === 'number' && Number.isInteger(header.height) && header.height >= 0) {
          latestBlock = { height: header.height, time: Math.floor(Date.now() / 1000) };
        }
        return; // Success
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        mainConnected = false;
        try { mainClient?.close(); } catch {}
        DEBUG && console.log(`[BCH2Electrum] ${proto}://${peer.host}:${port} failed:`, lastError.message);
      }
    }

    // Delay before trying next peer
    if (attempt < MAX_RETRIES - 1) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError || new Error('Failed to connect to any Electrum server');
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
// Electrum blockchain.scripthash.get_history returns confirmed txs OLDEST-first (mempool, height<=0, appended
// last). Sort NEWEST-first (mempool first, then confirmed by descending height) and keep the newest 500, so a
// reused address with >500 txs retains the most recent activity (and the newest gets SPV-verified / rendered
// first) rather than dropping it (round-5 MED).
function newestFirst(history: any): any[] {
  if (!Array.isArray(history)) return [];
  const rank = (h: any) => (typeof h?.height === 'number' && h.height > 0 ? h.height : Number.MAX_SAFE_INTEGER);
  return history.slice().sort((a, b) => rank(b) - rank(a)).slice(0, 500);
}

export async function getTransactionsByScripthash(scripthash: string): Promise<any[]> {
  if (typeof scripthash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(scripthash)) {
    throw new Error('Invalid scripthash: expected 64-char hex string');
  }
  await connectMain();
  return newestFirst(await mainClient.blockchainScripthash_getHistory(scripthash));
}

export async function getTransactionsByAddress(address: string): Promise<any[]> {
  await connectMain();
  const script = addressToScriptHash(address);
  return newestFirst(await mainClient.blockchainScripthash_getHistory(script));
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
  // We can compute the exact txid of the tx we signed, so a broadcast is a REAL failure only
  // if the node has NOT accepted that txid. This prevents a false "failed" when the node
  // actually took the tx but our response was lost, or a reconnect re-sent it and the node
  // answered "already in mempool" — both leave the tx on-chain (observed: a MAX send that
  // confirmed while the app showed "Failed to broadcast").
  let expectedTxid: string | null = null;
  try { expectedTxid = computeTxid(hex); } catch { /* unparseable — fall back to server txid */ }

  let result: any;
  try {
    result = await mainClient.blockchainTransaction_broadcast(hex);
  } catch (e: any) {
    // The call rejected (timeout/disconnect/"already known"). If the node already has our
    // txid, the broadcast actually SUCCEEDED — return it instead of a false failure.
    if (expectedTxid && (await nodeHasTx(expectedTxid))) return expectedTxid;
    throw e;
  }

  const txid = typeof result === 'string' ? result.trim() : '';
  if (!/^[a-fA-F0-9]{64}$/.test(txid)) {
    // Non-txid response (server error string) — the tx may still have landed; verify by txid.
    if (expectedTxid && (await nodeHasTx(expectedTxid))) return expectedTxid;
    throw new Error(`Broadcast failed: ${String(result).substring(0, 200)}`);
  }
  // A server that drops the tx and echoes a bogus/other id is caught here rather than
  // showing a false "sent". BCH2 txs are legacy-serialized, so this is a plain double-SHA256.
  if (expectedTxid && txid.toLowerCase() !== expectedTxid.toLowerCase()) {
    throw new Error(`Broadcast returned a txid that does not match the signed transaction — refusing to trust it`);
  }
  return expectedTxid || txid;
}

// Does the node already know this txid (mempool or confirmed)? Distinguishes a real broadcast
// failure from a lost/duplicate response for a tx that actually landed.
async function nodeHasTx(txid: string): Promise<boolean> {
  try {
    await connectMain();
    const t = await mainClient.blockchainTransaction_get(txid, false);
    return typeof t === 'string' ? t.length > 0 : !!t;
  } catch {
    return false;
  }
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

// ── SPV support (bch2-spv.ts): merkle proof + batch headers ───────────────────────────────────────────────────
/** blockchain.transaction.get_merkle — the Merkle inclusion proof for a confirmed tx at `height`. */
export async function getMerkleProof(txid: string, height: number): Promise<{ block_height: number; merkle: string[]; pos: number }> {
  if (typeof txid !== 'string' || !/^[0-9a-fA-F]{64}$/.test(txid)) throw new Error('Invalid txid');
  if (!Number.isInteger(height) || height < 0) throw new Error('Invalid height');
  await connectMain();
  return mainClient.blockchainTransaction_getMerkle(txid, height);
}

/** blockchain.block.headers — a batch of raw 80-byte headers as hex. Uses request() directly because the vendored
 *  electrum-client's blockchainBlock_headers wrapper sends a typo'd method name ('blockchain.block.headeres'). */
export async function getBlockHeaders(startHeight: number, count: number): Promise<{ count: number; hex: string; max: number }> {
  if (!Number.isInteger(startHeight) || startHeight < 0) throw new Error('Invalid start height');
  if (!Number.isInteger(count) || count < 1 || count > 2016) throw new Error('Invalid header count');
  await connectMain();
  return mainClient.request('blockchain.block.headers', [startHeight, count]);
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
 *
 * This uses the BCH2 chain height (latestBlock) and BCH2 raw-tx lookups
 * (isCoinbaseTx via mainClient), so it is only valid for BCH2 UTXOs. For BC2
 * we have no BC2 height/raw-tx tracking, and applying BCH2 data to BC2 UTXOs
 * would mis-classify them; instead we skip the client-side filter for BC2 —
 * the BC2 node still rejects any premature-coinbase spend at broadcast, so this
 * cannot cause an invalid spend (ordinary user UTXOs are not coinbase; note BC2
 * DOES have SegWit/Taproot, so BC2 UTXOs may be P2WPKH/P2TR, not only P2PKH).
 */
export async function filterMatureUtxos(utxos: any[], isBC2: boolean = false): Promise<any[]> {
  if (isBC2) return utxos; // BC2 maturity is enforced by the BC2 node at broadcast
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

/**
 * Fetch a FRESH tip height (re-subscribe). latestBlock is captured once at connect and connectMain() short-circuits
 * while the socket is alive, so getLatestBlock() can be stale for a long-running session — SPV needs the current
 * tip so a tx confirmed after connect isn't mis-flagged. Falls back to the cached height on error.
 */
export async function getTipHeight(): Promise<number> {
  try {
    await connectMain();
    const header = await mainClient.blockchainHeaders_subscribe();
    if (header && typeof header.height === 'number' && Number.isInteger(header.height) && header.height >= 0) {
      latestBlock = { height: header.height, time: Math.floor(Date.now() / 1000) };
      return header.height;
    }
  } catch { /* fall back to cached */ }
  return latestBlock.height || 0;
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
  // Return an in-flight attempt BEFORE tearing down a stale client (round-5 LOW: else a concurrent caller closes
  // the actively-connecting socket out from under the first).
  if (bc2ConnectingPromise) return bc2ConnectingPromise;
  // Clear stale client on disconnect (same pattern as connectMain)
  if (!bc2Connected && bc2Client) {
    try { bc2Client.close(); } catch {}
    bc2Client = undefined;
  }

  bc2ConnectingPromise = _doConnectBC2();
  try {
    await bc2ConnectingPromise;
  } finally {
    bc2ConnectingPromise = null;
  }
}

async function _doConnectBC2(): Promise<void> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const peer = bc2Peers[bc2PeerIndex];
    bc2PeerIndex = (bc2PeerIndex + 1) % bc2Peers.length;

    // TLS only — no plaintext TCP fallback (see connectMain). BC2 uses a stable
    // self-signed cert, so chain validation would fail; the SPKI pin below IS
    // the trust anchor. rejectUnauthorized:false lets the handshake complete;
    // verifyPinnedSpki then fails closed unless the pinned key is presented.
    if (!peer.ssl) continue;
    const protocols: Array<{ port: number; proto: string; opts?: object }> = [
      { port: peer.ssl, proto: 'tls', opts: { rejectUnauthorized: false } },
    ];

    for (const { port, proto, opts } of protocols) {
      try {
        bc2Client = new ElectrumClient(net, tls, port, peer.host, proto, opts);

        bc2Client.onError = (e: Error) => {
          bc2Connected = false;
        };
        bc2Client.onClose = () => {
          bc2Connected = false;
        };

        await Promise.race([
          bc2Client.initElectrum({ client: 'bluewallet-bch2', version: '1.4' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('BC2 connection timeout')), 10000)),
        ]);
        await verifyPinnedSpki(bc2Client, 'bc2', peer.host);
        bc2Connected = true;
        return; // Success
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        bc2Connected = false;
        try { bc2Client?.close(); } catch {}
        DEBUG && console.log(`[BCH2Electrum] BC2 ${proto}://${peer.host}:${port} failed:`, lastError.message);
      }
    }

    // Delay before trying next peer
    if (attempt < MAX_RETRIES - 1) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError || new Error('Failed to connect to any BC2 Electrum server');
}

// Get BC2 balance using explorer API (Electrum server has indexing issues)
export async function getBC2Balance(address: string): Promise<{ confirmed: number; unconfirmed: number }> {
  if (typeof address !== 'string' || address.length === 0 || address.length > 150) {
    throw new Error('Invalid BC2 address');
  }
  try {
    // Use explorer API as primary method (more reliable than Electrum)
    const response = await fetch(`${BC2_EXPLORER_URL}/api/address/${encodeURIComponent(address)}`);
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

/**
 * BC2 address info for HD gap-limit scanning: balance PLUS tx_count so a used-
 * but-now-empty address still advances the gap counter (rather than being treated
 * as unused, which would prematurely stop the scan and hide funds at higher
 * indices). Explorer-only (the esplora /api/address endpoint returns chain_stats).
 */
export async function getBC2AddressInfo(address: string): Promise<{ confirmed: number; unconfirmed: number; txCount: number }> {
  if (typeof address !== 'string' || address.length === 0 || address.length > 150) {
    throw new Error('Invalid BC2 address');
  }
  const response = await fetch(`${BC2_EXPLORER_URL}/api/address/${encodeURIComponent(address)}`);
  if (!response.ok) throw new Error(`Explorer API error: ${response.status}`);
  const data = await response.json();
  const funded = Number(data.chain_stats?.funded_txo_sum ?? 0);
  const spent = Number(data.chain_stats?.spent_txo_sum ?? 0);
  const mFunded = Number(data.mempool_stats?.funded_txo_sum ?? 0);
  const mSpent = Number(data.mempool_stats?.spent_txo_sum ?? 0);
  const chainTx = Number(data.chain_stats?.tx_count ?? 0);
  const memTx = Number(data.mempool_stats?.tx_count ?? 0);
  if (![funded, spent, mFunded, mSpent, chainTx, memTx].every(Number.isFinite)) {
    throw new Error('Invalid address data from explorer');
  }
  const MAX_BALANCE = 21_000_000 * 100_000_000;
  const confirmed = Math.max(0, funded - spent);
  const unconfirmed = mFunded - mSpent;
  if (confirmed > MAX_BALANCE || Math.abs(unconfirmed) > MAX_BALANCE) {
    throw new Error('Balance exceeds maximum supply — possible server error');
  }
  return { confirmed, unconfirmed, txCount: chainTx + memTx };
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
    const url = `${BC2_EXPLORER_URL}/api/address/${encodeURIComponent(address)}/utxo`;
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

// Fetch a BC2 transaction's raw hex by txid (esplora GET /api/tx/{txid}/hex).
// Used to verify legacy input amounts before signing — the legacy sighash does
// not commit the input value, so we confirm each input against its prev tx.
export async function getBC2RawTransaction(txid: string): Promise<string> {
  if (typeof txid !== 'string' || !/^[0-9a-fA-F]{64}$/.test(txid)) {
    throw new Error('Invalid txid');
  }
  const response = await fetch(`${BC2_EXPLORER_URL}/api/tx/${txid}/hex`);
  if (!response.ok) {
    throw new Error(`Failed to fetch BC2 tx ${txid}: ${response.status}`);
  }
  const hex = (await response.text()).trim();
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 20) {
    throw new Error(`Invalid raw tx hex for ${txid}`);
  }
  return hex;
}

// Get BC2 transaction history using explorer API
export async function getBC2Transactions(address: string): Promise<any[]> {
  if (typeof address !== 'string' || address.length === 0 || address.length > 150) {
    throw new Error('Invalid BC2 address');
  }
  try {
    const response = await fetch(`${BC2_EXPLORER_URL}/api/address/${encodeURIComponent(address)}/txs`);
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

function readVarIntBC2(buf: Buffer, o: number): { value: number; size: number } {
  const f = buf[o];
  if (f < 0xfd) return { value: f, size: 1 };
  if (f === 0xfd) return { value: buf.readUInt16LE(o + 1), size: 3 };
  if (f === 0xfe) return { value: buf.readUInt32LE(o + 1), size: 5 };
  return { value: Number(buf.readBigUInt64LE(o + 1)), size: 9 };
}

/** Re-serialize a BIP144 SegWit tx without marker/flag/witness (the txid preimage). */
function stripWitnessForTxid(buf: Buffer): Buffer {
  let o = 0;
  const version = buf.subarray(o, o + 4); o += 4;
  o += 2; // marker + flag
  const vinStart = o;
  const vin = readVarIntBC2(buf, o); o += vin.size;
  for (let i = 0; i < vin.value; i++) {
    o += 36; const s = readVarIntBC2(buf, o); o += s.size + s.value; o += 4;
  }
  const vout = readVarIntBC2(buf, o); o += vout.size;
  for (let i = 0; i < vout.value; i++) {
    o += 8; const s = readVarIntBC2(buf, o); o += s.size + s.value;
  }
  const inputsOutputs = buf.subarray(vinStart, o);
  for (let i = 0; i < vin.value; i++) {
    const items = readVarIntBC2(buf, o); o += items.size;
    for (let j = 0; j < items.value; j++) { const it = readVarIntBC2(buf, o); o += it.size + it.value; }
  }
  const locktime = buf.subarray(o, o + 4);
  return Buffer.concat([version, inputsOutputs, locktime]);
}

/**
 * Compute a transaction's txid from its raw hex. For SegWit txs (BIP144
 * marker/flag) the txid excludes the witness, so it is stripped first. Exported so
 * broadcast can verify the server returned the txid of the tx we actually signed.
 * Validated against real BC2 SegWit + legacy tx vectors.
 */
export function computeTxid(rawHex: string): string {
  const buf = Buffer.from(rawHex, 'hex');
  const body = (buf.length > 6 && buf[4] === 0x00 && buf[5] !== 0x00) ? stripWitnessForTxid(buf) : buf;
  return Buffer.from(sha256(sha256(body))).reverse().toString('hex');
}

// Best-effort secondary relay of an already-accepted BC2 tx over the SPKI-pinned
// bc2electrum socket. The explorer is our primary broadcaster (more reliable — the
// BC2 Electrum server has indexing issues), and computeTxid verification already
// rejects a server that echoes a *different* txid. This closes the narrower gap
// where the explorer accepts our hex, returns the correct txid, but never actually
// relays the tx: an independent, authenticated path still pushes it to the network.
// Fire-and-forget, hard-bounded, and fully error-swallowing — a healthy explorer
// broadcast is already a success, and "already in mempool" from the socket is the
// expected happy path here, so no failure of this relay is user-visible.
function relayBC2ViaPinnedSocket(hex: string): void {
  (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          await connectBC2();
          await bc2Client.blockchainTransaction_broadcast(hex);
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('relay timeout')), 12000); }),
      ]);
    } catch {
      /* best-effort: the explorer already accepted the tx */
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
}

// Broadcast BC2 transaction using explorer API
export async function broadcastBC2Transaction(hex: string): Promise<string> {
  // Max 32MB block = 64M hex chars; cap at 2MB tx (4M hex) as practical limit
  if (typeof hex !== 'string' || hex.length < 20 || hex.length > 4_000_000 || !/^[a-fA-F0-9]+$/.test(hex)) {
    throw new Error('Invalid transaction hex');
  }
  DEBUG && console.log(`[BC2] Broadcasting transaction, hex length: ${hex.length}`);

  try {
    const response = await fetch(`${BC2_EXPLORER_URL}/api/tx`, {
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

    // Verify the server returned the txid of the tx we actually signed. A server
    // (or MITM) that drops the tx and echoes a bogus/other txid is caught here,
    // rather than leaving the user with a false "sent". computeTxid should never
    // throw for our own well-formed txs; if it somehow does, don't block the send.
    let expectedTxid: string | null = null;
    try { expectedTxid = computeTxid(hex); } catch { /* skip verification on parse failure */ }
    if (expectedTxid && txidResult.toLowerCase() !== expectedTxid.toLowerCase()) {
      throw new Error(`Broadcast returned a txid that does not match the signed transaction — refusing to trust it`);
    }
    // Belt-and-suspenders: also relay over the pinned socket so the tx still
    // propagates if the explorer echoed our txid without actually broadcasting.
    relayBC2ViaPinnedSocket(hex);
    return expectedTxid || txidResult;
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
      let expectedTxid: string | null = null;
      try { expectedTxid = computeTxid(hex); } catch { /* skip verification on parse failure */ }
      if (expectedTxid && txid.toLowerCase() !== expectedTxid.toLowerCase()) {
        throw new Error(`Electrum broadcast returned a txid that does not match the signed transaction — refusing to trust it`);
      }
      return expectedTxid || txid;
    } catch (electrumError: any) {
      DEBUG && console.log('[BC2] Electrum broadcast also failed:', electrumError.message);
      DEBUG && console.log(`[BC2] Full broadcast errors - API: ${apiError.message}, Electrum: ${electrumError.message}`);
      // Both paths errored, but the tx may already have landed (a lost response, or a re-send
      // answered "already in mempool"). If the node/explorer knows our txid, it succeeded —
      // don't show a false failure that leads the user to re-send.
      let expectedTxid: string | null = null;
      try { expectedTxid = computeTxid(hex); } catch { /* fall through to the error */ }
      if (expectedTxid && (await nodeHasBC2Tx(expectedTxid))) return expectedTxid;
      throw new Error('BC2 broadcast failed — check network connection and try again');
    }
  }
}

// Does the BC2 network already know this txid? Queries the explorer (BC2's primary, more
// reliable than its Electrum indexer, and no connect-retry latency). Distinguishes a real
// failure from a lost/duplicate response for a tx that actually landed.
async function nodeHasBC2Tx(txid: string): Promise<boolean> {
  try {
    const r = await fetch(`${BC2_EXPLORER_URL}/api/tx/${txid}`);
    return !!r && r.ok === true;
  } catch {
    return false;
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
