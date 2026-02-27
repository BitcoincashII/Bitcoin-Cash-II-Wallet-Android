/**
 * BCH2 and BC2 Constants
 */

// Block Explorers
export const BCH2_EXPLORER_URL = 'https://explorer.bch2.org';
export const BC2_EXPLORER_URL = 'https://explorer.bitcoin-ii.org';

// Validate that a string looks like a hex txid (64 hex chars)
function isValidTxid(txid: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(txid);
}

// Get transaction URL for explorer
export function getBCH2TransactionUrl(txid: string): string {
  if (!isValidTxid(txid)) return BCH2_EXPLORER_URL;
  return `${BCH2_EXPLORER_URL}/tx/${txid}`;
}

export function getBC2TransactionUrl(txid: string): string {
  if (!isValidTxid(txid)) return BC2_EXPLORER_URL;
  return `${BC2_EXPLORER_URL}/tx/${txid}`;
}

// Get address URL for explorer
export function getBCH2AddressUrl(address: string): string {
  return `${BCH2_EXPLORER_URL}/address/${encodeURIComponent(address)}`;
}

export function getBC2AddressUrl(address: string): string {
  return `${BC2_EXPLORER_URL}/address/${encodeURIComponent(address)}`;
}

// Get block URL for explorer (by hash)
export function getBCH2BlockUrl(blockHash: string): string {
  if (!isValidTxid(blockHash)) return BCH2_EXPLORER_URL;
  return `${BCH2_EXPLORER_URL}/block/${blockHash}`;
}

export function getBC2BlockUrl(blockHash: string): string {
  if (!isValidTxid(blockHash)) return BC2_EXPLORER_URL;
  return `${BC2_EXPLORER_URL}/block/${blockHash}`;
}

// Get block URL for explorer (by height)
export function getBCH2BlockHeightUrl(height: number): string {
  if (!Number.isInteger(height) || height < 0) return BCH2_EXPLORER_URL;
  return `${BCH2_EXPLORER_URL}/block-height/${height}`;
}

export function getBC2BlockHeightUrl(height: number): string {
  if (!Number.isInteger(height) || height < 0) return BC2_EXPLORER_URL;
  return `${BC2_EXPLORER_URL}/block-height/${height}`;
}

export default {
  BCH2_EXPLORER_URL,
  BC2_EXPLORER_URL,
  getBCH2TransactionUrl,
  getBC2TransactionUrl,
  getBCH2AddressUrl,
  getBC2AddressUrl,
  getBCH2BlockUrl,
  getBC2BlockUrl,
  getBCH2BlockHeightUrl,
  getBC2BlockHeightUrl,
};
