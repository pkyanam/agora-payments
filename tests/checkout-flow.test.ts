import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir=mkdtempSync(join(tmpdir(),'agora-checkout-test-'));
const env=process.env as Record<string,string|undefined>;env.AGORA_DATABASE_PATH=join(dir,'checkout.sqlite');env.AGORA_SEED='false';env.NODE_ENV='production';
const s=await import('../lib/server/local');const d=await import('../lib/server/db');
const prepare=await import('../app/api/checkout/prepare/route');const statusRoute=await import('../app/api/checkout/status/[paymentId]/route');

await test('Stripe payer wrapper exchanges fragment capability for a scoped cookie, never URL/body token',async()=>{
 const product=s.createProduct(s.owner,{name:'Checkout test',amount:900});const payment=s.createPayment(s.owner,{product_id:product.id});s.prepareStripePayment(payment.id,'test');s.saveStripeSession(payment.id,{id:'cs_test_wrapper',url:'https://checkout.stripe.com/c/pay_example',payment_intent:'pi_test_wrapper',status:'open'},'test');
 const request=new Request('https://agora.example/api/checkout/prepare',{method:'POST',headers:{'X-Agora-Checkout-Token':payment.checkout_token}});const response=await prepare.POST(request);assert.equal(response.status,200);assert.deepEqual(await response.json(),{checkout_url:'https://checkout.stripe.com/c/pay_example'});
 const cookie=response.headers.get('set-cookie')!;assert.match(cookie,new RegExp(`agora_checkout_status_${payment.id}=${payment.checkout_token}`));assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Lax/);assert.match(cookie,new RegExp(`Path=/api/checkout/status/${payment.id}`));
 const statusRequest=new Request(`https://agora.example/api/checkout/status/${payment.id}?session_id=cs_test_wrapper`,{headers:{cookie:cookie.split(';',1)[0]}});const status=await statusRoute.GET(statusRequest,{params:Promise.resolve({paymentId:payment.id})});assert.equal(status.status,200);assert.deepEqual(await status.json(),{id:payment.id,product_name:'Checkout test',amount:900,currency:'usd',status:'pending',provider:'stripe',provider_mode:'test'});
 const mismatch=new Request(`https://agora.example/api/checkout/status/${payment.id}?session_id=cs_test_other`,{headers:{cookie:cookie.split(';',1)[0]}});assert.equal((await statusRoute.GET(mismatch,{params:Promise.resolve({paymentId:payment.id})})).status,404);
 const leaked=JSON.stringify(await (await prepare.POST(new Request('https://agora.example/api/checkout/prepare',{method:'POST',headers:{'X-Agora-Checkout-Token':'not-a-token'}}))).json());assert.equal(leaked.includes(payment.checkout_token),false);
});

process.once('beforeExit',()=>rmSync(dir,{recursive:true,force:true}));
