const origin = process.env.AGORA_TEST_PUBLIC_ORIGIN || 'https://agora.localhost';
const base = process.env.AGORA_TEST_WORKER_URL;
if (!base) throw new Error('Set AGORA_TEST_WORKER_URL to a local Wrangler Worker URL.');
const fail = (message) => { throw new Error(message); };

async function call(path, options = {}) {
  const response = await fetch(new URL(path, base), options);
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.headers.get('cache-control')?.includes('no-store')) fail(`${path} is missing no-store.`);
  if (!response.headers.get('x-agora-storage')?.startsWith('durable-object-sqlite-')) fail(`${path} did not identify Durable Object storage.`);
  return { response, body };
}

const api = await call('/api/v1/products');
if (api.response.status !== 401) fail('Unauthenticated API list did not reject the request.');

for (const host of ['localhost', 'attacker.example']) {
  const result = await call('/api/console', {
    method: 'POST',
    headers: { Host: host, Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': `host-spoof-${host}` },
    body: JSON.stringify({ action: 'review_registration', payload: { registration_id: 'reg_fake', decision: 'approve' } }),
  });
  if (![401, 403].includes(result.response.status)) fail(`Unauthenticated console approval with Host ${host} returned ${result.response.status}.`);
}

const crossOrigin = await call('/api/registrations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ business_name: 'Fixture', owner_name: 'Fixture', email: `cross-${crypto.randomUUID()}@example.invalid` }),
});
if (crossOrigin.response.status !== 403) fail('Cross-origin public registration was not rejected.');

const escalation = await call('/api/registrations', {
  method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ business_name: 'Fixture', owner_name: 'Fixture', email: `escalate-${crypto.randomUUID()}@example.invalid`, status: 'approved', tenant_id: 'owner', provider_account_id: 'acct_untrusted' }),
});
if (escalation.response.status !== 422) fail('Public registration accepted caller-controlled approval or provider ownership fields.');

const registration = await call('/api/registrations', {
  method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ business_name: 'Fixture', owner_name: 'Fixture', email: `pending-${crypto.randomUUID()}@example.invalid` }),
});
if (registration.response.status !== 201 || registration.body.status !== 'pending' || registration.body.provider_status !== 'not_connected') {
  fail('Valid public registration did not remain pending with no processor connected.');
}

for (let attempt = 0; attempt < 3; attempt++) {
  const result = await call('/api/registrations', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_name: 'Fixture', owner_name: 'Fixture', email: `limited-${crypto.randomUUID()}@example.invalid` }),
  });
  if (result.response.status !== 201) fail('Registration limit rejected an allowed request too early.');
}
const limited = await call('/api/registrations', {
  method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ business_name: 'Fixture', owner_name: 'Fixture', email: `limited-${crypto.randomUUID()}@example.invalid` }),
});
if (limited.response.status !== 429) fail('Public registration rate limit did not reject excess requests.');

console.log('PASS: Worker rejects unauthenticated API/console access, host spoofing, cross-origin registration, self-approval fields, and excess registration requests; responses are uncached and identify DO storage.');
