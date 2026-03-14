module.exports = {
  testEnvironment: '<rootDir>/tests/custom-environment.js',
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
