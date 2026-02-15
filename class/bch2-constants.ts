/**
 * BCH2 and BC2 Constants
 */

// Block Explorers
export const BCH2_EXPLORER_URL = 'https://explorer.bch2.org';
export const BC2_EXPLORER_URL = 'https://explorer.bitcoin-ii.org';

// Get transaction URL for explorer
export function getBCH2TransactionUrl(txid: string): string {
  return `${BCH2_EXPLORER_URL}/tx/${txid}`;
}

export function getBC2TransactionUrl(txid: string): string {
  return `${BC2_EXPLORER_URL}/tx/${txid}`;
}

// Get address URL for explorer
export function getBCH2AddressUrl(address: string): string {
  return `${BCH2_EXPLORER_URL}/address/${address}`;
}

export function getBC2AddressUrl(address: string): string {
  return `${BC2_EXPLORER_URL}/address/${address}`;
}

// Get block URL for explorer
export function getBCH2BlockUrl(blockHash: string): string {
  return `${BCH2_EXPLORER_URL}/block/${blockHash}`;
}

export function getBC2BlockUrl(blockHash: string): string {
  return `${BC2_EXPLORER_URL}/block/${blockHash}`;
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
};
