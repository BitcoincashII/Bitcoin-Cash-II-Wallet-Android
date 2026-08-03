/**
 * App-lock unit coverage (BCH2AppPassword). The lock had ZERO tests despite a
 * cluster of audit findings (fail-open empty password, brute-force reset, weak
 * hashing). These lock down the security-critical behaviour so the on-device
 * unlock/brute-force gate is a confirmation, not a discovery.
 */

// react-native-biometrics is instantiated at module load; stub it out.
jest.mock('react-native-biometrics', () => {
  class ReactNativeBiometrics {
    isSensorAvailable() {
      return Promise.resolve({ available: false });
    }
    simplePrompt() {
      return Promise.resolve({ success: false });
    }
  }
  return { __esModule: true, default: ReactNativeBiometrics };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

import {
  setAppPassword,
  verifyAppPassword,
  isAppPasswordSet,
  recordFailedAttempt,
  readUnlockAttempts,
  readLockedUntil,
  clearFailedAttempts,
} from '../../screen/bch2/BCH2AppPassword';

const APP_PASSWORD_KEY = '@bch2_app_password';

// scrypt (N=2^14) runs on each set/verify — give the suite headroom.
jest.setTimeout(30000);

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('app-lock password', () => {
  it('reports no password until one is set', async () => {
    expect(await isAppPasswordSet()).toBe(false);
    await setAppPassword('correct horse');
    expect(await isAppPasswordSet()).toBe(true);
  });

  it('FAIL-CLOSED: verify returns false when no password is configured', async () => {
    // The password path must never unlock when nothing is stored — not even for
    // an empty string (regression: an earlier build fail-OPEN'd here).
    expect(await verifyAppPassword('')).toBe(false);
    expect(await verifyAppPassword('anything')).toBe(false);
  });

  it('accepts the correct password and rejects wrong / empty input', async () => {
    await setAppPassword('S3cret-pass');
    expect(await verifyAppPassword('S3cret-pass')).toBe(true);
    expect(await verifyAppPassword('s3cret-pass')).toBe(false); // case-sensitive
    expect(await verifyAppPassword('wrong')).toBe(false);
    expect(await verifyAppPassword('')).toBe(false);
  });

  it('stores a SALTED scrypt record — never the plaintext or a bare hash', async () => {
    await setAppPassword('same-password');
    const rec1 = await AsyncStorage.getItem(APP_PASSWORD_KEY);
    expect(rec1).not.toContain('same-password'); // never plaintext
    const parsed = JSON.parse(rec1!);
    expect(parsed.v).toBe(2);
    expect(typeof parsed.salt).toBe('string');
    expect(typeof parsed.hash).toBe('string');
    // Not the unsalted SHA-256 of the password.
    expect(parsed.hash).not.toBe(bytesToHex(sha256(new TextEncoder().encode('same-password'))));

    // The same password re-set yields a fresh salt (and thus a different hash).
    await setAppPassword('same-password');
    const parsed2 = JSON.parse((await AsyncStorage.getItem(APP_PASSWORD_KEY))!);
    expect(parsed2.salt).not.toBe(parsed.salt);
    expect(parsed2.hash).not.toBe(parsed.hash);
    expect(await verifyAppPassword('same-password')).toBe(true);
  });

  it('verifies a legacy v1 SHA-256 record and transparently upgrades it to salted scrypt', async () => {
    // Simulate a pre-existing legacy record (unsalted single-round SHA-256 hex).
    const legacyHex = bytesToHex(sha256(new TextEncoder().encode('legacy-pw')));
    await AsyncStorage.setItem(APP_PASSWORD_KEY, legacyHex);

    expect(await verifyAppPassword('legacy-pw')).toBe(true);

    // On success the record is upgraded to the v2 salted-scrypt format...
    const upgraded = JSON.parse((await AsyncStorage.getItem(APP_PASSWORD_KEY))!);
    expect(upgraded.v).toBe(2);
    // ...and still verifies (and still rejects the wrong password).
    expect(await verifyAppPassword('legacy-pw')).toBe(true);
    expect(await verifyAppPassword('nope')).toBe(false);
  });
});

describe('app-lock brute-force lockout', () => {
  it('counts attempts and imposes a timed lockout only after the free-attempt threshold', async () => {
    // BACKOFF_AFTER = 5 free attempts before a timed lockout begins.
    for (let i = 1; i <= 4; i++) {
      const r = await recordFailedAttempt();
      expect(r.attempts).toBe(i);
      expect(r.lockedUntil).toBe(0); // no lockout yet
    }
    expect(await readUnlockAttempts()).toBe(4);
    expect(await readLockedUntil()).toBe(0);

    const fifth = await recordFailedAttempt();
    expect(fifth.attempts).toBe(5);
    expect(fifth.lockedUntil).toBeGreaterThan(Date.now()); // lockout now active
    expect(await readLockedUntil()).toBeGreaterThan(Date.now());
  });

  it('lockout escalates with more attempts and clears on success', async () => {
    for (let i = 0; i < 5; i++) await recordFailedAttempt();
    const afterFive = await readLockedUntil();
    const sixth = await recordFailedAttempt();
    // 6th backoff (2^1 base) must be strictly later than the 5th (2^0 base).
    expect(sixth.lockedUntil).toBeGreaterThan(afterFive);

    // A successful unlock resets everything.
    await clearFailedAttempts();
    expect(await readUnlockAttempts()).toBe(0);
    expect(await readLockedUntil()).toBe(0);
  });

  it('persisted counters survive as raw AsyncStorage values (outlive React state)', async () => {
    await recordFailedAttempt();
    await recordFailedAttempt();
    // A fresh read (simulating an app restart) still sees the attempts.
    expect(await readUnlockAttempts()).toBe(2);
  });
});
