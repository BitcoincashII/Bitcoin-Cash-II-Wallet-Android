# Bitcoin Cash II Wallet

<p align="center">
  <strong>The official mobile wallet for Bitcoin Cash II (BCH2)</strong>
</p>

<p align="center">
  <a href="https://github.com/BitcoincashII/Bitcoin-Cash-II-Wallet-Android/releases">
    <img src="https://img.shields.io/github/v/release/BitcoincashII/Bitcoin-Cash-II-Wallet-Android?style=flat-square" alt="Latest Release"/>
  </a>
  <a href="https://bch2.org">
    <img src="https://img.shields.io/badge/website-bch2.org-0ac18e?style=flat-square" alt="Website"/>
  </a>
</p>

---

## About

Bitcoin Cash II Wallet is a non-custodial mobile wallet for the BCH2 blockchain. Built on the proven BlueWallet codebase, it provides a secure and user-friendly way to store, send, and receive BCH2.

### Features

- **BCH2 Native Support** - Full support for the Bitcoin Cash II blockchain
- **BC2 Airdrop Claiming** - Claim your BCH2 airdrop from BC2 holdings at fork height 53,200
- **Non-Custodial** - You control your private keys
- **CashAddr Format** - Uses `bitcoincashii:` address prefix
- **Electrum Connection** - Connects to BCH2 Electrum servers for fast syncing
- **QR Code Support** - Scan and generate QR codes for addresses
- **BIP39 Mnemonic** - Standard 12/24 word recovery phrases
- **Custom Server** - Configure your own Electrum server

## Download

Download the latest APK from the [Releases](https://github.com/BitcoincashII/Bitcoin-Cash-II-Wallet-Android/releases) page.

### Verify APK Signature

Before installing, verify the APK signature matches:

| Type | Fingerprint |
|------|-------------|
| **SHA-256** | `d3d870cb95325edae44d2812ae82391b5b83a3e60161dfaf9d75c7c701160c47` |
| SHA-1 | `444ed630b136252490784b728ddb05ce9badd0d4` |

### Installation

1. Download `BitcoinCashII-Wallet-v1.0.0.apk`
2. Enable "Install from unknown sources" in Android settings
3. Open the APK to install
4. Launch "Bitcoin Cash II Wallet"

## BCH2 Airdrop

BCH2 forked from BC2 at block **53,200**. If you held BC2 at the fork, you have an equal BCH2 balance.

### How to Claim

1. Open the wallet
2. Tap "Claim Airdrop"
3. Import your BC2 wallet using:
   - Private key (WIF format)
   - 12/24 word seed phrase
4. Your BCH2 balance will appear automatically

## Network Information

| Parameter | Value |
|-----------|-------|
| Network | BCH2 Mainnet |
| Fork Height | Block 53,200 |
| Address Format | CashAddr (`bitcoincashii:`) |
| Derivation Path | `m/44'/145'/0'` |
| Consensus | BCH rules (CTOR enabled) |

## Electrum Servers

Default servers:
- `144.202.73.66:50002` (SSL) - Primary
- `electrum.bch2.org:50002` (SSL)
- `electrum2.bch2.org:50002` (SSL)

You can configure a custom server in Settings.

## Building from Source

### Requirements

- Node.js 20+
- Java 17+
- Android SDK 35
- Yarn

### Build

```bash
# Install dependencies
yarn install

# Build Android release
cd android
./gradlew assembleRelease
```

The APK will be at `android/app/build/outputs/apk/release/app-release-unsigned.apk`

## Security

- **Non-custodial**: Private keys never leave your device
- **Open source**: Full source code available for audit
- **No tracking**: No analytics or telemetry
- **No KYC**: No registration required

## Links

- **Website**: [bch2.org](https://bch2.org)
- **Block Explorer**: [explorer.bch2.org](https://explorer.bch2.org)
- **GitHub**: [BitcoincashII](https://github.com/BitcoincashII)

## License

MIT License - See [LICENSE](LICENSE) for details.

Based on [BlueWallet](https://github.com/BlueWallet/BlueWallet).
