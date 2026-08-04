// bch2-spv.ts — client-side SPV verification for BCH2 (Android wallet).
//
// L1 (audit): confirmation counts / balances were TRUSTED from a single Electrum server. A compromised server
// could fabricate a "confirmed" incoming payment. This module removes that trust for CONFIRMATIONS: it verifies a
// proof-of-work + ASERT header chain from a hardcoded checkpoint to the tip, then a Merkle-inclusion proof that a
// tx is in the block at a claimed height, and binds the proven leaf to the requested txid. Every function is
// fail-closed (any throw = "not verified"). This is DISPLAY-ONLY (a verification badge) and touches NO signing
// path, so it is fund-safe by construction.
//
// The core is a BIT-EXACT port of the swap-DEX verifier (bch2-swap src/core/spv.ts + src/electrum/spv-verifier.ts),
// which is a bit-exact port of the node's ASERT consensus (bch2-bc2-fork src/pow.cpp / src/arith_uint256.cpp),
// validated against BCH2 mainnet. BCH2 is a single ASERT chain and non-SegWit, so the legacy 2016-block retarget
// path and the BIP144 witness stripper are omitted — hash256(rawTxHex) === txid directly.
import { sha256 } from '@noble/hashes/sha256';
import { getBlockHeaders, getMerkleProof, getRawTransaction, getServerName } from './BCH2Electrum';

/** Double-SHA256 (hash256) — the block-hash and Merkle-node primitive. */
export function hash256(d: Uint8Array): Uint8Array { return sha256(sha256(d)); }

function concat(...arrs: Uint8Array[]): Uint8Array {
  let n = 0; for (const a of arrs) n += a.length;
  const out = new Uint8Array(n); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function reverse(a: Uint8Array): Uint8Array { const b = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) b[i] = a[a.length - 1 - i]; return b; }
function equalBytes(a: Uint8Array, b: Uint8Array): boolean { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
function hexToBytes(h: string): Uint8Array { const s = h.startsWith('0x') ? h.slice(2) : h; if (s.length % 2) throw new Error('odd hex'); const out = new Uint8Array(s.length / 2); for (let i = 0; i < out.length; i++) { const b = parseInt(s.substr(i * 2, 2), 16); if (Number.isNaN(b)) throw new Error('bad hex'); out[i] = b; } return out; }
function bytesToHex(a: Uint8Array): string { let s = ''; for (const b of a) s += b.toString(16).padStart(2, '0'); return s; }
/** Interpret 32 bytes as a little-endian 256-bit integer (arith_uint256 semantics). */
function leBytesToBigInt(a: Uint8Array): bigint { let n = 0n; for (let i = a.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(a[i]); return n; }
function bitLength(n: bigint): number { return n <= 0n ? 0 : n.toString(2).length; }

// ── Compact "nBits" ⇄ target (exact port of arith_uint256::SetCompact / GetCompact) ──────────────────────────
export function targetFromCompact(nCompact: number): { target: bigint; negative: boolean; overflow: boolean } {
  const nSize = nCompact >>> 24;
  const nWordRaw = nCompact & 0x007fffff;
  let nWord = BigInt(nWordRaw);
  let target: bigint;
  if (nSize <= 3) { nWord >>= BigInt(8 * (3 - nSize)); target = nWord; }
  else { target = BigInt(nWordRaw) << BigInt(8 * (nSize - 3)); }
  const negative = nWord !== 0n && (nCompact & 0x00800000) !== 0;
  const overflow = nWord !== 0n && ((nSize > 34) || (nWord > 0xffn && nSize > 33) || (nWord > 0xffffn && nSize > 32));
  return { target, negative, overflow };
}

export function compactFromTarget(target: bigint): number {
  let nSize = Math.floor((bitLength(target) + 7) / 8);
  let low: bigint;
  if (nSize <= 3) low = (target & 0xffffffffffffffffn) << BigInt(8 * (3 - nSize));
  else low = (target >> BigInt(8 * (nSize - 3))) & 0xffffffffffffffffn;
  let nCompact = Number(low & 0xffffffffn) >>> 0;
  if (nCompact & 0x00800000) { nCompact >>>= 8; nSize++; }
  nCompact = (nCompact | (nSize << 24)) >>> 0;
  return nCompact;
}

// ── CalculateASERT (exact BigInt port of src/pow.cpp) ─────────────────────────────────────────────────────────
export function calculateASERT(refTarget: bigint, spacing: bigint, timeDiff: bigint, heightDiff: bigint, powLimit: bigint, halfLife: bigint): bigint {
  if (heightDiff < 0n) throw new Error('ASERT: negative heightDiff');
  if (refTarget <= 0n || refTarget > powLimit) throw new Error('ASERT: refTarget out of range');
  const exponent = ((timeDiff - spacing * (heightDiff + 1n)) * 65536n) / halfLife;
  const shifts0 = exponent >> 16n;
  const frac = exponent & 0xFFFFn;
  const factor = 65536n + ((195766423245049n * frac + 971821376n * frac * frac + 5127n * frac * frac * frac + (1n << 47n)) >> 48n);
  let nextTarget = refTarget * factor;
  const shifts = shifts0 - 16n;
  if (shifts <= 0n) nextTarget >>= (-shifts);
  else nextTarget <<= shifts;
  if (nextTarget === 0n) return 1n;
  if (nextTarget > powLimit) return powLimit;
  return nextTarget;
}

// ── BCH2 mainnet ASERT / PoW consensus parameters ─────────────────────────────────────────────────────────────
export interface AsertParams {
  anchorHeight: number;      // first post-fork block (gets anchorBits directly)
  anchorBits: number;
  anchorParentTime: number;  // timestamp of the fork block (the block BEFORE the anchor)
  spacing: bigint;
  powLimit: bigint;
  halfLife: (nextHeight: number) => bigint;
}
// From bch2-bc2-fork src/kernel/chainparams.cpp; validated bit-exact vs BCH2 mainnet in the swap-DEX SPV tests.
// The 3600→172800 half-life STEP at height 92736 is load-bearing (a single value diverges nBits post-92736).
export const BCH2_MAINNET_ASERT: AsertParams = {
  anchorHeight: 53201,
  anchorBits: 0x1903a30c,
  anchorParentTime: 1772649180,
  spacing: 600n,
  powLimit: 0x00000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffn,
  halfLife: (h) => (h >= 92736 ? 172800n : 3600n),
};

export interface Checkpoint { height: number; hashDisplay: string; time: number; }
// A buried BCH2 mainnet block, the TRUSTED anchor for header-chain verification. The client verifies a contiguous
// PoW+ASERT chain from here to the tip, so this bounds the header fetch. REFRESH PER RELEASE to keep the fetch
// small; re-validate against electrum.bch2.org at capture time. (Same value the swap DEX validated 2026-07-07.)
export const BCH2_MAINNET_CHECKPOINT: Checkpoint = {
  height: 71000,
  hashDisplay: '0000000000000009271d1b0554f651d7102b8f7622f74c50eb20963f62910117',
  time: 1783333735,
};

/** Expected compact nBits for the block at prevHeight+1, given its parent's height+timestamp. */
export function getNextWorkRequiredASERT(prevHeight: number, prevTime: number, p: AsertParams): number {
  const nextHeight = prevHeight + 1;
  if (nextHeight < p.anchorHeight) throw new Error(`SPV: height ${nextHeight} is at/below the fork block (pre-fork, not ASERT)`);
  if (nextHeight === p.anchorHeight) return p.anchorBits;
  const { target: refTarget, negative, overflow } = targetFromCompact(p.anchorBits);
  if (negative || overflow || refTarget === 0n) throw new Error('ASERT: bad anchor bits');
  const timeDiff = BigInt(prevTime - p.anchorParentTime);
  const heightDiff = BigInt(prevHeight - p.anchorHeight);
  return compactFromTarget(calculateASERT(refTarget, p.spacing, timeDiff, heightDiff, p.powLimit, p.halfLife(nextHeight)));
}

// ── Block header parse + PoW check ────────────────────────────────────────────────────────────────────────────
export interface BlockHeader { version: number; prevHash: Uint8Array; merkleRoot: Uint8Array; time: number; bits: number; nonce: number; raw: Uint8Array; }

export function parseHeader(raw: Uint8Array): BlockHeader {
  if (raw.length !== 80) throw new Error('header must be exactly 80 bytes');
  const dv = new DataView(raw.buffer, raw.byteOffset, 80);
  return {
    version: dv.getInt32(0, true),
    prevHash: raw.slice(4, 36),   // internal (LE) order
    merkleRoot: raw.slice(36, 68), // internal (LE) order
    time: dv.getUint32(68, true),
    bits: dv.getUint32(72, true),
    nonce: dv.getUint32(76, true),
    raw: raw.slice(0, 80),
  };
}

export function blockHashInternal(raw: Uint8Array): Uint8Array { return hash256(raw); }

/** True iff the header's PoW satisfies its own nBits and nBits is within powLimit. */
export function checkPoW(raw: Uint8Array, bits: number, powLimit: bigint): boolean {
  const { target, negative, overflow } = targetFromCompact(bits);
  if (negative || overflow || target === 0n || target > powLimit) return false;
  return leBytesToBigInt(hash256(raw)) <= target;
}

// ── Merkle inclusion (Electrum transaction.get_merkle format) ─────────────────────────────────────────────────
export function merkleRootFromBranch(txidInternal: Uint8Array, branchInternal: Uint8Array[], pos: number): Uint8Array {
  let h = txidInternal;
  let index = pos >>> 0;
  for (const sib of branchInternal) {
    h = (index & 1) ? hash256(concat(sib, h)) : hash256(concat(h, sib));
    index >>>= 1;
  }
  return h;
}

/**
 * Verify a tx is included in a block whose header Merkle root is `merkleRootInternal`. BCH2 is non-SegWit, so
 * hash256(rawTxHex) === txid (the Merkle-tree leaf) directly — no witness strip. `merkleHexReversed`/`pos` come
 * straight from Electrum get_merkle (display/reversed hex). Returns the display txid; throws on mismatch.
 */
export function verifyMerkleInclusion(rawTxHex: string, merkleHexReversed: string[], pos: number, merkleRootInternal: Uint8Array): string {
  const txidInternal = hash256(hexToBytes(rawTxHex));
  const branchInternal = merkleHexReversed.map((h) => reverse(hexToBytes(h)));
  const root = merkleRootFromBranch(txidInternal, branchInternal, pos);
  if (!equalBytes(root, merkleRootInternal)) throw new Error('Merkle inclusion proof does not match the block header merkle root');
  return bytesToHex(reverse(txidInternal));
}

// ── Contiguous header-chain verification ──────────────────────────────────────────────────────────────────────
const MAX_HEADER_FUTURE_SEC = 7200; // 2h — Bitcoin's block-timestamp future limit

function medianTimePast(window: number[]): number {
  const w = window.slice(-11).slice().sort((a, b) => a - b);
  return w[Math.floor(w.length / 2)];
}

/**
 * Verify a contiguous run of headers descends by PoW from a trusted checkpoint. Each header must (1) link to its
 * predecessor, (2) satisfy its own PoW, (3) be within +2h of trusted now, (4) exceed median-time-past once 11
 * predecessors are known, (5) carry the EXACT ASERT nBits for its height. The time bounds close the ASERT
 * difficulty-collapse attack (a far-future parent timestamp that would collapse the target to powLimit).
 */
export function verifyHeaderChain(
  headers: Uint8Array[], startHeight: number, prevHashOfStart: Uint8Array, p: AsertParams,
  prevTimeOfStart: number, trustedNowSec: number, priorTimes: number[] = [],
): Map<number, BlockHeader> {
  const out = new Map<number, BlockHeader>();
  let expectedPrevHash = prevHashOfStart;
  let prevTime = prevTimeOfStart;
  let prevHeight = startHeight - 1;
  const times = priorTimes.slice(-11);
  for (let i = 0; i < headers.length; i++) {
    const height = startHeight + i;
    const h = parseHeader(headers[i]);
    if (!equalBytes(h.prevHash, expectedPrevHash)) throw new Error(`header ${height}: prevHash does not link to ${prevHeight}`);
    if (!checkPoW(h.raw, h.bits, p.powLimit)) throw new Error(`header ${height}: proof-of-work below target`);
    if (h.time > trustedNowSec + MAX_HEADER_FUTURE_SEC) throw new Error(`header ${height}: timestamp ${h.time} exceeds trusted now + 2h`);
    if (times.length >= 11 && h.time <= medianTimePast(times)) throw new Error(`header ${height}: timestamp ${h.time} not above median-time-past`);
    const expectedBits = getNextWorkRequiredASERT(prevHeight, prevTime, p);
    if (h.bits !== expectedBits) throw new Error(`header ${height}: nBits 0x${h.bits.toString(16)} != expected ASERT 0x${expectedBits.toString(16)}`);
    out.set(height, h);
    expectedPrevHash = blockHashInternal(h.raw);
    prevTime = h.time;
    prevHeight = height;
    times.push(h.time);
  }
  return out;
}

// ── Orchestration: checkpoint-anchored chain-verify + verifyConfirmations ─────────────────────────────────────
const HEADERS_PER_CALL = 500;
const CHAIN = 'bch2';
// The genuine SPKI-pinned BCH2 mainnet server, by both DNS name and its IP fallback (hardcodedPeers) — the SAME
// server, so SPV must be available on either. Anything else (regtest / unknown) => SPV not supported.
const MAINNET_SERVERS = new Set(['electrum.bch2.org', '144.202.73.66']);

interface Verified { tipHeight: number; lastHashInternal: Uint8Array; lastTime: number; headers: Map<number, BlockHeader>; }
const cache = new Map<string, Verified>();
const locks = new Map<string, Promise<unknown>>();

/** SPV is only meaningful on a known BCH2 mainnet server (regtest uses a different DAA + min-difficulty). */
export function spvSupported(): boolean {
  const s = getServerName();
  return !!s && MAINNET_SERVERS.has(s);
}

/**
 * True iff a tx confirmed at `claimedHeight` CAN be SPV-verified on the current server: mainnet, post-fork, and
 * ABOVE the hardcoded checkpoint (early history at/below the checkpoint is out of scope). When false, the tx is
 * neutral — callers must show NO badge, NOT a failure. Keeps the "verifying…"/"failed" states off txs SPV never
 * covers (non-mainnet server, or pre-checkpoint history).
 */
export function isInSpvScope(claimedHeight: number): boolean {
  return spvSupported()
    && Number.isInteger(claimedHeight)
    && claimedHeight >= BCH2_MAINNET_ASERT.anchorHeight
    && claimedHeight > BCH2_MAINNET_CHECKPOINT.height;
}

function splitHeaders(hex: string, count: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const chunk = hex.slice(i * 160, (i + 1) * 160);
    if (chunk.length !== 160) throw new Error('SPV: short header in batch');
    out.push(hexToBytes(chunk));
  }
  return out;
}

/** Serialize chain-extension so concurrent verify passes don't double-fetch or race the cache. */
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const p = new Promise<void>((r) => { release = r; });
  locks.set(key, prev.then(() => p));
  await prev.catch(() => { /* ignore prior failure */ });
  try { return await fn(); } finally { release(); }
}

/** Extend (or build) the verified header chain up to tipHeight, anchored at the hardcoded checkpoint. */
async function extendVerifiedChain(tipHeight: number): Promise<Verified> {
  const p = BCH2_MAINNET_ASERT;
  const cp = BCH2_MAINNET_CHECKPOINT;
  if (tipHeight <= cp.height) throw new Error(`SPV: tip ${tipHeight} is at/below checkpoint ${cp.height}`);
  return withLock(CHAIN, async () => {
    let v = cache.get(CHAIN);
    if (!v) v = { tipHeight: cp.height, lastHashInternal: reverse(hexToBytes(cp.hashDisplay)), lastTime: cp.time, headers: new Map() };
    const trustedNowSec = Math.floor(Date.now() / 1000);
    while (v.tipHeight < tipHeight) {
      const start = v.tipHeight + 1;
      const want = Math.min(HEADERS_PER_CALL, tipHeight - v.tipHeight);
      const res = await getBlockHeaders(start, want);
      const raws = splitHeaders(res.hex, res.count);
      if (raws.length === 0) throw new Error('SPV: server returned no headers');
      const priorTimes: number[] = [];
      for (let hh = start - 11; hh < start; hh++) {
        if (hh === cp.height) priorTimes.push(cp.time);
        else { const hd = v.headers.get(hh); if (hd) priorTimes.push(hd.time); }
      }
      let map: Map<number, BlockHeader>;
      try {
        map = verifyHeaderChain(raws, start, v.lastHashInternal, p, v.lastTime, trustedNowSec, priorTimes);
      } catch (e) {
        // A reorg below our cached tip makes the next chunk fail to link. Drop the cached chain so the next call
        // rebuilds from the hardcoded checkpoint (the only anchor a reorg cannot invalidate). Still fails closed.
        cache.delete(CHAIN);
        throw e;
      }
      for (const [h, hdr] of map) v.headers.set(h, hdr);
      const lastHeight = start + raws.length - 1;
      const last = map.get(lastHeight)!;
      v.lastHashInternal = blockHashInternal(last.raw);
      v.lastTime = last.time;
      v.tipHeight = lastHeight;
    }
    cache.set(CHAIN, v);
    return v;
  });
}

/**
 * Verify — WITHOUT trusting the server's height — that a tx is buried at a real confirmation depth. Verifies a
 * PoW+ASERT header chain from the hardcoded checkpoint to `tipHeight`, plus a Merkle-inclusion proof that `txid`
 * is in the block at `claimedHeight` against that verified header, and binds the proven leaf to `txid`.
 *
 * Returns the VERIFIED confirmation count on success. Returns NULL when the tx is simply OUT OF SPV SCOPE or not
 * yet verifiable — non-mainnet server, at/below the checkpoint, pre-fork, above the (stale) tip, or a transient
 * network / header-fetch error. Callers must render null as NEUTRAL (no badge), never a failure. THROWS only on a
 * DEFINITIVE forgery of this tx's inclusion (Merkle root mismatch or txid-binding mismatch) — an unambiguous
 * server lie a network error cannot cause — which callers surface as 'failed'. Fail-CLOSED throughout: a tx is
 * NEVER reported as verified unless the merkle proof + txid binding both hold against a PoW-verified header.
 */
export async function verifyConfirmations(txid: string, claimedHeight: number, tipHeight: number): Promise<number | null> {
  if (!isInSpvScope(claimedHeight)) return null;                                  // out of scope → neutral
  if (!Number.isInteger(tipHeight) || claimedHeight > tipHeight) return null;     // stale/low tip → neutral, retry later
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) return null;
  let v: Verified;
  let header: BlockHeader | undefined;
  let rawTxHex: string;
  let proof: { block_height: number; merkle: string[]; pos: number };
  try {
    v = await extendVerifiedChain(tipHeight);   // may throw on transient fetch OR a forged header chain
    header = v.headers.get(claimedHeight);
    rawTxHex = await getRawTransaction(txid);
    proof = await getMerkleProof(txid, claimedHeight);
  } catch {
    // Network / header-fetch / header-chain failure — treat as "not verified YET" (neutral). Still fail-closed
    // (never 'verified'); a genuine forgery is caught below by the Merkle/binding check, or on the next refresh.
    return null;
  }
  if (!header) return null;
  if (proof.block_height !== claimedHeight) return null;
  // The Merkle-inclusion + txid-binding are the unambiguous adversarial checks: a network error cannot make a
  // wrong tx's bytes hash into the real block's merkle root. A throw here == the server forged this tx's inclusion.
  const provenTxid = verifyMerkleInclusion(rawTxHex, proof.merkle, proof.pos, header.merkleRoot); // throws on mismatch
  if (provenTxid.toLowerCase() !== txid.toLowerCase()) throw new Error(`SPV: proven txid ${provenTxid} != requested ${txid}`);
  return Math.min(v.tipHeight, tipHeight) - claimedHeight + 1;
}

/** Test-only: reset the in-memory verified-chain cache. */
export function __resetSpvCacheForTests(): void { cache.clear(); locks.clear(); }
