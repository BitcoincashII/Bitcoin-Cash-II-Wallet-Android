import assert from 'assert';
import { isGroundControlUriValid } from '../../blue_modules/notifications';

// Notifications.default = new Notifications();

describe('notifications', () => {
  // TODO: Re-enable when BCH2 push notification server is deployed
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('can check groundcontrol server uri validity', async () => {
    // TODO: Replace with BCH2 push notification server URL
    assert.ok(await isGroundControlUriValid('https://groundcontrol.bch2.example.com'));
    assert.ok(!(await isGroundControlUriValid('https://www.google.com')));
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  it('returns false for empty uri', async () => {
    assert.ok(!(await isGroundControlUriValid('')));
  });

  // muted because it causes jest to hang waiting indefinitely
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('can check non-responding url', async () => {
    assert.ok(!(await isGroundControlUriValid('https://localhost.com')));
  });
});
