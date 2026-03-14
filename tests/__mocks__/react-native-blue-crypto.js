// Mock for removed react-native-blue-crypto dependency
// BIP38 falls back to pure-JS scryptsy when this is unavailable
module.exports = {
  isAvailable: () => false,
  scrypt: () => Promise.reject(new Error('react-native-blue-crypto removed')),
};
