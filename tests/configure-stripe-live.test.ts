import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptSource = path.join(repoRoot, 'scripts', 'configure-stripe-live.mjs');
const wranglerSource = path.join(repoRoot, 'wrangler.jsonc');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agora-live-setup-test-'));
  const scripts = path.join(root, 'scripts');
  const secrets = path.join(root, '.secrets');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(scripts);
  fs.mkdirSync(secrets, { mode: 0o700 });
  fs.mkdirSync(bin);
  fs.copyFileSync(scriptSource, path.join(scripts, 'configure-stripe-live.mjs'));
  fs.copyFileSync(wranglerSource, path.join(root, 'wrangler.jsonc'));
  fs.chmodSync(secrets, 0o700);
  fs.writeFileSync(path.join(secrets, 'stripe-live-api-key'), 'rk_live_fixture_only\n', { mode: 0o600 });
  fs.writeFileSync(path.join(secrets, 'stripe-live-account-id'), 'acct_fixtureonly\n', { mode: 0o600 });

  const tracePath = path.join(root, 'trace.json');
  const preloadPath = path.join(root, 'mock-fetch.mjs');
  fs.writeFileSync(preloadPath, `
import fs from 'node:fs';
const tracePath = process.env.AGORA_TEST_TRACE;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = init.method || 'GET';
  const trace = fs.existsSync(tracePath) ? JSON.parse(fs.readFileSync(tracePath, 'utf8')) : [];
  trace.push({ method, pathname: url.pathname, body: init.body ? String(init.body) : null });
  fs.writeFileSync(tracePath, JSON.stringify(trace));
  if (url.pathname === '/v1/account' && method === 'GET') {
    return Response.json({ id: 'acct_fixtureonly', business_profile: { name: 'Belweave', support_email: 'info@belweave.com' }, charges_enabled: true, payouts_enabled: true });
  }
  if (url.pathname === '/v1/webhook_endpoints' && method === 'GET') {
    return Response.json({ data: [], has_more: false });
  }
  if (url.pathname === '/v1/webhook_endpoints' && method === 'POST') {
    return Response.json({ id: 'we_fixture_only', url: 'https://agora-api.preetham-981.workers.dev/api/webhooks/stripe', enabled_events: [], status: 'enabled', livemode: true, secret: 'whsec_fixture_only' });
  }
  return Response.json({ error: { code: 'unexpected_mock_endpoint' } }, { status: 500 });
};
`);
  fs.writeFileSync(path.join(bin, 'bunx'), `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
const configArg = args.indexOf('--config');
const configPath = configArg >= 0 ? args[configArg + 1] : '';
const config = configPath ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
const tracePath = process.env.AGORA_TEST_TRACE;
const calls = fs.existsSync(tracePath) ? JSON.parse(fs.readFileSync(tracePath, 'utf8')) : [];
const number = calls.filter((call) => call.kind === 'wrangler').length + 1;
calls.push({ kind: 'wrangler', args, deploymentEnv: config.vars?.AGORA_DEPLOYMENT_ENV, provider: config.vars?.AGORA_PAYMENT_PROVIDER, mode: config.vars?.AGORA_STRIPE_MODE || null, stdinBytes: fs.readFileSync(0).length });
fs.writeFileSync(tracePath, JSON.stringify(calls));
process.exit(Number(process.env.AGORA_TEST_FAIL_WRANGLER_AT || 0) === number ? 1 : 0);
`);
  fs.chmodSync(path.join(bin, 'bunx'), 0o700);

  return {
    root,
    tracePath,
    scriptPath: path.join(scripts, 'configure-stripe-live.mjs'),
    bin,
    preloadPath,
    run(failWranglerAt?: number) {
      const env = {
        PATH: `${bin}:${process.env.PATH || ''}`,
        AGORA_TEST_TRACE: tracePath,
        ...(failWranglerAt ? { AGORA_TEST_FAIL_WRANGLER_AT: String(failWranglerAt) } : {}),
      } as unknown as NodeJS.ProcessEnv;
      return spawnSync(process.execPath, ['--import', preloadPath, path.join(scripts, 'configure-stripe-live.mjs')], { cwd: root, env, encoding: 'utf8' });
    },
    trace() {
      return JSON.parse(fs.readFileSync(tracePath, 'utf8')) as Array<{kind?:string;args?:string[];deploymentEnv?:string;provider?:string;mode?:string|null;stdinBytes?:number;method?:string;pathname?:string;body?:string|null}>;
    },
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

test('live setup only reads account/webhook APIs and enables live config after all secrets are stored', () => {
  const f = fixture();
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /rk_live_fixture|whsec_fixture/);
    const calls = f.trace();
    const stripeCalls = calls.filter((call) => call.kind !== 'wrangler');
    assert.deepEqual(stripeCalls.map(({ method, pathname }) => [method, pathname]), [
      ['GET', '/v1/account'],
      ['GET', '/v1/webhook_endpoints'],
      ['POST', '/v1/webhook_endpoints'],
    ]);
    const endpointFields = new URLSearchParams(stripeCalls[2].body || '');
    assert.equal(endpointFields.get('url'), 'https://agora-api.preetham-981.workers.dev/api/webhooks/stripe');
    assert.deepEqual(endpointFields.getAll('enabled_events[]').sort(), [
      'checkout.session.async_payment_failed',
      'checkout.session.async_payment_succeeded',
      'checkout.session.completed',
      'checkout.session.expired',
      'refund.updated',
    ]);
    assert.equal(stripeCalls.some((call) => /payment_intents|checkout|refund|payout/i.test(String(call.pathname))), false);
    const wranglerCalls = calls.filter((call) => call.kind === 'wrangler');
    assert.deepEqual(wranglerCalls.map((call) => call.deploymentEnv), ['production', 'production', 'production', 'production']);
    assert.deepEqual(wranglerCalls.map((call) => call.provider), ['sandbox', 'sandbox', 'sandbox', 'stripe']);
    assert.deepEqual(wranglerCalls.map((call) => call.args?.[1]), ['deploy', 'secret', 'secret', 'deploy']);
    assert.ok(wranglerCalls[1].stdinBytes as number > 0);
    assert.ok(wranglerCalls[2].stdinBytes as number > 0);
  } finally { f.cleanup(); }
});

test('failed live-secret provisioning never deploys the live provider config', () => {
  const f = fixture();
  try {
    const result = f.run(3);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /rk_live_fixture|whsec_fixture/);
    const calls = f.trace();
    const wranglerCalls = calls.filter((call) => call.kind === 'wrangler');
    assert.equal(wranglerCalls.length, 3);
    assert.deepEqual(wranglerCalls.map((call) => call.deploymentEnv), ['production', 'production', 'production']);
    assert.deepEqual(wranglerCalls.map((call) => call.provider), ['sandbox', 'sandbox', 'sandbox']);
    assert.equal(wranglerCalls.some((call) => call.provider === 'stripe'), false);
    const stripeCalls = calls.filter((call) => call.kind !== 'wrangler');
    assert.equal(stripeCalls.some((call) => /payment_intents|checkout|refund|payout/i.test(String(call.pathname))), false);
  } finally { f.cleanup(); }
});
