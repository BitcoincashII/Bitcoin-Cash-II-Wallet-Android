/**
 * BCH2 SPV merkle/header primitives against a REAL regtest node. parseHeader / verifyMerkleInclusion / checkPoW
 * are chain-agnostic (the ASERT nBits rule is NOT exercised here — that is mainnet-only and covered by the unit
 * tests). We mine a block containing exactly [coinbase, tx], then verify the tx's Merkle inclusion against the
 * real block header the node produced, and that its PoW parses. Gated behind BW_INTEGRATION + node presence.
 */
jest.mock('../../blue_modules/BCH2Electrum', () => ({
  getBlockHeaders: jest.fn(), getMerkleProof: jest.fn(), getRawTransaction: jest.fn(), getServerName: jest.fn(() => false),
}));

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { parseHeader, verifyMerkleInclusion, checkPoW } from '../../blue_modules/bch2-spv';

const CLI_BIN = process.env.BC2_REGTEST_CLI || '/home/dev/bch2-linux-out/bitcoincashII-cli';
const DATADIR = process.env.BC2_REGTEST_DATADIR ||
  '/tmp/claude-1000/-home-dev/e646408f-da62-4ce4-9b72-40c2a9b440a9/scratchpad/bc2-regtest';
const crypto = require('crypto');

function cli(args: string[]): string { return execFileSync(CLI_BIN, [`-datadir=${DATADIR}`, '-regtest', ...args], { encoding: 'utf8' }).trim(); }
function jcli(args: string[]): any { return JSON.parse(cli(args)); }
function nodeUp(): boolean { if (!fs.existsSync(CLI_BIN)) return false; try { cli(['getblockcount']); return true; } catch { return false; } }
function le64(n: number): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; }
function hexToBytes(h: string): Uint8Array { const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; }

// Build + sign a 1-in/1-out tx paying a legacy address; return {rawHex, txid} WITHOUT broadcasting.
function makeTx(): { rawHex: string; txid: string } {
  const u = (jcli(['listunspent', '1']) as any[]).find(x => x.spendable && Math.round(x.amount * 1e8) >= 200000);
  if (!u) throw new Error('no spendable UTXO');
  const inVal = Math.round(u.amount * 1e8);
  const dest = cli(['getnewaddress', '', 'legacy']);
  const destSpk = Buffer.from(jcli(['getaddressinfo', dest]).scriptPubKey, 'hex');
  const prev = Buffer.concat([Buffer.from(u.txid, 'hex').reverse(), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(u.vout); return b; })()]);
  const raw = Buffer.concat([
    Buffer.from('02000000', 'hex'), Buffer.from([0x01]), prev, Buffer.from([0x00]), Buffer.from('ffffffff', 'hex'),
    Buffer.from([0x01]), le64(inVal - 5000), Buffer.from([destSpk.length]), destSpk, Buffer.from('00000000', 'hex'),
  ]).toString('hex');
  const signed = jcli(['signrawtransactionwithwallet', raw]);
  if (!signed.complete) throw new Error('sign failed');
  return { rawHex: signed.hex, txid: jcli(['decoderawtransaction', signed.hex]).txid };
}

const run = nodeUp() ? describe : describe.skip;

run('BCH2 SPV merkle/header primitives — real regtest block', () => {
  it('verifies a tx Merkle-inclusion proof against the real block header (+ header parses, PoW holds)', () => {
    const { rawHex, txid } = makeTx();
    // Mine a block with exactly [coinbase, our tx].
    const blockHash = JSON.parse(cli(['generateblock', cli(['getnewaddress', '', 'legacy']), JSON.stringify([rawHex])])).hash;
    const block = jcli(['getblock', blockHash, '1']);       // tx[0]=coinbase, tx[1]=our tx
    expect(block.tx.length).toBe(2);
    expect(block.tx[1]).toBe(txid);
    const coinbaseTxid = block.tx[0];

    const headerHex = cli(['getblockheader', blockHash, 'false']);
    const header = parseHeader(hexToBytes(headerHex));

    // Our tx is at position 1; its Merkle sibling is the coinbase txid (display order, as get_merkle returns).
    const proven = verifyMerkleInclusion(rawHex, [coinbaseTxid], 1, header.merkleRoot);
    expect(proven).toBe(txid);

    // Header PoW parses and holds under a permissive powLimit (regtest difficulty is trivial).
    expect(checkPoW(header.raw, header.bits, 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn)).toBe(true);

    // Binding: the coinbase bytes are NOT our tx — proving the coinbase at pos 1 fails the root check.
    const coinbaseRaw = cli(['getrawtransaction', coinbaseTxid]);
    expect(() => verifyMerkleInclusion(coinbaseRaw, [coinbaseTxid], 1, header.merkleRoot)).toThrow();
  });
});
