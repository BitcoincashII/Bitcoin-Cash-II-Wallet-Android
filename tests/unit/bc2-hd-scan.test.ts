/**
 * Unit tests for the BC2 HD account scan (scanBC2Hd) — the gap-limit + balance
 * aggregation + atomicity guarantees, with the explorer mocked.
 */
import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';
import ecc from '../../blue_modules/noble_ecc';
import { bc2AddressFromPubkey } from '../../class/bch2-wallet-storage';

const bip32 = BIP32Factory(ecc);

// address -> {confirmed, unconfirmed, txCount}; addresses in mockFail always throw.
const mockInfo = new Map<string, { confirmed: number; unconfirmed: number; txCount: number }>();
const mockUtxos = new Map<string, any[]>();
const mockFail = new Set<string>();

jest.mock('../../blue_modules/BCH2Electrum', () => ({
  getBC2AddressInfo: async (addr: string) => {
    if (mockFail.has(addr)) throw new Error('explorer 503');
    return mockInfo.get(addr) || { confirmed: 0, unconfirmed: 0, txCount: 0 };
  },
  getBC2Utxos: async (addr: string) => mockUtxos.get(addr) || [],
  filterMatureUtxos: async (u: any[]) => u,
  getUtxosByAddress: async () => [],
  getUtxosByScripthash: async () => [],
  broadcastTransaction: async () => '',
  broadcastBC2Transaction: async () => '',
}));

import { scanBC2Hd } from '../../class/bch2-transaction';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const root = bip32.fromSeed(bip39.mnemonicToSeedSync(TEST_MNEMONIC));
// scanBC2Hd is watch-only: it takes the account xpub, not the mnemonic.
const NATIVE_XPUB = root.derivePath("m/84'/0'/0'").neutered().toBase58();

function addr(chain: 0 | 1, index: number): string {
  const node = root.derivePath(`m/84'/0'/0'/${chain}/${index}`); // native-segwit
  return bc2AddressFromPubkey('native-segwit', Buffer.from(node.publicKey));
}

beforeEach(() => { mockInfo.clear(); mockUtxos.clear(); mockFail.clear(); });

describe('scanBC2Hd', () => {
  it('aggregates balance across multiple used indices', async () => {
    mockInfo.set(addr(0, 0), { confirmed: 100, unconfirmed: 0, txCount: 1 });
    mockInfo.set(addr(0, 2), { confirmed: 50, unconfirmed: 5, txCount: 1 });
    mockUtxos.set(addr(0, 0), [{ txid: 'a'.repeat(64), vout: 0, value: 100 }]);
    mockUtxos.set(addr(0, 2), [{ txid: 'b'.repeat(64), vout: 1, value: 50 }]);
    const scan = await scanBC2Hd(NATIVE_XPUB, 'native-segwit');
    expect(scan.confirmed).toBe(150);
    expect(scan.unconfirmed).toBe(5);
    expect(scan.utxos).toHaveLength(2);
    expect(scan.utxos.map(u => u.index).sort()).toEqual([0, 2]);
  });

  it('a used-but-empty address (tx_count>0, balance 0) does NOT stop the scan early', async () => {
    // index 1 spent-empty; funds live at index 2 (past it). A balance-only gap
    // check would miss index 2 — tx_count must keep the scan going.
    mockInfo.set(addr(0, 0), { confirmed: 10, unconfirmed: 0, txCount: 1 });
    mockInfo.set(addr(0, 1), { confirmed: 0, unconfirmed: 0, txCount: 3 }); // used, now empty
    mockInfo.set(addr(0, 2), { confirmed: 77, unconfirmed: 0, txCount: 1 });
    mockUtxos.set(addr(0, 2), [{ txid: 'c'.repeat(64), vout: 0, value: 77 }]);
    const scan = await scanBC2Hd(NATIVE_XPUB, 'native-segwit');
    expect(scan.confirmed).toBe(87);
    expect(scan.utxos.some(u => u.index === 2)).toBe(true);
    expect(scan.nextReceiveIndex).toBe(3); // first unused index past all used ones
  });

  it('THROWS on a persistent explorer error at a funded index (atomic — never a fake-clean partial)', async () => {
    mockInfo.set(addr(0, 0), { confirmed: 500, unconfirmed: 0, txCount: 1 });
    mockFail.add(addr(0, 0)); // getBC2AddressInfo always throws for this address
    await expect(scanBC2Hd(NATIVE_XPUB, 'native-segwit')).rejects.toThrow();
  });

  it('empty account returns zero balance and index 0 as next receive', async () => {
    const scan = await scanBC2Hd(NATIVE_XPUB, 'native-segwit');
    expect(scan.confirmed).toBe(0);
    expect(scan.utxos).toHaveLength(0);
    expect(scan.nextReceiveIndex).toBe(0);
    expect(scan.nextChangeIndex).toBe(0);
    expect(scan.receiveAddress).toBe(addr(0, 0));
  });
});
