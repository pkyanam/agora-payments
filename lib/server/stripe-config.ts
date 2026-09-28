import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { LedgerStore } from './store';
import { ApiError } from './errors';
import { stripeApiKeyMatchesMode } from './stripe';

type Mode = 'test' | 'live';
type SecretName = 'test_secret_key' | 'test_webhook_secret' | 'live_secret_key' | 'live_webhook_secret';
const secretNames: SecretName[] = ['test_secret_key', 'test_webhook_secret', 'live_secret_key', 'live_webhook_secret'];
// Keep a stable key outside the database. The fallback lets existing installations reuse
// their already-managed MFA key while new installers can provide a dedicated secrets key.
function key(env:Record<string,string|undefined>) {
  const raw = env.AGORA_SECRETS_ENCRYPTION_KEY || env.AGORA_MFA_ENCRYPTION_KEY;
  if (!raw) throw new ApiError(503, 'secrets_encryption_unavailable', 'Set a stable AGORA_SECRETS_ENCRYPTION_KEY before saving Stripe credentials.');
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length !== 32) throw new ApiError(503, 'secrets_encryption_unavailable', 'AGORA_SECRETS_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return bytes;
}
function seal(value: string, env:Record<string,string|undefined>) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(env), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${body.toString('base64url')}`;
}
function open(value: string, env:Record<string,string|undefined>) {
  const [, ivText, tagText, bodyText] = value.split('.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(env), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(bodyText, 'base64url')), decipher.final()]).toString('utf8');
  } catch { throw new ApiError(500, 'stored_secret_invalid', 'A stored Stripe credential cannot be decrypted. Check the installation encryption key.'); }
}
export function encryptWorkspaceSecret(value:string,environment:Record<string,string|undefined>=process.env){return seal(value,environment);}
export function decryptWorkspaceSecret(value:string,environment:Record<string,string|undefined>=process.env){return open(value,environment);}
function init(store:LedgerStore) { store.run('CREATE TABLE IF NOT EXISTS workspace_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)'); }
function read(store:LedgerStore,keyName: string) { init(store); return store.one<{value:string}>('SELECT value FROM workspace_settings WHERE key=?', keyName)?.value; }
function write(store:LedgerStore,keyName: string, value: string) { init(store); store.run('INSERT INTO workspace_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at', keyName, value, new Date().toISOString()); }

export function stripeRuntimeEnvironment(store:LedgerStore, base:Record<string,string|undefined>=process.env) {
  const result:Record<string,string|undefined> = { ...base };
  const provider = read(store,'payment_provider');
  const mode = read(store,'stripe_mode');
  const origin = read(store,'public_origin');
  if (provider) result.AGORA_PAYMENT_PROVIDER = provider;
  else if (result.AGORA_DEPLOYMENT_TYPE === 'community') result.AGORA_PAYMENT_PROVIDER = 'stripe';
  if (mode) result.AGORA_STRIPE_MODE = mode;
  if (origin) result.AGORA_PUBLIC_ORIGIN = origin;
  for (const name of secretNames) {
    const stored = read(store,name);
    const envName = ({test_secret_key:'STRIPE_TEST_SECRET_KEY',test_webhook_secret:'STRIPE_TEST_WEBHOOK_SECRET',live_secret_key:'STRIPE_LIVE_SECRET_KEY',live_webhook_secret:'STRIPE_LIVE_WEBHOOK_SECRET'} as const)[name];
    if (stored !== undefined) result[envName] = stored === '' ? undefined : open(stored,base);
  }
  return result;
}
export function saveStripeConfig(store:LedgerStore,input: {provider:'stripe'|'sandbox';mode:Mode;public_origin:string;test_secret_key?:string;test_webhook_secret?:string;live_secret_key?:string;live_webhook_secret?:string},environment:Record<string,string|undefined>=process.env) {
  if (input.provider === 'stripe') {
    for (const [name, value, mode] of [['test_secret_key',input.test_secret_key,'test'],['live_secret_key',input.live_secret_key,'live']] as const) {
      if (value && !stripeApiKeyMatchesMode(value, mode)) throw new ApiError(422, 'stripe_key_mode_mismatch', `The ${mode} key does not match Stripe ${mode} mode.`);
    }
    for (const [name, value] of [['test_webhook_secret',input.test_webhook_secret],['live_webhook_secret',input.live_webhook_secret]] as const) {
      if (value && !/^whsec_[A-Za-z0-9]+$/.test(value)) throw new ApiError(422, 'invalid_webhook_secret', `${name.startsWith('test')?'Test':'Live'} webhook signing secret must start with whsec_.`);
    }
    if (!input.public_origin || !/^https?:\/\//.test(input.public_origin)) throw new ApiError(422, 'invalid_public_origin', 'Enter the public HTTPS origin for this Agora deployment.');
    const parsed = new URL(input.public_origin);
    const localhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
    if (parsed.origin !== input.public_origin.replace(/\/$/, '') || (parsed.protocol !== 'https:' && !localhost)) throw new ApiError(422, 'invalid_public_origin', 'Use only the HTTPS deployment origin, without a path. HTTP is allowed only for localhost development.');
  }
  // Validate key material before touching settings, so bad setup never partially saves.
  const env={...environment};key(env);
  write(store,'payment_provider', input.provider); write(store,'stripe_mode', input.mode); write(store,'public_origin', input.public_origin.replace(/\/$/, ''));
  for (const name of secretNames) {
    const value = input[name];
    if (value !== undefined) { if (value === '') write(store,name,''); else write(store,name, seal(value,env)); }
  }
}
export function stripeConfigSummary(store:LedgerStore,base:Record<string,string|undefined>=process.env) {
  const env = stripeRuntimeEnvironment(store,base);
  const provider = (env.AGORA_PAYMENT_PROVIDER || 'sandbox') as 'stripe'|'sandbox';
  const mode = (env.AGORA_STRIPE_MODE === 'live' ? 'live' : 'test') as Mode;
  const configured = (m:Mode) => ({
    secret_key: Boolean(m === 'test' ? env.STRIPE_TEST_SECRET_KEY : env.STRIPE_LIVE_SECRET_KEY),
    webhook_secret: Boolean(m === 'test' ? env.STRIPE_TEST_WEBHOOK_SECRET : env.STRIPE_LIVE_WEBHOOK_SECRET),
    webhook_verified: read(store,`webhook_verified_${m}`) === ((m==='test'?env.STRIPE_TEST_WEBHOOK_SECRET:env.STRIPE_LIVE_WEBHOOK_SECRET)?createHash('sha256').update((m==='test'?env.STRIPE_TEST_WEBHOOK_SECRET:env.STRIPE_LIVE_WEBHOOK_SECRET)!).digest('hex'):'') && Boolean(read(store,`webhook_verified_${m}`)),
  });
  const webhookUrl = `${env.AGORA_PUBLIC_ORIGIN || ''}/api/webhooks/stripe`;
  return { provider, mode, public_origin: env.AGORA_PUBLIC_ORIGIN || '', webhook_url: webhookUrl, configured: {test:configured('test'),live:configured('live')} };
}
export function setStripeConfig(store:LedgerStore,input: unknown,base:Record<string,string|undefined>=process.env) {
  const parsed = input as Record<string,unknown>;
  if (!parsed || !['stripe','sandbox'].includes(String(parsed.provider)) || !['test','live'].includes(String(parsed.mode))) throw new ApiError(422, 'invalid_request', 'Provide provider stripe or sandbox and mode test or live.');
  const summary = stripeConfigSummary(store,base);
  const origin = typeof parsed.public_origin === 'string' ? parsed.public_origin.trim() : summary.public_origin;
  const optional = (field:SecretName) => parsed[field] === undefined ? undefined : typeof parsed[field] === 'string' ? String(parsed[field]).trim() : (()=>{throw new ApiError(422,'invalid_request',`${field} must be a string.`)})();
  store.transaction(()=>saveStripeConfig(store,{provider:parsed.provider as 'stripe'|'sandbox',mode:parsed.mode as Mode,public_origin:origin,
    test_secret_key:optional('test_secret_key'),test_webhook_secret:optional('test_webhook_secret'),live_secret_key:optional('live_secret_key'),live_webhook_secret:optional('live_webhook_secret')},base));
  return stripeConfigSummary(store,base);
}
export function stripeSecret(store:LedgerStore,mode:Mode, kind:'api'|'webhook',base:Record<string,string|undefined>=process.env) {
  const env = stripeRuntimeEnvironment(store,base);
  return mode === 'test' ? (kind === 'api' ? env.STRIPE_TEST_SECRET_KEY : env.STRIPE_TEST_WEBHOOK_SECRET) : (kind === 'api' ? env.STRIPE_LIVE_SECRET_KEY : env.STRIPE_LIVE_WEBHOOK_SECRET);
}

export function markWebhookVerified(store:LedgerStore,mode:Mode,secret:string){const digest=createHash('sha256').update(secret).digest('hex');write(store,`webhook_verified_${mode}`,digest);}
