/**
 * Native BC2 SegWit / Taproot spend validation against a real regtest node.
 *
 * This exercises the ACTUAL builders from class/bch2-transaction.ts:
 *   - buildBC2SegwitTx  (P2WPKH + P2SH-P2WPKH)
 *   - buildBC2TaprootTx (P2TR key-path)
 *
 * P2WPKH / P2SH-P2WPKH are validated end-to-end against consensus by mining the
 * spend into a block with `generateblock` on a bitcoincashII regtest node (SegWit
 * buried-active). generateblock enforces consensus (not just mempool policy), so a
 * bad witness/sighash makes it throw.
 *
 * Taproot cannot be mined on the available reference node (its regtest DAA jumps to
 * difficulty 1 at height 2), so it is validated by: (a) the official BIP86 key/tweak
 * test vector, (b) independently recomputing the BIP341 sighash and BIP340-verifying
 * the signature the builder produced, and (c) confirming the witness tx decodes on the
 * node. The witness serializer is additionally proven by the SegWit consensus tests.
 *
 * Requires the local regtest node; skipped automatically when absent (so CI is green).
 * Set BC2_REGTEST_CLI / BC2_REGTEST_DATADIR to point at a funded node.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';
import ecc from '../../blue_modules/noble_ecc';

const crypto = require('crypto');
const bip32 = BIP32Factory(ecc);

// Builders import class/bch2-transaction which pulls BCH2Electrum (RN net). Mock it.
jest.mock('../../blue_modules/BCH2Electrum', () => ({
  getUtxosByAddress: async () => [],
  getBC2Utxos: async () => [],
  getUtxosByScripthash: async () => [],
  broadcastTransaction: async () => '',
  broadcastBC2Transaction: async () => '',
  filterMatureUtxos: async (u: any[]) => u,
}));

import { buildBC2SegwitTx, buildBC2TaprootTx, buildBC2SegwitTxMulti, buildBC2TaprootTxMulti, buildBC2LegacyTxMulti } from '../../class/bch2-transaction';

const CLI_BIN = process.env.BC2_REGTEST_CLI || '/home/dev/bch2-linux-out/bitcoincashII-cli';
const DATADIR = process.env.BC2_REGTEST_DATADIR ||
  '/tmp/claude-1000/-home-dev/e646408f-da62-4ce4-9b72-40c2a9b440a9/scratchpad/bc2-regtest';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function nodeUp(): boolean {
  if (!fs.existsSync(CLI_BIN)) return false;
  try { cli(['getblockcount']); return true; } catch { return false; }
}

function cli(args: string[]): string {
  return execFileSync(CLI_BIN, [`-datadir=${DATADIR}`, ...args], { encoding: 'utf8' }).trim();
}
function jcli(args: string[]): any { return JSON.parse(cli(args)); }

function le64(n: number): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; }
function varint(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = 0xfe; b.writeUInt32LE(n, 1); return b;
}
function sha256(b: Buffer): Buffer { return crypto.createHash('sha256').update(b).digest(); }
function hash160(b: Buffer): Buffer {
  return crypto.createHash('ripemd160').update(sha256(b)).digest();
}
function taggedHash(tag: string, data: Buffer): Buffer {
  const t = sha256(Buffer.from(tag, 'utf8'));
  return sha256(Buffer.concat([t, t, data]));
}

/** Fund an arbitrary scriptPubKey on the node and return its confirmed UTXO.
 *  Seeds the raw tx with one real wallet input so it isn't mis-parsed as a
 *  0-input SegWit tx (version + 0x00 would read as the witness marker); then
 *  lets fundrawtransaction add change + fee. */
function fundScript(spk: Buffer, valueSats: number): { txid: string; vout: number; value: number } {
  // Prefer a single spendable UTXO large enough to cover the target (a coinbase),
  // so repeated runs on a stateful node don't pick a tiny low-conf change output.
  const unspent = jcli(['listunspent', '1']) as any[];
  const u = unspent.find(x => x.spendable && Math.round(x.amount * 1e8) >= valueSats + 100000)
    || unspent.find(x => x.spendable);
  if (!u) throw new Error('no spendable wallet UTXO to fund from');
  const prev = Buffer.concat([Buffer.from(u.txid, 'hex').reverse(), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(u.vout); return b; })()]);
  const partial = Buffer.concat([
    Buffer.from('02000000', 'hex'),
    Buffer.from([0x01]), prev, Buffer.from([0x00]), Buffer.from('ffffffff', 'hex'), // 1 input, empty scriptSig
    Buffer.from([0x01]), le64(valueSats), varint(spk.length), spk,                  // 1 output = target script
    Buffer.from('00000000', 'hex'),
  ]).toString('hex');
  const funded = jcli(['fundrawtransaction', partial]);
  const signed = jcli(['signrawtransactionwithwallet', funded.hex]);
  if (!signed.complete) throw new Error('funding tx did not sign');
  const txid = cli(['sendrawtransaction', signed.hex]);
  cli(['generatetoaddress', '1', cli(['getnewaddress'])]);
  const decoded = jcli(['decoderawtransaction', signed.hex]);
  const out = decoded.vout.find((o: any) => o.scriptPubKey.hex === spk.toString('hex'));
  if (!out) throw new Error('funded output not found');
  return { txid, vout: out.n, value: valueSats };
}

/** Mine the spend into a block: consensus-valid iff height increments (throws otherwise). */
function assertConsensusValid(spendHex: string): void {
  const before = Number(cli(['getblockcount']));
  cli(['generateblock', cli(['getnewaddress']), JSON.stringify([spendHex])]); // throws on invalid
  const after = Number(cli(['getblockcount']));
  expect(after).toBe(before + 1);
}

const RECIPIENT = Buffer.concat([Buffer.from([0x00, 0x14]), Buffer.alloc(20, 0x11)]); // P2WPKH(0x11..)

const run = nodeUp() ? describe : describe.skip;

run('native BC2 SegWit / Taproot spends — real regtest consensus', () => {
  const root = bip32.fromSeed(bip39.mnemonicToSeedSync(TEST_MNEMONIC));

  it('P2WPKH (m/84\') spend is accepted by SegWit consensus', () => {
    const child = root.derivePath("m/84'/0'/0'/0/0");
    const pub = Buffer.from(child.publicKey);
    const spk = Buffer.concat([Buffer.from([0x00, 0x14]), hash160(pub)]);
    const utxo = fundScript(spk, 100_000_000);
    const change = spk;
    const hex = buildBC2SegwitTx(false, [utxo], RECIPIENT, 50_000_000, change, 49_999_000, Buffer.from(child.privateKey!), pub);
    // structural sanity: segwit marker+flag present
    expect(hex.slice(8, 12)).toBe('0001');
    assertConsensusValid(hex);
  });

  it('P2SH-P2WPKH (m/49\') spend is accepted by SegWit consensus', () => {
    const child = root.derivePath("m/49'/0'/0'/0/0");
    const pub = Buffer.from(child.publicKey);
    const redeem = Buffer.concat([Buffer.from([0x00, 0x14]), hash160(pub)]);
    const spk = Buffer.concat([Buffer.from([0xa9, 0x14]), hash160(redeem), Buffer.from([0x87])]);
    const utxo = fundScript(spk, 100_000_000);
    const change = spk;
    const hex = buildBC2SegwitTx(true, [utxo], RECIPIENT, 50_000_000, change, 49_999_000, Buffer.from(child.privateKey!), pub);
    assertConsensusValid(hex);
  });

  it('multi-input P2WPKH spend is accepted (proves BIP143 midstates over N inputs)', () => {
    const child = root.derivePath("m/84'/0'/0'/0/0");
    const pub = Buffer.from(child.publicKey);
    const spk = Buffer.concat([Buffer.from([0x00, 0x14]), hash160(pub)]);
    const u1 = fundScript(spk, 30_000_000);
    const u2 = fundScript(spk, 40_000_000);
    const hex = buildBC2SegwitTx(false, [u1, u2], RECIPIENT, 60_000_000, spk, 9_999_000, Buffer.from(child.privateKey!), pub);
    assertConsensusValid(hex);
  });

  it('Taproot (m/86\') key/tweak matches the official BIP86 test vector', () => {
    const child = root.derivePath("m/86'/0'/0'/0/0");
    const xonly = Buffer.from(child.publicKey).subarray(1, 33);
    // Official BIP86 vector for "abandon…about" @ m/86'/0'/0'/0/0. The internal
    // x-only key and the tweaked output key below were both confirmed against
    // Bitcoin Core's descriptor engine (tr(...)) deriving from this same seed:
    // output key a60869f0… ⇒ address bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr.
    expect(xonly.toString('hex')).toBe('cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115');
    const tweak = taggedHash('TapTweak', xonly);
    const tr = ecc.xOnlyPointAddTweak(xonly, tweak)!;
    expect(Buffer.from(tr.xOnlyPubkey).toString('hex')).toBe('a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c');
  });

  it('Taproot key-path spend: sig verifies over an independent BIP341 sighash and decodes on the node', () => {
    const child = root.derivePath("m/86'/0'/0'/0/0");
    const pub = Buffer.from(child.publicKey);
    const xonly = pub.subarray(1, 33);
    const tweak = taggedHash('TapTweak', xonly);
    const tr = ecc.xOnlyPointAddTweak(xonly, tweak)!;
    const tweakedXonly = Buffer.from(tr.xOnlyPubkey);
    const effective = pub[0] === 0x02 ? Buffer.from(child.privateKey!) : Buffer.from(ecc.privateNegate(Buffer.from(child.privateKey!)));
    const tweakedPriv = Buffer.from(ecc.privateAdd(effective, tweak)!);
    const spk = Buffer.concat([Buffer.from([0x51, 0x20]), tweakedXonly]);

    const utxo = fundScript(spk, 100_000_000);
    const amount = 50_000_000, change = 49_999_000;
    const hex = buildBC2TaprootTx([utxo], RECIPIENT, amount, spk, change, tweakedPriv, tweakedXonly);

    // Build outputs exactly as the builder did, then independently recompute BIP341 sighash.
    const outs = Buffer.concat([
      le64(amount), varint(RECIPIENT.length), RECIPIENT,
      le64(change), varint(spk.length), spk,
    ]);
    const outpoint = Buffer.concat([Buffer.from(utxo.txid, 'hex').reverse(), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(utxo.vout); return b; })()]);
    const msg = Buffer.concat([
      Buffer.from([0x00, 0x00]),                       // epoch, SIGHASH_DEFAULT
      Buffer.from('02000000', 'hex'),                  // nVersion
      Buffer.from('00000000', 'hex'),                  // nLockTime
      sha256(outpoint),                                // sha_prevouts
      sha256(le64(utxo.value)),                        // sha_amounts
      sha256(Buffer.concat([varint(spk.length), spk])),// sha_scriptpubkeys
      sha256(Buffer.from('ffffffff', 'hex')),          // sha_sequences
      sha256(outs),                                    // sha_outputs
      Buffer.from([0x00]),                             // spend_type
      Buffer.from('00000000', 'hex'),                  // input_index 0
    ]);
    const sighash = taggedHash('TapSighash', msg);

    const decoded = jcli(['decoderawtransaction', hex, 'true']);
    const sig = Buffer.from(decoded.vin[0].txinwitness[0], 'hex');
    expect(sig.length).toBe(64);
    expect(ecc.verifySchnorr(sighash, tweakedXonly, sig)).toBe(true);
    // The output key committed in the UTXO is exactly what we signed for.
    expect(decoded.vout[0].scriptPubKey.hex).toBe(RECIPIENT.toString('hex'));
  });

  it('multi-KEY P2WPKH spend (two different HD addresses) accepted by consensus', () => {
    // The core HD guarantee: inputs from different addresses, each signed by its own key.
    const c0 = root.derivePath("m/84'/0'/0'/0/0");
    const c1 = root.derivePath("m/84'/0'/0'/0/1");
    const p0 = Buffer.from(c0.publicKey), p1 = Buffer.from(c1.publicKey);
    const spk0 = Buffer.concat([Buffer.from([0x00, 0x14]), hash160(p0)]);
    const spk1 = Buffer.concat([Buffer.from([0x00, 0x14]), hash160(p1)]);
    const u0 = fundScript(spk0, 30_000_000);
    const u1 = fundScript(spk1, 40_000_000);
    const inputs = [
      { txid: u0.txid, vout: u0.vout, value: u0.value, privateKey: Buffer.from(c0.privateKey!), publicKey: p0 },
      { txid: u1.txid, vout: u1.vout, value: u1.value, privateKey: Buffer.from(c1.privateKey!), publicKey: p1 },
    ];
    const hex = buildBC2SegwitTxMulti(false, inputs, RECIPIENT, 60_000_000, spk0, 9_999_000);
    assertConsensusValid(hex); // a wrong key on either input would make consensus reject
  });

  it('multi-KEY legacy P2PKH spend (two different HD addresses) accepted by consensus', () => {
    const c0 = root.derivePath("m/44'/0'/0'/0/0");
    const c1 = root.derivePath("m/44'/0'/0'/0/1");
    const p0 = Buffer.from(c0.publicKey), p1 = Buffer.from(c1.publicKey);
    const spk = (pub: Buffer) => Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), hash160(pub), Buffer.from([0x88, 0xac])]);
    const u0 = fundScript(spk(p0), 30_000_000);
    const u1 = fundScript(spk(p1), 40_000_000);
    const inputs = [
      { txid: u0.txid, vout: u0.vout, value: u0.value, privateKey: Buffer.from(c0.privateKey!), publicKey: p0 },
      { txid: u1.txid, vout: u1.vout, value: u1.value, privateKey: Buffer.from(c1.privateKey!), publicKey: p1 },
    ];
    const hex = buildBC2LegacyTxMulti(inputs, RECIPIENT, 60_000_000, spk(p0), 9_999_000);
    assertConsensusValid(hex);
  });

  it('multi-KEY Taproot spend: each input signed by its own tweaked key', () => {
    const mk = (i: number) => {
      const c = root.derivePath(`m/86'/0'/0'/0/${i}`);
      const pub = Buffer.from(c.publicKey);
      const xonly = pub.subarray(1, 33);
      const tweak = taggedHash('TapTweak', xonly);
      const tweakedXonly = Buffer.from(ecc.xOnlyPointAddTweak(xonly, tweak)!.xOnlyPubkey);
      const eff = pub[0] === 0x02 ? Buffer.from(c.privateKey!) : Buffer.from(ecc.privateNegate(Buffer.from(c.privateKey!)));
      const tweakedPriv = Buffer.from(ecc.privateAdd(eff, tweak)!);
      const spk = Buffer.concat([Buffer.from([0x51, 0x20]), tweakedXonly]);
      return { tweakedPriv, tweakedXonly, spk };
    };
    const k0 = mk(0), k1 = mk(1);
    const u0 = fundScript(k0.spk, 30_000_000);
    const u1 = fundScript(k1.spk, 40_000_000);
    const utxos = [u0, u1];
    const spks = [k0.spk, k1.spk];
    const inputs = [
      { txid: u0.txid, vout: u0.vout, value: u0.value, tweakedPrivkey: k0.tweakedPriv, tweakedXonly: k0.tweakedXonly },
      { txid: u1.txid, vout: u1.vout, value: u1.value, tweakedPrivkey: k1.tweakedPriv, tweakedXonly: k1.tweakedXonly },
    ];
    const amount = 50_000_000, change = 19_999_000;
    const hexReal = buildBC2TaprootTxMulti(inputs, RECIPIENT, amount, k0.spk, change); // change → input 0's script
    const outs = Buffer.concat([
      le64(amount), varint(RECIPIENT.length), RECIPIENT,
      le64(change), varint(k0.spk.length), k0.spk,
    ]);
    const shaPrevouts = sha256(Buffer.concat(utxos.map(u => Buffer.concat([Buffer.from(u.txid, 'hex').reverse(), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(u.vout); return b; })()]))));
    const shaAmounts = sha256(Buffer.concat(utxos.map(u => le64(u.value))));
    const shaSpks = sha256(Buffer.concat(spks.map(s => Buffer.concat([varint(s.length), s]))));
    const shaSeqs = sha256(Buffer.concat(utxos.map(() => Buffer.from('ffffffff', 'hex'))));
    const shaOuts = sha256(outs);
    const decoded = jcli(['decoderawtransaction', hexReal, 'true']);
    for (let i = 0; i < 2; i++) {
      const idx = Buffer.alloc(4); idx.writeUInt32LE(i);
      const msg = Buffer.concat([Buffer.from([0x00, 0x00]), Buffer.from('02000000', 'hex'), Buffer.from('00000000', 'hex'), shaPrevouts, shaAmounts, shaSpks, shaSeqs, shaOuts, Buffer.from([0x00]), idx]);
      const sighash = taggedHash('TapSighash', msg);
      const sig = Buffer.from(decoded.vin[i].txinwitness[0], 'hex');
      expect(sig.length).toBe(64);
      expect(ecc.verifySchnorr(sighash, inputs[i].tweakedXonly, sig)).toBe(true); // input i signed by key i
    }
  });

  it("fee estimate covers the real vsize of a Taproot-output tx at 1 sat/vByte (regression: 43-byte outputs)", () => {
    // Regression for the 34-byte-output fee bug: a P2TR/P2WSH output is 43 bytes,
    // so a taproot send with change must be charged >= its true vsize at 1 sat/vB.
    const child = root.derivePath("m/86'/0'/0'/0/0");
    const pub = Buffer.from(child.publicKey);
    const xonly = pub.subarray(1, 33);
    const tweak = taggedHash('TapTweak', xonly);
    const tweakedXonly = Buffer.from(ecc.xOnlyPointAddTweak(xonly, tweak)!.xOnlyPubkey);
    const effective = pub[0] === 0x02 ? Buffer.from(child.privateKey!) : Buffer.from(ecc.privateNegate(Buffer.from(child.privateKey!)));
    const tweakedPriv = Buffer.from(ecc.privateAdd(effective, tweak)!);
    const spk = Buffer.concat([Buffer.from([0x51, 0x20]), tweakedXonly]); // P2TR, 34-byte script

    const utxo = fundScript(spk, 100_000_000);
    // Mirror sendBC2NativeHd's estimate: perInput(taproot)=58, outputs sized by real script length.
    const outBytes = (s: Buffer) => 8 + (s.length < 0xfd ? 1 : 3) + s.length;
    const estimate = 11 + 58 * 1 + outBytes(spk) + outBytes(spk); // 1 input, P2TR recipient + P2TR change
    const amount = 40_000_000;
    const fee = estimate * 1; // feePerByte = 1 (the default/min)
    const hex = buildBC2TaprootTx([utxo], spk, amount, spk, 100_000_000 - amount - fee, tweakedPriv, tweakedXonly);
    // BC2 is Bitcoin-Core lineage: min-relay uses BIP141 weight/vsize (NOT the BCH
    // regtest node's un-discounted size). Compute the real vsize node-independently.
    // Witness portion for 1 input with a single 64-byte Schnorr item = marker+flag
    // (2) + stack-count (1) + len (1) + sig (64) = 68.
    const full = Buffer.from(hex, 'hex').length;
    const base = full - 68;
    const vsize = Math.ceil((base * 3 + full) / 4);
    expect(estimate).toBeGreaterThanOrEqual(vsize); // fee >= vsize*1 ⇒ meets BC2 min-relay
  });
});
