import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LedgerStore, SqlValue } from './store';
import { dispatchWebhookBatch, enqueueWebhookEvent } from './outgoing-webhooks';
const path = process.env.AGORA_DATABASE_PATH || resolve('.data/agora.sqlite');
mkdirSync(dirname(path), { recursive:true });
export const db = new DatabaseSync(path);
db.exec(`PRAGMA busy_timeout=15000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
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
`);
// Multiple Next build workers may initialize the same fresh SQLite file at once.
// Serialize the check-and-ALTER sequence so each worker re-reads the schema after
// acquiring the write lock instead of racing on a stale PRAGMA table_info result.
db.exec('BEGIN IMMEDIATE');
try {
for(const [table,column,definition] of [
 ['products','tenant_id',"TEXT NOT NULL DEFAULT 'owner'"],
 ['products','archived_at','TEXT'],
 ['payments','tenant_id',"TEXT NOT NULL DEFAULT 'owner'"],
 ['payments','archived_at','TEXT'],
 ['credentials','tenant_id',"TEXT NOT NULL DEFAULT 'owner'"],
 ['credentials','provider_mode',"TEXT NOT NULL DEFAULT 'sandbox'"],
 ['refunds','tenant_id',"TEXT NOT NULL DEFAULT 'owner'"],
 ['approvals','tenant_id',"TEXT NOT NULL DEFAULT 'owner'"],
 ['events','tenant_id',"TEXT NOT NULL DEFAULT 'owner'"],
 ['journal','tenant_id',"TEXT NOT NULL DEFAULT 'owner'"],
 ['payments','provider',"TEXT NOT NULL DEFAULT 'sandbox'"],
 ['payments','provider_mode','TEXT'],
 ['payments','provider_session_id','TEXT'],
 ['payments','provider_checkout_url','TEXT'],
 ['payments','provider_payment_intent','TEXT'],
 ['payments','provider_account_id','TEXT'],
 ['refunds','status',"TEXT NOT NULL DEFAULT 'succeeded'"],
 ['refunds','provider_refund_id','TEXT'],
 ['refunds','provider_mode','TEXT'],
 ['refunds','credential_id','TEXT'],
] as const){const cols=db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[];if(!cols.some(c=>c.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS tenant_email_unique ON tenants(email COLLATE NOCASE);");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS merchant_email_unique ON merchant_users(email COLLATE NOCASE);");
db.exec('COMMIT');
} catch(error) {
  db.exec('ROLLBACK');
  throw error;
}
export const now = () => new Date().toISOString();
export const id = (prefix:string) => `${prefix}_${randomUUID().replaceAll('-','').slice(0,20)}`;
export function one<T>(sql:string,...args:SQLInputValue[]):T|undefined { return db.prepare(sql).get(...args) as T|undefined; }
export function all<T>(sql:string,...args:SQLInputValue[]):T[] { return db.prepare(sql).all(...args) as T[]; }
export function run(sql:string,...args:SQLInputValue[]) { return db.prepare(sql).run(...args); }
export function transaction<T>(fn:()=>T):T { db.exec('BEGIN IMMEDIATE'); try { const value=fn(); db.exec('COMMIT'); return value; } catch(e){ db.exec('ROLLBACK'); throw e; } }
export function event(type:string,actor:string,object_id:string,data:object={},tenantId='owner') { const eventId=id('evt'); const created=now();run('INSERT INTO events(id,type,actor,object_id,data,created_at,tenant_id) VALUES(?,?,?,?,?,?,?)',eventId,type,actor,object_id,JSON.stringify(data),created,tenantId); enqueueWebhookEvent(localStore,{id:eventId,type,actor,object_id,data,tenant_id:tenantId,created_at:created}); return eventId; }
export function journal(reference:string,amount:number,account:string,tenantId='owner'){ const t=now();run('INSERT INTO journal(id,reference_id,account,amount,created_at,tenant_id) VALUES(?,?,?,?,?,?)',id('jrn'),reference,account,amount,t,tenantId);run('INSERT INTO journal(id,reference_id,account,amount,created_at,tenant_id) VALUES(?,?,?,?,?,?)',id('jrn'),reference,'merchant_proceeds',-amount,t,tenantId); }
run("INSERT OR IGNORE INTO tenants(id,business_name,email,status,provider,created_at,approved_at) VALUES('owner',?,?,'approved','stripe',?,?)",process.env.AGORA_WORKSPACE_NAME||'Agora workspace',process.env.AGORA_OWNER_EMAIL||'owner@localhost',now(),now());
let webhookTimer:ReturnType<typeof setInterval>|undefined;
function scheduleWebhookAlarm(){
  if(process.env.AGORA_DEPLOYMENT_TARGET!=='node'||process.env.AGORA_DEPLOYMENT_TYPE!=='community'||process.env.VERCEL==='1'||process.env.VERCEL_ENV)return;
  if(webhookTimer)return;
  webhookTimer=setInterval(()=>{void dispatchWebhookBatch(localStore).catch(()=>{});},5000);
  webhookTimer.unref?.();
}
export const localStore:LedgerStore={one:<T>(sql:string,...args:SqlValue[])=>one<T>(sql,...args as SQLInputValue[]),all:<T>(sql:string,...args:SqlValue[])=>all<T>(sql,...args as SQLInputValue[]),run:(sql:string,...args:SqlValue[])=>run(sql,...args as SQLInputValue[]),transaction,id,now,event,journal,scheduleWebhookAlarm};
scheduleWebhookAlarm();
if (!one('SELECT id FROM products LIMIT 1') && (process.env.AGORA_SEED === 'true' || (process.env.NODE_ENV !== 'production' && process.env.AGORA_SEED !== 'false'))) transaction(()=>{
 const date=new Date();const time=(days:number)=>new Date(date.getTime()-days*86400000).toISOString();
 run('INSERT INTO products(id,name,description,amount,currency,created_at) VALUES(?,?,?,?,?,?)','prod_studio','Studio license','A permanent home for your best work.',4900,'usd',time(25));
 run('INSERT INTO products(id,name,description,amount,currency,created_at) VALUES(?,?,?,?,?,?)','prod_api','API credits','10,000 requests. Build something useful.',2500,'usd',time(25));
 run('INSERT INTO products(id,name,description,amount,currency,created_at) VALUES(?,?,?,?,?,?)','prod_session','Strategy session','One focused hour, together.',15000,'usd',time(25));
 const people=['Olivia Rhye','Phoenix Baker','Lana Steiner','Demi Wilkinson','Drew Cano','Natali Craig','Orlando Diggs','Andi Lane'];
 for(let i=0;i<28;i++){const prod=i%4===0?'prod_session':i%3===0?'prod_api':'prod_studio';const p=one<{name:string;amount:number}>('SELECT * FROM products WHERE id=?',prod)!;const pid=id('pay');const succeeded=i!==7 && i!==14;run('INSERT INTO payments(id,product_id,product_name,customer,amount,refunded,currency,status,actor,created_at,checkout_token,sample) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',pid,prod,p.name,people[i%8]+' · example',p.amount,0,'usd',succeeded?'succeeded':'failed',i%3===0?'Studio agent':'You',time(i),id('demo'),1);if(succeeded)journal(pid,p.amount,'processor_receivable');}
 event('workspace.created','You','workspace_demo',{mode:'sandbox',sample_data:true});
});
