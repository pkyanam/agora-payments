import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testStripeApiKey } from '../lib/server/stripe';

test('Stripe account credential check accepts account responses without livemode', async () => {
  let requested = '';
  const result = await testStripeApiKey('rk_test_fixtureonly', 'test', async (input, init) => {
    requested = `${String(input)} ${init?.method || 'GET'}`;
    return Response.json({ id: 'acct_fixture_only', charges_enabled: false, payouts_enabled: false });
  });
  assert.equal(requested, 'https://api.stripe.com/v1/account GET');
  assert.deepEqual(result, { account_id: 'acct_fixture_only', mode: 'test' });
});

test('Stripe credential check rejects a key prefix that does not match the selected mode before networking', async () => {
  let called = false;
  await assert.rejects(
    testStripeApiKey('rk_test_fixtureonly', 'live', async () => {
      called = true;
      return Response.json({ id: 'acct_fixture_only' });
    }),
    (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'stripe_key_mode_mismatch',
  );
  assert.equal(called, false);
});
