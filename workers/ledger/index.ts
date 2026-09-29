import { DurableObject } from 'cloudflare:workers';
import type { LedgerStore, SqlValue } from '../../lib/server/store';
import { createService, requireScope, requireProviderMode, paymentProviderReadiness, ApiError, bodyOf, requireSameOrigin, responseError } from '../../lib/server/service';
import { setMfaCookie } from '../../lib/server/admin-auth';
import { createStripeCheckout, createStripeRefund, deauthorizeStripeAccount, exchangeStripeOAuthCode, getStripeConnectedAccount, retrieveStripeCheckout } from '../../lib/server/stripe';
import type { Payment } from '../../lib/types';
import { publicPayment } from '../../lib/server/public-payment';
import { testStripeApiKey } from '../../lib/server/stripe';
import { dispatchWebhookBatch, enqueueWebhookEvent } from '../../lib/server/outgoing-webhooks';

interface Env {
  AGORA_LEDGER: DurableObjectNamespace<AgoraLedgerDO>;
  AGORA_WORKSPACE_ID?: string;
  AGORA_DEPLOYMENT_ENV?: string;
  AGORA_DEPLOYMENT_TYPE?: string;
  AGORA_DEPLOYMENT_TARGET?: string;
  AGORA_VERSION?: string;
  AGORA_SECRETS_ENCRYPTION_KEY?: string;
  AGORA_PUBLIC_ORIGIN: string;
  AGORA_OWNER_EMAIL?: string;
  AGORA_WORKSPACE_NAME?: string;
  AGORA_PAYMENT_PROVIDER?: string;
  AGORA_STRIPE_MODE?: string;
  AGORA_ADMIN_PASSWORD?: string;
  AGORA_OWNER_SETUP_TOKEN_HASH?: string;
  AGORA_ADMIN_TOKEN: string;
  AGORA_MFA_ENCRYPTION_KEY: string;
  STRIPE_TEST_SECRET_KEY?: string;
  STRIPE_LIVE_SECRET_KEY?: string;
  STRIPE_TEST_WEBHOOK_SECRET?: string;
  STRIPE_LIVE_WEBHOOK_SECRET?: string;
  STRIPE_TEST_CONNECT_CLIENT_ID?: string;
  STRIPE_LIVE_CONNECT_CLIENT_ID?: string;
}

const schema = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),currency TEXT NOT NULL DEFAULT 'usd' CHECK(currency='usd'),created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),product_name TEXT NOT NULL,customer TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),refunded INTEGER NOT NULL DEFAULT 0 CHECK(refunded>=0 AND refunded<=amount),currency TEXT NOT NULL DEFAULT 'usd',status TEXT NOT NULL CHECK(status IN ('pending','succeeded','failed')),actor TEXT NOT NULL,created_at TEXT NOT NULL,checkout_token TEXT NOT NULL UNIQUE,sample INTEGER NOT NULL DEFAULT 0,provider TEXT NOT NULL DEFAULT 'sandbox',provider_mode TEXT,provider_session_id TEXT,provider_checkout_url TEXT,provider_payment_intent TEXT,provider_account_id TEXT);
CREATE TABLE IF NOT EXISTS credentials(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,prefix TEXT NOT NULL,hash TEXT NOT NULL UNIQUE,scopes TEXT NOT NULL,max_amount INTEGER NOT NULL,refund_budget INTEGER NOT NULL,spent INTEGER NOT NULL DEFAULT 0,revoked INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,provider_mode TEXT NOT NULL DEFAULT 'sandbox');
CREATE TABLE IF NOT EXISTS refunds(id TEXT PRIMARY KEY,payment_id TEXT NOT NULL REFERENCES payments(id),amount INTEGER NOT NULL CHECK(amount>0),reason TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'succeeded',provider_refund_id TEXT,provider_mode TEXT,credential_id TEXT);
CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,payment_id TEXT NOT NULL REFERENCES payments(id),amount INTEGER NOT NULL CHECK(amount>0),reason TEXT NOT NULL,credential_id TEXT NOT NULL REFERENCES credentials(id),actor TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,type TEXT NOT NULL,actor TEXT NOT NULL,object_id TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS journal(id TEXT PRIMARY KEY,reference_id TEXT NOT NULL,account TEXT NOT NULL,amount INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency(actor TEXT NOT NULL,route TEXT NOT NULL,key TEXT NOT NULL,hash TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(actor,route,key));
CREATE TABLE IF NOT EXISTS owner_mfa(id TEXT PRIMARY KEY CHECK(id='owner'),encrypted_secret TEXT NOT NULL,confirmed INTEGER NOT NULL DEFAULT 0,last_counter INTEGER NOT NULL DEFAULT -1,recovery_hashes TEXT NOT NULL DEFAULT '[]',updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS owner_password(id TEXT PRIMARY KEY CHECK(id='owner'),email TEXT,salt TEXT NOT NULL,password_hash TEXT NOT NULL,session_version INTEGER NOT NULL DEFAULT 1,must_change INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS owner_setup(id TEXT PRIMARY KEY CHECK(id='owner'),token_hash TEXT NOT NULL,expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auth_rate_limits(bucket TEXT PRIMARY KEY,attempts INTEGER NOT NULL,window_started INTEGER NOT NULL,locked_until INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS registration_rate_limits(bucket TEXT PRIMARY KEY,attempts INTEGER NOT NULL,window_started INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS registrations(id TEXT PRIMARY KEY,business_name TEXT NOT NULL,owner_name TEXT NOT NULL,email TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'stripe',provider_account_id TEXT,status TEXT NOT NULL DEFAULT 'pending',tenant_id TEXT,created_at TEXT NOT NULL,reviewed_at TEXT,review_reason TEXT);
CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY,business_name TEXT NOT NULL,email TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',provider TEXT NOT NULL DEFAULT 'stripe',provider_account_id TEXT,created_at TEXT NOT NULL,approved_at TEXT);
CREATE TABLE IF NOT EXISTS stripe_webhook_events(id TEXT PRIMARY KEY,livemode INTEGER NOT NULL,received_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tenant_provider_accounts(tenant_id TEXT NOT NULL,provider TEXT NOT NULL,mode TEXT NOT NULL,account_id TEXT NOT NULL,status TEXT NOT NULL,charges_enabled INTEGER NOT NULL DEFAULT 0,payouts_enabled INTEGER NOT NULL DEFAULT 0,details_submitted INTEGER NOT NULL DEFAULT 0,capabilities TEXT NOT NULL DEFAULT '{}',connected_at TEXT NOT NULL,PRIMARY KEY(tenant_id,provider,mode),UNIQUE(provider,mode,account_id));
CREATE TABLE IF NOT EXISTS provider_oauth_states(state_hash TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,provider TEXT NOT NULL,mode TEXT NOT NULL,redirect_uri TEXT NOT NULL,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS merchant_invites(token_hash TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,email TEXT NOT NULL,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS merchant_users(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,email TEXT NOT NULL,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,mfa_secret TEXT,mfa_confirmed INTEGER NOT NULL DEFAULT 0,last_counter INTEGER NOT NULL DEFAULT -1,recovery_hashes TEXT NOT NULL DEFAULT '[]',disabled INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(tenant_id,email));
CREATE TABLE IF NOT EXISTS revoked_sessions(token_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS webhook_endpoints(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,url TEXT NOT NULL,provider_mode TEXT NOT NULL CHECK(provider_mode IN ('test','live')),event_types TEXT NOT NULL,secret_ciphertext TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','archived')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,secret_updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS webhook_deliveries(id TEXT PRIMARY KEY,endpoint_id TEXT NOT NULL,event_id TEXT NOT NULL,event_type TEXT NOT NULL,tenant_id TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivering','delivered','failed','paused','skipped_mode')),attempt_count INTEGER NOT NULL DEFAULT 0,next_attempt_at TEXT NOT NULL,last_attempt_at TEXT,delivered_at TEXT,last_http_status INTEGER,last_error TEXT,lease_token TEXT,locked_until TEXT,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS webhook_delivery_due ON webhook_deliveries(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS webhook_delivery_endpoint ON webhook_deliveries(endpoint_id,created_at,id);
CREATE TABLE IF NOT EXISTS webhook_attempts(id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL,attempt INTEGER NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,http_status INTEGER,duration_ms INTEGER,error TEXT,response_excerpt TEXT NOT NULL DEFAULT '',UNIQUE(delivery_id,attempt));
CREATE TABLE IF NOT EXISTS stripe_risk_signals(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,payment_id TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('test','live')),account_id TEXT,kind TEXT NOT NULL CHECK(kind IN ('early_fraud_warning','review')),state TEXT NOT NULL,actionable INTEGER,fraud_type TEXT,reason TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,event_id TEXT NOT NULL UNIQUE);
CREATE INDEX IF NOT EXISTS stripe_risk_scope ON stripe_risk_signals(tenant_id,mode,created_at,id);
CREATE INDEX IF NOT EXISTS payment_created ON payments(created_at);
CREATE INDEX IF NOT EXISTS event_created ON events(created_at);
`;

function makeStore(storage: DurableObjectStorage, scheduleWebhookAlarm:()=>void): LedgerStore {
  const sql = storage.sql;
  const store: LedgerStore = {
    one<T>(query: string, ...args: SqlValue[]) {
      return sql.exec(query, ...args).toArray()[0] as T | undefined;
    },
    all<T>(query: string, ...args: SqlValue[]) {
      return sql.exec(query, ...args).toArray() as T[];
    },
    run(query: string, ...args: SqlValue[]) {
      return sql.exec(query, ...args);
    },
    transaction<T>(fn: () => T) {
      return storage.transactionSync(fn);
    },
    id(prefix: string) {
      return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
    },
    now() {
      return new Date().toISOString();
    },
    event(type: string, actor: string, object_id: string, data: object = {}, tenantId = 'owner') {
      const eventId = store.id('evt'), created=store.now();
      store.run('INSERT INTO events(id,type,actor,object_id,data,created_at,tenant_id) VALUES(?,?,?,?,?,?,?)', eventId, type, actor, object_id, JSON.stringify(data), created, tenantId);
      enqueueWebhookEvent(store,{id:eventId,type,actor,object_id,data,tenant_id:tenantId,created_at:created});
      return eventId;
    },
    journal(reference: string, amount: number, account: string, tenantId = 'owner') {
      const at = store.now();
      store.run('INSERT INTO journal(id,reference_id,account,amount,created_at,tenant_id) VALUES(?,?,?,?,?,?)', store.id('jrn'), reference, account, amount, at, tenantId);
      store.run('INSERT INTO journal(id,reference_id,account,amount,created_at,tenant_id) VALUES(?,?,?,?,?,?)', store.id('jrn'), reference, 'merchant_proceeds', -amount, at, tenantId);
    },
    scheduleWebhookAlarm,
  };
  return store;
}

function json(data: unknown, status = 200, headers?: HeadersInit) {
  const result = new Headers(headers);
  result.set('Cache-Control', 'no-store, private');
  result.set('X-Content-Type-Options', 'nosniff');
  result.set('X-Agora-Storage', 'durable-object-sqlite-v1');
  return Response.json(data, { status, headers: result });
}

type WorkerPayment = ReturnType<ReturnType<typeof createService>['createPayment']> & { checkout_token: string; tenant_id: string };

export class AgoraLedgerDO extends DurableObject<Env> {
  private readonly store: LedgerStore;
  private readonly service: ReturnType<typeof createService>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = makeStore(ctx.storage,()=>ctx.waitUntil(ctx.storage.setAlarm(Date.now()+1000)));
    this.service = createService(this.store, env);
    ctx.storage.sql.exec(schema);
    const initialSetupHash=this.env.AGORA_OWNER_SETUP_TOKEN_HASH;if(!this.store.one("SELECT id FROM owner_password WHERE id='owner'")&&initialSetupHash&&/^[a-f0-9]{64}$/.test(initialSetupHash))this.store.run("INSERT OR IGNORE INTO owner_setup(id,token_hash,expires_at) VALUES('owner',?,?)",initialSetupHash,new Date(Date.now()+7*24*60*60*1000).toISOString());
    for (const [table, column, definition] of [
      ['products', 'tenant_id', "TEXT NOT NULL DEFAULT 'owner'"],
      ['products', 'archived_at', 'TEXT'],
      ['payments', 'tenant_id', "TEXT NOT NULL DEFAULT 'owner'"],
      ['payments', 'archived_at', 'TEXT'],
      ['credentials', 'tenant_id', "TEXT NOT NULL DEFAULT 'owner'"],
      ['credentials', 'provider_mode', "TEXT NOT NULL DEFAULT 'sandbox'"],
      ['refunds', 'tenant_id', "TEXT NOT NULL DEFAULT 'owner'"],
      ['approvals', 'tenant_id', "TEXT NOT NULL DEFAULT 'owner'"],
      ['events', 'tenant_id', "TEXT NOT NULL DEFAULT 'owner'"],
      ['journal', 'tenant_id', "TEXT NOT NULL DEFAULT 'owner'"],
      ['payments', 'provider', "TEXT NOT NULL DEFAULT 'sandbox'"],
      ['payments', 'provider_mode', 'TEXT'],
      ['payments', 'provider_session_id', 'TEXT'],
      ['payments', 'provider_checkout_url', 'TEXT'],
      ['payments', 'provider_payment_intent', 'TEXT'],
      ['payments', 'provider_account_id', 'TEXT'],
      ['refunds', 'status', "TEXT NOT NULL DEFAULT 'succeeded'"],
      ['refunds', 'provider_refund_id', 'TEXT'],
      ['refunds', 'provider_mode', 'TEXT'],
      ['refunds', 'credential_id', 'TEXT'],
    ] as const) {
      const columns = ctx.storage.sql.exec(`PRAGMA table_info(${table})`).toArray() as { name: string }[];
      if (!columns.some((item) => item.name === column)) ctx.storage.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
    ctx.storage.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS tenant_email_unique ON tenants(email COLLATE NOCASE)");
    ctx.storage.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS merchant_user_email_unique ON merchant_users(email COLLATE NOCASE)");
    ctx.storage.sql.exec("INSERT OR IGNORE INTO tenants(id,business_name,email,status,provider,created_at,approved_at) VALUES('owner',?,?,'approved','stripe',?,?)", this.env.AGORA_WORKSPACE_NAME||'Agora workspace',this.env.AGORA_OWNER_EMAIL||'owner@localhost',this.store.now(),this.store.now());
    const mfaMigration = this.service.migrateMfaEncryptionKeys();
    console.info('Agora MFA key migration', {
      migrated: mfaMigration.migrated,
      remaining_old: mfaMigration.remaining_old,
    });
  }

  async alarm(){
    await dispatchWebhookBatch(this.store,this.env as unknown as Record<string,string|undefined>,fetch);
    const row=this.store.one<{wake:string|null}>("SELECT MIN(CASE WHEN status='pending' THEN next_attempt_at ELSE locked_until END) AS wake FROM webhook_deliveries WHERE status IN ('pending','delivering')");
    if(row?.wake){const at=Date.parse(row.wake);if(Number.isFinite(at))await this.ctx.storage.setAlarm(Math.max(Date.now()+1000,at));}
  }

  async fetch(request: Request): Promise<Response> {
    const requestId = this.store.id('req');
    try {
      const url = new URL(request.url);
      if (url.pathname === '/__health' && request.method === 'GET') {
        const readiness = this.service.paymentProviderReadiness();
        return json({ ok: true, storage: 'durable-object-sqlite-v1', deployment: this.env.AGORA_DEPLOYMENT_ENV || 'unspecified', provider_status: readiness.provider_status, checkout_enabled: readiness.checkout_enabled, ...(readiness.provider_mode ? { provider_mode: readiness.provider_mode } : {}) }, 200, { 'X-Request-Id': requestId });
      }
      const method = request.method;
      const path = url.pathname;

      if (path === '/api/health' && method === 'GET') {
        const readiness=this.service.paymentProviderReadiness();const config=this.service.stripeConfigSummary();
        return json({status:'ok',deployment_type:this.env.AGORA_DEPLOYMENT_TYPE||'community',deployment_target:this.env.AGORA_DEPLOYMENT_TARGET||'cloudflare-worker',current_version:this.env.AGORA_VERSION||'0.0.1',provider:{name:config.provider,mode:config.mode,status:readiness.provider_status,checkout_enabled:readiness.checkout_enabled,webhook_url:config.webhook_url,configured:config.configured[config.mode]}},200,{'X-Request-Id':requestId});
      }
      if (path === '/api/console/stripe-config' && method === 'GET') {
        const actor=this.service.consoleActor(request);if(actor.tenant_id!=='owner')throw new ApiError(403,'permission_denied','Only the workspace owner can configure Stripe.');
        return json({...this.service.stripeConfigSummary(),...this.service.paymentProviderReadiness()},200,{'X-Request-Id':requestId});
      }
      if(path==='/api/console/activity'&&method==='GET'){
        const actor=this.service.consoleActor(request);const value=url.searchParams.get('range')||'30d';const ranges=new Set(['1h','24h','7d','30d','90d','1y','all','custom']);if(!ranges.has(value))throw new ApiError(422,'invalid_request','Choose a supported activity range.');const from=url.searchParams.get('from')||undefined,to=url.searchParams.get('to')||undefined;if(value==='custom'&&(!from||!to))throw new ApiError(422,'invalid_request','Custom range needs a start and end date.');try{return json(this.service.paymentActivity(actor.tenant_id,value as '1h'|'24h'|'7d'|'30d'|'90d'|'1y'|'all'|'custom',from,to),200,{'X-Request-Id':requestId});}catch(error){if(error instanceof Error)throw new ApiError(422,'invalid_range',error.message);throw error;}
      }
      if(path==='/api/console/risk-signals'&&method==='GET'){
        const actor=this.service.consoleActor(request);const queryMode=url.searchParams.get('mode')||this.service.stripeRuntimeEnvironment().AGORA_STRIPE_MODE;if(queryMode!=='test'&&queryMode!=='live')throw new ApiError(422,'invalid_mode','Choose Stripe test or live mode.');const rawLimit=url.searchParams.get('limit');const limit=rawLimit===null?25:Number(rawLimit);if(!Number.isInteger(limit)||limit<1||limit>100)throw new ApiError(422,'invalid_limit','Limit must be between 1 and 100.');return json(this.service.listStripeRiskSignals(actor,queryMode,url.searchParams.get('cursor')||undefined,limit),200,{'X-Request-Id':requestId});
      }
      if (path === '/api/console/stripe-config' && method === 'PATCH') {
        const actor=this.service.consoleActor(request,true);if(actor.tenant_id!=='owner')throw new ApiError(403,'permission_denied','Only the workspace owner can configure Stripe.');
        const body=await bodyOf(request);const requestedOrigin=body&&typeof body==='object'?(body as {public_origin?:unknown}).public_origin:undefined;const requestOrigin=request.headers.get('origin');if(typeof requestedOrigin==='string'&&requestOrigin&&new URL(requestedOrigin).origin!==requestOrigin)throw new ApiError(422,'origin_mismatch','Public app URL must match the origin used to sign in.');const result=this.service.setStripeConfig(body);return json({...result,...this.service.paymentProviderReadiness()},200,{'X-Request-Id':requestId});
      }
      if (path === '/api/console/stripe-config' && method === 'POST') {
        const actor=this.service.consoleActor(request,true);if(actor.tenant_id!=='owner')throw new ApiError(403,'permission_denied','Only the workspace owner can configure Stripe.');
        const body=await bodyOf(request) as {action?:unknown;mode?:unknown};if(body.action!=='test'||(body.mode!=='test'&&body.mode!=='live'))throw new ApiError(422,'invalid_request','Provide action test and mode test or live.');
        const mode=body.mode;const secret=this.service.stripeSecret(mode,'api');if(!secret)throw new ApiError(409,'stripe_key_missing',`Configure a Stripe ${mode} API key first.`);
        const account=await testStripeApiKey(secret,mode);const configured=this.service.stripeConfigSummary().configured[mode];
        return json({ok:true,mode,account_id:account.account_id,webhook:{configured:configured.webhook_secret,verified:configured.webhook_verified},message:configured.webhook_verified?'Stripe credentials and webhook delivery are verified.':'Stripe credentials work. Send a signed account.updated test event to verify webhook delivery.'},200,{'X-Request-Id':requestId});
      }
      if (path === '/api/auth/session' && method === 'GET') return json(this.service.authSession(request), 200, { 'X-Request-Id': requestId });
      if (path === '/api/auth/setup/claim' && method === 'POST') { const result=this.service.claimOwnerSetup(request,await bodyOf(request)); const {cookie,...payload}=result; const response=json(payload,200,{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Request-Id':requestId}); return setMfaCookie(response,request,'pending',cookie); }
      if (path === '/api/auth/password/change' && method === 'POST') return json(this.service.changeAdminPassword(request, await bodyOf(request)), 200, { 'Cache-Control': 'no-store', 'X-Request-Id': requestId });
      if (path === '/api/auth/login' && method === 'POST') {
        const body = await bodyOf(request);
        if (body && typeof body === 'object' && typeof (body as { email?: unknown }).email === 'string' && String((body as { email: string }).email).trim().toLowerCase() !== this.service.ownerLoginEmail().trim().toLowerCase()) {
          const { cookie, ...payload } = await this.service.merchantLogin(request, body);
          const response = json({ role: 'merchant', ...payload }, 200, { 'X-Request-Id': requestId, 'Referrer-Policy': 'no-referrer' });
          return this.service.setMerchantCookie(response, request, 'pending', cookie);
        }
        const adminBody = body && typeof body === 'object' ? { password: (body as { password?: unknown }).password } : body;
        const result = this.service.beginAdminLogin(request, adminBody);
        const response = json({ stage: result.stage, ...(result.secret ? { secret: result.secret, otpauth_url: result.otpauth_url } : {}) }, 200, { 'X-Request-Id': requestId });
        return setMfaCookie(response, request, 'pending', result.cookie);
      }
      if (path === '/api/auth/mfa/enroll' && method === 'POST') {
        const result = this.service.enrollAdminMfa(request, await bodyOf(request));
        const response = json({ recovery_codes: result.recovery_codes, authenticated: true, role: 'owner', access_status: 'approved' }, 200, { 'X-Request-Id': requestId });
        setMfaCookie(response, request, 'pending');
        return setMfaCookie(response, request, 'owner', result.cookie);
      }
      if (path === '/api/auth/mfa/verify' && method === 'POST') {
        const result = this.service.verifyAdminMfa(request, await bodyOf(request));
        const response = json({ authenticated: true, role: 'owner', access_status: 'approved', mfa_stage: 'complete' }, 200, { 'X-Request-Id': requestId });
        setMfaCookie(response, request, 'pending');
        return setMfaCookie(response, request, 'owner', result.cookie);
      }
      if (path === '/api/auth/invite/accept' && method === 'POST') {
        const { cookie, ...payload } = await this.service.acceptMerchantInvite(request, await bodyOf(request));
        const response = json({ role: 'merchant', ...payload }, 200, { 'X-Request-Id': requestId, 'Referrer-Policy': 'no-referrer' });
        return this.service.setMerchantCookie(response, request, 'pending', cookie);
      }
      if (path === '/api/auth/merchant/mfa/enroll' && method === 'POST') {
        const { cookie, ...payload } = this.service.enrollMerchantMfa(request, await bodyOf(request));
        const response = json({ role: 'merchant', authenticated: true, access_status: 'approved', mfa_stage: 'complete', ...payload }, 200, { 'X-Request-Id': requestId });
        this.service.setMerchantCookie(response, request, 'pending');
        return this.service.setMerchantCookie(response, request, 'member', cookie);
      }
      if (path === '/api/auth/merchant/mfa/verify' && method === 'POST') {
        const { cookie } = this.service.verifyMerchantMfa(request, await bodyOf(request));
        const response = json({ role: 'merchant', authenticated: true, access_status: 'approved', mfa_stage: 'complete' }, 200, { 'X-Request-Id': requestId });
        this.service.setMerchantCookie(response, request, 'pending');
        return this.service.setMerchantCookie(response, request, 'member', cookie);
      }
      if (path === '/api/auth/logout' && method === 'POST') {
        requireSameOrigin(request, true);
        this.service.logout(request);
        const response = json({ authenticated: false }, 200, { 'X-Request-Id': requestId });
        setMfaCookie(response, request, 'owner');
        setMfaCookie(response, request, 'pending');
        response.headers.append('Set-Cookie', this.service.clearMerchantCookie(request));
        return response;
      }

      const connectMatch = path.match(/^\/api\/merchants\/([^/]+)\/stripe\/connect$/);
      if (connectMatch && method === 'GET') {
        const actor = this.service.consoleActor(request);
        const tenantId = decodeURIComponent(connectMatch[1]);
        if (actor.tenant_id !== 'owner' && actor.tenant_id !== tenantId) throw new ApiError(404, 'not_found', 'Merchant workspace not found.');
        const mode = this.service.stripeRuntimeEnvironment().AGORA_STRIPE_MODE;
        const linked = mode === 'test' || mode === 'live' ? this.service.stripeAccountForTenant(tenantId, mode) : null;
        return json({ provider: 'stripe', mode: mode === 'test' || mode === 'live' ? mode : null, status: linked?.status || 'not_connected', charges_enabled: linked?.charges_enabled || false }, 200, { 'X-Request-Id': requestId });
      }
      if (connectMatch && method === 'POST') {
        const actor = this.service.consoleActor(request, true);
        const mode = this.service.stripeRuntimeEnvironment().AGORA_STRIPE_MODE;
        const clientId = mode === 'live' ? this.env.STRIPE_LIVE_CONNECT_CLIENT_ID : mode === 'test' ? this.env.STRIPE_TEST_CONNECT_CLIENT_ID : undefined;
        if ((mode !== 'test' && mode !== 'live') || !clientId) throw new ApiError(503, 'provider_not_configured', 'Stripe Connect is not configured for this mode.');
        const origin = this.env.AGORA_PUBLIC_ORIGIN;
        if (!origin) throw new ApiError(503, 'provider_not_configured', 'AGORA_PUBLIC_ORIGIN is required for Stripe Connect.');
        const redirectUri = new URL('/api/provider/stripe/callback', origin).toString();
        const result = this.service.beginStripeConnect(actor, decodeURIComponent(connectMatch[1]), mode, clientId, redirectUri);
        return json({ authorize_url: result.authorize_url, expires_at: result.expires_at, mode }, 200, { 'X-Request-Id': requestId });
      }

      if (connectMatch && method === 'DELETE') {
        const actor = this.service.consoleActor(request, true);
        const mode = this.service.stripeRuntimeEnvironment().AGORA_STRIPE_MODE;
        if (mode !== 'test' && mode !== 'live') throw new ApiError(503, 'provider_not_configured', 'Stripe Connect is not configured for this mode.');
        const tenantId = decodeURIComponent(connectMatch[1]);
        if (actor.tenant_id !== 'owner' && actor.tenant_id !== tenantId) throw new ApiError(404, 'not_found', 'Merchant workspace not found.');
        const linked = this.service.stripeAccountForTenant(tenantId, mode);
        if (!linked) return json({ disconnected: false }, 200, { 'X-Request-Id': requestId });
        const clientId = mode === 'live' ? this.env.STRIPE_LIVE_CONNECT_CLIENT_ID : this.env.STRIPE_TEST_CONNECT_CLIENT_ID;
        const secretKey = (mode === 'test' || mode === 'live') ? this.service.stripeSecret(mode, 'api') : undefined;
        if (!clientId || !secretKey || (mode === 'test' && !secretKey.startsWith('sk_test_'))) throw new ApiError(503, 'provider_not_configured', 'Stripe Connect disconnection is not configured for this mode.');
        const result = this.service.disconnectStripeAccount(actor, tenantId, mode);
        await deauthorizeStripeAccount(secretKey, clientId, linked.account_id);
        return json(result, 200, { 'X-Request-Id': requestId });
      }

      if (path === '/api/provider/stripe/callback' && method === 'GET') {
        const actor = this.service.consoleActor(request);
        const origin = this.env.AGORA_PUBLIC_ORIGIN;
        const mode = this.service.stripeRuntimeEnvironment().AGORA_STRIPE_MODE;
        const clientId = mode === 'live' ? this.env.STRIPE_LIVE_CONNECT_CLIENT_ID : mode === 'test' ? this.env.STRIPE_TEST_CONNECT_CLIENT_ID : undefined;
        const secretKey = (mode === 'test' || mode === 'live') ? this.service.stripeSecret(mode, 'api') : undefined;
        if (!origin || (mode !== 'test' && mode !== 'live') || !clientId || !secretKey) throw new ApiError(503, 'provider_not_configured', 'Stripe Connect is not configured for this mode.');
        const callback = new URL(request.url);
        if (callback.searchParams.has('error')) return Response.redirect(new URL('/?view=Agents&stripe_connect=failed', origin), 303);
        const code = callback.searchParams.get('code');
        const state = callback.searchParams.get('state');
        if (!code || !state) throw new ApiError(400, 'oauth_callback_invalid', 'Stripe account connection could not be verified.');
        const redirectUri = new URL('/api/provider/stripe/callback', origin).toString();
        const { tenant_id } = this.service.consumeStripeConnectState(state, mode, redirectUri);
        if (actor.tenant_id !== 'owner' && actor.tenant_id !== tenant_id) throw new ApiError(403, 'oauth_tenant_mismatch', 'Stripe returned to a different merchant workspace.');
        const authorization = await exchangeStripeOAuthCode(secretKey, clientId, code);
        if (authorization.livemode !== (mode === 'live')) throw new ApiError(400, 'oauth_mode_mismatch', 'Stripe returned an account for a different payment mode.');
        const account = await getStripeConnectedAccount(secretKey, authorization.accountId);
        this.service.saveStripeConnectedAccount(tenant_id, mode, account);
        return Response.redirect(new URL('/?view=Agents&stripe_connect=connected', origin), 303);
      }

      if (path === '/api/webhooks/stripe' && method === 'POST') {
        const rawBody = await request.text();
        if (rawBody.length > 1024 * 1024) throw new ApiError(413, 'payload_too_large', 'Webhook payload exceeds 1 MB.');
        const signature = request.headers.get('stripe-signature');
        if (!signature) throw new ApiError(400, 'missing_signature', 'Stripe-Signature is required.');
        return json(this.service.handleStripeWebhook(rawBody, signature), 200, { 'X-Request-Id': requestId });
      }

      const statusMatch = path.match(/^\/api\/checkout\/status\/([^/]+)$/);
      if (statusMatch && method === 'GET') {
        const paymentId = statusMatch[1];
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(paymentId)) throw new ApiError(404, 'not_found', 'Checkout status not found.');
        const cookieName = `agora_checkout_status_${paymentId}`;
        const cookie = request.headers.get('cookie')?.split(';').map((value) => value.trim()).find((value) => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
        const token = request.headers.get('x-checkout-status-token') || cookie;
        const sessionId = url.searchParams.get('session_id');
        if (!token || !/^[a-f0-9]{48}$/.test(token)) throw new ApiError(404, 'not_found', 'Checkout status not found.');
        const payment = this.store.one<{ id: string; product_name: string; amount: number; currency: string; status: string; provider: string; provider_mode: string | null; provider_session_id: string | null }>(
          "SELECT id,product_name,amount,currency,status,provider,provider_mode,provider_session_id FROM payments WHERE id=? AND checkout_token=? AND sample=0",
          paymentId, token,
        );
        if (!payment || payment.provider !== 'stripe' || !payment.provider_session_id || (sessionId && sessionId !== payment.provider_session_id)) throw new ApiError(404, 'not_found', 'Checkout status not found.');
        const headers: HeadersInit = { 'X-Request-Id': requestId, 'Referrer-Policy': 'no-referrer' };
        if (payment.status !== 'pending') {
          const secure = true;
          (headers as Record<string, string>)['Set-Cookie'] = `${cookieName}=; Path=/api/checkout/status/${paymentId}; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
        }
        return json({ id: payment.id, product_name: payment.product_name, amount: payment.amount, currency: payment.currency, status: payment.status, provider: payment.provider, provider_mode: payment.provider_mode }, 200, headers);
      }

      if (path === '/api/checkout/prepare' && method === 'POST') {
        const token = request.headers.get('x-agora-checkout-token');
        if (!token || !/^[a-f0-9]{48}$/.test(token)) throw new ApiError(404, 'not_found', 'Checkout not found.');
        const payment = this.store.one<{ id: string; provider: string; status: string; provider_checkout_url: string | null }>(
          'SELECT id,provider,status,provider_checkout_url FROM payments WHERE checkout_token=? AND sample=0', token,
        );
        if (!payment || payment.provider !== 'stripe' || !payment.provider_checkout_url) throw new ApiError(404, 'not_found', 'Checkout not found.');
        if (payment.status !== 'pending') throw new ApiError(409, 'checkout_not_pending', 'This payment is no longer awaiting checkout.');
        const target = new URL(payment.provider_checkout_url);
        if (target.protocol !== 'https:' || target.hostname !== 'checkout.stripe.com') throw new ApiError(502, 'provider_invalid_response', 'The stored provider checkout URL is invalid.');
        const secure = true;
        const cookieName = `agora_checkout_status_${payment.id}`;
        const cookie = `${cookieName}=${token}; Path=/api/checkout/status/${payment.id}; HttpOnly; SameSite=Lax; Max-Age=3600${secure ? '; Secure' : ''}`;
        return json({ checkout_url: target.toString() }, 200, { 'X-Request-Id': requestId, 'Referrer-Policy': 'no-referrer', 'Set-Cookie': cookie });
      }

      const archiveProductMatch=path.match(/^\/api\/console\/products\/([^/]+)$/);
      if(archiveProductMatch&&method==='PATCH'){const actor=this.service.consoleActor(request,true);if(actor.tenant_id!=='owner')throw new ApiError(403,'permission_denied','Only the workspace owner can archive products.');const body=await bodyOf(request) as {archived?:unknown};if(typeof body.archived!=='boolean')throw new ApiError(422,'invalid_request','Provide archived as true or false.');return json(this.service.archiveProduct(actor,decodeURIComponent(archiveProductMatch[1]),body.archived),200,{'X-Request-Id':requestId});}
      const archivePaymentMatch=path.match(/^\/api\/console\/payments\/([^/]+)$/);
      if(archivePaymentMatch&&method==='PATCH'){const actor=this.service.consoleActor(request,true);if(actor.tenant_id!=='owner')throw new ApiError(403,'permission_denied','Only the workspace owner can archive payments.');const body=await bodyOf(request) as {archived?:unknown};if(typeof body.archived!=='boolean')throw new ApiError(422,'invalid_request','Provide archived as true or false.');return json(this.service.archivePayment(actor,decodeURIComponent(archivePaymentMatch[1]),body.archived),200,{'X-Request-Id':requestId});}
      if (path === '/api/console' && method === 'GET') {
        const actor = this.service.consoleActor(request);
        const readiness = this.service.paymentProviderReadiness();
        return json({ ...this.service.snapshot(actor.tenant_id,url.searchParams.get('include_archived')==='1'||url.searchParams.get('include_archived')==='true'), mode: this.service.stripeRuntimeEnvironment().AGORA_PAYMENT_PROVIDER === 'stripe' ? 'stripe' : 'sandbox', provider_status: readiness.provider_status, checkout_enabled: readiness.checkout_enabled, ...(readiness.provider_mode ? { provider_mode: readiness.provider_mode } : {}) }, 200, { 'X-Request-Id': requestId });
      }
      if (path === '/api/console/webhooks') {
        const actor=this.service.consoleActor(request,method!=='GET');if(actor.tenant_id!=='owner')throw new ApiError(403,'permission_denied','Only the workspace owner can manage outgoing webhooks.');
        if(method==='GET')return json({data:this.service.listWebhookEndpoints(actor,url.searchParams.get('include_archived')==='true')},200,{'X-Request-Id':requestId});
        if(method==='POST')return json(this.service.createWebhookEndpoint(actor,await bodyOf(request)),201,{'X-Request-Id':requestId});
      }
      const webhookEndpoint=path.match(/^\/api\/console\/webhooks\/([^/]+)$/);
      if(webhookEndpoint){const actor=this.service.consoleActor(request,true);if(actor.tenant_id!=='owner')throw new ApiError(403,'permission_denied','Only the workspace owner can manage outgoing webhooks.');const endpointId=decodeURIComponent(webhookEndpoint[1]);if(method==='PATCH'){const body=await bodyOf(request) as {action?:unknown};if(body?.action==='rotate_secret')return json(this.service.rotateWebhookSecret(actor,endpointId),200,{'X-Request-Id':requestId});return json(this.service.updateWebhookEndpoint(actor,endpointId,body),200,{'X-Request-Id':requestId});}if(method==='DELETE')return json(this.service.archiveWebhookEndpoint(actor,endpointId),200,{'X-Request-Id':requestId});}
      const webhookRotate=path.match(/^\/api\/console\/webhooks\/([^/]+)\/rotate-secret$/);
      if(webhookRotate&&method==='POST'){const actor=this.service.consoleActor(request,true);if(actor.tenant_id!=='owner')throw new ApiError(403,'permission_denied','Only the workspace owner can rotate outgoing webhook secrets.');return json(this.service.rotateWebhookSecret(actor,decodeURIComponent(webhookRotate[1])),200,{'X-Request-Id':requestId});}
      const webhookDeliveries=path.match(/^\/api\/console\/webhooks\/([^/]+)\/deliveries$/);
      if(webhookDeliveries&&method==='GET'){const actor=this.service.consoleActor(request);if(actor.tenant_id!=='owner')throw new ApiError(403,'permission_denied','Only the workspace owner can inspect outgoing webhooks.');return json(this.service.listWebhookDeliveries(actor,decodeURIComponent(webhookDeliveries[1]),url.searchParams.get('cursor')||undefined,Number(url.searchParams.get('limit')||25)),200,{'X-Request-Id':requestId});}
      const webhookDelivery=path.match(/^\/api\/console\/webhooks\/([^/]+)\/deliveries\/([^/]+)$/);
      if(webhookDelivery&&method==='GET'){const actor=this.service.consoleActor(request);if(actor.tenant_id!=='owner')throw new ApiError(403,'permission_denied','Only the workspace owner can inspect outgoing webhooks.');return json(this.service.webhookDeliveryDetail(actor,decodeURIComponent(webhookDelivery[1]),decodeURIComponent(webhookDelivery[2])),200,{'X-Request-Id':requestId});}
      const webhookReplay=path.match(/^\/api\/console\/webhooks\/([^/]+)\/deliveries\/([^/]+)\/replay$/);
      if(webhookReplay&&method==='POST'){const actor=this.service.consoleActor(request,true);if(actor.tenant_id!=='owner')throw new ApiError(403,'permission_denied','Only the workspace owner can replay outgoing webhooks.');return json(this.service.replayWebhookDelivery(actor,decodeURIComponent(webhookReplay[1]),decodeURIComponent(webhookReplay[2])),202,{'X-Request-Id':requestId});}
      if (path === '/api/console' && method === 'POST') {
        const body = await bodyOf(request) as { action?: string; payload?: unknown };
        const actor = this.service.consoleActor(request, true);
        const handlers: Record<string, () => unknown> = {
          create_product: () => this.service.createProduct(actor, body.payload),
          resolve_approval: () => this.service.resolveApproval(actor, body.payload),
          revoke_key: () => this.service.revokeCredential(actor, body.payload),
          review_registration: () => this.service.reviewRegistration(actor, body.payload),
        };
        if (body.action === 'create_payment') {
          return json(await this.createPaymentCheckout(actor, 'create_payment', request.headers.get('idempotency-key'), body.payload), 200, { 'X-Request-Id': requestId });
        }
        if (body.action === 'refund') {
          const result = this.service.mutate(actor, body.action, request.headers.get('idempotency-key'), body.payload, () => this.service.createRefund(actor, body.payload)) as Record<string, unknown>;
          if (result.status === 'pending' && result.provider === 'stripe') return json(await this.finishRefundOrReplay(actor.tenant_id, result), 200, { 'X-Request-Id': requestId });
          return json(result, 200, { 'X-Request-Id': requestId });
        }
        if (body.action === 'resolve_approval') {
          const result = this.service.mutate(actor, body.action, request.headers.get('idempotency-key'), body.payload, () => this.service.resolveApproval(actor, body.payload)) as { refund?: Record<string, unknown> };
          if (result.refund?.status === 'pending' && result.refund.provider === 'stripe') return json({ ...result, refund: await this.finishRefundOrReplay(actor.tenant_id, result.refund) }, 200, { 'X-Request-Id': requestId });
          return json(result, 200, { 'X-Request-Id': requestId });
        }
        if (body.action === 'create_invite') {
          if (actor.tenant_id !== 'owner') throw new ApiError(403, 'permission_denied', 'Only the owner can issue merchant invitations.');
          const payload = body.payload as { tenant_id?: unknown };
          if (typeof payload?.tenant_id !== 'string') throw new ApiError(422, 'invalid_request', 'Provide a merchant workspace ID.');
          const origin = this.env.AGORA_PUBLIC_ORIGIN;
          if (!origin) throw new ApiError(503, 'auth_not_configured', 'AGORA_PUBLIC_ORIGIN is required before issuing invitations.');
          const invite = this.service.createMerchantInvite(actor, payload.tenant_id);
          return json({ email: invite.email, expires_at: invite.expires_at, invite_url: `${origin}/invite#${invite.token}` }, 200, { 'X-Request-Id': requestId, 'Referrer-Policy': 'no-referrer' });
        }
        if (body.action === 'create_key') {
          if (!this.service.paymentProviderReadiness().checkout_enabled) throw new ApiError(503, 'provider_not_configured', 'API keys are unavailable until a mode-matched processor API key and webhook secret are configured.');
          let secret: string | undefined;
          const result = this.service.mutate(actor, body.action, request.headers.get('idempotency-key'), body.payload, () => {
            const created = this.service.createCredential(actor, body.payload);
            secret = created.secret;
            const { secret: _secret, ...metadata } = created;
            return metadata;
          });
          return json(secret ? { ...result as object, secret } : result, 200, { 'X-Request-Id': requestId });
        }
        const handler = body.action ? handlers[body.action] : undefined;
        if (!handler || !body.action) throw new ApiError(400, 'invalid_action', 'Unknown console action.');
        return json(this.service.mutate(actor, body.action, request.headers.get('idempotency-key'), body.payload, handler), 200, { 'X-Request-Id': requestId });
      }

      if (path === '/api/registrations' && method === 'POST') {
        const body = await bodyOf(request);
        requireSameOrigin(request, true);
        const source = request.headers.get('cf-connecting-ip') || 'unknown';
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
        const bucket = `registration:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
        const now = Math.floor(Date.now() / 1000);
        const prior = this.store.one<{ attempts: number; window_started: number }>('SELECT attempts,window_started FROM registration_rate_limits WHERE bucket=?', bucket);
        if (prior && now - prior.window_started < 900 && prior.attempts >= 5) throw new ApiError(429, 'rate_limited', 'Too many registration attempts. Try again later.');
        const attempts = prior && now - prior.window_started < 900 ? prior.attempts + 1 : 1;
        const started = prior && now - prior.window_started < 900 ? prior.window_started : now;
        this.store.run('INSERT INTO registration_rate_limits(bucket,attempts,window_started) VALUES(?,?,?) ON CONFLICT(bucket) DO UPDATE SET attempts=excluded.attempts,window_started=excluded.window_started', bucket, attempts, started);
        return json(this.service.registerMerchant(body), 201, { 'X-Request-Id': requestId });
      }

      if (path === '/api/v1/products' || path === '/api/v1/payments' || path === '/api/v1/events') {
        const body = method === 'POST' ? await bodyOf(request) : undefined;
        const actor = this.service.authenticate(request);
        const table = path.slice('/api/v1/'.length);
        if (method === 'GET') {
          requireScope(actor, `${table}:read`);
          const cursor = Number(url.searchParams.get('cursor') || 0);
          const limit = Number(url.searchParams.get('limit') || 25);
          if (!Number.isInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(422, 'invalid_pagination', 'limit must be 1–100 and cursor a non-negative integer.');
          let filter = '';
          const filterArgs: (string | number | null)[] = [];
          if (actor.credential && table === 'payments') {
            const mode = actor.credential.provider_mode || 'sandbox';
            filter = mode === 'sandbox' ? " AND provider='sandbox'" : " AND provider='stripe' AND provider_mode=?";
            if (mode !== 'sandbox') filterArgs.push(mode);
          } else if (actor.credential && table === 'events') {
            const mode = actor.credential.provider_mode || 'sandbox';
            const paymentMode = mode === 'sandbox' ? "p.provider='sandbox'" : "p.provider='stripe' AND p.provider_mode=?";
            const approvalMode = mode === 'sandbox' ? "p.provider='sandbox'" : "p.provider='stripe' AND p.provider_mode=?";
            filter = ` AND (type LIKE 'product.%' OR object_id IN (SELECT p.id FROM payments p WHERE p.tenant_id=? AND ${paymentMode}) OR object_id IN (SELECT a.id FROM approvals a JOIN payments p ON p.id=a.payment_id AND p.tenant_id=a.tenant_id WHERE a.tenant_id=? AND ${approvalMode}))`;
            filterArgs.push(actor.tenant_id);
            if (mode !== 'sandbox') filterArgs.push(mode);
            filterArgs.push(actor.tenant_id);
            if (mode !== 'sandbox') filterArgs.push(mode);
          }
          const rows = this.store.all<Record<string, unknown>>(`SELECT rowid AS cursor_id,* FROM ${table} WHERE tenant_id=? AND rowid>?${filter} ORDER BY rowid LIMIT ?`, actor.tenant_id, cursor, ...filterArgs, limit + 1);
          const hasMore = rows.length > limit;
          const items = rows.slice(0, limit);
          return json({ data: items.map((row) => { const { cursor_id, ...item } = row; if (table === 'payments') return publicPayment(item as unknown as Payment, this.env.AGORA_PUBLIC_ORIGIN || url.origin); const { checkout_token, tenant_id: _tenantId, ...visible } = item; return table === 'events' ? { ...visible, data: JSON.parse(String(visible.data)) } : visible; }), next_cursor: hasMore ? items.at(-1)?.cursor_id : null }, 200, { 'X-Request-Id': requestId });
        }
        if (method === 'POST' && table !== 'events') {
          if (table === 'products') {
            const provider = this.service.stripeRuntimeEnvironment().AGORA_PAYMENT_PROVIDER || 'sandbox';
            const mode = provider === 'stripe' ? this.service.stripeRuntimeEnvironment().AGORA_STRIPE_MODE : 'sandbox';
            if (mode !== 'sandbox' && mode !== 'test' && mode !== 'live') throw new ApiError(503, 'provider_not_configured', 'Set AGORA_STRIPE_MODE to test or live.');
            requireProviderMode(actor, mode);
            return json(this.service.mutate(actor, table, request.headers.get('idempotency-key'), body, () => this.service.createProduct(actor, body)), 201, { 'X-Request-Id': requestId });
          }
          return json(await this.createPaymentCheckout(actor, table, request.headers.get('idempotency-key'), body), 201, { 'X-Request-Id': requestId });
        }
      }
      if (path === '/api/v1/refunds' && method === 'POST') {
        const body = await bodyOf(request);
        const actor = this.service.authenticate(request);
        if (body && typeof body === 'object' && typeof (body as { payment_id?: unknown }).payment_id === 'string') {
          this.service.requirePaymentMode(actor, (body as { payment_id: string }).payment_id);
        }
        const initial = this.service.mutate(actor, 'refunds', request.headers.get('idempotency-key'), body, () => this.service.createRefund(actor, body)) as Record<string, unknown>;
        if (initial.status !== 'pending' || initial.provider !== 'stripe') return json(initial, 201, { 'X-Request-Id': requestId });
        return json(await this.finishRefundOrReplay(actor.tenant_id, initial), 201, { 'X-Request-Id': requestId });
      }
      const reconcileMatch = path.match(/^\/api\/v1\/payments\/([A-Za-z0-9_-]{1,80})\/reconcile$/);
      if (reconcileMatch && method === 'POST') {
        const actor = this.service.authenticate(request);
        requireScope(actor, 'payments:write');
        this.service.requirePaymentMode(actor, reconcileMatch[1]);
        const context = this.service.stripePaymentReconcileContext(reconcileMatch[1], actor.tenant_id);
        const mode = context.provider_mode;
        if (mode !== 'test' && mode !== 'live') throw new ApiError(409, 'provider_mode_invalid', 'Stripe payment mode is missing.');
        const secretKey = this.service.stripeSecret(mode, 'api');
        if (!secretKey || !(secretKey.startsWith(mode === 'test' ? 'sk_test_' : 'sk_live_') || secretKey.startsWith(mode === 'test' ? 'rk_test_' : 'rk_live_'))) throw new ApiError(503, 'provider_not_configured', 'Stripe reconciliation credentials are not configured for this payment mode.');
        const session = await retrieveStripeCheckout(secretKey, context.provider_session_id!, context.provider_account_id || undefined);
        return json(this.service.reconcileStripePayment(context.id, actor.tenant_id, session), 200, { 'X-Request-Id': requestId });
      }
      const paymentMatch = path.match(/^\/api\/v1\/payments\/([^/]+)$/);
      if (paymentMatch && method === 'GET') {
        const actor = this.service.authenticate(request);
        requireScope(actor, 'payments:read');
        const mode = actor.credential?.provider_mode || 'sandbox';
        const payment = actor.credential
          ? this.store.one<Payment>(mode === 'sandbox'
            ? "SELECT * FROM payments WHERE id=? AND tenant_id=? AND provider='sandbox'"
            : "SELECT * FROM payments WHERE id=? AND tenant_id=? AND provider='stripe' AND provider_mode=?", ...mode === 'sandbox' ? [paymentMatch[1], actor.tenant_id] : [paymentMatch[1], actor.tenant_id, mode])
          : this.store.one<Payment>('SELECT * FROM payments WHERE id=? AND tenant_id=?', paymentMatch[1], actor.tenant_id);
        if (!payment) throw new ApiError(404, 'not_found', 'Payment not found.');
        return json(publicPayment(payment, this.env.AGORA_PUBLIC_ORIGIN || url.origin), 200, { 'X-Request-Id': requestId });
      }
      const checkoutMatch = path.match(/^\/api\/checkout\/([^/]+)$/);
      if (checkoutMatch && method === 'GET') {
        const payment = this.store.one<Payment>('SELECT * FROM payments WHERE checkout_token=? AND sample=0', checkoutMatch[1]);
        if (!payment) throw new ApiError(404, 'not_found', 'Checkout not found. Use the exact checkout_url returned by Agora; payment IDs are not checkout links.');
        return json({ id: payment.id, product_name: payment.product_name, amount: payment.amount, status: payment.status, currency: payment.currency, provider: payment.provider || 'sandbox', provider_mode: payment.provider_mode || null }, 200, { 'X-Request-Id': requestId });
      }
      if (checkoutMatch && method === 'POST') {
        const body = await bodyOf(request);
        if (this.env.AGORA_DEPLOYMENT_ENV === 'production' || this.service.stripeRuntimeEnvironment().AGORA_PAYMENT_PROVIDER !== 'sandbox') throw new ApiError(503, 'provider_not_configured', 'Sandbox payment simulation is disabled for this deployment.');
        return json(this.service.simulate(checkoutMatch[1], body), 200, { 'X-Request-Id': requestId });
      }
      throw new ApiError(404, 'not_found', 'Endpoint not found.');
    } catch (error) {
      // Rejected requests may still carry a body; cancel it before returning so
      // the Worker runtime does not report an unread-stream exception.
      try { await request.body?.cancel(); } catch {}
      const response = responseError(error, requestId);
      response.headers.set('X-Agora-Storage', 'durable-object-sqlite-v1');
      response.headers.set('Cache-Control', 'no-store, private');
      return response;
    }
  }

  private async createPaymentCheckout(actor: ReturnType<ReturnType<typeof createService>['authenticate']>, route: string, key: string | null, body: unknown) {
    const readiness = this.service.paymentProviderReadiness();
    if (!readiness.checkout_enabled) throw new ApiError(503, 'provider_not_configured', 'Payment acceptance is unavailable until a mode-matched processor API key, webhook secret, and public origin are configured.');
    const provider = this.service.stripeRuntimeEnvironment().AGORA_PAYMENT_PROVIDER || 'sandbox';
    const mode = readiness.provider_mode;
    if (provider === 'sandbox') {
      requireProviderMode(actor,'sandbox');
    } else if (provider === 'stripe') {
      if (mode !== 'test' && mode !== 'live') throw new ApiError(503, 'provider_not_configured', 'Set Stripe mode to test or live before accepting payments.');
      requireProviderMode(actor,mode);
    } else {
      throw new ApiError(503, 'provider_not_configured', 'The configured payment provider is unavailable.');
    }
    const payment = this.service.mutate(actor, route, key, body, () => this.service.createPayment(actor, body)) as WorkerPayment;
    if (provider === 'sandbox') {
      return publicPayment(payment, this.env.AGORA_PUBLIC_ORIGIN);
    }
    const secretKey = (mode === 'test' || mode === 'live') ? this.service.stripeSecret(mode, 'api') : undefined;
    const prefix = mode === 'live' ? 'live' : 'test';
    if (!mode || !secretKey || !(secretKey.startsWith(`sk_${prefix}_`) || secretKey.startsWith(`rk_${prefix}_`))) throw new ApiError(503, 'provider_not_configured', `Set a mode-matched Stripe ${prefix} API key before enabling checkout.`);
    const configured = this.service.stripeRuntimeEnvironment().AGORA_PUBLIC_ORIGIN;
    if (!configured) throw new ApiError(503, 'provider_not_configured', 'Set AGORA_PUBLIC_ORIGIN before enabling Stripe Checkout.');
    const connected = actor.tenant_id === 'owner' ? null : this.service.stripeAccountForTenant(actor.tenant_id, mode);
    if (actor.tenant_id !== 'owner' && (!connected || connected.status !== 'connected' || !connected.charges_enabled)) throw new ApiError(409, 'merchant_connection_required', 'This approved merchant must connect a Stripe account with charges enabled.');
    this.service.prepareStripePayment(payment.id, mode, actor.tenant_id, connected?.account_id || null);
    const session = await createStripeCheckout(secretKey, {
      amount: payment.amount,
      currency: 'usd',
      productName: payment.product_name,
      paymentId: payment.id,
      tenantId: actor.tenant_id,
      successUrl: `${configured}/checkout/complete?payment_id=${encodeURIComponent(payment.id)}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${configured}/checkout/cancel?payment_id=${encodeURIComponent(payment.id)}`,
      idempotencyKey: `agora-checkout-${payment.id}`,
      ...(connected ? { stripeAccountId: connected.account_id } : {}),
    });
    this.service.saveStripeSession(payment.id, session, mode, actor.tenant_id, connected?.account_id || null);
    return publicPayment({ ...payment, provider: 'stripe', provider_mode: mode }, configured);
  }

  private async submitStripeRefund(tenantId: string, refundId: string) {
    const context = this.service.stripeRefundContext(refundId);
    const mode = context.provider_mode;
    if (mode !== 'test' && mode !== 'live') throw new ApiError(409, 'provider_mode_invalid', 'Stripe refund mode is missing.');
    const secretKey = (mode === 'test' || mode === 'live') ? this.service.stripeSecret(mode, 'api') : undefined;
    const prefix = mode === 'live' ? 'live' : 'test';
    if (!secretKey || !(secretKey.startsWith(`sk_${prefix}_`) || secretKey.startsWith(`rk_${prefix}_`))) throw new ApiError(503, 'provider_not_configured', `Set a mode-matched Stripe ${prefix} API key before enabling refunds.`);
    if (tenantId !== context.tenant_id) throw new ApiError(404, 'not_found', 'Refund request not found.');
    if (tenantId !== 'owner') {
      const connected = this.service.stripeAccountForTenant(tenantId, mode);
      if (!connected || connected.status !== 'connected' || !connected.charges_enabled || connected.account_id !== context.provider_account_id) throw new ApiError(409, 'merchant_connection_required', 'This merchant must reconnect its own Stripe account before processor refunds are enabled.');
    }
    const providerRefund = await createStripeRefund(secretKey, {
      paymentIntent: context.payment_intent!,
      amount: context.amount,
      refundId,
      idempotencyKey: `agora-refund-${refundId}`,
      ...(context.provider_account_id ? { stripeAccountId: context.provider_account_id } : {}),
    });
    return this.store.transaction(() => this.service.recordStripeRefundResult(refundId, providerRefund.id, providerRefund.status));
  }

  private async finishRefundOrReplay(tenantId: string, initial: Record<string, unknown>) {
    const refundId = String(initial.id);
    const current = this.store.one<{ id: string; payment_id: string; amount: number; reason: string; status: string; provider_refund_id: string | null; provider_mode: string | null }>(
      'SELECT id,payment_id,amount,reason,status,provider_refund_id,provider_mode FROM refunds WHERE id=? AND tenant_id=?', refundId, tenantId,
    );
    if (!current) throw new ApiError(404, 'not_found', 'Refund request not found.');
    if (current.status !== 'pending') return { ...initial, ...current, provider: 'stripe' };
    return { ...initial, ...await this.submitStripeRefund(tenantId, refundId) };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const workspaceId = env.AGORA_WORKSPACE_ID || 'owner-workspace';
    if (url.pathname === '/' || url.pathname === '/__health') {
      const id = env.AGORA_LEDGER.idFromName(workspaceId);
      return env.AGORA_LEDGER.get(id).fetch(new Request(new URL('/__health', request.url), { method: 'GET' }));
    }
    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const id = env.AGORA_LEDGER.idFromName(workspaceId);
    return env.AGORA_LEDGER.get(id).fetch(request);
  },
};
