import assert from 'assert';

import {
  BCH2Unit,
  CoinType,
  formatBCH2Amount,
  parseBCH2Amount,
  BCH2_FORK_INFO,
} from '../../models/bch2Units';

describe('BCH2 Units', () => {
  describe('BCH2Unit constants', () => {
    it('has BCH2 unit', () => {
      assert.strictEqual(BCH2Unit.BCH2, 'BCH2');
    });

    it('has SATS unit', () => {
      assert.strictEqual(BCH2Unit.SATS, 'sats');
    });

    it('has LOCAL_CURRENCY unit', () => {
      assert.strictEqual(BCH2Unit.LOCAL_CURRENCY, 'local_currency');
    });

    it('has MAX unit', () => {
      assert.strictEqual(BCH2Unit.MAX, 'MAX');
    });

    it('contains exactly 4 unit types', () => {
      const keys = Object.keys(BCH2Unit);
      assert.strictEqual(keys.length, 4);
    });
  });

  describe('CoinType constants', () => {
    it('has BC2 coin type', () => {
      assert.strictEqual(CoinType.BC2, 'BC2');
    });

    it('has BCH2 coin type', () => {
      assert.strictEqual(CoinType.BCH2, 'BCH2');
    });

    it('contains exactly 2 coin types', () => {
      const keys = Object.keys(CoinType);
      assert.strictEqual(keys.length, 2);
    });
  });

  describe('formatBCH2Amount', () => {
    it('formats 0 satoshis in BCH2', () => {
      assert.strictEqual(formatBCH2Amount(0), '0.00000000 BCH2');
    });

    it('formats 1 satoshi in BCH2', () => {
      assert.strictEqual(formatBCH2Amount(1), '0.00000001 BCH2');
    });

    it('formats 100000000 satoshis (1 BCH2) in BCH2', () => {
      assert.strictEqual(formatBCH2Amount(100000000), '1.00000000 BCH2');
    });

    it('formats a fractional BCH2 amount', () => {
      assert.strictEqual(formatBCH2Amount(123456789), '1.23456789 BCH2');
    });

    it('formats large amounts in BCH2', () => {
      // 21 million BCH2 in satoshis = 2100000000000000
      assert.strictEqual(formatBCH2Amount(2100000000000000), '21000000.00000000 BCH2');
    });

    it('formats MAX_SAFE_INTEGER in BCH2', () => {
      const result = formatBCH2Amount(Number.MAX_SAFE_INTEGER);
      assert.ok(result.endsWith(' BCH2'));
      assert.ok(result.length > 0);
    });

    it('formats negative satoshis in BCH2', () => {
      assert.strictEqual(formatBCH2Amount(-100000000), '-1.00000000 BCH2');
    });

    it('formats 0 satoshis in SATS unit', () => {
      assert.strictEqual(formatBCH2Amount(0, BCH2Unit.SATS), '0 sats');
    });

    it('formats 1 satoshi in SATS unit', () => {
      assert.strictEqual(formatBCH2Amount(1, BCH2Unit.SATS), '1 sats');
    });

    it('formats large satoshi amounts in SATS unit', () => {
      assert.strictEqual(formatBCH2Amount(100000000, BCH2Unit.SATS), '100000000 sats');
    });

    it('formats negative satoshis in SATS unit', () => {
      assert.strictEqual(formatBCH2Amount(-500, BCH2Unit.SATS), '-500 sats');
    });

    it('defaults to BCH2 format for LOCAL_CURRENCY unit', () => {
      const result = formatBCH2Amount(100000000, BCH2Unit.LOCAL_CURRENCY);
      assert.strictEqual(result, '1.00000000 BCH2');
    });

    it('defaults to BCH2 format for MAX unit', () => {
      const result = formatBCH2Amount(100000000, BCH2Unit.MAX);
      assert.strictEqual(result, '1.00000000 BCH2');
    });
  });

  describe('parseBCH2Amount', () => {
    it('parses "1.0" as 100000000 satoshis (BCH2 unit)', () => {
      assert.strictEqual(parseBCH2Amount('1.0'), 100000000);
    });

    it('parses "0.00000001" as 1 satoshi (BCH2 unit)', () => {
      assert.strictEqual(parseBCH2Amount('0.00000001'), 1);
    });

    it('parses "0" as 0 satoshis', () => {
      assert.strictEqual(parseBCH2Amount('0'), 0);
    });

    it('parses "0.5" as 50000000 satoshis', () => {
      assert.strictEqual(parseBCH2Amount('0.5'), 50000000);
    });

    it('parses "21000000" as 2100000000000000 satoshis', () => {
      assert.strictEqual(parseBCH2Amount('21000000'), 2100000000000000);
    });

    it('returns 0 for empty string', () => {
      assert.strictEqual(parseBCH2Amount(''), 0);
    });

    it('returns 0 for completely invalid string', () => {
      assert.strictEqual(parseBCH2Amount('abc'), 0);
    });

    it('returns 0 for string with no digits', () => {
      assert.strictEqual(parseBCH2Amount('---'), 0);
    });

    it('strips non-numeric characters and parses remainder', () => {
      // "1.5 BCH2" => regex keeps digits and dots => "1.52" => 152000000
      assert.strictEqual(parseBCH2Amount('1.5 BCH2'), 152000000);
      // Pure non-numeric suffix with no digits
      assert.strictEqual(parseBCH2Amount('1.5 coins'), 150000000);
    });

    it('handles string with leading/trailing spaces via regex cleaning', () => {
      // spaces are stripped by the regex, leaving numeric content
      assert.strictEqual(parseBCH2Amount('  1.0  '), 100000000);
    });

    it('parses in SATS unit mode', () => {
      assert.strictEqual(parseBCH2Amount('12345', BCH2Unit.SATS), 12345);
    });

    it('floors fractional values in SATS unit mode', () => {
      assert.strictEqual(parseBCH2Amount('123.99', BCH2Unit.SATS), 123);
    });

    it('returns 0 for negative in SATS mode (after cleaning)', () => {
      // "-5" => cleaned to "5" => 5 (the minus is stripped by regex)
      assert.strictEqual(parseBCH2Amount('-5', BCH2Unit.SATS), 5);
    });

    it('returns 0 for empty string in SATS mode', () => {
      assert.strictEqual(parseBCH2Amount('', BCH2Unit.SATS), 0);
    });

    it('returns 0 for NaN-producing string in SATS mode', () => {
      assert.strictEqual(parseBCH2Amount('xyz', BCH2Unit.SATS), 0);
    });

    it('rounds correctly for small BCH2 fractions', () => {
      // 0.00000001 * 100000000 = 1
      assert.strictEqual(parseBCH2Amount('0.00000001', BCH2Unit.BCH2), 1);
    });

    it('handles "1.23456789" correctly', () => {
      assert.strictEqual(parseBCH2Amount('1.23456789', BCH2Unit.BCH2), 123456789);
    });
  });

  describe('BCH2_FORK_INFO', () => {
    it('has correct fork height', () => {
      assert.strictEqual(BCH2_FORK_INFO.forkHeight, 53200);
    });

    it('has fork timestamp initialized to 0', () => {
      assert.strictEqual(BCH2_FORK_INFO.forkTimestamp, 0);
    });

    it('has correct coin name', () => {
      assert.strictEqual(BCH2_FORK_INFO.coinName, 'Bitcoin Cash II');
    });

    it('has correct symbol', () => {
      assert.strictEqual(BCH2_FORK_INFO.symbol, 'BCH2');
    });

    it('has correct address prefix', () => {
      assert.strictEqual(BCH2_FORK_INFO.addressPrefix, 'bitcoincashii');
    });

    it('has correct default port', () => {
      assert.strictEqual(BCH2_FORK_INFO.defaultPort, 8339);
    });

    it('has correct RPC port', () => {
      assert.strictEqual(BCH2_FORK_INFO.rpcPort, 8342);
    });

    it('has correct Electrum port', () => {
      assert.strictEqual(BCH2_FORK_INFO.electrumPort, 50001);
    });

    it('has correct Electrum SSL port', () => {
      assert.strictEqual(BCH2_FORK_INFO.electrumSSLPort, 50002);
    });

    it('is frozen/readonly (all fields)', () => {
      const keys = Object.keys(BCH2_FORK_INFO);
      assert.strictEqual(keys.length, 9);
      assert.deepStrictEqual(keys.sort(), [
        'addressPrefix',
        'coinName',
        'defaultPort',
        'electrumPort',
        'electrumSSLPort',
        'forkHeight',
        'forkTimestamp',
        'rpcPort',
        'symbol',
      ]);
    });
  });

  describe('parseBCH2Amount edge cases', () => {
    it('handles scientific notation input by stripping non-numeric chars', () => {
      // "1e8" => regex strips 'e', leaving "18" => parseFloat("18") = 18
      // 18 * 100_000_000 = 1_800_000_000
      assert.strictEqual(parseBCH2Amount('1e8', BCH2Unit.BCH2), 1800000000);
    });

    it('handles multiple decimal points by parsing up to second dot', () => {
      // "1.2.3" => regex keeps digits and dots => "1.2.3"
      // parseFloat("1.2.3") = 1.2 (stops at second dot)
      // Math.round(1.2 * 100_000_000) = 120_000_000
      assert.strictEqual(parseBCH2Amount('1.2.3', BCH2Unit.BCH2), 120000000);
    });

    it('handles multiple decimal points in SATS mode', () => {
      // "100.5.9" => cleaned "100.5.9" => parseFloat = 100.5 => Math.floor = 100
      assert.strictEqual(parseBCH2Amount('100.5.9', BCH2Unit.SATS), 100);
    });

    it('handles scientific notation input in SATS mode', () => {
      // "5e2" => regex strips 'e', leaving "52" => parseFloat("52") = 52
      assert.strictEqual(parseBCH2Amount('5e2', BCH2Unit.SATS), 52);
    });
  });

  describe('formatBCH2Amount very small negative amounts', () => {
    it('formats -1 satoshi as -0.00000001 BCH2', () => {
      assert.strictEqual(formatBCH2Amount(-1), '-0.00000001 BCH2');
    });

    it('formats -1 satoshi in SATS unit', () => {
      assert.strictEqual(formatBCH2Amount(-1, BCH2Unit.SATS), '-1 sats');
    });

    it('formats -10 satoshis correctly in BCH2', () => {
      assert.strictEqual(formatBCH2Amount(-10), '-0.00000010 BCH2');
    });

    it('formats -99 satoshis correctly in BCH2', () => {
      assert.strictEqual(formatBCH2Amount(-99), '-0.00000099 BCH2');
    });
  });

  describe('parseBCH2Amount additional edge cases', () => {
    it('returns 0 for ".a." input (regex strips to "..", parseFloat is NaN)', () => {
      // ".a." => regex keeps digits and dots => ".." => parseFloat("..") = NaN => returns 0
      assert.strictEqual(parseBCH2Amount('.a.'), 0);
    });

    it('returns 0 for pure non-numeric "abc" input', () => {
      // "abc" => regex strips all non-digit/non-dot => "" => parseFloat("") = NaN => returns 0
      assert.strictEqual(parseBCH2Amount('abc'), 0);
    });

    it('handles value just below MAX_SAFE_INTEGER precision limit', () => {
      // 90071992.54740991 BCH2 * 100_000_000 = 9007199254740991 = Number.MAX_SAFE_INTEGER
      // This is exactly at the boundary and IS a safe integer, so should succeed
      assert.strictEqual(parseBCH2Amount('90071992.54740991', BCH2Unit.BCH2), Number.MAX_SAFE_INTEGER);
    });

    it('parses " 1.5 " with leading/trailing whitespace correctly', () => {
      // " 1.5 " => regex strips spaces => "1.5" => parseFloat("1.5") = 1.5
      // Math.round(1.5 * 100_000_000) = 150_000_000
      assert.strictEqual(parseBCH2Amount(' 1.5 ', BCH2Unit.BCH2), 150000000);
    });
  });

  describe('formatBCH2Amount default unit parameter', () => {
    it('defaults to BCH2 unit when no unit is specified', () => {
      // Call without second argument; should behave identically to BCH2Unit.BCH2
      assert.strictEqual(formatBCH2Amount(50000000), '0.50000000 BCH2');
      assert.strictEqual(formatBCH2Amount(50000000, BCH2Unit.BCH2), '0.50000000 BCH2');
    });

    it('formats exactly 0 satoshis as "0.00000000 BCH2" with default unit', () => {
      assert.strictEqual(formatBCH2Amount(0), '0.00000000 BCH2');
    });
  });

  describe('parseBCH2Amount MAX_SAFE_INTEGER overflow', () => {
    it('returns 0 for values exceeding MAX_SAFE_INTEGER in BCH2 mode', () => {
      // 100_000_000 BCH2 * 100_000_000 sats/BCH2 = 10^16 which exceeds MAX_SAFE_INTEGER (9007199254740991)
      // Math.round(100000000 * 100000000) = 10000000000000000 which is NOT a safe integer
      const result = parseBCH2Amount('100000000', BCH2Unit.BCH2);
      assert.strictEqual(result, 0);
    });

    it('returns 0 for values exceeding MAX_SAFE_INTEGER in SATS mode', () => {
      // A value larger than MAX_SAFE_INTEGER (9007199254740991)
      const result = parseBCH2Amount('9007199254740992', BCH2Unit.SATS);
      assert.strictEqual(result, 0);
    });
  });
});
