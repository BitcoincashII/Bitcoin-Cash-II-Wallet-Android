// Integration tests that need a live network or a running node are excluded from the
// default (offline) run; set BW_INTEGRATION=1 to run them.
//   - The BlueWallet .js tests fetch real balances / UTXOs / transactions / exchange
//     rates via BlueElectrum for Bitcoin wallet classes the BCH2 app does not use.
//   - bc2-native-regtest validates the BC2 spend builders against a running v27 BCH2
//     regtest node (consensus via generateblock); run it deliberately against a fresh
//     node with `BW_INTEGRATION=1 jest tests/integration/bc2-native-regtest.test.ts`.
// (import/legacy-wallet/bip47 are instead gated per-test with itNet, so their
// non-network tests still run in the default suite.)
const NETWORK_INTEGRATION = [
  'tests/integration/BlueElectrum\\.test\\.js$',
  'tests/integration/ElectrumClient\\.test\\.js$',
  'tests/integration/Currency\\.test\\.js$',
  'tests/integration/watch-only-wallet\\.test\\.js$',
  'tests/integration/multisig-hd-wallet\\.test\\.js$',
  'tests/integration/hd-segwit-p2sh-wallet\\.test\\.js$',
  'tests/integration/hd-segwit-bech32-transaction\\.test\\.js$',
  'tests/integration/bc2-native-regtest\\.test\\.ts$',
  'tests/integration/bch2-segwit-recovery-regtest\\.test\\.ts$',
];

module.exports = {
  testEnvironment: '<rootDir>/tests/custom-environment.js',
  // tests/e2e/*.spec.js are Detox end-to-end tests (need a device + built app); they
  // run via `detox test`, never the jest unit runner, so always ignore them here.
  testPathIgnorePatterns: ['/node_modules/', '/tests/e2e/', ...(process.env.BW_INTEGRATION ? [] : NETWORK_INTEGRATION)],
  reporters: ['default', ['<rootDir>/tests/custom-reporter.js', {}]],
  preset: 'react-native',
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
  transformIgnorePatterns: ['node_modules/(?!((jest-)?react-native(-.*)?|@react-native(-community)?)|@rneui|silent-payments|@arkade-os)/'],
  moduleNameMapper: {
    '^expo/fetch$': '<rootDir>/util/expo-fetch-nodejs.js',
    '^@react-native-menu/menu$': '<rootDir>/tests/__mocks__/@react-native-menu/menu.js',
    '^@lodev09/react-native-true-sheet$': '<rootDir>/tests/__mocks__/@lodev09/react-native-true-sheet.js',
    '^react-native-rate-app$': '<rootDir>/tests/__mocks__/react-native-rate-app.js',
    '^react-native-draglist$': '<rootDir>/tests/__mocks__/react-native-draglist.js',
    '^react-native-capture-protection$': '<rootDir>/tests/__mocks__/react-native-capture-protection.js',
    '^react-native-blue-crypto$': '<rootDir>/tests/__mocks__/react-native-blue-crypto.js',
  },
  setupFiles: ['./tests/setup.js'],
  watchPathIgnorePatterns: ['<rootDir>/node_modules'],
};
