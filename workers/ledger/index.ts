import { DurableObject } from 'cloudflare:workers';
import type { LedgerStore, SqlValue } from '../../lib/server/store';
import { createService, owner, requireScope, ApiError, bodyOf, consoleAuth, responseError } from '../../lib/server/service';
import { setMfaCookie } from '../../lib/server/admin-auth';
import type { Payment } from '../../lib/types';

interface Env {
  AGORA_LEDGER: DurableObjectNamespace<AgoraLedgerDO>;
  AGORA_PUBLIC_ORIGIN: string;
  AGORA_OWNER_EMAIL: string;
  AGORA_PAYMENT_PROVIDER?: string;
  AGORA_ADMIN_PASSWORD: string;
  AGORA_ADMIN_TOKEN: string;
  AGORA_MFA_ENCRYPTION_KEY: string;
}

const schema = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),currency TEXT NOT NULL DEFAULT 'usd' CHECK(currency='usd'),created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),product_name TEXT NOT NULL,customer TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),refunded INTEGER NOT NULL DEFAULT 0 CHECK(refunded>=0 AND refunded<=amount),currency TEXT NOT NULL DEFAULT 'usd',status TEXT NOT NULL CHECK(status IN ('pending','succeeded','failed')),actor TEXT NOT NULL,created_at TEXT NOT NULL,checkout_token TEXT NOT NULL UNIQUE,sample INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS credentials(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,prefix TEXT NOT NULL,hash TEXT NOT NULL UNIQUE,scopes TEXT NOT NULL,max_amount INTEGER NOT NULL,refund_budget INTEGER NOT NULL,spent INTEGER NOT NULL DEFAULT 0,revoked INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS refunds(id TEXT PRIMARY KEY,payment_id TEXT NOT NULL REFERENCES payments(id),amount INTEGER NOT NULL CHECK(amount>0),reason TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,payment_id TEXT NOT NULL REFERENCES payments(id),amount INTEGER NOT NULL CHECK(amount>0),reason TEXT NOT NULL,credential_id TEXT NOT NULL REFERENCES credentials(id),actor TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,type TEXT NOT NULL,actor TEXT NOT NULL,object_id TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS journal(id TEXT PRIMARY KEY,reference_id TEXT NOT NULL,account TEXT NOT NULL,amount INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency(actor TEXT NOT NULL,route TEXT NOT NULL,key TEXT NOT NULL,hash TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(actor,route,key));
CREATE TABLE IF NOT EXISTS owner_mfa(id TEXT PRIMARY KEY CHECK(id='owner'),encrypted_secret TEXT NOT NULL,confirmed INTEGER NOT NULL DEFAULT 0,last_counter INTEGER NOT NULL DEFAULT -1,recovery_hashes TEXT NOT NULL DEFAULT '[]',updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auth_rate_limits(bucket TEXT PRIMARY KEY,attempts INTEGER NOT NULL,window_started INTEGER NOT NULL,locked_until INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS registrations(id TEXT PRIMARY KEY,business_name TEXT NOT NULL,owner_name TEXT NOT NULL,email TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'stripe',provider_account_id TEXT,status TEXT NOT NULL DEFAULT 'pending',tenant_id TEXT,created_at TEXT NOT NULL,reviewed_at TEXT,review_reason TEXT);
CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY,business_name TEXT NOT NULL,email TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',provider TEXT NOT NULL DEFAULT 'stripe',provider_account_id TEXT,created_at TEXT NOT NULL,approved_at TEXT);
CREATE INDEX IF NOT EXISTS payment_created ON payments(created_at);
CREATE INDEX IF NOT EXISTS event_created ON events(created_at);
`;

function makeStore(storage: DurableObjectStorage): LedgerStore {
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
      const eventId = store.id('evt');
      store.run('INSERT INTO events(id,type,actor,object_id,data,created_at,tenant_id) VALUES(?,?,?,?,?,?,?)', eventId, type, actor, object_id, JSON.stringify(data), store.now(), tenantId);
      return eventId;
    },
    journal(reference: string, amount: number, account: string, tenantId = 'owner') {
      const at = store.now();
      store.run('INSERT INTO journal(id,reference_id,account,amount,created_at,tenant_id) VALUES(?,?,?,?,?,?)', store.id('jrn'), reference, account, amount, at, tenantId);
      store.run('INSERT INTO journal(id,reference_id,account,amount,created_at,tenant_id) VALUES(?,?,?,?,?,?)', store.id('jrn'), reference, 'merchant_proceeds', -amount, at, tenantId);
    },
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

export class AgoraLedgerDO extends DurableObject<Env> {
  private readonly store: LedgerStore;
  private readonly service: ReturnType<typeof createService>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = makeStore(ctx.storage);
    this.service = createService(this.store);
    ctx.storage.sql.exec(schema);
    for (const [table, column, definition] of [
      ['products', 'tenant_id', "TEXT NOT NULL DEFAULT 'owner'"],
      ['payments', 'tenant_id', "TEXT NOT NULL DEFAULT 'owner'"],
      ['credentials', 'tenant_id', "TEXT NOT NULL DEFAULT 'owner'"],
      ['refunds', 'tenant_id', "TEXT NOT NULL DEFAULT 'owner'"],
      ['approvals', 'tenant_id', "TEXT NOT NULL DEFAULT 'owner'"],
      ['events', 'tenant_id', "TEXT NOT NULL DEFAULT 'owner'"],
      ['journal', 'tenant_id', "TEXT NOT NULL DEFAULT 'owner'"],
    ] as const) {
      const columns = ctx.storage.sql.exec(`PRAGMA table_info(${table})`).toArray() as { name: string }[];
      if (!columns.some((item) => item.name === column)) ctx.storage.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
    ctx.storage.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS tenant_email_unique ON tenants(email COLLATE NOCASE)");
    ctx.storage.sql.exec("INSERT OR IGNORE INTO tenants(id,business_name,email,status,provider,created_at,approved_at) VALUES('owner','Belweave','info@belweave.com','approved','sandbox',?,?)", this.store.now(), this.store.now());
  }

  async fetch(request: Request): Promise<Response> {
    const requestId = this.store.id('req');
    try {
      const url = new URL(request.url);
      if (url.pathname === '/__health' && request.method === 'GET') {
        return json({ ok: true, storage: 'durable-object-sqlite-v1', mode: this.env.AGORA_PAYMENT_PROVIDER || 'sandbox' }, 200, { 'X-Request-Id': requestId });
      }
      const method = request.method;
      const path = url.pathname;

      if (path === '/api/auth/session' && method === 'GET') return json(this.service.authSession(request), 200, { 'X-Request-Id': requestId });
      if (path === '/api/auth/login' && method === 'POST') {
        const result = this.service.beginAdminLogin(request, await bodyOf(request));
        const response = json({ stage: result.stage, ...(result.secret ? { secret: result.secret, otpauth_url: result.otpauth_url } : {}) }, 200, { 'X-Request-Id': requestId });
        return setMfaCookie(response, request, 'pending', result.cookie);
      }
      if (path === '/api/auth/mfa/enroll' && method === 'POST') {
        const result = this.service.enrollAdminMfa(request, await bodyOf(request));
        const response = json({ recovery_codes: result.recovery_codes }, 200, { 'X-Request-Id': requestId });
        setMfaCookie(response, request, 'pending');
        return setMfaCookie(response, request, 'owner', result.cookie);
      }
      if (path === '/api/auth/mfa/verify' && method === 'POST') {
        const result = this.service.verifyAdminMfa(request, await bodyOf(request));
        const response = json({ authenticated: true }, 200, { 'X-Request-Id': requestId });
        setMfaCookie(response, request, 'pending');
        return setMfaCookie(response, request, 'owner', result.cookie);
      }
      if (path === '/api/auth/logout' && method === 'POST') {
        const response = json({ authenticated: false }, 200, { 'X-Request-Id': requestId });
        setMfaCookie(response, request, 'owner');
        return setMfaCookie(response, request, 'pending');
      }

      if (path === '/api/console' && method === 'GET') {
        const actor = consoleAuth(request);
        return json(this.service.snapshot(), 200, { 'X-Request-Id': requestId });
      }
      if (path === '/api/console' && method === 'POST') {
        const actor = consoleAuth(request, true);
        const body = await bodyOf(request) as { action?: string; payload?: unknown };
        const handlers: Record<string, () => unknown> = {
          create_product: () => this.service.createProduct(actor, body.payload),
          create_payment: () => this.service.createPayment(actor, body.payload),
          refund: () => this.service.createRefund(actor, body.payload),
          resolve_approval: () => this.service.resolveApproval(actor, body.payload),
          revoke_key: () => this.service.revokeCredential(actor, body.payload),
        };
        if (body.action === 'create_key') {
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

      if (path === '/api/v1/products' || path === '/api/v1/payments' || path === '/api/v1/events') {
        const actor = this.service.authenticate(request);
        const table = path.slice('/api/v1/'.length);
        if (method === 'GET') {
          requireScope(actor, `${table}:read`);
          const cursor = Number(url.searchParams.get('cursor') || 0);
          const limit = Number(url.searchParams.get('limit') || 25);
          if (!Number.isInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(422, 'invalid_pagination', 'limit must be 1–100 and cursor a non-negative integer.');
          const rows = this.store.all<Record<string, unknown>>(`SELECT rowid AS cursor_id,* FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT ?`, cursor, limit + 1);
          const hasMore = rows.length > limit;
          const items = rows.slice(0, limit);
          return json({ data: items.map((row) => { const { cursor_id, checkout_token, ...item } = row; return table === 'events' ? { ...item, data: JSON.parse(String(item.data)) } : item; }), next_cursor: hasMore ? items.at(-1)?.cursor_id : null }, 200, { 'X-Request-Id': requestId });
        }
        if (method === 'POST' && table !== 'events') {
          const body = await bodyOf(request);
          const handler: () => unknown = table === 'products' ? () => this.service.createProduct(actor, body) : () => {
            const payment = this.service.createPayment(actor, body);
            const { checkout_token, ...metadata } = payment;
            return { ...metadata, checkout_url: `/checkout/${checkout_token}` };
          };
          return json(this.service.mutate(actor, table, request.headers.get('idempotency-key'), body, handler), 201, { 'X-Request-Id': requestId });
        }
      }
      if (path === '/api/v1/refunds' && method === 'POST') {
        const actor = this.service.authenticate(request);
        const body = await bodyOf(request);
        return json(this.service.mutate(actor, 'refunds', request.headers.get('idempotency-key'), body, () => this.service.createRefund(actor, body)), 201, { 'X-Request-Id': requestId });
      }
      const paymentMatch = path.match(/^\/api\/v1\/payments\/([^/]+)$/);
      if (paymentMatch && method === 'GET') {
        const actor = this.service.authenticate(request);
        requireScope(actor, 'payments:read');
        const payment = this.store.one<Payment>('SELECT * FROM payments WHERE id=?', paymentMatch[1]);
        if (!payment) throw new ApiError(404, 'not_found', 'Payment not found.');
        const { checkout_token: _checkoutToken, ...visible } = payment;
        return json(visible, 200, { 'X-Request-Id': requestId });
      }
      const checkoutMatch = path.match(/^\/api\/checkout\/([^/]+)$/);
      if (checkoutMatch && method === 'GET') {
        const payment = this.store.one<Payment>('SELECT * FROM payments WHERE checkout_token=? AND sample=0', checkoutMatch[1]);
        if (!payment) throw new ApiError(404, 'not_found', 'Checkout not found.');
        return json({ id: payment.id, product_name: payment.product_name, amount: payment.amount, status: payment.status, currency: payment.currency }, 200, { 'X-Request-Id': requestId });
      }
      if (checkoutMatch && method === 'POST') return json(this.service.simulate(checkoutMatch[1], await bodyOf(request)), 200, { 'X-Request-Id': requestId });
      throw new ApiError(404, 'not_found', 'Endpoint not found.');
    } catch (error) {
      const response = responseError(error, requestId);
      response.headers.set('X-Agora-Storage', 'durable-object-sqlite-v1');
      response.headers.set('Cache-Control', 'no-store, private');
      return response;
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/__health') {
      const id = env.AGORA_LEDGER.idFromName('owner-workspace');
      return env.AGORA_LEDGER.get(id).fetch(new Request(new URL('/__health', request.url), { method: 'GET' }));
    }
    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const id = env.AGORA_LEDGER.idFromName('owner-workspace');
    return env.AGORA_LEDGER.get(id).fetch(request);
  },
};
