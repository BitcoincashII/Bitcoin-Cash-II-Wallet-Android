/**
 * Unit tests for the ported BCH2 SPV core (blue_modules/bch2-spv.ts). These cover the pure, consensus-exact
 * pieces (compact<->target, CalculateASERT, ASERT wiring, merkle inclusion + the critical txid binding). The
 * BCH2Electrum-backed orchestration (verifyConfirmations / header-chain sync) is validated separately.
 */
jest.mock('../../blue_modules/BCH2Electrum', () => ({
  getBlockHeaders: jest.fn(),
  getMerkleProof: jest.fn(),
  getRawTransaction: jest.fn(),
  getServerName: jest.fn(() => false),
}));

import {
  targetFromCompact, compactFromTarget, calculateASERT, getNextWorkRequiredASERT,
  BCH2_MAINNET_ASERT, BCH2_MAINNET_CHECKPOINT, merkleRootFromBranch, verifyMerkleInclusion, hash256,
  isInSpvScope, verifyConfirmations,
} from '../../blue_modules/bch2-spv';
import * as BCH2Electrum from '../../blue_modules/BCH2Electrum';

const POW = BCH2_MAINNET_ASERT.powLimit;

// ---- test-local byte helpers (mirror the module's internal ones) ----
function hexToBytes(h: string): Uint8Array { const out = new Uint8Array(h.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16); return out; }
function bytesToHex(a: Uint8Array): string { let s = ''; for (const b of a) s += b.toString(16).padStart(2, '0'); return s; }
function reverse(a: Uint8Array): Uint8Array { const b = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) b[i] = a[a.length - 1 - i]; return b; }
function concat(x: Uint8Array, y: Uint8Array): Uint8Array { const o = new Uint8Array(x.length + y.length); o.set(x, 0); o.set(y, x.length); return o; }

describe('compact nBits <-> target round-trip (arith_uint256 parity)', () => {
  for (const bits of [0x1903a30c, 0x1d00ffff, 0x1802aee0, 0x1b0404cb]) {
    it(`0x${bits.toString(16)} round-trips`, () => {
      const { target, negative, overflow } = targetFromCompact(bits);
      expect(negative).toBe(false);
      expect(overflow).toBe(false);
      expect(compactFromTarget(target)).toBe(bits);
    });
  }
});

describe('CalculateASERT parity', () => {
  const ref = targetFromCompact(0x1903a30c).target;
  it('perfect spacing (exponent 0) leaves the target UNCHANGED', () => {
    // timeDiff = spacing*(heightDiff+1) => exponent 0 => factor 65536, shift -16 => unchanged.
    const r = calculateASERT(ref, 600n, 600n, 0n, POW, 3600n);
    expect(r).toBe(ref);
  });
  it('blocks twice as fast => harder (lower target)', () => {
    expect(calculateASERT(ref, 600n, 300n, 0n, POW, 3600n) < ref).toBe(true);
  });
  it('blocks much slower stays clamped <= powLimit', () => {
    expect(calculateASERT(POW / 2n, 600n, 600n * 100n, 0n, POW, 3600n) <= POW).toBe(true);
  });
});

describe('getNextWorkRequiredASERT (BCH2 wiring)', () => {
  it('anchor block returns anchorBits directly', () => {
    expect(getNextWorkRequiredASERT(BCH2_MAINNET_ASERT.anchorHeight - 1, 0, BCH2_MAINNET_ASERT)).toBe(BCH2_MAINNET_ASERT.anchorBits);
  });
  it('refuses pre-fork / fork-block heights (<= 53200 = BC2, not ASERT)', () => {
    expect(() => getNextWorkRequiredASERT(BCH2_MAINNET_ASERT.anchorHeight - 2, 0, BCH2_MAINNET_ASERT)).toThrow();
  });
  it('half-life step: 92735 uses 1h, 92736 uses 2d', () => {
    expect(BCH2_MAINNET_ASERT.halfLife(92735)).toBe(3600n);
    expect(BCH2_MAINNET_ASERT.halfLife(92736)).toBe(172800n);
  });
  it('produces a valid within-powLimit nBits just after the anchor', () => {
    const bits = getNextWorkRequiredASERT(53201, BCH2_MAINNET_ASERT.anchorParentTime + 600, BCH2_MAINNET_ASERT);
    const { target, negative, overflow } = targetFromCompact(bits);
    expect(negative || overflow).toBe(false);
    expect(target > 0n && target <= POW).toBe(true);
  });
});

describe('SPV scope gating + neutral null (review fixes)', () => {
  const CP = BCH2_MAINNET_CHECKPOINT.height;
  const setServer = (s: string | false) => (BCH2Electrum.getServerName as jest.Mock).mockReturnValue(s);
  afterEach(() => setServer(false));

  it('isInSpvScope: off-mainnet false; at/below checkpoint false; above true; IP fallback true', () => {
    setServer(false);
    expect(isInSpvScope(CP + 5000)).toBe(false);        // non-mainnet server => no SPV
    setServer('electrum.bch2.org');
    expect(isInSpvScope(CP)).toBe(false);               // at checkpoint = out of scope
    expect(isInSpvScope(CP + 1)).toBe(true);            // just above
    expect(isInSpvScope(50000)).toBe(false);            // pre-fork / below anchor
    setServer('144.202.73.66');                         // IP fallback = SAME pinned server
    expect(isInSpvScope(CP + 5000)).toBe(true);
  });

  it('verifyConfirmations returns null (neutral, never throws) for out-of-scope / stale-tip / non-mainnet', async () => {
    setServer('electrum.bch2.org');
    await expect(verifyConfirmations('ab'.repeat(32), CP - 100, CP + 5000)).resolves.toBeNull(); // below checkpoint
    await expect(verifyConfirmations('ab'.repeat(32), CP + 5000, CP + 100)).resolves.toBeNull(); // above (stale) tip
    setServer(false);
    await expect(verifyConfirmations('ab'.repeat(32), CP + 5000, CP + 9000)).resolves.toBeNull(); // non-mainnet
  });
});

describe('merkle inclusion + txid binding', () => {
  // Build a 2-leaf tree: leaf0 = hash256(rawTx), sibling arbitrary; root at pos 0.
  const rawTxHex = '0200000001' + 'ab'.repeat(40); // arbitrary bytes (non-SegWit shape)
  const leaf0 = hash256(hexToBytes(rawTxHex));      // internal txid
  const sibling = new Uint8Array(32).fill(0x42);
  const rootPos0 = merkleRootFromBranch(leaf0, [sibling], 0); // leaf on the left

  it('verifies a correct proof and returns the display txid', () => {
    const merkleDisplay = [bytesToHex(reverse(sibling))]; // get_merkle returns display/reversed hex
    const proven = verifyMerkleInclusion(rawTxHex, merkleDisplay, 0, rootPos0);
    expect(proven).toBe(bytesToHex(reverse(leaf0)));
  });

  it('throws when the reconstructed root does not match the header root', () => {
    const merkleDisplay = [bytesToHex(reverse(sibling))];
    expect(() => verifyMerkleInclusion(rawTxHex, merkleDisplay, 0, new Uint8Array(32))).toThrow(/merkle root/i);
  });

  it('position matters: pos 1 (leaf on the right) yields a different root', () => {
    const rootPos1 = merkleRootFromBranch(leaf0, [sibling], 1);
    expect(bytesToHex(rootPos1)).not.toBe(bytesToHex(rootPos0));
    // hash256(sibling || leaf0) for pos 1
    expect(bytesToHex(rootPos1)).toBe(bytesToHex(hash256(concat(sibling, leaf0))));
  });
});
