import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  saveWallet,
  getWallets,
  getWallet,
  deleteWallet,
  getWalletMnemonic,
  updateWalletBalance,
  verifyWalletPassword,
} from '../../class/bch2-wallet-storage';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TEST_PASSWORD = 'testpassword123';
const WALLETS_KEY = '@bch2_wallets';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('Encryption Security', () => {
  it('saveWallet stores mnemonic encrypted (starts with gcm:)', async () => {
    const wallet = await saveWallet('Test', TEST_MNEMONIC, 'bch2', TEST_PASSWORD);
    expect(wallet.mnemonic.startsWith('gcm:')).toBe(true);
  });

  it('saveWallet never stores plaintext mnemonic', async () => {
    const wallet = await saveWallet('Test', TEST_MNEMONIC, 'bch2', TEST_PASSWORD);
    expect(wallet.mnemonic).not.toBe(TEST_MNEMONIC);
    expect(wallet.mnemonic).not.toContain(TEST_MNEMONIC);

    // Also verify the raw storage does not contain the plaintext
    const raw = await AsyncStorage.getItem(WALLETS_KEY);
    expect(raw).not.toBeNull();
    expect(raw).not.toContain(TEST_MNEMONIC);
  });

  it('getWalletMnemonic with correct password returns original mnemonic', async () => {
    const wallet = await saveWallet('Test', TEST_MNEMONIC, 'bch2', TEST_PASSWORD);
    const mnemonic = await getWalletMnemonic(wallet.id, TEST_PASSWORD);
    expect(mnemonic).toBe(TEST_MNEMONIC);
  });

  it('getWalletMnemonic with wrong password throws', async () => {
    const wallet = await saveWallet('Test', TEST_MNEMONIC, 'bch2', TEST_PASSWORD);
    // GCM authenticated encryption detects wrong key and throws before
    // the bip39 validation layer — Node crypto raises "unable to authenticate data"
    await expect(getWalletMnemonic(wallet.id, 'wrongpassword')).rejects.toThrow();
  });

  it('getWalletMnemonic without password for encrypted wallet throws Password is required', async () => {
    const wallet = await saveWallet('Test', TEST_MNEMONIC, 'bch2', TEST_PASSWORD);
    await expect(getWalletMnemonic(wallet.id, '')).rejects.toThrow('Password is required');
    await expect(getWalletMnemonic(wallet.id)).rejects.toThrow('Password is required');
  });

  it('GCM encrypted format has correct structure: gcm:salt:iv:authTag:ciphertext (5 parts)', async () => {
    const wallet = await saveWallet('Test', TEST_MNEMONIC, 'bch2', TEST_PASSWORD);
    const parts = wallet.mnemonic.split(':');
    expect(parts.length).toBe(5);
    expect(parts[0]).toBe('gcm');
  });

  it('salt is 32 hex chars (16 bytes), IV is 24 hex chars (12 bytes), authTag is 32 hex chars (16 bytes)', async () => {
    const wallet = await saveWallet('Test', TEST_MNEMONIC, 'bch2', TEST_PASSWORD);
    const parts = wallet.mnemonic.split(':');
    // parts[1] = salt (16 bytes = 32 hex chars)
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/);
    // parts[2] = IV (12 bytes = 24 hex chars)
    expect(parts[2]).toMatch(/^[0-9a-f]{24}$/);
    // parts[3] = authTag (16 bytes = 32 hex chars)
    expect(parts[3]).toMatch(/^[0-9a-f]{32}$/);
    // parts[4] = ciphertext (non-empty hex)
    expect(parts[4]).toMatch(/^[0-9a-f]+$/);
    expect(parts[4].length).toBeGreaterThan(0);
  });
});

describe('Input Validation', () => {
  it('saveWallet throws if password is empty string', async () => {
    await expect(saveWallet('Test', TEST_MNEMONIC, 'bch2', '')).rejects.toThrow('Password is required');
  });

  it('saveWallet throws if mnemonic is invalid (not BIP39-valid)', async () => {
    await expect(saveWallet('Test', 'not a valid mnemonic phrase at all', 'bch2', TEST_PASSWORD)).rejects.toThrow('Invalid mnemonic');
  });

  it('saveWallet trims mnemonic whitespace before encryption', async () => {
    const paddedMnemonic = '  ' + TEST_MNEMONIC + '  ';
    const wallet = await saveWallet('Test', paddedMnemonic, 'bch2', TEST_PASSWORD);
    const decrypted = await getWalletMnemonic(wallet.id, TEST_PASSWORD);
    expect(decrypted).toBe(TEST_MNEMONIC);
    // No leading/trailing whitespace
    expect(decrypted).not.toMatch(/^\s/);
    expect(decrypted).not.toMatch(/\s$/);
  });

  it('saveWallet trims label whitespace', async () => {
    const wallet = await saveWallet('  My Wallet  ', TEST_MNEMONIC, 'bch2', TEST_PASSWORD);
    expect(wallet.label).toBe('My Wallet');
  });

  it('updateWalletBalance rejects NaN balance', async () => {
    const wallet = await saveWallet('Test', TEST_MNEMONIC, 'bch2', TEST_PASSWORD);
    await updateWalletBalance(wallet.id, NaN, 0);
    // Balance should remain unchanged (0) since NaN is silently rejected
    const updated = await getWallet(wallet.id);
    expect(updated!.balance).toBe(0);
  });

  it('updateWalletBalance rejects Infinity balance', async () => {
    const wallet = await saveWallet('Test', TEST_MNEMONIC, 'bch2', TEST_PASSWORD);
    await updateWalletBalance(wallet.id, Infinity, 0);
    // Balance should remain unchanged (0) since Infinity is silently rejected
    const updated = await getWallet(wallet.id);
    expect(updated!.balance).toBe(0);
  });

  it('updateWalletBalance rejects negative confirmed balance', async () => {
    const wallet = await saveWallet('Test', TEST_MNEMONIC, 'bch2', TEST_PASSWORD);
    await updateWalletBalance(wallet.id, -100, 0);
    // Negative confirmed balance is clamped to 0 via Math.max(0, ...)
    const updated = await getWallet(wallet.id);
    expect(updated!.balance).toBe(0);
  });
});

describe('Legacy Wallet Handling', () => {
  it('getWalletMnemonic validates legacy (unencrypted) mnemonics with bip39', async () => {
    const legacyWallet = {
      id: 'legacy_test',
      type: 'bch2' as const,
      label: 'Legacy',
      mnemonic: TEST_MNEMONIC, // plaintext - legacy format
      address: 'bitcoincashii:qtest',
      balance: 0,
      unconfirmedBalance: 0,
      createdAt: Date.now(),
      isEncrypted: false,
    };
    await AsyncStorage.setItem(WALLETS_KEY, JSON.stringify([legacyWallet]));

    const mnemonic = await getWalletMnemonic('legacy_test');
    expect(mnemonic).toBe(TEST_MNEMONIC);
  });

  it('getWalletMnemonic throws for invalid legacy mnemonic data', async () => {
    const legacyWallet = {
      id: 'legacy_bad',
      type: 'bch2' as const,
      label: 'Legacy Bad',
      mnemonic: 'this is not a valid mnemonic at all garbage data here today', // invalid plaintext
      address: 'bitcoincashii:qtest',
      balance: 0,
      unconfirmedBalance: 0,
      createdAt: Date.now(),
      isEncrypted: false,
    };
    await AsyncStorage.setItem(WALLETS_KEY, JSON.stringify([legacyWallet]));

    await expect(getWalletMnemonic('legacy_bad')).rejects.toThrow('Invalid mnemonic in legacy wallet');
  });
});

describe('Deletion Security', () => {
  it('deleteWallet removes wallet from storage', async () => {
    const wallet = await saveWallet('Test', TEST_MNEMONIC, 'bch2', TEST_PASSWORD);
    await deleteWallet(wallet.id);
    const wallets = await getWallets();
    expect(wallets.length).toBe(0);
  });

  it('after deleteWallet, getWallet returns null for deleted ID', async () => {
    const wallet = await saveWallet('Test', TEST_MNEMONIC, 'bch2', TEST_PASSWORD);
    const id = wallet.id;
    await deleteWallet(id);
    const result = await getWallet(id);
    expect(result).toBeNull();
  });

  it('deleteWallet does not affect other wallets', async () => {
    const wallet1 = await saveWallet('Wallet 1', TEST_MNEMONIC, 'bch2', TEST_PASSWORD);
    // Use a different valid mnemonic for wallet 2
    const mnemonic2 = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
    const wallet2 = await saveWallet('Wallet 2', mnemonic2, 'bch2', TEST_PASSWORD);

    await deleteWallet(wallet1.id);

    const remaining = await getWallets();
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe(wallet2.id);
    expect(remaining[0].label).toBe('Wallet 2');

    // Verify wallet2 mnemonic is still accessible
    const decrypted = await getWalletMnemonic(wallet2.id, TEST_PASSWORD);
    expect(decrypted).toBe(mnemonic2);
  });
});

describe('Password Verification', () => {
  it('verifyWalletPassword returns true for correct password', async () => {
    const wallet = await saveWallet('Test', TEST_MNEMONIC, 'bch2', TEST_PASSWORD);
    const result = await verifyWalletPassword(wallet.id, TEST_PASSWORD);
    expect(result).toBe(true);
  });

  it('verifyWalletPassword returns false for wrong password', async () => {
    const wallet = await saveWallet('Test', TEST_MNEMONIC, 'bch2', TEST_PASSWORD);
    const result = await verifyWalletPassword(wallet.id, 'wrongpassword');
    expect(result).toBe(false);
  });

  it('verifyWalletPassword returns false for non-existent wallet', async () => {
    const result = await verifyWalletPassword('nonexistent_id', TEST_PASSWORD);
    expect(result).toBe(false);
  });
});

describe('Concurrent Access', () => {
  it('multiple concurrent saveWallet calls do not lose data (storage lock test)', async () => {
    const mnemonics = [
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
      'legal winner thank year wave sausage worth useful legal winner thank yellow',
    ];

    // Fire all three saves concurrently
    const results = await Promise.all(
      mnemonics.map((m, i) => saveWallet(`Wallet ${i}`, m, 'bch2', TEST_PASSWORD)),
    );

    expect(results.length).toBe(3);

    const wallets = await getWallets();
    expect(wallets.length).toBe(3);

    // Each wallet should be present
    const ids = wallets.map(w => w.id);
    for (const r of results) {
      expect(ids).toContain(r.id);
    }
  });

  it('saveWallet followed by immediate getWallets returns the saved wallet', async () => {
    const wallet = await saveWallet('Immediate', TEST_MNEMONIC, 'bch2', TEST_PASSWORD);
    const wallets = await getWallets();
    expect(wallets.length).toBe(1);
    expect(wallets[0].id).toBe(wallet.id);
    expect(wallets[0].label).toBe('Immediate');
    expect(wallets[0].isEncrypted).toBe(true);
  });
});

describe('Address Derivation', () => {
  it('saveWallet with type bch2 derives a bitcoincashii: prefixed address', async () => {
    const wallet = await saveWallet('BCH2', TEST_MNEMONIC, 'bch2', TEST_PASSWORD);
    expect(wallet.address.startsWith('bitcoincashii:')).toBe(true);
  });

  it('saveWallet with type bc2 derives a legacy address (starts with 1)', async () => {
    const wallet = await saveWallet('BC2', TEST_MNEMONIC, 'bc2', TEST_PASSWORD);
    expect(wallet.address.startsWith('1')).toBe(true);
  });
});
