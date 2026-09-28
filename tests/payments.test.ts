import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
const dir=mkdtempSync(join(tmpdir(),'agora-test-'));process.env.AGORA_DATABASE_PATH=join(dir,'test.sqlite');process.env.AGORA_SEED='false';
const s=await import('../lib/server/local');const d=await import('../lib/server/db');
const write=<T>(route:string,key:string,body:unknown,fn:()=>T,actor=s.owner)=>s.mutate(actor,route,key,body,fn);
const product=write('product','p1',{},()=>s.createProduct(s.owner,{name:'Test',amount:5000}));
const payment=write('payment','pay1',{},()=>s.createPayment(s.owner,{product_id:product.id}));
function key(name:string,budget:number,permissions:string[]=s.scopes as unknown as string[]){const c=write('key',name,{},()=>s.createCredential(s.owner,{name,kind:'agent',scopes:permissions,max_amount:10000,refund_budget:budget}));return{...c,actor:s.authenticate(new Request('http://localhost',{headers:{Authorization:`Bearer ${c.secret}`}}))}}
await test('same idempotency key creates only one payment; changed payload conflicts',()=>{const replay=write('payment','pay1',{},()=>s.createPayment(s.owner,{product_id:product.id}));assert.equal(replay.id,payment.id);assert.equal(d.all('SELECT * FROM payments').length,1);assert.throws(()=>write('payment','pay1',{changed:true},()=>null),(e:unknown)=>e instanceof s.ApiError&&e.status===409)});
await test('checkout success replay journals once, conflicting outcome is rejected',()=>{s.simulate(payment.checkout_token,{outcome:'succeeded'});s.simulate(payment.checkout_token,{outcome:'succeeded'});assert.equal(d.all('SELECT * FROM journal').length,2);assert.throws(()=>s.simulate(payment.checkout_token,{outcome:'failed'}));assert.equal(d.one<{sum:number}>('SELECT SUM(amount) AS sum FROM journal')?.sum,0)});
await test('limited agent needs human approval; replay does not duplicate request',()=>{const k=key('Limited',0);const b={payment_id:payment.id,amount:1000,reason:'Customer request'};const a=write('refund','r1',b,()=>s.createRefund(k.actor,b),k.actor);const again=write('refund','r1',b,()=>s.createRefund(k.actor,b),k.actor);assert.equal(a.id,again.id);assert.equal(a.status,'requires_approval');assert.equal(d.one<{refunded:number}>('SELECT refunded FROM payments WHERE id=?',payment.id)?.refunded,0);write('approve','a1',{},()=>s.resolveApproval(s.owner,{approval_id:a.id,decision:'approve'}));assert.equal(d.one<{refunded:number}>('SELECT refunded FROM payments WHERE id=?',payment.id)?.refunded,1000);assert.throws(()=>write('approve','a2',{},()=>s.resolveApproval(s.owner,{approval_id:a.id,decision:'approve'})));});
await test('cumulative allowance cannot be exceeded by splitting refunds',()=>{const k=key('Budget',1000);const b={payment_id:payment.id,amount:600,reason:'Partial return'};assert.equal(write('refund','b1',b,()=>s.createRefund(k.actor,b),k.actor).status,'succeeded');assert.equal(write('refund','b2',b,()=>s.createRefund(k.actor,b),k.actor).status,'requires_approval');assert.equal(d.one<{spent:number}>('SELECT spent FROM credentials WHERE id=?',k.id)?.spent,600)});
await test('read-only keys and amount limits are enforced',()=>{const k=key('Reader',0,['payments:read']);assert.throws(()=>write('refund','x1',{},()=>s.createRefund(k.actor,{payment_id:payment.id,amount:1,reason:'Test'}),k.actor),(e:unknown)=>e instanceof s.ApiError&&e.status===403);const expensive=write('product','p2',{},()=>s.createProduct(s.owner,{name:'Expensive',amount:20000}));const full=key('Small limit',0);assert.throws(()=>write('payment','high',{},()=>s.createPayment(full.actor,{product_id:expensive.id}),full.actor));});
await test('revocation invalidates keys and prevents pending approval execution',()=>{const k=key('Revoke me',0);const b={payment_id:payment.id,amount:100,reason:'Return'};const a=write('refund','rev1',b,()=>s.createRefund(k.actor,b),k.actor);write('revoke','rev',{},()=>s.revokeCredential(s.owner,{key_id:k.id}));assert.throws(()=>s.authenticate(new Request('http://localhost',{headers:{Authorization:`Bearer ${k.secret}`}})));assert.throws(()=>write('approve','revapprove',{},()=>s.resolveApproval(s.owner,{approval_id:a.id,decision:'approve'})));assert.throws(()=>write('refund','rev1',b,()=>s.createRefund(k.actor,b),k.actor));});
await test('over-refunds roll back without additional journal or event effects',()=>{const before=d.all('SELECT * FROM events').length;assert.throws(()=>write('refund','too-much',{},()=>s.createRefund(s.owner,{payment_id:payment.id,amount:5000,reason:'Over refund'})));assert.equal(d.all('SELECT * FROM events').length,before);assert.equal(d.one<{sum:number}>('SELECT SUM(amount) AS sum FROM journal')?.sum,0);assert.equal(d.all('SELECT * FROM idempotency WHERE key=?','too-much').length,0)});
await test('raw card-like fields and decimal amounts are rejected',()=>{assert.throws(()=>write('product','bad',{},()=>s.createProduct(s.owner,{name:'Bad',amount:1.5})));assert.throws(()=>write('payment','pan',{},()=>s.createPayment(s.owner,{product_id:product.id,card_number:'test'})));});
await test('console rejects cross-site requests',()=>{assert.throws(()=>s.consoleAuth(new Request('http://localhost/api/console',{headers:{host:'localhost',origin:'https://attacker.example','sec-fetch-site':'cross-site'}})));});
function totp(secret:string){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,value=0;const bytes:number[]=[];for(const c of secret){value=(value<<5)|alphabet.indexOf(c);bits+=5;if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}}const counter=Math.floor(Date.now()/30000);const input=Buffer.alloc(8);input.writeBigUInt64BE(BigInt(counter));const digest=createHmac('sha1',Buffer.from(bytes)).update(input).digest();const offset=digest[digest.length-1]&15;return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}
await test('owner password requires MFA enrollment; replay and recovery-code reuse are rejected',()=>{
 const env=process.env as Record<string,string|undefined>;
 const prior={password:env.AGORA_ADMIN_PASSWORD,token:env.AGORA_ADMIN_TOKEN,nodeEnv:env.NODE_ENV,origin:env.AGORA_PUBLIC_ORIGIN,mfaKey:env.AGORA_MFA_ENCRYPTION_KEY};
 env.AGORA_ADMIN_PASSWORD='correct horse battery staple';env.AGORA_ADMIN_TOKEN='test-only-signing-secret-long-enough-for-auth';env.AGORA_PUBLIC_ORIGIN='https://agora.example';env.AGORA_MFA_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');env.AGORA_OWNER_EMAIL='owner@example.test';env.NODE_ENV='production';
 try{
  const loginRequest=new Request('https://api.example/api/auth/login',{method:'POST',headers:{host:'api.example',origin:'https://agora.example'},body:'{}'});
  const badOrigin=new Request('https://api.example/api/auth/login',{method:'POST',headers:{host:'api.example',origin:'https://attacker.example'},body:'{}'});
  assert.throws(()=>s.beginAdminLogin(badOrigin,{password:'wrong'}));
  const setup=s.beginAdminLogin(loginRequest,{password:env.AGORA_ADMIN_PASSWORD});assert.equal(setup.stage,'enroll');
  const pending=s.setMfaCookie(new Response(null),loginRequest,'pending',setup.cookie).headers.get('set-cookie')!.split(';')[0];
  const pendingRequest=new Request('https://api.example/api/auth/mfa/enroll',{method:'POST',headers:{host:'api.example',origin:'https://agora.example',cookie:pending}});
  assert.throws(()=>s.consoleAuth(pendingRequest,true));
  const enrolled=s.enrollAdminMfa(pendingRequest,{code:totp(setup.secret)});assert.equal(enrolled.recovery_codes.length,10);
  const session=s.setSessionCookie(new Response(null),loginRequest,enrolled.cookie).headers.get('set-cookie')!.split(';')[0];
  assert.equal(s.hasAdminSession(new Request('https://api.example/api/auth/session',{headers:{host:'api.example',cookie:session}})),true);
  const consoleRequest=new Request('https://api.example/api/console',{headers:{host:'api.example',cookie:session,origin:'https://agora.example'}});assert.equal(s.consoleAuth(consoleRequest).id,'console_owner');
  const second=s.beginAdminLogin(loginRequest,{password:env.AGORA_ADMIN_PASSWORD});assert.equal(second.stage,'verify');
  const verifyRequest=new Request('https://api.example/api/auth/mfa/verify',{method:'POST',headers:{host:'api.example',origin:'https://agora.example',cookie:s.setMfaCookie(new Response(null),loginRequest,'pending',second.cookie).headers.get('set-cookie')!.split(';')[0]}});
  assert.throws(()=>s.verifyAdminMfa(verifyRequest,{code:totp(setup.secret)}),(e:unknown)=>e instanceof s.ApiError&&e.code==='invalid_mfa_code');
  const recovery=enrolled.recovery_codes[0];const verified=s.verifyAdminMfa(verifyRequest,{recovery_code:recovery});assert.ok(verified.cookie.value);
  const next=s.beginAdminLogin(loginRequest,{password:env.AGORA_ADMIN_PASSWORD});const nextRequest=new Request('https://api.example/api/auth/mfa/verify',{method:'POST',headers:{host:'api.example',origin:'https://agora.example',cookie:s.setMfaCookie(new Response(null),loginRequest,'pending',next.cookie).headers.get('set-cookie')!.split(';')[0]}});
  assert.throws(()=>s.verifyAdminMfa(nextRequest,{recovery_code:recovery}),(e:unknown)=>e instanceof s.ApiError&&e.code==='invalid_mfa_code');
 }finally{
  if(prior.password===undefined)delete env.AGORA_ADMIN_PASSWORD;else env.AGORA_ADMIN_PASSWORD=prior.password;
  if(prior.token===undefined)delete env.AGORA_ADMIN_TOKEN;else env.AGORA_ADMIN_TOKEN=prior.token;
  if(prior.nodeEnv===undefined)delete env.NODE_ENV;else env.NODE_ENV=prior.nodeEnv;
  if(prior.origin===undefined)delete env.AGORA_PUBLIC_ORIGIN;else env.AGORA_PUBLIC_ORIGIN=prior.origin;
  if(prior.mfaKey===undefined)delete env.AGORA_MFA_ENCRYPTION_KEY;else env.AGORA_MFA_ENCRYPTION_KEY=prior.mfaKey;
 }
});
d.db.close();rmSync(dir,{recursive:true,force:true});
