# BlueWallet BCH2 Edition

A mobile wallet for **Bitcoin Cash II (BCH2)** with support for both BC2 and BCH2 chains.

## Features

- **Dual Chain Support**: Manage both BC2 and BCH2 wallets in one app
- **BCH2 Airdrop Claim**: Automatically claim your BCH2 from existing BC2 wallets
- **CashAddr Format**: Native support for `bitcoincashii:` addresses
- **No SegWit**: BCH2 follows BCH consensus rules (no SegWit support)
- **Privacy First**: No KYC, no registration, your keys = your coins

## BCH2 Fork Information

BCH2 forks from BC2 at **block 53,200**. If you held BC2 at the fork height, you automatically have the same balance on BCH2.

### Claiming Your BCH2 Airdrop

1. Import your BC2 wallet using your seed phrase or private key
2. The app will automatically detect your BCH2 balance
3. Send your BCH2 to any BCH2-compatible wallet

## Building from Source

### Prerequisites

- Node.js 18+
- React Native CLI
- Android Studio (for Android builds)
- Xcode (for iOS builds)

### Android Build

```bash
# Install dependencies
npm install

# Build APK
cd android
./gradlew assembleRelease
```

The APK will be at `android/app/build/outputs/apk/release/app-release.apk`

### iOS Build

```bash
# Install dependencies
npm install
cd ios && pod install && cd ..

# Build IPA (requires Apple Developer account for distribution)
npx react-native build-ios --mode Release
```

## Download

Pre-built APKs are available at:
- [GitHub Releases](https://github.com/BitcoincashII/bluewallet-bch2/releases)
- [bch2.org/wallet](https://bch2.org/wallet)

## Technical Details

- **BCH2 Electrum Server**: `electrum.bch2.org:50002` (SSL)
- **Address Format**: CashAddr (`bitcoincashii:q...`)
- **Derivation Path**: m/44'/145'/0' (BCH standard)

## Security

- All keys are stored locally on your device
- Mnemonic phrases are encrypted
- No server-side storage of private keys
- Open source and auditable

## License

MIT License - Based on [BlueWallet](https://github.com/BlueWallet/BlueWallet)

## Support

- Discord: https://discord.gg/bch2
- GitHub Issues: https://github.com/BitcoincashII/bluewallet-bch2/issues
