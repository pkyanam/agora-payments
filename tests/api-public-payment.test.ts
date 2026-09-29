import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'agora-public-payment-api-'));
const env = process.env as Record<string, string | undefined>;
env.AGORA_DATABASE_PATH = join(dir, 'agora.sqlite');
env.AGORA_SEED = 'false';
env.AGORA_DEPLOYMENT_ENV = 'qa';
env.AGORA_PAYMENT_PROVIDER = 'sandbox';
env.AGORA_PUBLIC_ORIGIN = 'https://agora.example';

const service = await import('../lib/server/local');
const db = await import('../lib/server/db');
const api = await import('../app/api/v1/[...path]/route');
const wrongCheckout = await import('../app/api/checkout/[token]/route');
const legacyCheckout = await import('../app/checkout/[token]/page');

await test('payment create, idempotent replay, read, and list return the same Agora checkout URL', async () => {
  const product = service.createProduct(service.owner, { name: 'API contract test', amount: 999 });
  const key = service.createCredential(service.owner, {
    name: 'Public payment contract test', kind: 'developer',
    scopes: ['products:read', 'payments:read', 'payments:write'], max_amount: 10000, refund_budget: 0,
  });
  const makeRequest = (method: string, path: string, body?: unknown, idem?: string) => new Request(`https://agora.example/api/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key.secret}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(idem ? { 'Idempotency-Key': idem } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const params = Promise.resolve({ path: ['payments'] });
  const payload = { product_id: product.id, customer: 'API test' };
  const createdResponse = await api.POST(makeRequest('POST', 'payments', payload, 'same-order'), { params });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json() as Record<string, unknown>;
  const token = db.one<{ checkout_token: string }>('SELECT checkout_token FROM payments WHERE id=?', String(created.id))?.checkout_token;
  assert.equal(created.checkout_url, `https://agora.example/checkout/${token}`);
  assert.equal('checkout_token' in created, false);
  assert.equal('provider_checkout_url' in created, false);

  const replayResponse = await api.POST(makeRequest('POST', 'payments', payload, 'same-order'), { params });
  const replay = await replayResponse.json() as Record<string, unknown>;
  assert.equal(replayResponse.status, 201);
  assert.equal(replay.id, created.id);
  assert.equal(replay.checkout_url, created.checkout_url);

  const getResponse = await api.GET(makeRequest('GET', `payments/${created.id}`), { params: Promise.resolve({ path: [`payments/${created.id}`] }) });
  const fetched = await getResponse.json() as Record<string, unknown>;
  assert.equal(getResponse.status, 200);
  assert.equal(fetched.checkout_url, created.checkout_url);
  assert.equal('checkout_token' in fetched, false);
  assert.equal('provider_checkout_url' in fetched, false);

  const listResponse = await api.GET(makeRequest('GET', 'payments'), { params });
  const listed = await listResponse.json() as { data: Array<Record<string, unknown>> };
  const listedPayment = listed.data.find((row) => row.id === created.id)!;
  assert.equal(listResponse.status, 200);
  assert.equal(listedPayment.checkout_url, created.checkout_url);
  assert.equal('checkout_token' in listedPayment, false);
  assert.equal('provider_checkout_url' in listedPayment, false);
  const currentSnapshot = service.snapshot('owner');
  const snapshotPayment = currentSnapshot.payments.find((row) => row.id === created.id)!;
  assert.equal(snapshotPayment.checkout_url, created.checkout_url);
  assert.equal('provider_checkout_url' in snapshotPayment, false);

  const badPathResponse = await wrongCheckout.GET(new Request(`https://agora.example/api/checkout/${created.id}`), { params: Promise.resolve({ token: String(created.id) }) });
  const badPath = await badPathResponse.json() as { error: { message: string } };
  assert.equal(badPathResponse.status, 404);
  assert.match(badPath.error.message, /payment IDs are not checkout links/);

  db.run("UPDATE payments SET provider='stripe',provider_mode='test',provider_session_id='cs_test_legacy',provider_checkout_url='https://checkout.stripe.com/c/pay_legacy' WHERE id=?", String(created.id));
  await assert.rejects(
    () => legacyCheckout.default({ params: Promise.resolve({ token: String(token) }) }),
    (error: unknown) => String((error as { digest?: string }).digest).includes(`/checkout/start#${token}`),
  );
  service.revokeCredential(service.owner, { key_id: key.id });
});

process.once('beforeExit', () => rmSync(dir, { recursive: true, force: true }));
