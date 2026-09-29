import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicPayment } from '../lib/server/public-payment';
import type { Payment } from '../lib/types';

const token = 'a'.repeat(48);
const base: Payment = {
  id: 'pay_public_view', product_id: 'prod_public_view', product_name: 'Example',
  customer: 'Guest', amount: 1200, refunded: 0, currency: 'usd', status: 'pending',
  actor: 'Agent', created_at: '2026-09-28T00:00:00.000Z', checkout_token: token,
  sample: 0, tenant_id: 'owner',
};

test('public payment view returns one absolute Agora checkout URL and no provider internals', () => {
  const stripe = publicPayment({
    ...base, provider: 'stripe', provider_mode: 'test',
    provider_checkout_url: 'https://checkout.stripe.com/c/pay_private',
    provider_session_id: 'cs_test_private', provider_payment_intent: 'pi_private',
    provider_account_id: 'acct_private',
  } as Payment, 'https://agora.example/ignored-path');
  assert.equal(stripe.checkout_url, `https://agora.example/checkout/start#${token}`);
  assert.equal('checkout_token' in stripe, false);
  assert.equal('provider_checkout_url' in stripe, false);
  assert.equal('provider_session_id' in stripe, false);
  assert.equal('provider_payment_intent' in stripe, false);
  assert.equal('provider_account_id' in stripe, false);
  assert.equal(JSON.stringify(stripe).includes('checkout.stripe.com'), false);

  const sandbox = publicPayment({ ...base, provider: 'sandbox' }, 'https://agora.example');
  assert.equal(sandbox.checkout_url, `https://agora.example/checkout/${token}`);
  assert.equal('checkout_token' in sandbox, false);
});
