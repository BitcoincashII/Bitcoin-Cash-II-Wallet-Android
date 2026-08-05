/**
 * BCH2 payment URI parsing (bitcoincashii:<address>?amount=..&label=..&message=..).
 * Pure and dependency-free so it is trivially testable and safe to call from the
 * deep-link handler.
 */

export interface BCH2Payment {
  address: string;   // normalized to include the bitcoincashii: prefix
  amount?: string;   // in BCH2 units (decimal string), as it appears in the URI
  label?: string;
  message?: string;
}

const SCHEME = 'bitcoincashii:';

/**
 * Parse a bitcoincashii: payment URI. Returns null if it is not a bitcoincashii:
 * URI or has no address. The scheme match is case-insensitive; the address is
 * returned with exactly one bitcoincashii: prefix (what the send screen validates).
 */
export function parseBCH2PaymentUri(uri: string): BCH2Payment | null {
  if (typeof uri !== 'string') return null;
  if (!uri.toLowerCase().startsWith(SCHEME)) return null;

  const rest = uri.slice(SCHEME.length);
  const qIdx = rest.indexOf('?');
  // Some senders double-prefix the address inside the URI; strip any leading scheme.
  let addrPart = (qIdx === -1 ? rest : rest.slice(0, qIdx)).trim();
  addrPart = addrPart.replace(/^bitcoincashii:/i, '').replace(/^\/+/, '');
  if (!addrPart) return null;

  // CashAddr is case-insensitive but must be uniform case; the scheme prefix is
  // lowercase, so lowercase the body too. Without this an all-UPPERCASE CashAddr
  // URI (valid, common in QR alphanumeric mode) becomes lowercase-prefix +
  // uppercase-body = mixed case, which decodeCashAddr rejects (LOW #24).
  const result: BCH2Payment = { address: `${SCHEME}${addrPart.toLowerCase()}` };

  const query = qIdx === -1 ? '' : rest.slice(qIdx + 1);
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    let key: string;
    let val: string;
    try {
      key = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq)).toLowerCase();
      val = eq === -1 ? '' : decodeURIComponent(pair.slice(eq + 1));
    } catch {
      continue; // malformed percent-encoding — skip this param, keep the rest
    }
    if (key === 'amount') {
      // Keep only a well-formed non-negative decimal; ignore junk.
      if (/^\d*\.?\d+$/.test(val)) result.amount = val;
    } else if (key === 'label') {
      result.label = val;
    } else if (key === 'message') {
      result.message = val;
    }
  }
  return result;
}

export interface BC2Payment {
  address: string; // bare address (scheme + query stripped); may be '' if none present
  amount?: string; // decimal string, as it appears in the URI
}

/**
 * Parse a scanned BC2 payment string. BC2 is a Bitcoin-Core-lineage chain, so a QR
 * may be a bare address (1.../3.../bc1.../bc1p...) or a BIP21-style URI with an
 * optional scheme (bitcoin:, bitcoinii:, …) and an ?amount= query. Never returns
 * null — a bare address is valid; the Send screen validates the address itself.
 */
export function parseBC2PaymentUri(raw: string): BC2Payment {
  let s = (typeof raw === 'string' ? raw : '').trim();
  // Strip a leading URI scheme (e.g. "bitcoin:") and any "//" that follows it.
  const scheme = s.match(/^[a-zA-Z][a-zA-Z0-9.+-]*:/);
  if (scheme) s = s.slice(scheme[0].length);
  s = s.replace(/^\/+/, '');

  const result: BC2Payment = { address: '' };
  const qIdx = s.indexOf('?');
  const query = qIdx === -1 ? '' : s.slice(qIdx + 1);
  result.address = (qIdx === -1 ? s : s.slice(0, qIdx)).trim();

  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    let key: string;
    let val: string;
    try {
      key = decodeURIComponent(pair.slice(0, eq)).toLowerCase();
      val = decodeURIComponent(pair.slice(eq + 1));
    } catch {
      continue;
    }
    if (key === 'amount' && /^\d*\.?\d+$/.test(val)) result.amount = val;
  }
  return result;
}
