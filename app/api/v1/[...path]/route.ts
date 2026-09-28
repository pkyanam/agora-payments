import { authenticate, ApiError, bodyOf, createPayment, createProduct, createRefund, mutate, prepareStripePayment, saveStripeSession, requireScope, requireProviderMode, requirePaymentMode, responseError, stripeAccountForTenant } from '@/lib/server/local';
import { all, one, id } from '@/lib/server/db';
import { createStripeCheckout } from '@/lib/server/stripe';
import { reconcileStripeCheckout, submitStripeRefund } from '@/lib/server/stripe-runtime';
import type { Payment } from '@/lib/types';

export const runtime='nodejs';
export const dynamic='force-dynamic';

async function handle(request:Request,{params}:{params:Promise<{path:string[]}>}){
 const requestId=id('req');
 try{
  const actor=authenticate(request);const path=(await params).path.join('/');let result:unknown;
  if(request.method==='GET'){
   const table=path==='products'?'products':path==='payments'?'payments':path==='events'?'events':null;
   if(table){
    requireScope(actor,`${table}:read`);const u=new URL(request.url);const cursor=Number(u.searchParams.get('cursor')||0);const limit=Number(u.searchParams.get('limit')||25);
    if(!Number.isInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>100)throw new ApiError(422,'invalid_pagination','limit must be 1–100 and cursor a non-negative integer.');
    let modeClause='';const queryArgs:(string|number)[]=[actor.tenant_id,cursor];if(actor.credential&&table==='payments'){const keyMode=actor.credential.provider_mode||'sandbox';modeClause=keyMode==='sandbox'?" AND provider='sandbox'":" AND provider='stripe' AND provider_mode=?";if(keyMode!=='sandbox')queryArgs.push(keyMode);}if(actor.credential&&table==='events'){const keyMode=actor.credential.provider_mode||'sandbox';const paymentMode=keyMode==='sandbox'?"p.provider='sandbox'":"p.provider='stripe' AND p.provider_mode=?";modeClause=` AND (type LIKE 'product.%' OR EXISTS(SELECT 1 FROM payments p WHERE p.tenant_id=events.tenant_id AND p.id=events.object_id AND ${paymentMode}) OR EXISTS(SELECT 1 FROM approvals a JOIN payments p ON p.id=a.payment_id AND p.tenant_id=a.tenant_id WHERE a.tenant_id=events.tenant_id AND a.id=events.object_id AND ${paymentMode}))`;if(keyMode!=='sandbox'){queryArgs.push(keyMode,keyMode);}}
    const rows=all<Record<string,unknown>>(`SELECT rowid AS cursor_id,* FROM ${table} WHERE tenant_id=? AND rowid>?${modeClause} ORDER BY rowid LIMIT ?`,...queryArgs,limit+1);const hasMore=rows.length>limit;const items=rows.slice(0,limit);
    result={data:items.map(row=>{const {cursor_id,checkout_token,tenant_id,...item}=row;return table==='events'?{...item,data:JSON.parse(String(item.data))}:item;}),next_cursor:hasMore?items.at(-1)?.cursor_id:null};
   }else if(path.startsWith('payments/')&&path.split('/').length===2){
    requireScope(actor,'payments:read');const p=one<Payment>('SELECT * FROM payments WHERE id=? AND tenant_id=?',path.split('/')[1],actor.tenant_id);if(!p)throw new ApiError(404,'not_found','Payment not found.');if(actor.credential&&(p.provider==='stripe'?p.provider_mode||'test':'sandbox')!==(actor.credential.provider_mode||'sandbox'))throw new ApiError(404,'not_found','Payment not found.');const {checkout_token,tenant_id,...payment}=p;result=payment;
   }else throw new ApiError(404,'not_found','Endpoint not found.');
  }else{
   const reconcileMatch=path.match(/^payments\/([A-Za-z0-9_-]{1,80})\/reconcile$/);
   if(reconcileMatch){const actor=authenticate(request);requireScope(actor,'payments:write');requirePaymentMode(actor,reconcileMatch[1]);result=await reconcileStripeCheckout(reconcileMatch[1],actor.tenant_id);return Response.json(result,{headers:{'X-Request-Id':requestId,'Cache-Control':'no-store'}});}
   const body=await bodyOf(request);const configuredProvider:string=process.env.AGORA_PAYMENT_PROVIDER||'sandbox';
   if(path==='payments'){
    const useStripe=configuredProvider==='stripe';
    let mode:'test'|'live'='test';let secretKey:string|undefined;let origin:string|undefined;
    let stripeAccountId:string|undefined;
    if(useStripe){const configuredMode=process.env.AGORA_STRIPE_MODE;if(configuredMode!=='test'&&configuredMode!=='live')throw new ApiError(503,'provider_not_configured','Set AGORA_STRIPE_MODE to test or live.');mode=configuredMode;requireProviderMode(actor,mode);secretKey=mode==='live'?process.env.STRIPE_LIVE_SECRET_KEY:process.env.STRIPE_TEST_SECRET_KEY;origin=process.env.AGORA_PUBLIC_ORIGIN;if(!secretKey||!secretKey.startsWith(mode==='live'?'sk_live_':'sk_test_')||!origin)throw new ApiError(503,'provider_not_configured',`Set a mode-matched ${mode} Stripe key and AGORA_PUBLIC_ORIGIN before enabling Checkout.`);if(actor.tenant_id!=='owner'){const connected=stripeAccountForTenant(actor.tenant_id,mode);if(!connected||connected.status!=='connected'||!connected.charges_enabled)throw new ApiError(409,'merchant_connection_required','This approved merchant must connect a Stripe account with charges enabled.');stripeAccountId=connected.account_id;}}else requireProviderMode(actor,'sandbox');
    const payment=mutate(actor,path,request.headers.get('idempotency-key'),body,()=>createPayment(actor,body)) as Payment&{checkout_token:string};
    if(useStripe){prepareStripePayment(payment.id,mode,actor.tenant_id,stripeAccountId||null);const session=await createStripeCheckout(secretKey!,{amount:payment.amount,currency:'usd',productName:payment.product_name,paymentId:payment.id,tenantId:actor.tenant_id,successUrl:`${origin}/checkout/complete?payment_id=${encodeURIComponent(payment.id)}&session_id={CHECKOUT_SESSION_ID}`,cancelUrl:`${origin}/checkout/cancel?payment_id=${encodeURIComponent(payment.id)}`,idempotencyKey:`agora-checkout-${payment.id}`,stripeAccountId});saveStripeSession(payment.id,session,mode,actor.tenant_id,stripeAccountId||null);const {checkout_token,...safePayment}=payment;result={...safePayment,checkout_url:`${origin}/checkout/start#${checkout_token}`,provider:'stripe',provider_mode:mode};}
    else{const {checkout_token,...safePayment}=payment;result={...safePayment,checkout_url:`/checkout/${checkout_token}`,provider:'sandbox'};}
   }else if(path==='refunds'){
    if(body&&typeof body==='object'&&typeof (body as {payment_id?:unknown}).payment_id==='string')requirePaymentMode(actor,(body as {payment_id:string}).payment_id);const initial=mutate(actor,path,request.headers.get('idempotency-key'),body,()=>createRefund(actor,body));const refund=initial as Record<string,unknown>;
    result=refund.status==='pending'&&refund.provider==='stripe'?{...refund,...await submitStripeRefund(String(refund.id),actor.tenant_id)}:initial;
   }else{
    const handlers:Record<string,()=>unknown>={products:()=>createProduct(actor,body)};const fn=handlers[path];if(!fn)throw new ApiError(404,'not_found','Endpoint not found.');if(path==='products'){const provider:string=process.env.AGORA_PAYMENT_PROVIDER||'sandbox';const mode=provider==='stripe'?process.env.AGORA_STRIPE_MODE:'sandbox';if(mode!=='sandbox'&&mode!=='test'&&mode!=='live')throw new ApiError(503,'provider_not_configured','Set AGORA_STRIPE_MODE to test or live.');requireProviderMode(actor,mode);}result=mutate(actor,path,request.headers.get('idempotency-key'),body,fn);
   }
  }
  return Response.json(result,{status:request.method==='POST'?201:200,headers:{'X-Request-Id':requestId,'Cache-Control':'no-store'}});
 }catch(error){return responseError(error,requestId);}
}
export const GET=handle;export const POST=handle;
