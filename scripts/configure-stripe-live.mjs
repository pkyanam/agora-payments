#!/usr/bin/env node
// Operator-only live setup. Reads secrets from mode-0600 files, never argv/stdout.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secretsDir = path.join(root, '.secrets');
const keyFile = path.join(secretsDir, 'stripe-live-api-key');
const accountIdFile = path.join(secretsDir, 'stripe-live-account-id');
const signingFile = path.join(secretsDir, 'stripe-live-webhook-secret');
const endpointFile = path.join(secretsDir, 'stripe-live-webhook-endpoint-id');
const events = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'refund.updated',
];

function publicHttpsUrl(value, label, pathname) {
  let url;
  try { url = new URL(value); } catch { fail(`${label}_must_be_a_valid_https_url`); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || isIP(host)
      || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
      || host.endsWith('.test') || host.endsWith('.invalid')) {
    fail(`${label}_must_use_a_public_https_hostname`);
  }
  if (pathname !== undefined && url.pathname !== pathname) fail(`${label}_path_is_invalid`);
  return url;
}

function deploymentConfig() {
  const endpointValue = process.env.AGORA_STRIPE_WEBHOOK_URL;
  const originValue = process.env.AGORA_STRIPE_PUBLIC_ORIGIN;
  const accountName = process.env.AGORA_STRIPE_EXPECTED_ACCOUNT_NAME?.trim();
  const supportEmail = process.env.AGORA_STRIPE_EXPECTED_SUPPORT_EMAIL?.trim().toLowerCase();
  if (!endpointValue || !originValue || !accountName || !supportEmail) {
    fail('set_AGORA_STRIPE_WEBHOOK_URL_AGORA_STRIPE_PUBLIC_ORIGIN_AGORA_STRIPE_EXPECTED_ACCOUNT_NAME_and_AGORA_STRIPE_EXPECTED_SUPPORT_EMAIL');
  }
  const endpoint = publicHttpsUrl(endpointValue, 'webhook_url', '/api/webhooks/stripe');
  const origin = publicHttpsUrl(originValue, 'public_origin');
  if (origin.pathname !== '/') fail('public_origin_must_be_a_root_origin');
  return { endpointUrl: endpoint.toString(), publicOrigin: origin.origin, accountName, supportEmail };
}

function fail(code) {
  console.error(JSON.stringify({ error: code }));
  process.exit(1);
}

function readPrivate(file) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { fail('missing_private_credential_file'); }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) fail('credential_file_must_be_regular_and_mode_0600');
  const value = fs.readFileSync(file, 'utf8').trim();
  if (!value || /\s/.test(value)) fail('credential_file_format_invalid');
  return value;
}

async function stripe(key, pathname, method = 'GET', fields) {
  let response;
  try {
    response = await fetch(`https://api.stripe.com${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(fields ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: fields,
      signal: AbortSignal.timeout(20000),
    });
  } catch { fail('stripe_request_failed_without_response'); }
  let body;
  try { body = await response.json(); } catch { fail('stripe_response_invalid'); }
  if (!response.ok) {
    const error = body?.error || {};
    const code = error.code === 'more_permissions_required' ? 'stripe_key_needs_additional_restricted_permissions' : 'stripe_request_rejected';
    fail(`${code}_http_${response.status}`);
  }
  return body;
}

function savePrivate(file, value) {
  fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(secretsDir, 0o700);
  try {
    const prior = fs.lstatSync(file);
    if (prior.isSymbolicLink() || !prior.isFile()) fail('private_output_must_not_be_a_symlink');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, `${value}\n`); } finally { fs.closeSync(fd); }
  fs.chmodSync(file, 0o600);
}

function wrangler(args, input) {
  const result = spawnSync('bunx', ['wrangler', ...args], {
    cwd: root,
    input,
    encoding: 'utf8',
    timeout: 180000,
  });
  if (result.status !== 0) fail('cloudflare_secret_or_deploy_step_failed');
}

function writeRuntimeConfig(provider, mode, publicOrigin) {
  const config = path.join(root, 'wrangler.jsonc');
  const original = fs.readFileSync(config, 'utf8');
  const parsed = JSON.parse(original);
  parsed.vars = {
    ...parsed.vars,
    AGORA_DEPLOYMENT_ENV: 'production',
    AGORA_PAYMENT_PROVIDER: provider,
    ...(mode ? { AGORA_STRIPE_MODE: mode } : {}),
    AGORA_PUBLIC_ORIGIN: publicOrigin,
  };
  const temp = path.join(root, 'wrangler.live.generated.jsonc');
  try { if (fs.lstatSync(temp).isSymbolicLink()) fail('generated_config_must_not_be_a_symlink'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  fs.writeFileSync(temp, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  return temp;
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Set AGORA_STRIPE_WEBHOOK_URL, AGORA_STRIPE_PUBLIC_ORIGIN, AGORA_STRIPE_EXPECTED_ACCOUNT_NAME, and AGORA_STRIPE_EXPECTED_SUPPORT_EMAIL for your own deployment. Store a restricted live key in .secrets/stripe-live-api-key (mode 0600), then run: node scripts/configure-stripe-live.mjs');
    return;
  }
  const config = deploymentConfig();
  if (process.argv.includes('--dry-run')) {
    const key = readPrivate(keyFile);
    if (!key.startsWith('rk_live_') && !key.startsWith('sk_live_')) fail('a_live_mode_stripe_key_is_required');
    console.log(JSON.stringify({ dryRun: true, keyShape: key.startsWith('rk_live_') ? 'restricted-live' : 'live', eventCount: events.length, actions: ['verify-account', 'create-or-reuse-webhook', 'store-worker-secrets', 'deploy-live-provider-config'] }));
    return;
  }

  const key = readPrivate(keyFile);
  if (!key.startsWith('rk_live_') && !key.startsWith('sk_live_')) fail('a_live_mode_stripe_key_is_required');
  const account = await stripe(key, '/v1/account');
  const accountName = account?.business_profile?.name;
  const supportEmail = account?.business_profile?.support_email;
  if (accountName !== config.accountName || supportEmail?.toLowerCase() !== config.supportEmail || account?.charges_enabled !== true || account?.payouts_enabled !== true) fail('stripe_account_identity_or_capabilities_do_not_match');

  let existing = [];
  let cursor;
  do {
    const query = new URLSearchParams({ limit: '100', ...(cursor ? { starting_after: cursor } : {}) });
    const page = await stripe(key, `/v1/webhook_endpoints?${query}`);
    existing = [...(existing || []), ...(page.data || [])];
    cursor = page.has_more ? page.data?.at(-1)?.id : undefined;
  } while (cursor);
  const expectedAccountId = readPrivate(accountIdFile);
  if (!/^acct_[A-Za-z0-9]+$/.test(expectedAccountId) || account.id !== expectedAccountId) fail('stripe_account_id_does_not_match_verified_owner_account');
  const matchingEndpoints = existing.filter((entry) => entry.url === config.endpointUrl);
  if (matchingEndpoints.length > 1) fail('multiple_matching_endpoints_require_manual_review');
  let endpoint = matchingEndpoints[0];
  let signingSecret;
  if (endpoint) {
    const storedEndpointId = readPrivate(endpointFile);
    if (storedEndpointId !== endpoint.id || endpoint.livemode !== true || JSON.stringify([...(endpoint.enabled_events || [])].sort()) !== JSON.stringify([...events].sort()) || endpoint.status !== 'enabled') fail('existing_endpoint_configuration_or_id_mismatch_require_manual_review');
    try { signingSecret = readPrivate(signingFile); } catch { fail('existing_endpoint_secret_is_not_retrievable_store_dashboard_secret_in_private_file'); }
    if (!signingSecret.startsWith('whsec_')) fail('webhook_secret_file_format_invalid');
    savePrivate(endpointFile, endpoint.id);
  } else {
    const form = new URLSearchParams({ url: config.endpointUrl, description: 'Agora Payments live webhook', 'metadata[managed_by]': 'agora-live-setup' });
    for (const event of events) form.append('enabled_events[]', event);
    endpoint = await stripe(key, '/v1/webhook_endpoints', 'POST', form);
    signingSecret = endpoint.secret;
    if (!endpoint.id?.startsWith('we_') || !signingSecret?.startsWith('whsec_') || endpoint.livemode !== true) fail('stripe_webhook_creation_response_invalid');
    savePrivate(signingFile, signingSecret);
    savePrivate(endpointFile, endpoint.id);
  }

  const configPath = writeRuntimeConfig('sandbox', undefined, config.publicOrigin);
  try {
    wrangler(['deploy', '--config', configPath]);
    wrangler(['secret', 'put', 'STRIPE_LIVE_SECRET_KEY', '--config', configPath], key);
    wrangler(['secret', 'put', 'STRIPE_LIVE_WEBHOOK_SECRET', '--config', configPath], signingSecret);
    writeRuntimeConfig('stripe', 'live', config.publicOrigin);
    wrangler(['deploy', '--config', configPath]);
  } finally {
    try { fs.unlinkSync(configPath); } catch {}
  }
  console.log(JSON.stringify({ configured: true, accountVerified: true, endpointConfigured: true, endpointId: endpoint.id, liveModeEnabled: true, livePaymentAttempted: false }));
}

main().catch(() => fail('setup_failed_without_safe_diagnostic'));
