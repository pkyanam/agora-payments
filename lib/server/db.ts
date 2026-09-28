import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LedgerStore, SqlValue } from './store';
const path = process.env.AGORA_DATABASE_PATH || resolve('.data/agora.sqlite');
mkdirSync(dirname(path), { recursive:true });
export const db = new DatabaseSync(path);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
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
`);
for(const [table,column,definition] of [
 ['products','tenant_id',"TEXT NOT NULL DEFAULT 'owner'"],
 ['payments','tenant_id',"TEXT NOT NULL DEFAULT 'owner'"],
 ['credentials','tenant_id',"TEXT NOT NULL DEFAULT 'owner'"],
 ['refunds','tenant_id',"TEXT NOT NULL DEFAULT 'owner'"],
 ['approvals','tenant_id',"TEXT NOT NULL DEFAULT 'owner'"],
 ['events','tenant_id',"TEXT NOT NULL DEFAULT 'owner'"],
 ['journal','tenant_id',"TEXT NOT NULL DEFAULT 'owner'"],
] as const){const cols=db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[];if(!cols.some(c=>c.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS tenant_email_unique ON tenants(email COLLATE NOCASE);");
export const now = () => new Date().toISOString();
export const id = (prefix:string) => `${prefix}_${randomUUID().replaceAll('-','').slice(0,20)}`;
export function one<T>(sql:string,...args:SQLInputValue[]):T|undefined { return db.prepare(sql).get(...args) as T|undefined; }
export function all<T>(sql:string,...args:SQLInputValue[]):T[] { return db.prepare(sql).all(...args) as T[]; }
export function run(sql:string,...args:SQLInputValue[]) { return db.prepare(sql).run(...args); }
export function transaction<T>(fn:()=>T):T { db.exec('BEGIN IMMEDIATE'); try { const value=fn(); db.exec('COMMIT'); return value; } catch(e){ db.exec('ROLLBACK'); throw e; } }
export function event(type:string,actor:string,object_id:string,data:object={},tenantId='owner') { const eventId=id('evt'); run('INSERT INTO events(id,type,actor,object_id,data,created_at,tenant_id) VALUES(?,?,?,?,?,?,?)',eventId,type,actor,object_id,JSON.stringify(data),now(),tenantId); return eventId; }
export function journal(reference:string,amount:number,account:string,tenantId='owner'){ const t=now();run('INSERT INTO journal(id,reference_id,account,amount,created_at,tenant_id) VALUES(?,?,?,?,?,?)',id('jrn'),reference,account,amount,t,tenantId);run('INSERT INTO journal(id,reference_id,account,amount,created_at,tenant_id) VALUES(?,?,?,?,?,?)',id('jrn'),reference,'merchant_proceeds',-amount,t,tenantId); }
run("INSERT OR IGNORE INTO tenants(id,business_name,email,status,provider,created_at,approved_at) VALUES('owner','Belweave','info@belweave.com','approved','sandbox',?,?)",now(),now());
export const localStore:LedgerStore={one:<T>(sql:string,...args:SqlValue[])=>one<T>(sql,...args as SQLInputValue[]),all:<T>(sql:string,...args:SqlValue[])=>all<T>(sql,...args as SQLInputValue[]),run:(sql:string,...args:SqlValue[])=>run(sql,...args as SQLInputValue[]),transaction,id,now,event,journal};
if (!one('SELECT id FROM products LIMIT 1') && process.env.AGORA_SEED !== 'false') transaction(()=>{
 const date=new Date();const time=(days:number)=>new Date(date.getTime()-days*86400000).toISOString();
 run('INSERT INTO products(id,name,description,amount,currency,created_at) VALUES(?,?,?,?,?,?)','prod_studio','Studio license','A permanent home for your best work.',4900,'usd',time(25));
 run('INSERT INTO products(id,name,description,amount,currency,created_at) VALUES(?,?,?,?,?,?)','prod_api','API credits','10,000 requests. Build something useful.',2500,'usd',time(25));
 run('INSERT INTO products(id,name,description,amount,currency,created_at) VALUES(?,?,?,?,?,?)','prod_session','Strategy session','One focused hour, together.',15000,'usd',time(25));
 const people=['Olivia Rhye','Phoenix Baker','Lana Steiner','Demi Wilkinson','Drew Cano','Natali Craig','Orlando Diggs','Andi Lane'];
 for(let i=0;i<28;i++){const prod=i%4===0?'prod_session':i%3===0?'prod_api':'prod_studio';const p=one<{name:string;amount:number}>('SELECT * FROM products WHERE id=?',prod)!;const pid=id('pay');const succeeded=i!==7 && i!==14;run('INSERT INTO payments(id,product_id,product_name,customer,amount,refunded,currency,status,actor,created_at,checkout_token,sample) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',pid,prod,p.name,people[i%8]+' · example',p.amount,0,'usd',succeeded?'succeeded':'failed',i%3===0?'Studio agent':'You',time(i),id('demo'),1);if(succeeded)journal(pid,p.amount,'processor_receivable');}
 event('workspace.created','You','workspace_demo',{mode:'sandbox',sample_data:true});
});
