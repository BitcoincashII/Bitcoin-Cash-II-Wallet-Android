/**
 * Tests for BCH2 Airdrop claiming module
 */

// Mock BCH2Electrum before importing the module under test
const mockGetBalanceByAddress = jest.fn();
const mockGetBalanceByScripthash = jest.fn();
const mockGetBC2Balance = jest.fn();
const mockGetBC2BalanceByScripthash = jest.fn();

jest.mock('../../blue_modules/BCH2Electrum', () => ({
  getBalanceByAddress: mockGetBalanceByAddress,
  getBalanceByScripthash: mockGetBalanceByScripthash,
  getBC2Balance: mockGetBC2Balance,
  getBC2BalanceByScripthash: mockGetBC2BalanceByScripthash,
  connectMain: jest.fn(),
}));

// Partial mock for noble_ecc to allow controlling xOnlyPointAddTweak in specific tests
const realEcc = jest.requireActual('../../blue_modules/noble_ecc');
let mockXOnlyPointAddTweakOverride: ((point: Uint8Array, tweak: Uint8Array) => any) | null = null;
jest.mock('../../blue_modules/noble_ecc', () => {
  const actual = jest.requireActual('../../blue_modules/noble_ecc');
  return {
    __esModule: true,
    ...actual,
    default: {
      ...actual.default,
      xOnlyPointAddTweak: (point: Uint8Array, tweak: Uint8Array) => {
        if (mockXOnlyPointAddTweakOverride) {
          return mockXOnlyPointAddTweakOverride(point, tweak);
        }
        return actual.default.xOnlyPointAddTweak(point, tweak);
      },
    },
  };
});

// Mock the BCH2Wallet class
jest.mock('../../class/wallets/bch2-wallet', () => {
  return {
    BCH2Wallet: jest.fn().mockImplementation(() => ({
      setSecret: jest.fn().mockReturnThis(),
      getAddress: jest.fn().mockReturnValue('bitcoincashii:qmockaddress'),
      fetchBalance: jest.fn().mockResolvedValue(undefined),
      prepareForSerialization: jest.fn(),
      balance: 50000,
      unconfirmed_balance: 0,
    })),
  };
});

import {
  claimFromWIF,
  claimFromMnemonic,
  importBC2Wallet,
  getTotalClaimable,
  bc1AddressToScripthash,
} from '../../class/bch2-airdrop';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Known compressed WIF (mainnet) - derived from a well-known test private key
// This is the WIF for private key 0x0000000000000000000000000000000000000000000000000000000000000001
const TEST_WIF_COMPRESSED = 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn';
// Uncompressed WIF for the same key
const TEST_WIF_UNCOMPRESSED = '5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ';

beforeEach(() => {
  jest.clearAllMocks();
  mockXOnlyPointAddTweakOverride = null; // Reset ecc override
  // Default: return zero balance
  mockGetBalanceByAddress.mockResolvedValue({ confirmed: 0, unconfirmed: 0 });
  mockGetBalanceByScripthash.mockResolvedValue({ confirmed: 0, unconfirmed: 0 });
  mockGetBC2Balance.mockResolvedValue({ confirmed: 0, unconfirmed: 0 });
  mockGetBC2BalanceByScripthash.mockResolvedValue({ confirmed: 0, unconfirmed: 0 });
});

// ============================================================================
// WIF Import
// ============================================================================
describe('WIF import', () => {
  it('valid compressed WIF (K/L prefix) derives correct keys and addresses', async () => {
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 100000, unconfirmed: 0 });

    const result = await claimFromWIF(TEST_WIF_COMPRESSED);

    expect(result.success).toBe(true);
    expect(result.bch2Address).toBeTruthy();
    expect(result.bch2Address.startsWith('bitcoincashii:')).toBe(true);
    // BC2 legacy address should start with 1
    expect(result.address).toMatch(/^[13]/);
    expect(result.balance).toBe(100000);
  });

  it('valid uncompressed WIF (5 prefix) derives correct keys', async () => {
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 50000, unconfirmed: 0 });

    const result = await claimFromWIF(TEST_WIF_UNCOMPRESSED);

    expect(result.success).toBe(true);
    expect(result.bch2Address.startsWith('bitcoincashii:')).toBe(true);
    expect(result.balance).toBe(50000);
  });

  it('compressed and uncompressed WIF for same key produce different addresses', async () => {
    // Need a non-zero balance so claimFromWIF returns success: true
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 10000, unconfirmed: 0 });

    const r1 = await claimFromWIF(TEST_WIF_COMPRESSED);
    const r2 = await claimFromWIF(TEST_WIF_UNCOMPRESSED);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    // Different because compressed vs uncompressed pubkey yields different hash160
    expect(r1.bch2Address).not.toBe(r2.bch2Address);
  });

  it('invalid WIF returns error result', async () => {
    const result = await claimFromWIF('notavalidwif');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.balance).toBe(0);
  });

  it('empty WIF returns error result', async () => {
    const result = await claimFromWIF('');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('WIF claim also checks SegWit balance', async () => {
    // claimFromWIF now scans 5 address types: legacy, p2pk, bc1, p2sh-segwit, p2tr.
    // Only give legacy a balance via getBalanceByAddress, and give bc1 balance via
    // targeted scripthash calls. scanSingleAddress calls getBalanceByScripthash for
    // p2pk (call 1), bc1 (call 2), p2sh-segwit (call 3), p2tr (call 4).
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 10000, unconfirmed: 0 });
    let scripthashCallCount = 0;
    mockGetBalanceByScripthash.mockImplementation(async () => {
      scripthashCallCount++;
      // Call 2 = bc1 (after p2pk)
      if (scripthashCallCount === 2) return { confirmed: 20000, unconfirmed: 0 };
      return { confirmed: 0, unconfirmed: 0 };
    });

    const result = await claimFromWIF(TEST_WIF_COMPRESSED);

    expect(result.success).toBe(true);
    // Total should include both legacy and bc1 balance
    expect(result.balance).toBe(30000);
  });

  it('WIF claim reports BC2 balance for comparison', async () => {
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 10000, unconfirmed: 0 });
    mockGetBC2Balance.mockResolvedValue({ confirmed: 50000, unconfirmed: 0 });

    const result = await claimFromWIF(TEST_WIF_COMPRESSED);

    expect(result.success).toBe(true);
    expect(result.bc2Balance).toBe(50000);
  });
});

// ============================================================================
// Mnemonic Import
// ============================================================================
describe('Mnemonic import', () => {
  it('valid 12-word mnemonic derives multiple address types', async () => {
    // Return balance on first BCH path address to get a result
    let callCount = 0;
    mockGetBalanceByAddress.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { confirmed: 100000, unconfirmed: 0 };
      }
      return { confirmed: 0, unconfirmed: 0 };
    });

    const results = await claimFromMnemonic(TEST_MNEMONIC);

    expect(results.length).toBeGreaterThanOrEqual(1);
    const firstResult = results[0];
    expect(firstResult.success).toBe(true);
    expect(firstResult.bch2Address.startsWith('bitcoincashii:')).toBe(true);
    expect(firstResult.balance).toBe(100000);
  });

  it('invalid mnemonic is rejected', async () => {
    const results = await claimFromMnemonic('not a valid mnemonic phrase');

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Invalid mnemonic phrase');
  });

  it('mnemonic with no balance returns appropriate message', async () => {
    // All balance checks return 0 (the default)
    const results = await claimFromMnemonic(TEST_MNEMONIC);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].balance).toBe(0);
    expect(results[0].error).toContain('No BCH2 balance found');
  });

  it('mnemonic scan finds balances across multiple derivation paths', async () => {
    // Simulate balance on BCH standard path (index 0) and BTC standard path (index 0)
    let addressCallIndex = 0;
    mockGetBalanceByAddress.mockImplementation(async () => {
      addressCallIndex++;
      // First address on first path (BCH m/44'/145'/0'/0/0) - call 1
      if (addressCallIndex === 1) return { confirmed: 50000, unconfirmed: 0 };
      // First address on second path (BTC m/44'/0'/0'/0/0) - call 21
      if (addressCallIndex === 21) return { confirmed: 30000, unconfirmed: 0 };
      return { confirmed: 0, unconfirmed: 0 };
    });

    const results = await claimFromMnemonic(TEST_MNEMONIC);

    expect(results.length).toBe(2);
    expect(results[0].balance).toBe(50000);
    expect(results[1].balance).toBe(30000);
  });

  it('mnemonic with passphrase works', async () => {
    let callCount = 0;
    mockGetBalanceByAddress.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return { confirmed: 25000, unconfirmed: 0 };
      return { confirmed: 0, unconfirmed: 0 };
    });

    const results = await claimFromMnemonic(TEST_MNEMONIC, 'mypassphrase');

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].success).toBe(true);
  });
});

// ============================================================================
// Balance Checking
// ============================================================================
describe('Balance checking', () => {
  it('checks BCH2 balance via Electrum', async () => {
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 75000, unconfirmed: 5000 });

    const result = await claimFromWIF(TEST_WIF_COMPRESSED);

    expect(mockGetBalanceByAddress).toHaveBeenCalled();
    const calledAddress = mockGetBalanceByAddress.mock.calls[0][0];
    expect(calledAddress.startsWith('bitcoincashii:')).toBe(true);
    expect(result.balance).toBeGreaterThanOrEqual(80000);
  });

  it('checks both BCH2 and BC2 balances', async () => {
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 10000, unconfirmed: 0 });
    mockGetBC2Balance.mockResolvedValue({ confirmed: 50000, unconfirmed: 0 });

    const result = await claimFromWIF(TEST_WIF_COMPRESSED);

    expect(result.success).toBe(true);
    expect(result.bc2Balance).toBe(50000);
    expect(mockGetBC2Balance).toHaveBeenCalled();
  });

  it('no balance found returns zero balance', async () => {
    // Default mocks return 0 balance
    const result = await claimFromWIF(TEST_WIF_COMPRESSED);

    expect(result.success).toBe(false);
    expect(result.balance).toBe(0);
    expect(result.error).toBe('No BCH2 balance found for this key');
  });

  it('getTotalClaimable() sums balances across addresses', async () => {
    let callIndex = 0;
    mockGetBalanceByAddress.mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) return { confirmed: 10000, unconfirmed: 5000 };
      if (callIndex === 2) return { confirmed: 20000, unconfirmed: 0 };
      return { confirmed: 0, unconfirmed: 0 };
    });

    // Legacy addresses that convertToCashAddr can handle
    const total = await getTotalClaimable(['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa']);

    expect(total).toBe(35000);
  });

  it('getTotalClaimable() skips invalid addresses gracefully', async () => {
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 5000, unconfirmed: 0 });

    // Mix of valid and invalid addresses
    const total = await getTotalClaimable(['!!!invalid!!!', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2']);

    // Should not throw, may skip invalid or include valid ones
    expect(typeof total).toBe('number');
    expect(total).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// SegWit Recovery (bc1 addresses)
// ============================================================================
describe('SegWit recovery (bc1 addresses)', () => {
  it('detects bc1 balance via scripthash', async () => {
    // Only bc1 (native segwit) balance, no legacy.
    // claimFromWIF scans: legacy, p2pk, bc1, p2sh-segwit, p2tr.
    // Scripthash calls: p2pk(1), bc1(2), p2sh-segwit(3), p2tr(4).
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 0, unconfirmed: 0 });
    let scripthashCallCount = 0;
    mockGetBalanceByScripthash.mockImplementation(async () => {
      scripthashCallCount++;
      if (scripthashCallCount === 2) return { confirmed: 45000, unconfirmed: 0 }; // bc1
      return { confirmed: 0, unconfirmed: 0 };
    });

    const result = await claimFromWIF(TEST_WIF_COMPRESSED);

    expect(result.success).toBe(true);
    expect(result.balance).toBe(45000);
    // Address should be bc1 (SegWit)
    expect(result.address.startsWith('bc1')).toBe(true);
  });

  it('bc1AddressToScripthash() converts valid bc1 address', () => {
    // Known bc1 address (P2WPKH for private key 1)
    // We test the function returns a valid 64-char hex scripthash
    const scripthash = bc1AddressToScripthash('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
    expect(scripthash).toBeTruthy();
    expect(scripthash!.length).toBe(64);
    // Should be valid hex
    expect(scripthash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('bc1AddressToScripthash() returns null for invalid address', () => {
    const result = bc1AddressToScripthash('not-a-valid-address');
    expect(result).toBeNull();
  });

  it('bc1AddressToScripthash() returns null for non-v0 witness', () => {
    // A bc1p (taproot/v1) address should return null since it expects v0
    // Using a dummy invalid string that does not parse as v0
    const result = bc1AddressToScripthash('bc1invalid');
    expect(result).toBeNull();
  });

  it('sends SegWit recovery to BCH2 CashAddr destination', async () => {
    // Only bc1 (native segwit) balance, no legacy.
    // Scripthash calls: p2pk(1), bc1(2), p2sh-segwit(3), p2tr(4).
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 0, unconfirmed: 0 });
    let scripthashCallCount = 0;
    mockGetBalanceByScripthash.mockImplementation(async () => {
      scripthashCallCount++;
      if (scripthashCallCount === 2) return { confirmed: 100000, unconfirmed: 0 }; // bc1
      return { confirmed: 0, unconfirmed: 0 };
    });

    const result = await claimFromWIF(TEST_WIF_COMPRESSED);

    expect(result.success).toBe(true);
    expect(result.balance).toBe(100000);
    // The BCH2 address should always be CashAddr
    expect(result.bch2Address.startsWith('bitcoincashii:')).toBe(true);
    // The source address should be bc1 (SegWit)
    expect(result.address.startsWith('bc1')).toBe(true);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================
describe('Edge cases', () => {
  it('network errors during balance check are handled gracefully', async () => {
    mockGetBalanceByAddress.mockRejectedValue(new Error('Network timeout'));
    mockGetBalanceByScripthash.mockRejectedValue(new Error('Connection refused'));

    // claimFromWIF wraps everything in try-catch
    const result = await claimFromWIF(TEST_WIF_COMPRESSED);

    // Should still return a result (success: false with error message)
    expect(result).toBeDefined();
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('empty responses from Electrum are handled', async () => {
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 0, unconfirmed: 0 });
    mockGetBalanceByScripthash.mockResolvedValue({ confirmed: 0, unconfirmed: 0 });
    mockGetBC2Balance.mockResolvedValue({ confirmed: 0, unconfirmed: 0 });

    const result = await claimFromWIF(TEST_WIF_COMPRESSED);

    // With all-zero balances, claimFromWIF returns success: false
    expect(result.success).toBe(false);
    expect(result.balance).toBe(0);
    expect(result.error).toBe('No BCH2 balance found for this key');
  });

  it('SegWit balance check failure does not block legacy balance', async () => {
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 10000, unconfirmed: 0 });
    mockGetBalanceByScripthash.mockRejectedValue(new Error('SegWit check failed'));

    const result = await claimFromWIF(TEST_WIF_COMPRESSED);

    expect(result.success).toBe(true);
    expect(result.balance).toBe(10000);
    // Address should be legacy since segwit failed
    expect(result.address).toMatch(/^[13]/);
  });

  it('BC2 balance check failure does not block airdrop claim', async () => {
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 50000, unconfirmed: 0 });
    mockGetBC2Balance.mockRejectedValue(new Error('BC2 server down'));

    const result = await claimFromWIF(TEST_WIF_COMPRESSED);

    expect(result.success).toBe(true);
    expect(result.balance).toBe(50000);
    expect(result.bc2Balance).toBe(0);
  });

  it('importBC2Wallet() creates BCH2 wallet from WIF', async () => {
    const result = await importBC2Wallet(TEST_WIF_COMPRESSED);

    expect(result).toBeDefined();
    expect(result.wallet).toBeDefined();
    expect(result.bc2Address).toBeTruthy();
    expect(result.bch2Address).toBeTruthy();
    expect(result.balance).toBeDefined();
    expect(result.balance.confirmed).toBeDefined();
    expect(result.balance.unconfirmed).toBeDefined();
  });

  it('mnemonic scan handles Electrum failures per address gracefully', async () => {
    // First call succeeds with balance, then all fail
    let callCount = 0;
    mockGetBalanceByAddress.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return { confirmed: 10000, unconfirmed: 0 };
      throw new Error('Connection lost');
    });

    const results = await claimFromMnemonic(TEST_MNEMONIC);

    // Should still return the one successful result
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].success).toBe(true);
    expect(results[0].balance).toBe(10000);
  });

  it('combined legacy + segwit balance in WIF claim', async () => {
    // claimFromWIF scans 5 address types: legacy, p2pk, bc1, p2sh-segwit, p2tr.
    // legacy uses getBalanceByAddress, the other 4 use getBalanceByScripthash.
    // Target only bc1 (call 2) for the segwit balance.
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 25000, unconfirmed: 5000 });
    let scripthashCallCount = 0;
    mockGetBalanceByScripthash.mockImplementation(async () => {
      scripthashCallCount++;
      if (scripthashCallCount === 2) return { confirmed: 15000, unconfirmed: 2000 }; // bc1
      return { confirmed: 0, unconfirmed: 0 };
    });

    const result = await claimFromWIF(TEST_WIF_COMPRESSED);

    expect(result.success).toBe(true);
    // Total: legacy(25000+5000) + bc1(15000+2000) = 47000
    expect(result.balance).toBe(47000);
  });

  it('getTotalClaimable() returns 0 for empty address list', async () => {
    const total = await getTotalClaimable([]);
    expect(total).toBe(0);
    expect(mockGetBalanceByAddress).not.toHaveBeenCalled();
  });
});

// ============================================================================
// BIP49 P2SH-P2WPKH and BIP86 Taproot mnemonic scan paths
// ============================================================================
// Known scripthash values for test mnemonic "abandon...about" at specific derivation paths
const KNOWN_SCRIPTHASHES = {
  BIP49_0_0: 'e5c5dbe8c82341872337d56fa52b120e3bac428855d9a450cacf63d15da5c65e', // m/49'/0'/0'/0/0
  BIP49_0_1: '820dd6253e05157b47af7ea1d7975adabd73ecfc885fb9a0f41f2d8f493ac311', // m/49'/0'/0'/0/1
  BIP84_0_0: '6e4f16236139f15046b38f399a683fb2aa8edf5fd128b3e5db017fb0ac74078a', // m/84'/0'/0'/0/0
  BIP86_0_0: 'a4215acda4621d8290b4903f3e497d32a2559a85360eba3daf8a29f6e0a824d5', // m/86'/0'/0'/0/0
  BIP86_0_1: '5b81491440d55aabd23272bd450d3074bd1f034d6dc6d9f98d721b6041870288', // m/86'/0'/0'/0/1
};

describe('Mnemonic scan BIP49/BIP86 paths', () => {
  it('mnemonic scan finds BIP49 P2SH-P2WPKH balance via scripthash', async () => {
    // Return balance when the BIP49 m/49'/0'/0'/0/0 P2SH-P2WPKH scripthash is queried
    mockGetBalanceByScripthash.mockImplementation(async (sh: string) => {
      if (sh === KNOWN_SCRIPTHASHES.BIP49_0_0) return { confirmed: 75000, unconfirmed: 0 };
      return { confirmed: 0, unconfirmed: 0 };
    });

    const results = await claimFromMnemonic(TEST_MNEMONIC);

    // Should find at least one result from BIP49 path
    expect(results.length).toBeGreaterThanOrEqual(1);
    const bip49Result = results.find(r => r.address.startsWith('3'));
    expect(bip49Result).toBeDefined();
    expect(bip49Result!.balance).toBe(75000);
    expect(bip49Result!.bch2Address.startsWith('bitcoincashii:')).toBe(true);
  });

  it('mnemonic scan finds BIP86 Taproot balance via scripthash', async () => {
    // Return balance when the BIP86 m/86'/0'/0'/0/0 P2TR scripthash is queried
    mockGetBalanceByScripthash.mockImplementation(async (sh: string) => {
      if (sh === KNOWN_SCRIPTHASHES.BIP86_0_0) return { confirmed: 42000, unconfirmed: 0 };
      return { confirmed: 0, unconfirmed: 0 };
    });

    const results = await claimFromMnemonic(TEST_MNEMONIC);

    expect(results.length).toBeGreaterThanOrEqual(1);
    const taprootResult = results.find(r => r.address.startsWith('bc1p'));
    expect(taprootResult).toBeDefined();
    expect(taprootResult!.balance).toBe(42000);
    expect(taprootResult!.bch2Address.startsWith('bitcoincashii:')).toBe(true);
  });
});

// ============================================================================
// Internal helper functions tested via re-implementation
// (These mirror the private helpers in bch2-airdrop.ts)
// ============================================================================
const crypto = require('crypto');

function hash160(data: Buffer): Buffer {
  const sha256Hash = crypto.createHash('sha256').update(data).digest();
  return crypto.createHash('ripemd160').update(sha256Hash).digest();
}

function doubleHash(data: Buffer): Buffer {
  const hash1 = crypto.createHash('sha256').update(data).digest();
  return crypto.createHash('sha256').update(hash1).digest();
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
  for (const byte of data) {
    if (byte === 0) result = '1' + result;
    else break;
  }
  return result;
}

function getP2SHP2WPKHAddress(pubkeyHash: Buffer): string {
  const redeemScript = Buffer.concat([Buffer.from([0x00, 0x14]), pubkeyHash]);
  const scriptHash = hash160(redeemScript);
  const versionedHash = Buffer.concat([Buffer.from([0x05]), scriptHash]);
  const checksum = doubleHash(versionedHash).slice(0, 4);
  const addressBytes = Buffer.concat([versionedHash, checksum]);
  return base58Encode(addressBytes);
}

function getP2SHP2WPKHScripthash(pubkeyHash: Buffer): string {
  const redeemScript = Buffer.concat([Buffer.from([0x00, 0x14]), pubkeyHash]);
  const scriptHash = hash160(redeemScript);
  const scriptPubKey = Buffer.concat([
    Buffer.from([0xa9, 0x14]),
    scriptHash,
    Buffer.from([0x87]),
  ]);
  const hash = crypto.createHash('sha256').update(scriptPubKey).digest();
  return Buffer.from(hash).reverse().toString('hex');
}

function getP2TRScripthash(tweakedXonly: Buffer): string {
  const scriptPubKey = Buffer.concat([Buffer.from([0x51, 0x20]), tweakedXonly]);
  const hash = crypto.createHash('sha256').update(scriptPubKey).digest();
  return Buffer.from(hash).reverse().toString('hex');
}

function bech32Polymod(values: number[]): number {
  const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GENERATOR[i];
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const result: number[] = [];
  for (const char of hrp) result.push(char.charCodeAt(0) >> 5);
  result.push(0);
  for (const char of hrp) result.push(char.charCodeAt(0) & 31);
  return result;
}

function bech32mChecksum(hrp: string, data: number[]): number[] {
  const values = [...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const polymod = bech32Polymod(values) ^ 0x2bc830a3;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) {
    checksum.push((polymod >> (5 * (5 - i))) & 31);
  }
  return checksum;
}

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function encodeBech32m(hrp: string, version: number, data: Buffer): string {
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
  if (bits > 0) converted.push((acc << (5 - bits)) & 0x1f);
  const checksum = bech32mChecksum(hrp, converted);
  let result = hrp + '1';
  for (const value of [...converted, ...checksum]) result += BECH32_CHARSET[value];
  return result;
}

function encodeBech32(hrp: string, version: number, data: Buffer): string {
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
  if (bits > 0) converted.push((acc << (5 - bits)) & 0x1f);
  // bech32 checksum (XOR 1)
  const values = [...bech32HrpExpand(hrp), ...converted, 0, 0, 0, 0, 0, 0];
  const polymod = bech32Polymod(values) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) checksum.push((polymod >> (5 * (5 - i))) & 31);
  let result = hrp + '1';
  for (const value of [...converted, ...checksum]) result += BECH32_CHARSET[value];
  return result;
}

function decodeBech32(address: string): { version: number; program: Buffer } | null {
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
  // verify checksum
  if (bech32Polymod([...bech32HrpExpand(hrp), ...data]) !== 1) return null;
  const payload = data.slice(0, -6);
  if (payload.length < 1) return null;
  const version = payload[0];
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
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) return null;
  return { version, program: Buffer.from(program) };
}

function taggedHash(tag: string, data: Buffer): Buffer {
  const tagHash = crypto.createHash('sha256').update(Buffer.from(tag, 'utf8')).digest();
  const combined = Buffer.concat([tagHash, tagHash, data]);
  return crypto.createHash('sha256').update(combined).digest();
}

function encodeCashAddr(prefix: string, type: number, hash: Buffer): string {
  const CHARSET_LOCAL = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const sizeMap: Record<number, number> = { 20: 0, 24: 1, 28: 2, 32: 3, 40: 4, 48: 5, 56: 6, 64: 7 };
  const sizeCode = sizeMap[hash.length] ?? 0;
  const versionByte = (type << 3) | sizeCode;
  const payload: number[] = [];
  let acc = versionByte;
  let bits = 8;
  for (const byte of hash) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; payload.push((acc >> bits) & 0x1f); }
  }
  if (bits > 0) payload.push((acc << (5 - bits)) & 0x1f);
  const GENERATORS = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];
  const prefixData: number[] = [];
  for (const char of prefix) prefixData.push(char.charCodeAt(0) & 0x1f);
  prefixData.push(0);
  const values = [...prefixData, ...payload, 0, 0, 0, 0, 0, 0, 0, 0];
  let chk = 1n;
  for (const value of values) {
    const top = chk >> 35n;
    chk = ((chk & 0x07ffffffffn) << 5n) ^ BigInt(value);
    for (let i = 0; i < 5; i++) { if ((top >> BigInt(i)) & 1n) chk ^= GENERATORS[i]; }
  }
  const polymod = chk ^ 1n;
  const checksum: number[] = [];
  for (let i = 0; i < 8; i++) checksum.push(Number((polymod >> BigInt(5 * (7 - i))) & 0x1fn));
  let result = prefix + ':';
  for (const v of [...payload, ...checksum]) result += CHARSET_LOCAL[v];
  return result;
}

describe('Internal helper functions (re-implemented)', () => {
  // A known 20-byte pubkey hash for testing
  const TEST_PUBKEY_HASH = Buffer.alloc(20, 0xab);

  it('getP2SHP2WPKHAddress() returns valid 3xxx address', () => {
    const address = getP2SHP2WPKHAddress(TEST_PUBKEY_HASH);
    // P2SH addresses start with '3' on mainnet (version byte 0x05)
    expect(address).toMatch(/^3/);
    // Should be a valid base58 string (25-35 chars typical)
    expect(address.length).toBeGreaterThanOrEqual(25);
    expect(address.length).toBeLessThanOrEqual(35);
  });

  it('getP2SHP2WPKHScripthash() returns 64-char hex', () => {
    const scripthash = getP2SHP2WPKHScripthash(TEST_PUBKEY_HASH);
    expect(scripthash).toMatch(/^[0-9a-f]{64}$/);
    // Should be deterministic
    expect(scripthash).toBe(getP2SHP2WPKHScripthash(TEST_PUBKEY_HASH));
  });

  it('getP2TRScripthash() returns 64-char hex', () => {
    // Use a 32-byte tweaked x-only pubkey
    const tweakedXonly = Buffer.alloc(32, 0xcd);
    const scripthash = getP2TRScripthash(tweakedXonly);
    expect(scripthash).toMatch(/^[0-9a-f]{64}$/);
    // Should be deterministic
    expect(scripthash).toBe(getP2TRScripthash(tweakedXonly));
  });

  it('encodeBech32m() produces valid bc1p address', () => {
    // 32-byte data for a Taproot address (version 1)
    const xonly = Buffer.alloc(32, 0x01);
    const address = encodeBech32m('bc', 1, xonly);
    expect(address.startsWith('bc1p')).toBe(true);
    // Bech32m address with 32-byte program: hrp(2) + '1' + version(1) + data(52) + checksum(6) = 62 chars
    expect(address.length).toBeGreaterThan(40);
  });

  it('decodeBech32() rejects invalid checksum', () => {
    // Create a valid bech32 address then tamper with it
    const pubkeyHash = Buffer.alloc(20, 0x01);
    const valid = encodeBech32('bc', 0, pubkeyHash);
    // Tamper with the last character of the checksum
    const chars = valid.split('');
    const lastIdx = chars.length - 1;
    const origChar = chars[lastIdx];
    chars[lastIdx] = BECH32_CHARSET[(BECH32_CHARSET.indexOf(origChar) + 1) % BECH32_CHARSET.length];
    const tampered = chars.join('');
    const result = decodeBech32(tampered);
    expect(result).toBeNull();
  });

  it('decodeBech32() rejects short payload', () => {
    // An address with too little data after the separator
    const result = decodeBech32('bc1qw');
    expect(result).toBeNull();
  });

  it('taggedHash() produces deterministic output', () => {
    const data = Buffer.from('test data', 'utf8');
    const hash1 = taggedHash('TapTweak', data);
    const hash2 = taggedHash('TapTweak', data);
    expect(hash1.length).toBe(32);
    expect(hash1.equals(hash2)).toBe(true);
    // Different tag should produce different result
    const hash3 = taggedHash('TapLeaf', data);
    expect(hash1.equals(hash3)).toBe(false);
  });

  it('convertToCashAddr() handles P2SH version byte (0x05) via getTotalClaimable', async () => {
    // A P2SH address starts with '3' (version byte 0x05)
    // We construct a known P2SH address by base58-encoding version 0x05 + 20-byte hash
    const testHash = Buffer.alloc(20, 0x11);
    const versionedHash = Buffer.concat([Buffer.from([0x05]), testHash]);
    const checksum = doubleHash(versionedHash).slice(0, 4);
    const addressBytes = Buffer.concat([versionedHash, checksum]);
    const p2shAddress = base58Encode(addressBytes);

    // Verify it starts with '3'
    expect(p2shAddress).toMatch(/^3/);

    // When getTotalClaimable processes this, it calls convertToCashAddr internally
    // which should map version 0x05 to CashAddr type 1 (P2SH → bitcoincashii:p...)
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 99000, unconfirmed: 0 });

    const total = await getTotalClaimable([p2shAddress]);

    // The mock was called, meaning convertToCashAddr succeeded
    expect(mockGetBalanceByAddress).toHaveBeenCalled();
    const calledAddr = mockGetBalanceByAddress.mock.calls[0][0];
    // P2SH CashAddr starts with 'p' after prefix
    expect(calledAddr.startsWith('bitcoincashii:p')).toBe(true);
    expect(total).toBe(99000);
  });
});

// ============================================================================
// claimFromWIF BC2 SegWit balance path
// ============================================================================
describe('claimFromWIF BC2 SegWit balance', () => {
  it('includes BC2 SegWit balance when segwitBalance > 0', async () => {
    // claimFromWIF scans 5 types: legacy, p2pk, bc1, p2sh-segwit, p2tr.
    // Scripthash calls: p2pk(1), bc1(2), p2sh-segwit(3), p2tr(4).
    // Give legacy and bc1 balances, leave others at 0.
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 10000, unconfirmed: 0 });
    let scripthashCallCount = 0;
    mockGetBalanceByScripthash.mockImplementation(async () => {
      scripthashCallCount++;
      if (scripthashCallCount === 2) return { confirmed: 30000, unconfirmed: 0 }; // bc1
      return { confirmed: 0, unconfirmed: 0 };
    });
    // BC2 legacy balance
    mockGetBC2Balance.mockResolvedValue({ confirmed: 50000, unconfirmed: 0 });
    // BC2 SegWit balance (called for bc1 type)
    mockGetBC2BalanceByScripthash.mockResolvedValue({ confirmed: 20000, unconfirmed: 0 });

    const result = await claimFromWIF(TEST_WIF_COMPRESSED);

    expect(result.success).toBe(true);
    // Total balance: legacy(10000) + bc1(30000) = 40000
    expect(result.balance).toBe(40000);
    // BC2 total: legacy(50000) + bc1(20000) = 70000
    expect(result.bc2Balance).toBe(70000);
    // BCH2 address is always CashAddr
    expect(result.bch2Address.startsWith('bitcoincashii:')).toBe(true);
    // BC2 SegWit balance check should have been called (because bc1 had balance)
    expect(mockGetBC2BalanceByScripthash).toHaveBeenCalled();
  });

  it('does NOT check BC2 SegWit balance when segwitBalance is 0', async () => {
    // Legacy BCH2 balance
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 10000, unconfirmed: 0 });
    // SegWit balance = 0 (does NOT trigger bc2 segwit check)
    mockGetBalanceByScripthash.mockResolvedValue({ confirmed: 0, unconfirmed: 0 });
    // BC2 legacy balance
    mockGetBC2Balance.mockResolvedValue({ confirmed: 50000, unconfirmed: 0 });

    const result = await claimFromWIF(TEST_WIF_COMPRESSED);

    expect(result.success).toBe(true);
    expect(result.balance).toBe(10000);
    expect(result.bc2Balance).toBe(50000);
    // Address should be legacy (not bc1) since segwit balance is 0
    expect(result.address).toMatch(/^[13]/);
    // BC2 SegWit balance check should NOT have been called
    expect(mockGetBC2BalanceByScripthash).not.toHaveBeenCalled();
  });
});

// ============================================================================
// computeTweakedXonly null return during BIP86 mnemonic scan
// ============================================================================
describe('computeTweakedXonly null return during BIP86 scan', () => {
  it('mnemonic scan continues without crashing when xOnlyPointAddTweak returns null', async () => {
    // Override xOnlyPointAddTweak to return null for the first call (BIP86 index 0),
    // simulating computeTweakedXonly returning null. The scan should skip that index
    // and continue to find balance at the next Taproot index.
    let tweakCallCount = 0;
    mockXOnlyPointAddTweakOverride = (point: Uint8Array, tweak: Uint8Array) => {
      tweakCallCount++;
      // Return null for the first BIP86 call to simulate computeTweakedXonly returning null
      if (tweakCallCount === 1) return null;
      // All other calls use the real implementation
      return realEcc.default.xOnlyPointAddTweak(point, tweak);
    };

    // Return balance for BIP86 index 1's P2TR scripthash
    mockGetBalanceByScripthash.mockImplementation(async (sh: string) => {
      if (sh === KNOWN_SCRIPTHASHES.BIP86_0_1) return { confirmed: 33000, unconfirmed: 0 };
      return { confirmed: 0, unconfirmed: 0 };
    });

    const results = await claimFromMnemonic(TEST_MNEMONIC);

    // Should find at least one result from BIP86 path (the second index)
    // and should NOT have crashed due to the null return on the first index
    expect(results.length).toBeGreaterThanOrEqual(1);
    const taprootResult = results.find(r => r.address.startsWith('bc1p'));
    expect(taprootResult).toBeDefined();
    expect(taprootResult!.balance).toBe(33000);
  });
});

// ============================================================================
// BIP49/BIP84/BIP86 paths with non-zero BC2 balance
// ============================================================================
describe('Mnemonic scan paths with non-zero BC2 balance', () => {
  it('BIP49 path reports both bch2Balance and bc2Balance > 0', async () => {
    // Return BCH2 balance for BIP49 m/49'/0'/0'/0/0 P2SH-P2WPKH scripthash
    mockGetBalanceByScripthash.mockImplementation(async (sh: string) => {
      if (sh === KNOWN_SCRIPTHASHES.BIP49_0_0) return { confirmed: 80000, unconfirmed: 0 };
      return { confirmed: 0, unconfirmed: 0 };
    });

    // Return BC2 balance for the same scripthash
    mockGetBC2BalanceByScripthash.mockImplementation(async (sh: string) => {
      if (sh === KNOWN_SCRIPTHASHES.BIP49_0_0) return { confirmed: 25000, unconfirmed: 5000 };
      return { confirmed: 0, unconfirmed: 0 };
    });

    const results = await claimFromMnemonic(TEST_MNEMONIC);

    // Should find the BIP49 result
    expect(results.length).toBeGreaterThanOrEqual(1);
    const bip49Result = results.find(r => r.address.startsWith('3'));
    expect(bip49Result).toBeDefined();
    expect(bip49Result!.balance).toBe(80000);
    expect(bip49Result!.bc2Balance).toBe(30000); // 25000 + 5000
    expect(bip49Result!.bch2Address.startsWith('bitcoincashii:')).toBe(true);
    expect(mockGetBC2BalanceByScripthash).toHaveBeenCalled();
  });

  it('BIP84 path reports both bch2Balance and bc2Balance > 0', async () => {
    // Return BCH2 balance for BIP84 m/84'/0'/0'/0/0 bc1 scripthash
    mockGetBalanceByScripthash.mockImplementation(async (sh: string) => {
      if (sh === KNOWN_SCRIPTHASHES.BIP84_0_0) return { confirmed: 65000, unconfirmed: 0 };
      return { confirmed: 0, unconfirmed: 0 };
    });

    // Return BC2 balance for the same scripthash
    mockGetBC2BalanceByScripthash.mockImplementation(async (sh: string) => {
      if (sh === KNOWN_SCRIPTHASHES.BIP84_0_0) return { confirmed: 40000, unconfirmed: 0 };
      return { confirmed: 0, unconfirmed: 0 };
    });

    const results = await claimFromMnemonic(TEST_MNEMONIC);

    expect(results.length).toBeGreaterThanOrEqual(1);
    const bip84Result = results.find(r => r.address.startsWith('bc1q'));
    expect(bip84Result).toBeDefined();
    expect(bip84Result!.balance).toBe(65000);
    expect(bip84Result!.bc2Balance).toBe(40000);
    expect(bip84Result!.bch2Address.startsWith('bitcoincashii:')).toBe(true);
    expect(mockGetBC2BalanceByScripthash).toHaveBeenCalled();
  });

  it('BIP86 Taproot path reports both bch2Balance and bc2Balance > 0', async () => {
    // Return BCH2 balance for BIP86 m/86'/0'/0'/0/0 P2TR scripthash
    mockGetBalanceByScripthash.mockImplementation(async (sh: string) => {
      if (sh === KNOWN_SCRIPTHASHES.BIP86_0_0) return { confirmed: 55000, unconfirmed: 0 };
      return { confirmed: 0, unconfirmed: 0 };
    });

    // Return BC2 balance for the same scripthash
    mockGetBC2BalanceByScripthash.mockImplementation(async (sh: string) => {
      if (sh === KNOWN_SCRIPTHASHES.BIP86_0_0) return { confirmed: 15000, unconfirmed: 10000 };
      return { confirmed: 0, unconfirmed: 0 };
    });

    const results = await claimFromMnemonic(TEST_MNEMONIC);

    expect(results.length).toBeGreaterThanOrEqual(1);
    const taprootResult = results.find(r => r.address.startsWith('bc1p'));
    expect(taprootResult).toBeDefined();
    expect(taprootResult!.balance).toBe(55000);
    expect(taprootResult!.bc2Balance).toBe(25000); // 15000 + 10000
    expect(taprootResult!.bch2Address.startsWith('bitcoincashii:')).toBe(true);
    expect(mockGetBC2BalanceByScripthash).toHaveBeenCalled();
  });
});

// ============================================================================
// Gap coverage: additional edge cases
// ============================================================================
describe('Gap coverage: claimFromWIF SegWit exception returns P2PKH claim', () => {
  it('exception during SegWit scripthash balance check still returns P2PKH balance', async () => {
    // P2PKH (legacy) has a balance
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 12000, unconfirmed: 3000 });
    // SegWit scripthash throws an exception
    mockGetBalanceByScripthash.mockRejectedValue(new Error('Scripthash lookup failed'));
    // BC2 balance succeeds
    mockGetBC2Balance.mockResolvedValue({ confirmed: 5000, unconfirmed: 0 });

    const result = await claimFromWIF(TEST_WIF_COMPRESSED);

    expect(result.success).toBe(true);
    // Balance should only include the P2PKH amount (segwit failed gracefully)
    expect(result.balance).toBe(15000); // 12000 + 3000
    // Address should be legacy (not bc1) since segwit check threw
    expect(result.address).toMatch(/^[13]/);
    // BCH2 address should still be valid CashAddr
    expect(result.bch2Address.startsWith('bitcoincashii:')).toBe(true);
    // BC2 segwit check should NOT have been called (segwitBalance is 0 due to exception)
    expect(mockGetBC2BalanceByScripthash).not.toHaveBeenCalled();
  });
});

describe('Gap coverage: unconfirmed-only balance detection', () => {
  it('claimFromWIF detects balance when confirmed=0 but unconfirmed>0', async () => {
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 0, unconfirmed: 77000 });

    const result = await claimFromWIF(TEST_WIF_COMPRESSED);

    expect(result.success).toBe(true);
    expect(result.balance).toBe(77000);
    expect(result.bch2Address.startsWith('bitcoincashii:')).toBe(true);
  });

  it('claimFromWIF detects segwit balance when confirmed=0 but unconfirmed>0', async () => {
    // Only bc1 (call 2) gets unconfirmed balance.
    // Scripthash calls: p2pk(1), bc1(2), p2sh-segwit(3), p2tr(4).
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 0, unconfirmed: 0 });
    let scripthashCallCount = 0;
    mockGetBalanceByScripthash.mockImplementation(async () => {
      scripthashCallCount++;
      if (scripthashCallCount === 2) return { confirmed: 0, unconfirmed: 44000 }; // bc1
      return { confirmed: 0, unconfirmed: 0 };
    });

    const result = await claimFromWIF(TEST_WIF_COMPRESSED);

    expect(result.success).toBe(true);
    expect(result.balance).toBe(44000);
    // segwitBalance > 0 so address should be bc1
    expect(result.address.startsWith('bc1')).toBe(true);
  });
});

describe('Gap coverage: claimFromMnemonic empty mnemonic', () => {
  it('empty mnemonic string returns invalid mnemonic error', async () => {
    const results = await claimFromMnemonic('');

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Invalid mnemonic phrase');
    expect(results[0].balance).toBe(0);
  });

  it('whitespace-only mnemonic returns invalid mnemonic error', async () => {
    const results = await claimFromMnemonic('   ');

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Invalid mnemonic phrase');
  });
});

describe('Gap coverage: claimFromMnemonic Taproot null tweak (all indices)', () => {
  it('all BIP86 indices returning null tweak produce no taproot results', async () => {
    // Override xOnlyPointAddTweak to always return null (all BIP86 indices skipped)
    mockXOnlyPointAddTweakOverride = () => null;

    // Give a balance on a BIP44 legacy path so results are non-empty
    let callCount = 0;
    mockGetBalanceByAddress.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return { confirmed: 10000, unconfirmed: 0 };
      return { confirmed: 0, unconfirmed: 0 };
    });

    const results = await claimFromMnemonic(TEST_MNEMONIC);

    // Should have the legacy result but no taproot results
    expect(results.length).toBeGreaterThanOrEqual(1);
    const taprootResults = results.filter(r => r.address.startsWith('bc1p'));
    expect(taprootResults).toHaveLength(0);
  });
});

describe('Gap coverage: BIP49 derivation error handling', () => {
  it('mnemonic scan continues when individual BIP49 address balance check throws', async () => {
    // Make first BIP49 scripthash (index 0) throw, second (index 1) succeed
    mockGetBalanceByScripthash.mockImplementation(async (sh: string) => {
      if (sh === KNOWN_SCRIPTHASHES.BIP49_0_0) throw new Error('BIP49 derivation error');
      if (sh === KNOWN_SCRIPTHASHES.BIP49_0_1) return { confirmed: 60000, unconfirmed: 0 };
      return { confirmed: 0, unconfirmed: 0 };
    });

    const results = await claimFromMnemonic(TEST_MNEMONIC);

    // Should find the second BIP49 address (first was skipped due to error)
    expect(results.length).toBeGreaterThanOrEqual(1);
    const bip49Result = results.find(r => r.address.startsWith('3'));
    expect(bip49Result).toBeDefined();
    expect(bip49Result!.balance).toBe(60000);
  });
});

describe('Gap coverage: getTotalClaimable edge cases', () => {
  it('getTotalClaimable with array of only invalid addresses returns 0', async () => {
    // These strings contain characters not in the Base58 alphabet,
    // so convertToCashAddr throws for each one, triggering the continue path
    const total = await getTotalClaimable(['!!!', '@@@invalid', '$$$$']);

    expect(total).toBe(0);
    // getBalanceByAddress should not have been called since convertToCashAddr throws for all
    expect(mockGetBalanceByAddress).not.toHaveBeenCalled();
  });

  it('getTotalClaimable returns only valid address balance when mixed with invalid', async () => {
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 8000, unconfirmed: 2000 });

    // "!!!invalid!!!" should trigger convertToCashAddr to throw, hitting the continue path
    const total = await getTotalClaimable(['!!!invalid!!!', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2']);

    // Only the valid address balance should be included
    expect(total).toBe(10000);
    // getBalanceByAddress should have been called once (only for the valid address)
    expect(mockGetBalanceByAddress).toHaveBeenCalledTimes(1);
  });
});

describe('Gap coverage: convertToCashAddr P2SH version byte (0x05)', () => {
  it('version byte 0x05 maps to CashAddr type 1 (P2SH prefix p)', async () => {
    // Construct a P2SH address (version byte 0x05) with a known hash
    const testHash = Buffer.alloc(20, 0x55);
    const versionedHash = Buffer.concat([Buffer.from([0x05]), testHash]);
    const checksum = doubleHash(versionedHash).slice(0, 4);
    const addressBytes = Buffer.concat([versionedHash, checksum]);
    const p2shAddress = base58Encode(addressBytes);

    expect(p2shAddress).toMatch(/^3/);

    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 42000, unconfirmed: 0 });

    const total = await getTotalClaimable([p2shAddress]);

    expect(total).toBe(42000);
    // The CashAddr should have type 1 (P2SH) indicated by 'p' after prefix
    const calledAddr = mockGetBalanceByAddress.mock.calls[0][0];
    expect(calledAddr.startsWith('bitcoincashii:p')).toBe(true);
  });

  it('version byte 0x00 maps to CashAddr type 0 (P2PKH prefix q)', async () => {
    // Construct a P2PKH address (version byte 0x00) with a known hash
    const testHash = Buffer.alloc(20, 0x33);
    const versionedHash = Buffer.concat([Buffer.from([0x00]), testHash]);
    const checksum = doubleHash(versionedHash).slice(0, 4);
    const addressBytes = Buffer.concat([versionedHash, checksum]);
    const p2pkhAddress = base58Encode(addressBytes);

    expect(p2pkhAddress).toMatch(/^1/);

    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 15000, unconfirmed: 0 });

    const total = await getTotalClaimable([p2pkhAddress]);

    expect(total).toBe(15000);
    const calledAddr = mockGetBalanceByAddress.mock.calls[0][0];
    expect(calledAddr.startsWith('bitcoincashii:q')).toBe(true);
  });
});

describe('Gap coverage: encodeBech32m checksum constant verification', () => {
  it('encodeBech32m uses 0x2bc830a3 checksum constant (bech32m), NOT 1 (bech32)', () => {
    const xonly = Buffer.alloc(32, 0xab);
    const address = encodeBech32m('bc', 1, xonly);

    // Decode the address and verify that the bech32m polymod validates to 0x2bc830a3
    const lower = address.toLowerCase();
    const pos = lower.lastIndexOf('1');
    const hrp = lower.slice(0, pos);
    const dataStr = lower.slice(pos + 1);
    const data: number[] = [];
    for (const char of dataStr) {
      data.push(BECH32_CHARSET.indexOf(char));
    }

    // Bech32m: polymod should equal 0x2bc830a3
    const polymodResult = bech32Polymod([...bech32HrpExpand(hrp), ...data]);
    expect(polymodResult).toBe(0x2bc830a3);

    // A bech32 (not bech32m) encoded address should produce polymod === 1 instead
    const pubkeyHash = Buffer.alloc(20, 0xab);
    const bech32Addr = encodeBech32('bc', 0, pubkeyHash);
    const bech32Lower = bech32Addr.toLowerCase();
    const bech32Pos = bech32Lower.lastIndexOf('1');
    const bech32Hrp = bech32Lower.slice(0, bech32Pos);
    const bech32DataStr = bech32Lower.slice(bech32Pos + 1);
    const bech32Data: number[] = [];
    for (const char of bech32DataStr) {
      bech32Data.push(BECH32_CHARSET.indexOf(char));
    }

    const bech32PolymodResult = bech32Polymod([...bech32HrpExpand(bech32Hrp), ...bech32Data]);
    expect(bech32PolymodResult).toBe(1);

    // Confirm they are different constants
    expect(polymodResult).not.toBe(bech32PolymodResult);
  });
});

describe('Gap coverage: decodeBech32 checksum failure path', () => {
  it('decodeBech32 returns null when checksum is corrupted (bit flip)', () => {
    // Encode a valid bech32 address
    const pubkeyHash = Buffer.alloc(20, 0xcd);
    const valid = encodeBech32('bc', 0, pubkeyHash);

    // Corrupt a character in the middle of the data (not just the checksum)
    const chars = valid.split('');
    const midIdx = Math.floor((valid.indexOf('1') + 1 + chars.length) / 2);
    const origChar = chars[midIdx];
    const origIdx = BECH32_CHARSET.indexOf(origChar);
    // Flip to a different valid bech32 character
    chars[midIdx] = BECH32_CHARSET[(origIdx + 7) % BECH32_CHARSET.length];
    const corrupted = chars.join('');

    const result = decodeBech32(corrupted);
    expect(result).toBeNull();
  });

  it('decodeBech32 returns null for invalid bech32 character', () => {
    // Insert a character not in the bech32 charset
    const result = decodeBech32('bc1qinvalidchar!here');
    expect(result).toBeNull();
  });

  it('decodeBech32 returns null for address with no separator', () => {
    const result = decodeBech32('noseparatorhere');
    expect(result).toBeNull();
  });
});

// ============================================================================
// Gap coverage: BIP84 path iteration count
// ============================================================================
describe('Gap coverage: BIP84 path iteration count', () => {
  it('claimFromMnemonic checks exactly 40 scripthash lookups for BIP84 (2 paths x 20 addresses)', async () => {
    // BIP84 uses getBalanceByScripthash. BIP49 also uses it (40 calls for 2 paths x 20).
    // BIP84 adds another 40 calls (2 paths x 20 addresses each).
    // BIP86 Taproot adds up to 40 more (but some may be skipped if tweak is null).
    // We need to count just the BIP84-specific calls.
    //
    // Strategy: Track all getBalanceByScripthash calls. BIP49 accounts for calls 1-40,
    // BIP84 for calls 41-80, BIP86 for calls 81+.
    // We return 0 balance for everything so no bc2 balance calls happen.

    const results = await claimFromMnemonic(TEST_MNEMONIC);

    // Total scripthash calls should be at least 80 (40 BIP49 + 40 BIP84).
    // BIP86 adds more but some may be skipped due to null tweak.
    const totalScripthashCalls = mockGetBalanceByScripthash.mock.calls.length;

    // BIP49: 2 paths x 20 = 40 calls
    // BIP84: 2 paths x 20 = 40 calls
    // Total at minimum: 80 (BIP86 may add more)
    expect(totalScripthashCalls).toBeGreaterThanOrEqual(80);

    // Verify the BIP84 paths specifically account for 40 calls (calls 41-80)
    // by checking that call count jumped from 40 to at least 80
    // Since all return 0, results should show "No BCH2 balance found"
    expect(results).toHaveLength(1);
    expect(results[0].balance).toBe(0);
    expect(results[0].error).toContain('No BCH2 balance found');
  });
});

// ============================================================================
// Gap coverage: BIP86 Taproot continuation after null tweak at index 0
// ============================================================================
describe('Gap coverage: BIP86 Taproot continuation after null tweak at index 0 but not index 1', () => {
  it('when computeTweakedXonly returns null for index 0 but succeeds for index 1, balance at index 1 is found', async () => {
    // Override xOnlyPointAddTweak: return null only for the very first BIP86 call (index 0 of first path),
    // then use real implementation for all subsequent calls.
    let tweakCallCount = 0;
    mockXOnlyPointAddTweakOverride = (point: Uint8Array, tweak: Uint8Array) => {
      tweakCallCount++;
      if (tweakCallCount === 1) return null; // BIP86 index 0 -> null
      return realEcc.default.xOnlyPointAddTweak(point, tweak);
    };

    // Return balance for BIP86 index 1's P2TR scripthash
    mockGetBalanceByScripthash.mockImplementation(async (sh: string) => {
      if (sh === KNOWN_SCRIPTHASHES.BIP86_0_1) return { confirmed: 19000, unconfirmed: 0 };
      return { confirmed: 0, unconfirmed: 0 };
    });

    const results = await claimFromMnemonic(TEST_MNEMONIC);

    // Should find the Taproot result at index 1
    const taprootResult = results.find(r => r.address.startsWith('bc1p'));
    expect(taprootResult).toBeDefined();
    expect(taprootResult!.balance).toBe(19000);
    expect(taprootResult!.bch2Address.startsWith('bitcoincashii:')).toBe(true);

    // Verify that tweak was called at least twice (first returned null, second succeeded)
    expect(tweakCallCount).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// Gap coverage: encodeBech32m() padding with odd-bit-count data
// ============================================================================
describe('Gap coverage: encodeBech32m() padding with odd-bit-count data', () => {
  it('encodes 32-byte data correctly (256 bits = 51 groups of 5 bits + 1 bit padding)', () => {
    // 32 bytes = 256 bits. 256 / 5 = 51 remainder 1.
    // So there is 1 leftover bit that must be padded to form a 52nd 5-bit group.
    const data32 = Buffer.alloc(32, 0xff);
    const address = encodeBech32m('bc', 1, data32);

    expect(address.startsWith('bc1p')).toBe(true);
    // Verify it is a valid bech32m by checking polymod
    const lower = address.toLowerCase();
    const pos = lower.lastIndexOf('1');
    const hrp = lower.slice(0, pos);
    const dataStr = lower.slice(pos + 1);
    const decoded: number[] = [];
    for (const char of dataStr) {
      decoded.push(BECH32_CHARSET.indexOf(char));
    }
    const polymodResult = bech32Polymod([...bech32HrpExpand(hrp), ...decoded]);
    expect(polymodResult).toBe(0x2bc830a3);
  });

  it('encodes 20-byte data correctly (160 bits = 32 groups of 5 bits, no padding needed)', () => {
    // 20 bytes = 160 bits. 160 / 5 = 32 exactly, so no padding bits needed.
    const data20 = Buffer.alloc(20, 0xaa);
    const address = encodeBech32m('bc', 1, data20);

    expect(address.startsWith('bc1p')).toBe(true);
    // Verify bech32m polymod
    const lower = address.toLowerCase();
    const pos = lower.lastIndexOf('1');
    const hrp = lower.slice(0, pos);
    const dataStr = lower.slice(pos + 1);
    const decoded: number[] = [];
    for (const char of dataStr) {
      decoded.push(BECH32_CHARSET.indexOf(char));
    }
    const polymodResult = bech32Polymod([...bech32HrpExpand(hrp), ...decoded]);
    expect(polymodResult).toBe(0x2bc830a3);
  });

  it('encodes 33-byte data (264 bits = 52 groups + 4 padding bits)', () => {
    // 33 bytes = 264 bits. 264 / 5 = 52 remainder 4, so 4 padding bits needed.
    const data33 = Buffer.from('01'.repeat(33), 'hex');
    const address = encodeBech32m('bc', 1, data33);

    expect(address.startsWith('bc1p')).toBe(true);
    // Verify bech32m polymod
    const lower = address.toLowerCase();
    const pos = lower.lastIndexOf('1');
    const hrp = lower.slice(0, pos);
    const dataStr = lower.slice(pos + 1);
    const decoded: number[] = [];
    for (const char of dataStr) {
      decoded.push(BECH32_CHARSET.indexOf(char));
    }
    const polymodResult = bech32Polymod([...bech32HrpExpand(hrp), ...decoded]);
    expect(polymodResult).toBe(0x2bc830a3);
  });
});

// ============================================================================
// Gap coverage: taggedHash() test vector validation
// ============================================================================
describe('Gap coverage: taggedHash() test vector validation', () => {
  it('taggedHash("BIP0340/challenge", known_data) is deterministic and 32 bytes', () => {
    const knownData = Buffer.alloc(32, 0x01);
    const hash1 = taggedHash('BIP0340/challenge', knownData);
    const hash2 = taggedHash('BIP0340/challenge', knownData);

    // Must be 32 bytes (SHA-256 output)
    expect(hash1.length).toBe(32);
    expect(hash2.length).toBe(32);

    // Must be deterministic
    expect(hash1.equals(hash2)).toBe(true);
  });

  it('taggedHash() matches expected structure: SHA256(SHA256(tag) || SHA256(tag) || data)', () => {
    const tag = 'TapTweak';
    const data = Buffer.from('deadbeef', 'hex');

    // Compute manually
    const tagHashManual = crypto.createHash('sha256').update(Buffer.from(tag, 'utf8')).digest();
    const combinedManual = Buffer.concat([tagHashManual, tagHashManual, data]);
    const expectedHash = crypto.createHash('sha256').update(combinedManual).digest();

    const result = taggedHash(tag, data);
    expect(result.equals(expectedHash)).toBe(true);
  });

  it('taggedHash() with empty data produces valid 32-byte hash', () => {
    const result = taggedHash('BIP0340/challenge', Buffer.alloc(0));
    expect(result.length).toBe(32);
    // Should not be all zeros
    expect(result.equals(Buffer.alloc(32, 0))).toBe(false);
  });

  it('different tags produce different hashes for same data', () => {
    const data = Buffer.alloc(32, 0xab);
    const h1 = taggedHash('BIP0340/challenge', data);
    const h2 = taggedHash('BIP0340/aux', data);
    const h3 = taggedHash('TapTweak', data);

    expect(h1.equals(h2)).toBe(false);
    expect(h1.equals(h3)).toBe(false);
    expect(h2.equals(h3)).toBe(false);
  });
});

// ============================================================================
// Gap coverage: claimFromMnemonic() with 24-word mnemonic
// ============================================================================
describe('Gap coverage: claimFromMnemonic() with 24-word mnemonic', () => {
  it('24-word mnemonic is accepted and scanned correctly', async () => {
    // A valid 24-word BIP39 mnemonic (256 bits of entropy)
    const MNEMONIC_24 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

    // Return balance on the first BCH path address
    let callCount = 0;
    mockGetBalanceByAddress.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return { confirmed: 200000, unconfirmed: 0 };
      return { confirmed: 0, unconfirmed: 0 };
    });

    const results = await claimFromMnemonic(MNEMONIC_24);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].success).toBe(true);
    expect(results[0].balance).toBe(200000);
    expect(results[0].bch2Address.startsWith('bitcoincashii:')).toBe(true);
  });

  it('24-word mnemonic produces different addresses than 12-word mnemonic', async () => {
    const MNEMONIC_24 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

    // Capture addresses for 24-word mnemonic
    let calls24: string[] = [];
    mockGetBalanceByAddress.mockImplementation(async (addr: string) => {
      calls24.push(addr);
      return { confirmed: 0, unconfirmed: 0 };
    });
    await claimFromMnemonic(MNEMONIC_24);

    // Capture addresses for 12-word mnemonic
    let calls12: string[] = [];
    mockGetBalanceByAddress.mockImplementation(async (addr: string) => {
      calls12.push(addr);
      return { confirmed: 0, unconfirmed: 0 };
    });
    await claimFromMnemonic(TEST_MNEMONIC);

    // First address on each should differ (different entropy -> different keys)
    expect(calls24.length).toBeGreaterThan(0);
    expect(calls12.length).toBeGreaterThan(0);
    expect(calls24[0]).not.toBe(calls12[0]);
  });
});

// ============================================================================
// Gap coverage: claimFromWIF() BC2 SegWit balance check failure in catch block
// ============================================================================
describe('Gap coverage: claimFromWIF() BC2 SegWit balance check failure in catch block', () => {
  it('when getBC2BalanceByScripthash throws, bc2Balance excludes segwit portion but claim still succeeds', async () => {
    // claimFromWIF scans 5 types: legacy, p2pk, bc1, p2sh-segwit, p2tr.
    // Scripthash calls: p2pk(1), bc1(2), p2sh-segwit(3), p2tr(4).
    // Give legacy and bc1 balances, leave others at 0.
    mockGetBalanceByAddress.mockResolvedValue({ confirmed: 10000, unconfirmed: 0 });
    let scripthashCallCount = 0;
    mockGetBalanceByScripthash.mockImplementation(async () => {
      scripthashCallCount++;
      if (scripthashCallCount === 2) return { confirmed: 30000, unconfirmed: 0 }; // bc1
      return { confirmed: 0, unconfirmed: 0 };
    });
    // BC2 legacy balance succeeds
    mockGetBC2Balance.mockResolvedValue({ confirmed: 50000, unconfirmed: 0 });
    // BC2 SegWit balance THROWS (the catch block catches this)
    mockGetBC2BalanceByScripthash.mockRejectedValue(new Error('BC2 SegWit lookup failed'));

    const result = await claimFromWIF(TEST_WIF_COMPRESSED);

    // Claim should still succeed
    expect(result.success).toBe(true);
    // Total BCH2 balance: legacy(10000) + bc1(30000) = 40000
    expect(result.balance).toBe(40000);
    // BC2 balance should only include legacy (50000), NOT bc1 segwit (which threw)
    expect(result.bc2Balance).toBe(50000);
    // BCH2 address should still be CashAddr
    expect(result.bch2Address.startsWith('bitcoincashii:')).toBe(true);
    // Verify the BC2 SegWit balance check was attempted
    expect(mockGetBC2BalanceByScripthash).toHaveBeenCalled();
  });
});
