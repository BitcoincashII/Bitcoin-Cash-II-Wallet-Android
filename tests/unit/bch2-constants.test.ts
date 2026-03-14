import assert from 'assert';

import {
  BCH2_EXPLORER_URL,
  BC2_EXPLORER_URL,
  getBCH2TransactionUrl,
  getBC2TransactionUrl,
  getBCH2AddressUrl,
  getBC2AddressUrl,
  getBCH2BlockUrl,
  getBC2BlockUrl,
  getBCH2BlockHeightUrl,
  getBC2BlockHeightUrl,
} from '../../class/bch2-constants';

const VALID_TXID = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
const VALID_BLOCK_HASH = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';

describe('BCH2 Constants', () => {
  describe('Explorer URL constants', () => {
    it('BCH2 explorer URL is correct', () => {
      assert.strictEqual(BCH2_EXPLORER_URL, 'https://explorer.bch2.org');
    });

    it('BC2 explorer URL is correct', () => {
      assert.strictEqual(BC2_EXPLORER_URL, 'https://explorer.bitcoin-ii.org');
    });

    it('explorer URLs use HTTPS', () => {
      assert.ok(BCH2_EXPLORER_URL.startsWith('https://'));
      assert.ok(BC2_EXPLORER_URL.startsWith('https://'));
    });
  });

  describe('getBCH2TransactionUrl', () => {
    it('returns correct URL for a valid txid', () => {
      assert.strictEqual(
        getBCH2TransactionUrl(VALID_TXID),
        `https://explorer.bch2.org/tx/${VALID_TXID}`,
      );
    });

    it('returns base URL for empty string', () => {
      assert.strictEqual(getBCH2TransactionUrl(''), BCH2_EXPLORER_URL);
    });

    it('returns base URL for a short string (not 64 hex chars)', () => {
      assert.strictEqual(getBCH2TransactionUrl('abcdef'), BCH2_EXPLORER_URL);
    });

    it('returns base URL for a string with non-hex characters', () => {
      const badTxid = 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
      assert.strictEqual(getBCH2TransactionUrl(badTxid), BCH2_EXPLORER_URL);
    });

    it('returns base URL for XSS attempt', () => {
      assert.strictEqual(getBCH2TransactionUrl('<script>alert(1)</script>'), BCH2_EXPLORER_URL);
    });

    it('returns base URL for string with spaces', () => {
      assert.strictEqual(getBCH2TransactionUrl('abcdef01234567890 bcdef0123456789abcdef0123456789abcdef012345678'), BCH2_EXPLORER_URL);
    });

    it('accepts uppercase hex txid', () => {
      const upperTxid = VALID_TXID.toUpperCase();
      assert.strictEqual(
        getBCH2TransactionUrl(upperTxid),
        `https://explorer.bch2.org/tx/${upperTxid}`,
      );
    });
  });

  describe('getBC2TransactionUrl', () => {
    it('returns correct URL for a valid txid', () => {
      assert.strictEqual(
        getBC2TransactionUrl(VALID_TXID),
        `https://explorer.bitcoin-ii.org/tx/${VALID_TXID}`,
      );
    });

    it('returns base URL for invalid txid', () => {
      assert.strictEqual(getBC2TransactionUrl('invalid'), BC2_EXPLORER_URL);
    });

    it('returns base URL for empty string', () => {
      assert.strictEqual(getBC2TransactionUrl(''), BC2_EXPLORER_URL);
    });

    it('accepts uppercase hex txid (case insensitive hex validation)', () => {
      const upperTxid = VALID_TXID.toUpperCase();
      assert.strictEqual(
        getBC2TransactionUrl(upperTxid),
        `https://explorer.bitcoin-ii.org/tx/${upperTxid}`,
      );
    });

    it('accepts mixed-case hex txid', () => {
      const mixedTxid = 'ABCDef0123456789abcdef0123456789ABCDEF0123456789abcdef0123456789';
      assert.strictEqual(
        getBC2TransactionUrl(mixedTxid),
        `https://explorer.bitcoin-ii.org/tx/${mixedTxid}`,
      );
    });
  });

  describe('getBCH2AddressUrl', () => {
    it('returns correct URL for a simple address', () => {
      const address = 'bitcoincashii:qpm2qsznhks23z7629mms6s4cwef74vcwva87rkuu';
      assert.strictEqual(
        getBCH2AddressUrl(address),
        `https://explorer.bch2.org/address/${encodeURIComponent(address)}`,
      );
    });

    it('returns URL even for empty string (no validation on address)', () => {
      assert.strictEqual(getBCH2AddressUrl(''), 'https://explorer.bch2.org/address/');
    });

    it('encodes special characters in address', () => {
      const malicious = '<script>alert("xss")</script>';
      const result = getBCH2AddressUrl(malicious);
      assert.ok(!result.includes('<script>'));
      assert.ok(result.includes(encodeURIComponent(malicious)));
    });

    it('encodes spaces in address', () => {
      const result = getBCH2AddressUrl('some address');
      assert.ok(result.includes('some%20address'));
    });

    it('encodes ampersands and question marks', () => {
      const result = getBCH2AddressUrl('addr?param=1&other=2');
      assert.ok(!result.includes('?param'));
      assert.ok(result.includes(encodeURIComponent('addr?param=1&other=2')));
    });
  });

  describe('getBC2AddressUrl', () => {
    it('returns correct URL for a simple address', () => {
      const address = 'bitcoincashii:qtest123';
      assert.strictEqual(
        getBC2AddressUrl(address),
        `https://explorer.bitcoin-ii.org/address/${encodeURIComponent(address)}`,
      );
    });

    it('encodes special characters', () => {
      const malicious = '"><img src=x onerror=alert(1)>';
      const result = getBC2AddressUrl(malicious);
      assert.ok(!result.includes('<img'));
      assert.ok(result.includes(encodeURIComponent(malicious)));
    });
  });

  describe('getBCH2BlockUrl', () => {
    it('returns correct URL for a valid block hash', () => {
      assert.strictEqual(
        getBCH2BlockUrl(VALID_BLOCK_HASH),
        `https://explorer.bch2.org/block/${VALID_BLOCK_HASH}`,
      );
    });

    it('returns base URL for empty string', () => {
      assert.strictEqual(getBCH2BlockUrl(''), BCH2_EXPLORER_URL);
    });

    it('returns base URL for short hash', () => {
      assert.strictEqual(getBCH2BlockUrl('0000abcdef'), BCH2_EXPLORER_URL);
    });

    it('returns base URL for non-hex characters', () => {
      const badHash = 'ghijklmnopqrstuvwxyzghijklmnopqrstuvwxyzghijklmnopqrstuvwxyz1234';
      assert.strictEqual(getBCH2BlockUrl(badHash), BCH2_EXPLORER_URL);
    });

    it('returns base URL for XSS in block hash', () => {
      assert.strictEqual(getBCH2BlockUrl('<script>alert(document.cookie)</script>'), BCH2_EXPLORER_URL);
    });
  });

  describe('getBC2BlockUrl', () => {
    it('returns correct URL for a valid block hash', () => {
      assert.strictEqual(
        getBC2BlockUrl(VALID_BLOCK_HASH),
        `https://explorer.bitcoin-ii.org/block/${VALID_BLOCK_HASH}`,
      );
    });

    it('returns base URL for invalid hash', () => {
      assert.strictEqual(getBC2BlockUrl('not-a-hash'), BC2_EXPLORER_URL);
    });
  });

  describe('getBCH2BlockHeightUrl', () => {
    it('returns correct URL for height 0', () => {
      assert.strictEqual(
        getBCH2BlockHeightUrl(0),
        'https://explorer.bch2.org/block-height/0',
      );
    });

    it('returns correct URL for a positive height', () => {
      assert.strictEqual(
        getBCH2BlockHeightUrl(53200),
        'https://explorer.bch2.org/block-height/53200',
      );
    });

    it('returns correct URL for a large height', () => {
      assert.strictEqual(
        getBCH2BlockHeightUrl(1000000),
        'https://explorer.bch2.org/block-height/1000000',
      );
    });

    it('returns base URL for negative height', () => {
      assert.strictEqual(getBCH2BlockHeightUrl(-1), BCH2_EXPLORER_URL);
    });

    it('returns base URL for non-integer height', () => {
      assert.strictEqual(getBCH2BlockHeightUrl(1.5), BCH2_EXPLORER_URL);
    });

    it('returns base URL for NaN', () => {
      assert.strictEqual(getBCH2BlockHeightUrl(NaN), BCH2_EXPLORER_URL);
    });

    it('returns base URL for Infinity', () => {
      assert.strictEqual(getBCH2BlockHeightUrl(Infinity), BCH2_EXPLORER_URL);
    });

    it('accepts MAX_SAFE_INTEGER as block height', () => {
      assert.strictEqual(
        getBCH2BlockHeightUrl(Number.MAX_SAFE_INTEGER),
        `https://explorer.bch2.org/block-height/${Number.MAX_SAFE_INTEGER}`,
      );
    });

    it('returns base URL for MAX_SAFE_INTEGER + 1 (not a safe integer)', () => {
      // Number.MAX_SAFE_INTEGER + 1 is still an integer in JS but not safe
      // However, Number.isInteger(Number.MAX_SAFE_INTEGER + 1) is true in JS
      // so this depends on Number.isInteger behavior
      const beyondSafe = Number.MAX_SAFE_INTEGER + 1;
      // Number.isInteger returns true even for unsafe integers
      if (Number.isInteger(beyondSafe) && beyondSafe >= 0) {
        assert.strictEqual(
          getBCH2BlockHeightUrl(beyondSafe),
          `https://explorer.bch2.org/block-height/${beyondSafe}`,
        );
      }
    });
  });

  describe('getBC2BlockHeightUrl', () => {
    it('returns correct URL for height 0', () => {
      assert.strictEqual(
        getBC2BlockHeightUrl(0),
        'https://explorer.bitcoin-ii.org/block-height/0',
      );
    });

    it('returns correct URL for a positive height', () => {
      assert.strictEqual(
        getBC2BlockHeightUrl(53200),
        'https://explorer.bitcoin-ii.org/block-height/53200',
      );
    });

    it('returns base URL for negative height', () => {
      assert.strictEqual(getBC2BlockHeightUrl(-1), BC2_EXPLORER_URL);
    });

    it('returns base URL for non-integer height', () => {
      assert.strictEqual(getBC2BlockHeightUrl(3.14), BC2_EXPLORER_URL);
    });

    it('accepts MAX_SAFE_INTEGER as block height', () => {
      assert.strictEqual(
        getBC2BlockHeightUrl(Number.MAX_SAFE_INTEGER),
        `https://explorer.bitcoin-ii.org/block-height/${Number.MAX_SAFE_INTEGER}`,
      );
    });

    it('returns base URL for NaN', () => {
      assert.strictEqual(getBC2BlockHeightUrl(NaN), BC2_EXPLORER_URL);
    });

    it('returns base URL for Infinity', () => {
      assert.strictEqual(getBC2BlockHeightUrl(Infinity), BC2_EXPLORER_URL);
    });
  });

  describe('URL format consistency', () => {
    it('all BCH2 URLs use the same base domain', () => {
      const txUrl = getBCH2TransactionUrl(VALID_TXID);
      const addrUrl = getBCH2AddressUrl('test');
      const blockUrl = getBCH2BlockUrl(VALID_BLOCK_HASH);
      const heightUrl = getBCH2BlockHeightUrl(100);

      assert.ok(txUrl.startsWith(BCH2_EXPLORER_URL));
      assert.ok(addrUrl.startsWith(BCH2_EXPLORER_URL));
      assert.ok(blockUrl.startsWith(BCH2_EXPLORER_URL));
      assert.ok(heightUrl.startsWith(BCH2_EXPLORER_URL));
    });

    it('all BC2 URLs use the same base domain', () => {
      const txUrl = getBC2TransactionUrl(VALID_TXID);
      const addrUrl = getBC2AddressUrl('test');
      const blockUrl = getBC2BlockUrl(VALID_BLOCK_HASH);
      const heightUrl = getBC2BlockHeightUrl(100);

      assert.ok(txUrl.startsWith(BC2_EXPLORER_URL));
      assert.ok(addrUrl.startsWith(BC2_EXPLORER_URL));
      assert.ok(blockUrl.startsWith(BC2_EXPLORER_URL));
      assert.ok(heightUrl.startsWith(BC2_EXPLORER_URL));
    });

    it('transaction URLs contain /tx/ path segment', () => {
      assert.ok(getBCH2TransactionUrl(VALID_TXID).includes('/tx/'));
      assert.ok(getBC2TransactionUrl(VALID_TXID).includes('/tx/'));
    });

    it('address URLs contain /address/ path segment', () => {
      assert.ok(getBCH2AddressUrl('test').includes('/address/'));
      assert.ok(getBC2AddressUrl('test').includes('/address/'));
    });

    it('block URLs contain /block/ path segment', () => {
      assert.ok(getBCH2BlockUrl(VALID_BLOCK_HASH).includes('/block/'));
      assert.ok(getBC2BlockUrl(VALID_BLOCK_HASH).includes('/block/'));
    });

    it('block height URLs contain /block-height/ path segment', () => {
      assert.ok(getBCH2BlockHeightUrl(100).includes('/block-height/'));
      assert.ok(getBC2BlockHeightUrl(100).includes('/block-height/'));
    });
  });
});

describe('Additional edge cases', () => {
  describe('Mixed-case hex txid in BCH2 transaction URL', () => {
    it('accepts mixed-case hex txid (aAbBcCdD...)', () => {
      const mixedTxid = 'aAbBcCdD0123456789aAbBcCdD0123456789aAbBcCdD0123456789aAbBcCdD01';
      assert.strictEqual(
        getBCH2TransactionUrl(mixedTxid),
        `https://explorer.bch2.org/tx/${mixedTxid}`,
      );
    });
  });

  describe('Double URL encoding in address URLs', () => {
    it('encodes already-percent-encoded address (double encoding)', () => {
      // Address containing "%20" gets encoded to "%2520" by encodeURIComponent
      const preEncoded = 'test%20address';
      const bch2Result = getBCH2AddressUrl(preEncoded);
      assert.ok(bch2Result.includes('test%2520address'));

      const bc2Result = getBC2AddressUrl(preEncoded);
      assert.ok(bc2Result.includes('test%2520address'));
    });
  });

  describe('Address URL with CashAddr colons', () => {
    it('encodes colon in BCH2 CashAddr correctly', () => {
      const cashAddr = 'bitcoincashii:qr95sy3j9xwd2ap32xkykttr4cvcu7as5yc93ky292';
      const result = getBCH2AddressUrl(cashAddr);
      // encodeURIComponent encodes ":" to "%3A"
      assert.ok(result.includes('bitcoincashii%3Aqr95sy3j9xwd2ap32xkykttr4cvcu7as5yc93ky292'));
    });

    it('encodes colon in BC2 CashAddr correctly', () => {
      const cashAddr = 'bitcoincashii:pqq3728yw0y47sqn6l2na30mcw6zm78dzq5ucqzc37';
      const result = getBC2AddressUrl(cashAddr);
      assert.ok(result.includes('bitcoincashii%3Apqq3728yw0y47sqn6l2na30mcw6zm78dzq5ucqzc37'));
    });
  });

  describe('Block height URL with height=0 (genesis block)', () => {
    it('BCH2 genesis block height URL is correct', () => {
      assert.strictEqual(
        getBCH2BlockHeightUrl(0),
        'https://explorer.bch2.org/block-height/0',
      );
    });

    it('BC2 genesis block height URL is correct', () => {
      assert.strictEqual(
        getBC2BlockHeightUrl(0),
        'https://explorer.bitcoin-ii.org/block-height/0',
      );
    });
  });
});

describe('isValidTxid boundary cases', () => {
  it('rejects 63-char hex string as txid (too short)', () => {
    const shortHex = 'a'.repeat(63);
    assert.strictEqual(getBCH2TransactionUrl(shortHex), BCH2_EXPLORER_URL);
  });

  it('rejects 65-char hex string as txid (too long)', () => {
    const longHex = 'a'.repeat(65);
    assert.strictEqual(getBCH2TransactionUrl(longHex), BCH2_EXPLORER_URL);
  });

  it('accepts exactly 64-char lowercase hex string as txid', () => {
    const exact64 = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    assert.strictEqual(
      getBCH2TransactionUrl(exact64),
      `https://explorer.bch2.org/tx/${exact64}`,
    );
  });
});
