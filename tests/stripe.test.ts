import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createStripeCheckout, retrieveStripeCheckout, verifyStripeWebhook } from '../lib/server/stripe';

const checkout={amount:2500,currency:'usd' as const,productName:'Studio access',paymentId:'pay_test_1',tenantId:'owner',successUrl:'https://agora.example/checkout/complete',cancelUrl:'https://agora.example/checkout/cancel',idempotencyKey:'agora:payment:one'};

await test('Stripe Checkout is account-scoped by the merchant secret and uses provider idempotency',async()=>{
 let request:Request|undefined;
 const session=await createStripeCheckout('sk_test_example123',checkout,async(input,init)=>{request=new Request(input,init);return Response.json({id:'cs_test_1',url:'https://checkout.stripe.com/c/pay_test_1',status:'open'});});
 assert.equal(session.id,'cs_test_1');assert.equal(request?.headers.get('idempotency-key'),checkout.idempotencyKey);
 const body=new URLSearchParams(await request!.text());assert.equal(body.get('metadata[agora_tenant_id]'),'owner');assert.equal(body.get('line_items[0][price_data][unit_amount]'),'2500');
 assert.equal(request?.headers.get('authorization'),'Bearer sk_test_example123');
});

await test('Stripe network uncertainty is surfaced for same-key retry and no fake success',async()=>{
 await assert.rejects(()=>createStripeCheckout('sk_test_example123',checkout,async()=>{throw new Error('network down');}),(e:unknown)=>e instanceof Error&&'code'in e&&e.code==='provider_outcome_unknown');
});

await test('Stripe session reconciliation retrieves only the stored account-scoped session',async()=>{
 let request:Request|undefined;const session=await retrieveStripeCheckout('sk_test_example123','cs_test_123','acct_merchant123',async(input,init)=>{request=new Request(input,init);return Response.json({id:'cs_test_123',status:'complete',payment_status:'paid',amount_total:2500,currency:'usd',client_reference_id:'pay_test_1',payment_intent:'pi_test_1',livemode:false,metadata:{agora_payment_id:'pay_test_1',agora_tenant_id:'tenant_1'}});});
 assert.equal(new URL(request!.url).pathname,'/v1/checkout/sessions/cs_test_123');assert.equal(request!.headers.get('stripe-account'),'acct_merchant123');assert.equal(session.livemode,false);assert.equal(session.metadata.agora_tenant_id,'tenant_1');
 await assert.rejects(()=>retrieveStripeCheckout('sk_test_example123','cs_live_123'),(e:unknown)=>e instanceof Error&&'code'in e&&e.code==='provider_mode_mismatch');
});

await test('Stripe webhook signature requires timestamp, exact body, and event structure',()=>{
 const secret='whsec_test_example123';const timestamp=Math.floor(Date.now()/1000);const raw=JSON.stringify({id:'evt_test_1',type:'checkout.session.completed',data:{object:{id:'cs_test_1'}}});
 const digest=createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex');
 assert.equal(verifyStripeWebhook(raw,`t=${timestamp},v1=${digest}`,secret).id,'evt_test_1');
 assert.throws(()=>verifyStripeWebhook(raw+' ',`t=${timestamp},v1=${digest}`,secret),(e:unknown)=>e instanceof Error&&'code'in e&&e.code==='invalid_webhook_signature');
 assert.throws(()=>verifyStripeWebhook(raw,`t=${timestamp-400},v1=${digest}`,secret),(e:unknown)=>e instanceof Error&&'code'in e&&e.code==='invalid_webhook_signature');
});
