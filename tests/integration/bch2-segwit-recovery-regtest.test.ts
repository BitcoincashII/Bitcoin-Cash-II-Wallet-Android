/**
 * BCH2 SegWit *recovery* sweep — real regtest consensus validation.
 *
 * Proves that sweepAirdropClaims can recover pre-fork SegWit airdrop funds
 * (bc1 P2WPKH, P2SH-P2WPKH) on BCH2, where post-fork these outputs are spent via
 * scriptSig (VerifyWitnessProgramViaScriptSig, 0x41 FORKID BIP143 sighash), NOT a
 * witness. We fund the SegWit scriptPubKey on the node, run the ACTUAL sweep
 * (with BCH2Electrum mocked to the node's UTXOs + capturing the broadcast), then
 * mine the swept tx with `generateblock` — which enforces consensus, so an invalid
 * recovery scriptSig/sighash throws.
 *
 * Requires a POST-FORK regtest node (regtest uahf/graviton height = 200, so the
 * NO_SEGWIT recovery rule is active above height 200). Skipped automatically when
 * the node is absent. Taproot recovery is validated structurally only if the node
 * lacks witness-v1 support.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';
import ecc from '../../blue_modules/noble_ecc';

const crypto = require('crypto');
const bip32 = BIP32Factory(ecc);

// class/bch2-transaction pulls BCH2Electrum (RN net). Mock it against the node.
const mockState: {
  utxoByScripthash: Record<string, any[]>;
  utxoByAddress: Record<string, any[]>;
  broadcasts: string[];
} = { utxoByScripthash: {}, utxoByAddress: {}, broadcasts: [] };

jest.mock('../../blue_modules/BCH2Electrum', () => ({
  getUtxosByAddress: async (a: string) => mockState.utxoByAddress[a] || [],
  getBC2Utxos: async () => [],
  getUtxosByScripthash: async (sh: string) => mockState.utxoByScripthash[sh] || [],
  broadcastTransaction: async (hex: string) => {
    mockState.broadcasts.push(hex);
    // Return the real double-SHA256 txid so the sweep records something sane.
    const b = Buffer.from(hex, 'hex');
    return Buffer.from(sha256(sha256(b))).reverse().toString('hex');
  },
  broadcastBC2Transaction: async () => '',
  filterMatureUtxos: async (u: any[]) => u,
}));

import { sweepAirdropClaims, getCashAddr } from '../../class/bch2-transaction';

const CLI_BIN = process.env.BC2_REGTEST_CLI || '/home/dev/bch2-linux-out/bitcoincashII-cli';
const DATADIR = process.env.BC2_REGTEST_DATADIR ||
  '/tmp/claude-1000/-home-dev/e646408f-da62-4ce4-9b72-40c2a9b440a9/scratchpad/bc2-regtest';
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function cli(args: string[]): string {
  return execFileSync(CLI_BIN, [`-datadir=${DATADIR}`, '-regtest', ...args], { encoding: 'utf8' }).trim();
}
function jcli(args: string[]): any { return JSON.parse(cli(args)); }
function nodeUp(): boolean {
  if (!fs.existsSync(CLI_BIN)) return false;
  try { cli(['getblockcount']); return true; } catch { return false; }
}
function sha256(b: Buffer): Buffer { return crypto.createHash('sha256').update(b).digest(); }
function hash160(b: Buffer): Buffer { return crypto.createHash('ripemd160').update(sha256(b)).digest(); }
function le64(n: number): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; }
function varint(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = 0xfe; b.writeUInt32LE(n, 1); return b;
}
function scripthashOf(spk: Buffer): string { return Buffer.from(sha256(spk)).reverse().toString('hex'); }
function taggedHash(tag: string, data: Buffer): Buffer { const t = sha256(Buffer.from(tag, 'utf8')); return sha256(Buffer.concat([t, t, data])); }

// Fund an arbitrary scriptPubKey by building the funding tx by hand and mining it
// with `generateblock`. This bypasses the wallet's post-fork bech32 guard
// (fundrawtransaction refuses to CREATE native SegWit outputs) and mempool
// standardness — generateblock only enforces consensus, and creating a witness
// output is consensus-valid. Output 0 = target spk; output 1 = P2PKH change.
function fundScript(spk: Buffer, valueSats: number): { txid: string; vout: number; value: number } {
  const unspent = jcli(['listunspent', '1']) as any[];
  const u = unspent.find(x => x.spendable && Math.round(x.amount * 1e8) >= valueSats + 100000);
  if (!u) throw new Error('no spendable wallet UTXO large enough to fund from');
  const inVal = Math.round(u.amount * 1e8);
  const changeAddr = cli(['getnewaddress', '', 'legacy']);
  const changeSpk = Buffer.from(jcli(['getaddressinfo', changeAddr]).scriptPubKey, 'hex');
  const changeVal = inVal - valueSats - 5000; // flat 5k-sat fee
  if (changeVal < 546) throw new Error('funding input too small for change');
  const prev = Buffer.concat([Buffer.from(u.txid, 'hex').reverse(), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(u.vout); return b; })()]);
  const raw = Buffer.concat([
    Buffer.from('02000000', 'hex'),
    Buffer.from([0x01]), prev, Buffer.from([0x00]), Buffer.from('ffffffff', 'hex'),
    Buffer.from([0x02]),
    le64(valueSats), varint(spk.length), spk,
    le64(changeVal), varint(changeSpk.length), changeSpk,
    Buffer.from('00000000', 'hex'),
  ]).toString('hex');
  const signed = jcli(['signrawtransactionwithwallet', raw]);
  if (!signed.complete) throw new Error('funding tx did not sign');
  const txid = jcli(['decoderawtransaction', signed.hex]).txid;
  cli(['generateblock', cli(['getnewaddress', '', 'legacy']), JSON.stringify([signed.hex])]);
  return { txid, vout: 0, value: valueSats };
}

/** Mine the swept tx into a block: consensus-valid iff height increments. */
function assertConsensusValid(spendHex: string): void {
  const before = Number(cli(['getblockcount']));
  cli(['generateblock', cli(['getnewaddress', '', 'legacy']), JSON.stringify([spendHex])]); // throws on invalid
  expect(Number(cli(['getblockcount']))).toBe(before + 1);
}

// Recovery is a POST-fork rule (regtest uahf/graviton = block 200). Skip (don't
// fail) if the node is still pre-fork — the BC2 native-SegWit suite needs pre-fork,
// so the two have opposite fork requirements and can't both run at one height.
function postFork(): boolean { try { return Number(cli(['getblockcount'])) >= 200; } catch { return false; } }
const run = nodeUp() && postFork() ? describe : describe.skip;

run('BCH2 SegWit-recovery sweep — real regtest consensus', () => {
  const root = bip32.fromSeed(bip39.mnemonicToSeedSync(TEST_MNEMONIC));

  beforeEach(() => {
    mockState.utxoByScripthash = {};
    mockState.utxoByAddress = {};
    mockState.broadcasts = [];
  });

  function destLegacyCashAddr(): string { return cli(['getnewaddress', '', 'legacy']); }

  it('logs the node fork state (height vs regtest fork@200)', () => {
    const h = Number(cli(['getblockcount']));
    // eslint-disable-next-line no-console
    console.log(`[recovery-regtest] node height=${h} (regtest uahf/graviton=200; recovery active when height>200)`);
    expect(h).toBeGreaterThan(0);
  });

  it('bc1 (P2WPKH m/84\') airdrop funds are recovered and the sweep tx is consensus-valid', async () => {
    const child = root.derivePath("m/84'/0'/0'/0/0");
    const pub = Buffer.from(child.publicKey);
    const pkh = hash160(pub);
    const spk = Buffer.concat([Buffer.from([0x00, 0x14]), pkh]); // P2WPKH
    const utxo = fundScript(spk, 100_000_000);

    mockState.utxoByScripthash[scripthashOf(spk)] = [{ txid: utxo.txid, vout: utxo.vout, value: utxo.value }];
    const dest = destLegacyCashAddr();
    const res = await sweepAirdropClaims(TEST_MNEMONIC, '', [
      { bch2Address: getCashAddr(pkh), addressType: 'bc1', derivationPath: "m/84'/0'/0'/0/0", balance: utxo.value },
    ], dest, 2);

    expect(res.skipped).toHaveLength(0);
    expect(res.txids).toHaveLength(1);
    expect(res.sweptSats).toBeGreaterThan(99_000_000);
    expect(mockState.broadcasts).toHaveLength(1);
    assertConsensusValid(mockState.broadcasts[0]);
  });

  it('P2SH-P2WPKH (m/49\') airdrop funds are recovered and consensus-valid', async () => {
    const child = root.derivePath("m/49'/0'/0'/0/0");
    const pub = Buffer.from(child.publicKey);
    const pkh = hash160(pub);
    const redeem = Buffer.concat([Buffer.from([0x00, 0x14]), pkh]);
    const spk = Buffer.concat([Buffer.from([0xa9, 0x14]), hash160(redeem), Buffer.from([0x87])]); // P2SH
    const utxo = fundScript(spk, 80_000_000);

    mockState.utxoByScripthash[scripthashOf(spk)] = [{ txid: utxo.txid, vout: utxo.vout, value: utxo.value }];
    const res = await sweepAirdropClaims(TEST_MNEMONIC, '', [
      { bch2Address: getCashAddr(pkh), addressType: 'p2sh-segwit', derivationPath: "m/49'/0'/0'/0/0", balance: utxo.value },
    ], destLegacyCashAddr(), 2);

    expect(res.skipped).toHaveLength(0);
    expect(res.txids).toHaveLength(1);
    assertConsensusValid(mockState.broadcasts[0]);
  });

  it('Taproot (bc1p m/86\') airdrop funds are recovered and consensus-valid', async () => {
    const child = root.derivePath("m/86'/0'/0'/0/0");
    const pub = Buffer.from(child.publicKey);
    const xonly = pub.subarray(1, 33);
    const tweak = taggedHash('TapTweak', xonly);
    const tw = ecc.xOnlyPointAddTweak(xonly, tweak);
    if (!tw) throw new Error('tweak failed');
    const tweaked = Buffer.from(tw.xOnlyPubkey);
    const spk = Buffer.concat([Buffer.from([0x51, 0x20]), tweaked]); // OP_1 PUSH32 <tweaked>
    const utxo = fundScript(spk, 90_000_000);

    mockState.utxoByScripthash[scripthashOf(spk)] = [{ txid: utxo.txid, vout: utxo.vout, value: utxo.value }];
    const res = await sweepAirdropClaims(TEST_MNEMONIC, '', [
      { bch2Address: getCashAddr(hash160(pub)), addressType: 'p2tr', derivationPath: "m/86'/0'/0'/0/0", balance: utxo.value },
    ], destLegacyCashAddr(), 2);

    expect(res.skipped).toHaveLength(0);
    expect(res.txids).toHaveLength(1);
    assertConsensusValid(mockState.broadcasts[0]);
  });

  it('mixed legacy + bc1 claims: legacy consolidates, bc1 recovers (2 consensus-valid txs)', async () => {
    const legacy = root.derivePath("m/44'/145'/0'/0/0");
    const lpub = Buffer.from(legacy.publicKey);
    const lpkh = hash160(lpub);
    const lspk = Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), lpkh, Buffer.from([0x88, 0xac])]);
    const lUtxo = fundScript(lspk, 60_000_000);

    const seg = root.derivePath("m/84'/0'/0'/0/1");
    const spub = Buffer.from(seg.publicKey);
    const spkh = hash160(spub);
    const sspk = Buffer.concat([Buffer.from([0x00, 0x14]), spkh]);
    const sUtxo = fundScript(sspk, 70_000_000);

    const lCash = getCashAddr(lpkh);
    mockState.utxoByAddress[lCash] = [{ txid: lUtxo.txid, vout: lUtxo.vout, value: lUtxo.value }];
    mockState.utxoByScripthash[scripthashOf(sspk)] = [{ txid: sUtxo.txid, vout: sUtxo.vout, value: sUtxo.value }];

    const res = await sweepAirdropClaims(TEST_MNEMONIC, '', [
      { bch2Address: lCash, addressType: 'legacy', derivationPath: "m/44'/145'/0'/0/0", balance: lUtxo.value },
      { bch2Address: getCashAddr(spkh), addressType: 'bc1', derivationPath: "m/84'/0'/0'/0/1", balance: sUtxo.value },
    ], destLegacyCashAddr(), 2);

    expect(res.skipped).toHaveLength(0);
    expect(res.txids).toHaveLength(2);
    expect(mockState.broadcasts).toHaveLength(2);
    for (const hex of mockState.broadcasts) assertConsensusValid(hex);
  });
});
