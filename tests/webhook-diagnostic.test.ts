import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'agora-webhook-diagnostic-'));
const env = process.env as Record<string, string | undefined>;
env.AGORA_DATABASE_PATH = join(dir, 'diagnostic.sqlite');
env.AGORA_SEED = 'false';
env.AGORA_DEPLOYMENT_ENV = 'qa';
env.AGORA_SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64');

const db = await import('../lib/server/db');
const webhookRoute = await import('../app/api/webhooks/stripe/route');
const stripeConfig = await import('../lib/server/stripe-config');
const webhookSecret = 'whsec_dashboardDiagnosticTest123';
stripeConfig.setStripeConfig(db.localStore, {
  provider: 'stripe', mode: 'test', public_origin: 'https://agora.example',
  test_secret_key: 'sk_test_dashboardDiagnostic123', test_webhook_secret: webhookSecret,
}, env);

function signedHeader(event: Record<string, unknown>, secret = webhookSecret) {
  const raw = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return { raw, header: `t=${timestamp},v1=${signature}` };
}

await test('signed product.created verifies test webhook without payment or ledger changes', async () => {
  const before = {
    payments: db.all('SELECT * FROM payments').length,
    products: db.all('SELECT * FROM products').length,
    journal: db.all('SELECT * FROM journal').length,
    appEvents: db.all('SELECT * FROM events').length,
  };
  const event = {
    id: 'evt_dashboard_product_created', type: 'product.created', livemode: false,
    data: { object: { id: 'prod_dashboard_diagnostic', name: 'Webhook diagnostic product' } },
  };

  const unsigned = signedHeader({ ...event, id: 'evt_dashboard_unsigned' });
  const invalidResponse = await webhookRoute.POST(new Request('https://agora.example/api/webhooks/stripe', {
    method: 'POST', headers: { 'stripe-signature': 't=1,v1=invalid' }, body: unsigned.raw,
  }));
  assert.equal(invalidResponse.status, 400);
  assert.equal(stripeConfig.stripeConfigSummary(db.localStore, env).configured.test.webhook_verified, false);

  const wrongMode = signedHeader({ ...event, id: 'evt_dashboard_wrong_mode', livemode: true });
  const wrongModeResponse = await webhookRoute.POST(new Request('https://agora.example/api/webhooks/stripe', {
    method: 'POST', headers: { 'stripe-signature': wrongMode.header }, body: wrongMode.raw,
  }));
  assert.equal(wrongModeResponse.status, 400);
  assert.equal(stripeConfig.stripeConfigSummary(db.localStore, env).configured.test.webhook_verified, false);

  const valid = signedHeader(event);
  const validResponse = await webhookRoute.POST(new Request('https://agora.example/api/webhooks/stripe', {
    method: 'POST', headers: { 'stripe-signature': valid.header }, body: valid.raw,
  }));
  assert.equal(validResponse.status, 200);
  assert.deepEqual(await validResponse.json(), {
    received: true, duplicate: false, ignored: true,
  });
  assert.equal(stripeConfig.stripeConfigSummary(db.localStore, env).configured.test.webhook_verified, true);
  assert.deepEqual({
    payments: db.all('SELECT * FROM payments').length,
    products: db.all('SELECT * FROM products').length,
    journal: db.all('SELECT * FROM journal').length,
    appEvents: db.all('SELECT * FROM events').length,
  }, before);
});

process.once('beforeExit', () => rmSync(dir, { recursive: true, force: true }));
