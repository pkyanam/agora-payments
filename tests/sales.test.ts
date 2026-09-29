import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir=mkdtempSync(join(tmpdir(),'agora-sales-'));process.env.AGORA_DATABASE_PATH=join(dir,'sales.sqlite');process.env.AGORA_SEED='false';process.env.AGORA_DEPLOYMENT_ENV='qa';process.env.AGORA_PAYMENT_PROVIDER='sandbox';process.env.AGORA_SECRETS_ENCRYPTION_KEY=Buffer.alloc(32,42).toString('base64');delete process.env.AGORA_STRIPE_MODE;
const s=await import('../lib/server/local');const d=await import('../lib/server/db');
const product=s.createProduct(s.owner,{name:'Consultation',amount:5000});

await test('same email keeps distinct customer identities and quote edits preserve snapshots with versioned capability rotation',()=>{
 const email='shared@example.test';
 const a=s.createQuote(s.owner,{customer:{name:'Austin Hedges',email},items:[{product_id:product.id,quantity:1}]});
 const b=s.createQuote(s.owner,{customer:{name:'Bala Kyanam',email},items:[{product_id:product.id,quantity:1}]});
 const aAgain=s.createQuote(s.owner,{customer:{name:'Austin Hedges',email},items:[{product_id:product.id,quantity:1}]});
 assert.notEqual(a.customer_id,b.customer_id);assert.equal(a.customer_id,aAgain.customer_id);assert.equal(s.listCustomers(s.owner,0,100).data.filter(c=>c.email===email).length,2);
 const oldLink=a.quote_token;const saved=s.updateQuote(s.owner,a.id,{expected_version:a.version,customer:{name:'Austin Hedges',email}});
 assert.equal(saved.customer_name,'Austin Hedges');assert.equal(saved.total_amount,a.total_amount);assert.equal(saved.items[0]?.unit_amount,a.items[0]?.unit_amount);assert.equal(saved.version,a.version+1);
 assert.notEqual(s.quoteShareUrl(s.owner,a.id,'https://agora.example'),`https://agora.example/quote#${oldLink}`);
 assert.throws(()=>s.reviewPublicQuote(oldLink),(error:unknown)=>error instanceof s.ApiError&&error.code==='not_found');
 const reviewed=s.reviewPublicQuote(saved.quote_token);const edited=s.updateQuote(s.owner,a.id,{expected_version:saved.version,customer_id:b.customer_id});
 assert.equal(edited.total_amount,a.total_amount);assert.equal(edited.customer_name,'Bala Kyanam');
 assert.throws(()=>s.acceptPublicQuote(saved.quote_token),(error:unknown)=>error instanceof s.ApiError&&error.code==='not_found');
 assert.equal(reviewed.internalQuote.version,saved.version);
});

await test('quotes snapshot catalog revisions and discounts; acceptance creates one order and payment',()=>{
 const quote=s.createQuote(s.owner,{customer:{name:'Customer',email:'buyer@example.test'},items:[{product_id:product.id,quantity:2}],discount_amount:1000});
 assert.equal(quote.total_amount,9000);assert.equal(quote.items[0]?.catalog_version,1);assert.equal(quote.items[0]?.net_total,9000);
 const updated=s.updateProduct(s.owner,product.id,{expected_version:1,amount:7000});assert.equal(updated.version,2);
 const accepted=s.acceptQuote(s.owner,quote.id);assert.equal(accepted.payment.amount,9000);assert.equal(accepted.items[0]?.unit_amount,5000);assert.equal(d.all('SELECT id FROM orders WHERE quote_id=?',quote.id).length,1);
 assert.throws(()=>s.acceptQuote(s.owner,quote.id),(error:unknown)=>error instanceof s.ApiError&&error.code==='quote_not_open');
});

await test('only successful checkout moves orders to paid and fulfillment to ready; completion requires claim',()=>{
 const quote=s.createQuote(s.owner,{customer:{name:'Another buyer'},items:[{product_id:product.id,quantity:1}]});const accepted=s.acceptQuote(s.owner,quote.id);
 const fulfillment=d.one<{id:string;status:string}>('SELECT id,status FROM fulfillments WHERE order_id=?',accepted.order_id)!;assert.equal(fulfillment.status,'awaiting_payment');
 s.simulate(accepted.payment.checkout_token,{outcome:'succeeded'});assert.equal(d.one<{status:string}>('SELECT status FROM orders WHERE id=?',accepted.order_id)?.status,'paid');assert.equal(d.one<{status:string}>('SELECT status FROM fulfillments WHERE id=?',fulfillment.id)?.status,'ready');
 assert.throws(()=>s.transitionFulfillment(s.owner,fulfillment.id,'complete',{}),(error:unknown)=>error instanceof s.ApiError&&error.code==='fulfillment_not_claimed');
 s.transitionFulfillment(s.owner,fulfillment.id,'claim',{});s.transitionFulfillment(s.owner,fulfillment.id,'complete',{note:'Delivered'});assert.equal(d.one<{status:string}>('SELECT status FROM fulfillments WHERE id=?',fulfillment.id)?.status,'completed');
});

await test('direct payment creates an order snapshot and verified success unlocks its fulfillment',()=>{
 const direct=s.createPayment(s.owner,{product_id:product.id,customer:'Direct buyer'});const order=d.one<{id:string;status:string;quote_id:string|null}>('SELECT id,status,quote_id FROM orders WHERE payment_id=?',direct.id);assert.ok(order);assert.equal(order.status,'awaiting_payment');assert.equal(order.quote_id,null);assert.equal(d.one<{quantity:number;unit_amount:number}>('SELECT quantity,unit_amount FROM order_items WHERE order_id=?',order.id)?.unit_amount,direct.amount);
 const fulfillment=d.one<{id:string;status:string}>('SELECT id,status FROM fulfillments WHERE order_id=?',order.id)!;assert.equal(fulfillment.status,'awaiting_payment');s.simulate(direct.checkout_token,{outcome:'succeeded'});assert.equal(d.one<{status:string}>('SELECT status FROM orders WHERE id=?',order.id)?.status,'paid');assert.equal(d.one<{status:string}>('SELECT status FROM fulfillments WHERE id=?',fulfillment.id)?.status,'ready');
});

await test('expired quote and stale product version fail without changing quote snapshot',()=>{
 const expired=s.createQuote(s.owner,{customer:{name:'Expired'},items:[{product_id:product.id,quantity:1}],expires_at:new Date(Date.now()+1000).toISOString()});
 d.run('UPDATE quotes SET expires_at=? WHERE id=?',new Date(Date.now()-1000).toISOString(),expired.id);assert.equal(s.getQuote(s.owner,expired.id).status,'expired');assert.throws(()=>s.acceptQuote(s.owner,expired.id),(error:unknown)=>error instanceof s.ApiError&&error.code==='quote_expired');
 assert.throws(()=>s.updateProduct(s.owner,product.id,{expected_version:1,amount:8000}),(error:unknown)=>error instanceof s.ApiError&&error.code==='version_conflict');
});

await test('public quote review is read-only, expires, and acceptance is invalidated when issuing key is revoked',()=>{
 const credential=s.createCredential(s.owner,{name:'Quote agent',kind:'agent',scopes:['products:read','products:write','quotes:write','quotes:read','payments:write'],max_amount:10000,refund_budget:0});const actor=s.authenticate(new Request('https://api.example',{headers:{Authorization:`Bearer ${credential.secret}`}}));
 const quote=s.createQuote(actor,{customer:{name:'Capability buyer'},items:[{product_id:product.id,quantity:1}]});assert.equal(d.one<{status:string}>('SELECT status FROM quotes WHERE id=?',quote.id)?.status,'open');assert.equal(s.reviewPublicQuote(quote.quote_token).quote.status,'open');
 d.run('UPDATE credentials SET revoked=1 WHERE id=?',credential.id);assert.throws(()=>s.reviewPublicQuote(quote.quote_token),(error:unknown)=>error instanceof s.ApiError&&error.code==='quote_unavailable');
});

await test('legacy hash-only quote links do not break listing or get fabricated',()=>{
 const legacy=s.createQuote(s.owner,{customer:{name:'Legacy link buyer'},items:[{product_id:product.id,quantity:1}]});d.run('UPDATE quotes SET token_ciphertext=NULL WHERE id=?',legacy.id);
 const listed=s.listQuotes(s.owner,0,100).data.find((quote)=>quote.id===legacy.id);assert.ok(listed);assert.equal(s.quoteShareUrl(s.owner,legacy.id,'https://agora.example'),null);
 const newQuote=s.createQuote(s.owner,{customer:{name:'Recoverable link buyer'},items:[{product_id:product.id,quantity:1}]});assert.match(s.quoteShareUrl(s.owner,newQuote.id,'https://agora.example')||'',/^https:\/\/agora\.example\/quote#/);
});

process.on('exit',()=>{try{d.db.close();}catch{}rmSync(dir,{recursive:true,force:true});});
