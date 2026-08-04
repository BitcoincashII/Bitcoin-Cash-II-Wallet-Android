import { parseBCH2PaymentUri } from '../../class/bch2-uri';

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
