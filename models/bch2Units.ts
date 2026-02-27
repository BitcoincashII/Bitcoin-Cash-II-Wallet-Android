/**
 * BCH2 Units and Chain Types
 */

export const BCH2Unit = {
  BCH2: 'BCH2',
  SATS: 'sats',
  LOCAL_CURRENCY: 'local_currency',
  MAX: 'MAX',
} as const;

export type BCH2Unit = (typeof BCH2Unit)[keyof typeof BCH2Unit];

export const CoinType = {
  BC2: 'BC2',
  BCH2: 'BCH2',
} as const;

export type CoinType = (typeof CoinType)[keyof typeof CoinType];

/**
 * Format BCH2 amount for display
 */
export function formatBCH2Amount(satoshis: number, unit: BCH2Unit = BCH2Unit.BCH2): string {
  switch (unit) {
    case BCH2Unit.BCH2:
      return (satoshis / 100000000).toFixed(8) + ' BCH2';
    case BCH2Unit.SATS:
      return satoshis.toString() + ' sats';
    default:
      return (satoshis / 100000000).toFixed(8) + ' BCH2';
  }
}

/**
 * Parse BCH2 amount string to satoshis.
 * Caller must specify the unit to avoid ambiguity.
 * Defaults to BCH2 (i.e. "1.5" = 150_000_000 sats).
 */
export function parseBCH2Amount(amount: string, unit: BCH2Unit = BCH2Unit.BCH2): number {
  const cleaned = amount.replace(/[^0-9.]/g, '');
  const value = parseFloat(cleaned);
  if (isNaN(value) || !isFinite(value)) return 0;

  if (unit === BCH2Unit.SATS) {
    const sats = Math.floor(value);
    if (!Number.isSafeInteger(sats) || sats < 0) return 0;
    return sats;
  }

  // BCH2 unit: convert to satoshis
  const sats = Math.round(value * 100000000);
  if (!Number.isSafeInteger(sats) || sats < 0) return 0;
  return sats;
}

/**
 * BCH2 fork information
 */
export const BCH2_FORK_INFO = {
  forkHeight: 53200,
  forkTimestamp: 0, // Will be set when fork happens
  coinName: 'Bitcoin Cash II',
  symbol: 'BCH2',
  addressPrefix: 'bitcoincashii',
  defaultPort: 8339,
  rpcPort: 8342,
  electrumPort: 50001,
  electrumSSLPort: 50002,
} as const;

export default {
  BCH2Unit,
  CoinType,
  formatBCH2Amount,
  parseBCH2Amount,
  BCH2_FORK_INFO,
};
