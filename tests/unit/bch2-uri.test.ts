import { parseBCH2PaymentUri, parseBC2PaymentUri } from '../../class/bch2-uri';

describe('parseBCH2PaymentUri', () => {
  const ADDR = 'qr95sy3j9xwd2ap32xkykttr4cvcu7as5yc93ky292';

  it('parses a bare address', () => {
    expect(parseBCH2PaymentUri(`bitcoincashii:${ADDR}`)).toEqual({ address: `bitcoincashii:${ADDR}` });
  });

  it('parses amount', () => {
    expect(parseBCH2PaymentUri(`bitcoincashii:${ADDR}?amount=1.5`)).toEqual({
      address: `bitcoincashii:${ADDR}`,
      amount: '1.5',
    });
  });

  it('parses amount, label and message (URL-decoded)', () => {
    const r = parseBCH2PaymentUri(`bitcoincashii:${ADDR}?amount=0.5&label=Test%20Payment&message=hi%20there`);
    expect(r).toEqual({ address: `bitcoincashii:${ADDR}`, amount: '0.5', label: 'Test Payment', message: 'hi there' });
  });

  it('handles the uppercase scheme and P2SH (p) addresses', () => {
    const p2sh = 'pqq3728yw0y47sqn6l2na30mcw6zm78dzq5ucqzc37';
    expect(parseBCH2PaymentUri(`BITCOINCASHII:${p2sh}`)).toEqual({ address: `bitcoincashii:${p2sh}` });
  });

  it('lowercases an all-UPPERCASE CashAddr body (LOW: avoids mixed-case rejection)', () => {
    // Uppercase is CashAddr-legal (common in QR alphanumeric mode). The lowercase
    // scheme + an uppercase body would be mixed-case and get rejected downstream.
    expect(parseBCH2PaymentUri(`BITCOINCASHII:${ADDR.toUpperCase()}`)).toEqual({ address: `bitcoincashii:${ADDR}` });
    expect(parseBCH2PaymentUri(`bitcoincashii:${ADDR.toUpperCase()}?amount=1`)).toEqual({ address: `bitcoincashii:${ADDR}`, amount: '1' });
  });

  it('normalizes a double-prefixed address to a single prefix', () => {
    expect(parseBCH2PaymentUri(`bitcoincashii:bitcoincashii:${ADDR}`)).toEqual({ address: `bitcoincashii:${ADDR}` });
  });

  it('ignores a malformed amount but keeps the address', () => {
    expect(parseBCH2PaymentUri(`bitcoincashii:${ADDR}?amount=notanumber`)).toEqual({ address: `bitcoincashii:${ADDR}` });
  });

  it('returns null for non-bitcoincashii URIs and empty address', () => {
    expect(parseBCH2PaymentUri('bitcoin:1abc')).toBeNull();
    expect(parseBCH2PaymentUri('bitcoincashii:')).toBeNull();
    expect(parseBCH2PaymentUri('' as any)).toBeNull();
    expect(parseBCH2PaymentUri(undefined as any)).toBeNull();
  });
});

describe('parseBC2PaymentUri', () => {
  it('accepts a bare address (no scheme)', () => {
    expect(parseBC2PaymentUri('bc1qxyz0000')).toEqual({ address: 'bc1qxyz0000' });
    expect(parseBC2PaymentUri('  1SomeLegacyAddr  ')).toEqual({ address: '1SomeLegacyAddr' });
  });

  it('strips a bitcoin:-style scheme and // and pulls the amount', () => {
    expect(parseBC2PaymentUri('bitcoin:bc1qabc?amount=1.5')).toEqual({ address: 'bc1qabc', amount: '1.5' });
    expect(parseBC2PaymentUri('bitcoinii://3AddrHere?amount=0.001&label=x')).toEqual({ address: '3AddrHere', amount: '0.001' });
  });

  it('ignores a malformed amount and extra params', () => {
    expect(parseBC2PaymentUri('bc1qtaproot?amount=abc&message=hi')).toEqual({ address: 'bc1qtaproot' });
    expect(parseBC2PaymentUri('bc1p0000?foo=bar')).toEqual({ address: 'bc1p0000' });
  });

  it('never throws on junk input', () => {
    expect(parseBC2PaymentUri('' as any)).toEqual({ address: '' });
    expect(parseBC2PaymentUri(undefined as any)).toEqual({ address: '' });
  });
});
