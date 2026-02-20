# Bitcoin Cash II Wallet

The official mobile wallet for Bitcoin Cash II (BCH2) and BitcoinII (BC2).

## Features

- **BCH2 & BC2 Support** - Full wallet support for both chains
- **Create & Import Wallets** - Generate new wallets or restore from seed phrase
- **BCH2 Airdrop Claiming** - Claim BCH2 from BC2 holdings at fork height 53,200
- **Non-Custodial** - Your keys, your coins
- **CashAddr Format** - BCH2 uses `bitcoincashii:` address prefix
- **Legacy Format** - BC2 uses standard legacy addresses
- **Electrum Connection** - Fast sync via Electrum servers
- **QR Code Support** - Scan and generate QR codes

## Download

Download the latest APK from [Releases](https://github.com/BitcoincashII/Bitcoin-Cash-II-Wallet-Android/releases).

## Electrum Servers

**BCH2:**
- electrum.bch2.org:50002 (SSL)
- electrum2.bch2.org:50002 (SSL)

**BC2:**
- infra1.bitcoin-ii.org:50009 (SSL)
- explorer.bitcoin-ii.org:50009 (SSL)

## Block Explorers

- **BCH2:** https://explorer.bch2.org
- **BC2:** https://explorer.bitcoin-ii.org

## Network Information

| Parameter | BCH2 | BC2 |
|-----------|------|-----|
| Address Format | CashAddr (`bitcoincashii:`) | Legacy (`1...`) |
| Fork Height | Block 53,200 | - |
| Derivation Path | m/44'/145'/0' | m/44'/145'/0' |

## Building from Source

### Requirements

- Node.js 20+
- Java 17+
- Android SDK 35
- Yarn

### Build

```bash
yarn install
cd android
./gradlew assembleRelease
```

APK output: `android/app/build/outputs/apk/release/app-release-unsigned.apk`

## Support

- **Report Bugs:** dev@bitcoincashii.org
- **Website:** https://bch2.org
- **BC2 Website:** https://bitcoin-ii.org

## License

MIT License
