/**
 * Android wallet BC2 fork-id e2e: drives the PRODUCTION Android builders
 * (buildBC2LegacyTxMulti, buildBC2SegwitTx native + nested) against the
 * patched v31.1.0 regtest node (replay protection active from height 150).
 */
(globalThis as any).__DEV__ = false;
import { createHash } from 'node:crypto';

const RPC = 'http://127.0.0.1:18443/wallet/miner';
const AUTH = 'Basic ' + Buffer.from('t:t').toString('base64');

async function rpc(method: string, params: unknown[] = [], allowError = false): Promise<any> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error && !allowError) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j;
}

const sha256b = (b: Buffer) => createHash('sha256').update(b).digest();
const hash160 = (b: Buffer) => createHash('ripemd160').update(sha256b(b)).digest();

async function mine(n: number) {
  const addr = (await rpc('getnewaddress')).result;
  await rpc('generatetoaddress', [n, addr]);
}

async function addrFor(desc: string): Promise<string> {
  const info = await rpc('getdescriptorinfo', [desc]);
  const d = (await rpc('deriveaddresses', [info.result.descriptor])).result;
  return d[0];
}

async function fund(addr: string, spkHex: string): Promise<{ txid: string; vout: number; value: number }> {
  const txid = (await rpc('sendtoaddress', [addr, 1.0])).result as string;
  const gtx = await rpc('gettransaction', [txid]);
  const dec = await rpc('decoderawtransaction', [gtx.result.hex]);
  const vout = dec.result.vout.findIndex((o: any) => o.scriptPubKey.hex === spkHex);
  if (vout < 0) throw new Error(`funding vout not found for ${spkHex}`);
  await mine(1);
  return { txid, vout, value: Math.round(dec.result.vout[vout].value * 1e8) };
}

async function expectAcceptMine(raw: string, label: string) {
  const r = await rpc('testmempoolaccept', [[raw]]);
  const v = r.result[0];
  if (!v.allowed) throw new Error(`${label}: expected ACCEPT, got ${v['reject-reason']}`);
  await rpc('sendrawtransaction', [raw]);
  await mine(1);
  console.log(`  PASS  ${label}: accepted + mined`);
}

async function main() {
  const tx = await import('/home/dev/bch2-dev/Bitcoin-Cash-II-Wallet-Android/class/bch2-transaction');

  const priv = Buffer.alloc(32, 0x37);
  // pubkey via the same noble the Android repo uses
  const necc = await import('@noble/secp256k1');
  const pub = Buffer.from(necc.getPublicKey(priv, true));
  const h160 = hash160(pub);
  const spkP2PKH = Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), h160, Buffer.from([0x88, 0xac])]);
  const spkP2WPKH = Buffer.concat([Buffer.from([0x00, 0x14]), h160]);
  const redeem = spkP2WPKH; // 0014<h160>
  const spkP2SH = Buffer.concat([Buffer.from([0xa9, 0x14]), hash160(redeem), Buffer.from([0x87])]);
  const destSpk = Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), Buffer.alloc(20, 0x55), Buffer.from([0x88, 0xac])]);
  const pubHex = pub.toString('hex');

  await rpc('loadwallet', ['miner'], true);
  await rpc('createwallet', ['miner'], true);
  let h = (await rpc('getblockcount')).result;
  if (h < 160) await mine(160 - h);
  h = (await rpc('getblockcount')).result;
  console.log(`\n== ANDROID builders above fork (tip ${h}, fork at 150) ==`);

  // (1) legacy P2PKH via buildBC2LegacyTxMulti
  const aLegacy = await addrFor(`pkh(${pubHex})`);
  const u1 = await fund(aLegacy, spkP2PKH.toString('hex'));
  const raw1 = tx.buildBC2LegacyTxMulti(
    [{ txid: u1.txid, vout: u1.vout, value: u1.value, privateKey: Buffer.from(priv), publicKey: pub }],
    destSpk, u1.value - 10000, null, 0,
  );
  await expectAcceptMine(raw1, 'ANDROID buildBC2LegacyTxMulti (legacy P2PKH)');

  // (2) native segwit P2WPKH via buildBC2SegwitTx(nested=false)
  const aNative = await addrFor(`wpkh(${pubHex})`);
  const u2 = await fund(aNative, spkP2WPKH.toString('hex'));
  const raw2 = tx.buildBC2SegwitTx(
    false, [{ txid: u2.txid, vout: u2.vout, value: u2.value }],
    destSpk, u2.value - 10000, null, 0, Buffer.from(priv), pub,
  );
  await expectAcceptMine(raw2, 'ANDROID buildBC2SegwitTx native P2WPKH');

  // (3) nested P2SH-P2WPKH via buildBC2SegwitTx(nested=true)
  const aNested = await addrFor(`sh(wpkh(${pubHex}))`);
  const u3 = await fund(aNested, spkP2SH.toString('hex'));
  const raw3 = tx.buildBC2SegwitTx(
    true, [{ txid: u3.txid, vout: u3.vout, value: u3.value }],
    destSpk, u3.value - 10000, null, 0, Buffer.from(priv), pub,
  );
  await expectAcceptMine(raw3, 'ANDROID buildBC2SegwitTx nested P2SH-P2WPKH');

  console.log('\nALL ANDROID E2E CHECKS PASSED');
}

main().catch(e => { console.error('ANDROID E2E FAILED:', e.message); process.exit(1); });
