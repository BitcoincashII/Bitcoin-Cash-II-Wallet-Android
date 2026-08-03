/**
 * Opt-in gate for BlueWallet's live-network integration tests.
 *
 * These upstream tests connect to a real Electrum server and fetch balances /
 * UTXOs / transactions for Bitcoin wallet classes (LegacyWallet, SegwitBech32Wallet,
 * BIP47) that the BCH2 app does not use. They cannot run offline, and in this fork
 * BlueElectrum is configured for BCH2 servers rather than Bitcoin, so they only make
 * sense against a real network. Set BW_INTEGRATION=1 to run them; otherwise they skip
 * (they are not fake-passed, and the non-network tests in the same files still run).
 *
 * `it` is a jest global available to modules imported by a test file.
 */
export const RUN_NETWORK_TESTS = !!process.env.BW_INTEGRATION;

// eslint-disable-next-line no-undef
export const itNet: jest.It = RUN_NETWORK_TESTS ? it : it.skip;
