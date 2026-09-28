// Run against a local server. Creates and revokes a test credential, never prints its secret.
import assert from 'node:assert/strict';
const base=process.env.AGORA_TEST_URL;
if(!base)throw new Error('Set AGORA_TEST_URL to the local server.');
const consoleCall=async(action,payload)=>{const r=await fetch(base+'/api/console',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({action,payload})});const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));return b};
const c=await consoleCall('create_key',{name:'API verification (temporary)',kind:'developer',scopes:['products:read','payments:read','payments:write','refunds:write','events:read'],max_amount:100000,refund_budget:0});
try{
 const req=async(path,method='GET',body,key)=>{const r=await fetch(base+'/api/v1/'+path,{method,headers:{Authorization:'Bearer '+c.secret,...(body?{'Content-Type':'application/json','Idempotency-Key':key}: {})},body:body?JSON.stringify(body):undefined});return{status:r.status,body:await r.json()}};
 const products=await req('products');assert.equal(products.status,200);const product=products.body.data[0];assert.ok(product);
 const op=crypto.randomUUID();const p=await req('payments','POST',{product_id:product.id,customer:'API verification'},op);assert.equal(p.status,201);const repeat=await req('payments','POST',{product_id:product.id,customer:'API verification'},op);assert.equal(repeat.body.id,p.body.id);
 const conflict=await req('payments','POST',{product_id:product.id,customer:'Changed'},op);assert.equal(conflict.status,409);
 const checkout=p.body.checkout_url.replace('/checkout/','/api/checkout/');const paid=await fetch(base+checkout,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({outcome:'succeeded'})});assert.equal(paid.status,200);
 const refund=await req('refunds','POST',{payment_id:p.body.id,amount:100,reason:'Verify approval policy'},crypto.randomUUID());assert.equal(refund.body.status,'requires_approval');await consoleCall('resolve_approval',{approval_id:refund.body.id,decision:'approve'});
 const read=await req('payments/'+p.body.id);assert.equal(read.body.refunded,100);
 const events=await req('events?limit=1');assert.equal(events.body.data.length,1);assert.ok(events.body.next_cursor);
 const unauth=await fetch(base+'/api/v1/payments');assert.equal(unauth.status,401);
 console.log('HTTP smoke passed: auth, checkout, idempotency replay/conflict, approval/refund, and cursor.');
}finally{await consoleCall('revoke_key',{key_id:c.id});console.log('Temporary key revoked.');}
