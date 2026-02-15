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
      return satoshis.toLocaleString() + ' sats';
    default:
      return (satoshis / 100000000).toFixed(8) + ' BCH2';
  }
}

/**
 * Parse BCH2 amount string to satoshis
 */
export function parseBCH2Amount(amount: string): number {
  const cleaned = amount.replace(/[^0-9.]/g, '');
  const value = parseFloat(cleaned);
  if (isNaN(value)) return 0;

  // If the amount looks like satoshis (no decimal), return as-is
  if (!cleaned.includes('.') && value > 1000) {
    return Math.floor(value);
  }

  // Otherwise, convert from BCH2 to satoshis
  return Math.floor(value * 100000000);
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
