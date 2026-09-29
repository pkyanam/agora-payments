import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors';

export type StripeCheckoutInput={
 amount:number;
 currency:'usd';
 productName:string;
 lineItems?:{name:string;amount:number}[];
 paymentId:string;
 tenantId:string;
 successUrl:string;
 cancelUrl:string;
 idempotencyKey:string;
 stripeAccountId?:string;
};
export type StripeCheckout={id:string;url:string;payment_intent:string|null;status:string};
export type StripeCheckoutStatus={id:string;status:'open'|'complete'|'expired';payment_status:'paid'|'unpaid'|'no_payment_required';amount_total:number;currency:string;client_reference_id:string|null;payment_intent:string|null;livemode:boolean;metadata:Record<string,string>};
export type StripeRefund={id:string;status:'pending'|'succeeded'|'failed'|'canceled'};

function stripeError(status:number,code:string,message:string){return new ApiError(status,code,message);}
export function stripeApiKeyMatchesMode(key:string|undefined,mode:'test'|'live'){return typeof key==='string'&&new RegExp(`^(?:sk|rk)_${mode}_[A-Za-z0-9]+$`).test(key);}
export function stripeSecretKeyMatchesMode(key:string|undefined,mode:'test'|'live'){return typeof key==='string'&&new RegExp(`^sk_${mode}_[A-Za-z0-9]+$`).test(key);}

/** Credential check only: reads the connected Stripe account and never creates a charge. */
export async function testStripeApiKey(secretKey:string, mode:'test'|'live', fetcher:typeof fetch=fetch) {
 if(!stripeApiKeyMatchesMode(secretKey,mode))throw stripeError(422,'stripe_key_mode_mismatch',`The configured key is not a Stripe ${mode} key.`);
 let response:Response;
 try{response=await fetcher('https://api.stripe.com/v1/account',{headers:{Authorization:`Bearer ${secretKey}`},signal:AbortSignal.timeout(15_000)});}
 catch{throw stripeError(503,'provider_unreachable','Could not reach Stripe. Check network access and retry.');}
 const value=await response.json().catch(()=>null) as {id?:unknown}|null;
 if(!response.ok){if(response.status===401)throw stripeError(422,'stripe_key_rejected','Stripe rejected this API key. Check that it is active and copied correctly.');if(response.status===403)throw stripeError(422,'stripe_key_permission_denied','This Stripe key needs permission to read the account.');throw stripeError(502,'stripe_account_check_failed','Stripe could not verify this account right now.');}
 // /v1/account does not consistently include a `livemode` property. The API key
 // prefix above is the mode signal; this request verifies that Stripe accepts it.
 if(typeof value?.id!=='string')throw stripeError(502,'stripe_account_check_failed','Stripe did not return a valid account.');
 return {account_id:value.id,mode};
}

/** Creates a hosted Checkout Session on the exact merchant account represented by the supplied secret key. */
export async function createStripeCheckout(secretKey:string,input:StripeCheckoutInput,fetcher:typeof fetch=fetch):Promise<StripeCheckout>{
 if(!/^(?:sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(secretKey))throw stripeError(503,'provider_not_configured','A mode-matched Stripe API key is not configured.');
 if(!Number.isSafeInteger(input.amount)||input.amount<1||input.amount>10_000_000)throw stripeError(422,'invalid_amount','The payment amount is outside the supported range.');
 const lineItems=input.lineItems?.length?input.lineItems:[{name:input.productName,amount:input.amount}];
 if(lineItems.some(item=>!item.name.trim()||!Number.isSafeInteger(item.amount)||item.amount<1)||lineItems.reduce((sum,item)=>sum+item.amount,0)!==input.amount)throw stripeError(422,'invalid_line_items','Checkout line items must be positive and add up to the payment total.');
 const fields=new URLSearchParams({
  mode:'payment',
  'payment_method_types[0]':'card',
  success_url:input.successUrl,
  cancel_url:input.cancelUrl,
  client_reference_id:input.paymentId,
  'metadata[agora_payment_id]':input.paymentId,
  'metadata[agora_tenant_id]':input.tenantId,
  'payment_intent_data[metadata][agora_payment_id]':input.paymentId,
  'payment_intent_data[metadata][agora_tenant_id]':input.tenantId,
 });
 lineItems.forEach((item,index)=>{fields.set(`line_items[${index}][price_data][currency]`,input.currency);fields.set(`line_items[${index}][price_data][unit_amount]`,String(item.amount));fields.set(`line_items[${index}][price_data][product_data][name]`,item.name.slice(0,120));fields.set(`line_items[${index}][quantity]`,'1');});
 let response:Response;
 const headers:Record<string,string>={Authorization:`Bearer ${secretKey}`,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':input.idempotencyKey};if(input.stripeAccountId)headers['Stripe-Account']=input.stripeAccountId;
 try{response=await fetcher('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers,body:fields,signal:AbortSignal.timeout(15_000)});}
 catch{throw stripeError(503,'provider_outcome_unknown','Stripe did not return a response. Retry this exact payment with the same idempotency key before creating another.');}
 const value=await response.json().catch(()=>null) as {id?:unknown;url?:unknown;payment_intent?:unknown;status?:unknown;error?:{type?:string;code?:string}}|null;
 if(!response.ok){
  if(response.status===403)throw stripeError(403,'provider_permission_denied','The Stripe API key lacks permission for Checkout Sessions. Grant the required restricted-key scope.');
  if(response.status===401)throw stripeError(503,'provider_authentication_failed','Stripe rejected the configured API key. Verify its mode and validity.');
  if(response.status>=500)throw stripeError(503,'provider_outcome_unknown','Stripe could not confirm whether it created Checkout. Retry this exact request with the same idempotency key.');
  const code=value?.error?.code==='idempotency_key_in_use'?'provider_request_in_progress':'provider_rejected';
  throw stripeError(502,code,'Stripe rejected the Checkout request. Verify the merchant account and payment configuration.');
 }
 if(typeof value?.id!=='string'||typeof value.url!=='string'||!value.url.startsWith('https://'))throw stripeError(502,'provider_invalid_response','Stripe returned an invalid Checkout response.');
 return{id:value.id,url:value.url,payment_intent:typeof value.payment_intent==='string'?value.payment_intent:null,status:typeof value.status==='string'?value.status:'open'};
}

export async function createStripeRefund(secretKey:string,input:{paymentIntent:string;amount:number;refundId:string;idempotencyKey:string;stripeAccountId?:string},fetcher:typeof fetch=fetch):Promise<StripeRefund>{
 if(!/^(?:sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(secretKey))throw stripeError(503,'provider_not_configured','A mode-matched Stripe API key is not configured.');
 if(!input.paymentIntent||!Number.isSafeInteger(input.amount)||input.amount<1)throw stripeError(422,'invalid_refund','The Stripe payment intent or refund amount is invalid.');
 const fields=new URLSearchParams({payment_intent:input.paymentIntent,amount:String(input.amount),'metadata[agora_refund_id]':input.refundId});
 let response:Response;
 const headers:Record<string,string>={Authorization:`Bearer ${secretKey}`,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':input.idempotencyKey};if(input.stripeAccountId)headers['Stripe-Account']=input.stripeAccountId;
 try{response=await fetcher('https://api.stripe.com/v1/refunds',{method:'POST',headers,body:fields,signal:AbortSignal.timeout(15_000)});}
 catch{throw stripeError(503,'provider_outcome_unknown','Stripe did not return a refund response. Retry this exact refund with the same idempotency key.');}
 const value=await response.json().catch(()=>null) as {id?:unknown;status?:unknown}|null;
 if(!response.ok){if(response.status===403)throw stripeError(403,'provider_permission_denied','The Stripe API key lacks permission to create refunds. Grant the required restricted-key scope.');if(response.status===401)throw stripeError(503,'provider_authentication_failed','Stripe rejected the configured API key. Verify its mode and validity.');if(response.status>=500)throw stripeError(503,'provider_outcome_unknown','Stripe could not confirm whether it created the refund. Retry this exact refund with the same idempotency key.');throw stripeError(502,'provider_rejected','Stripe rejected the refund request. Verify the payment and merchant account.');}
 if(typeof value?.id!=='string'||!['pending','succeeded','failed','canceled'].includes(String(value.status)))throw stripeError(502,'provider_invalid_response','Stripe returned an invalid refund response.');
 return{id:value.id,status:value.status as StripeRefund['status']};
}

/** Retrieve an existing Checkout Session for reconciliation after a missed webhook. */
export async function retrieveStripeCheckout(secretKey:string,sessionId:string,stripeAccountId?:string,fetcher:typeof fetch=fetch):Promise<StripeCheckoutStatus>{
 const keyMode=secretKey.match(/^(?:sk|rk)_(test|live)_[A-Za-z0-9]+$/)?.[1];const sessionMode=sessionId.match(/^cs_(test|live)_[A-Za-z0-9]+$/)?.[1];if(!keyMode||!sessionMode)throw stripeError(503,'provider_not_configured','The stored Stripe Checkout session is invalid or unavailable.');if(keyMode!==sessionMode)throw stripeError(409,'provider_mode_mismatch','Stripe key and Checkout session modes do not match.');
 const headers:Record<string,string>={Authorization:`Bearer ${secretKey}`};if(stripeAccountId)headers['Stripe-Account']=stripeAccountId;
 let response:Response;try{response=await fetcher(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,{headers,signal:AbortSignal.timeout(15_000)});}catch{throw stripeError(503,'provider_outcome_unknown','Stripe did not return a Checkout status. Retry reconciliation later.');}
 const value=await response.json().catch(()=>null) as Record<string,unknown>|null;
 if(!response.ok){if(response.status===403)throw stripeError(403,'provider_permission_denied','The Stripe API key lacks read permission for Checkout Sessions. Grant the required restricted-key scope.');if(response.status===401)throw stripeError(503,'provider_authentication_failed','Stripe rejected the configured API key. Verify its mode and validity.');if(response.status>=500)throw stripeError(503,'provider_outcome_unknown','Stripe could not confirm the Checkout status. Retry reconciliation later.');throw stripeError(502,'provider_reconcile_failed','Stripe could not retrieve this Checkout session.');}
 if(value?.id!==sessionId||!['open','complete','expired'].includes(String(value.status))||!['paid','unpaid','no_payment_required'].includes(String(value.payment_status))||!Number.isSafeInteger(value.amount_total)||typeof value.currency!=='string'||typeof value.livemode!=='boolean')throw stripeError(502,'provider_invalid_response','Stripe returned an invalid Checkout status.');
 const metadata=value.metadata&&typeof value.metadata==='object'?value.metadata as Record<string,unknown>:{};const safeMetadata:Record<string,string>={};for(const [k,v] of Object.entries(metadata))if(typeof v==='string')safeMetadata[k]=v;
 return{id:sessionId,status:value.status as StripeCheckoutStatus['status'],payment_status:value.payment_status as StripeCheckoutStatus['payment_status'],amount_total:value.amount_total as number,currency:value.currency,client_reference_id:typeof value.client_reference_id==='string'?value.client_reference_id:null,payment_intent:typeof value.payment_intent==='string'?value.payment_intent:null,livemode:value.livemode,metadata:safeMetadata};
}

export type StripeEvent={id:string;type:string;account?:string;livemode?:boolean;data:{object:Record<string,unknown>}};

export type StripeAccountStatus={
 id:string;
 charges_enabled:boolean;
 payouts_enabled:boolean;
 details_submitted:boolean;
 capabilities:Record<string,string>;
};

/** Exchange a one-time Standard-account OAuth code, then discard the access token. */
export async function exchangeStripeOAuthCode(secretKey:string,clientId:string,code:string,fetcher:typeof fetch=fetch):Promise<{accountId:string;livemode:boolean}>{
 if(!/^sk_(test|live)_[A-Za-z0-9]+$/.test(secretKey)||!/^ca_[A-Za-z0-9]+$/.test(clientId)||!code||code.length>2048)throw stripeError(503,'provider_not_configured','Stripe Connect OAuth is not configured for this mode.');
 const fields=new URLSearchParams({client_id:clientId,code,grant_type:'authorization_code'});
 let response:Response;
 try{response=await fetcher('https://connect.stripe.com/oauth/token',{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:fields,signal:AbortSignal.timeout(15_000)});}
 catch{throw stripeError(503,'provider_outcome_unknown','Stripe did not return an OAuth response. Start a new connection attempt.');}
 const value=await response.json().catch(()=>null) as {stripe_user_id?:unknown;livemode?:unknown;error?:unknown}|null;
 if(!response.ok||typeof value?.stripe_user_id!=='string'||typeof value.livemode!=='boolean')throw stripeError(502,'provider_oauth_rejected','Stripe did not authorize this account connection. Start a new connection attempt.');
 return{accountId:value.stripe_user_id,livemode:value.livemode};
}

/** Read capabilities through the platform key scoped to the account; no access token is retained. */
export async function getStripeConnectedAccount(secretKey:string,accountId:string,fetcher:typeof fetch=fetch):Promise<StripeAccountStatus>{
 if(!/^sk_(test|live)_[A-Za-z0-9]+$/.test(secretKey)||!/^acct_[A-Za-z0-9]+$/.test(accountId))throw stripeError(503,'provider_not_configured','Stripe account verification is not configured.');
 let response:Response;
 try{response=await fetcher('https://api.stripe.com/v1/account',{headers:{Authorization:`Bearer ${secretKey}`,'Stripe-Account':accountId},signal:AbortSignal.timeout(15_000)});}
 catch{throw stripeError(503,'provider_outcome_unknown','Stripe did not return account verification. Start a new connection attempt.');}
 const value=await response.json().catch(()=>null) as {id?:unknown;charges_enabled?:unknown;payouts_enabled?:unknown;details_submitted?:unknown;capabilities?:unknown}|null;
 if(!response.ok||value?.id!==accountId||typeof value.charges_enabled!=='boolean'||typeof value.payouts_enabled!=='boolean'||typeof value.details_submitted!=='boolean')throw stripeError(502,'provider_account_unverified','Stripe could not verify the connected account capabilities.');
 const capabilities=value.capabilities&&typeof value.capabilities==='object'?value.capabilities as Record<string,unknown>:{};
 const safeCapabilities:Record<string,string>={};for(const [key,status] of Object.entries(capabilities))if(typeof status==='string')safeCapabilities[key]=status;
 return{id:accountId,charges_enabled:value.charges_enabled,payouts_enabled:value.payouts_enabled,details_submitted:value.details_submitted,capabilities:safeCapabilities};
}

export async function deauthorizeStripeAccount(secretKey:string,clientId:string,accountId:string,fetcher:typeof fetch=fetch):Promise<void>{
 if(!/^sk_(test|live)_[A-Za-z0-9]+$/.test(secretKey)||!/^ca_[A-Za-z0-9]+$/.test(clientId)||!/^acct_[A-Za-z0-9]+$/.test(accountId))throw stripeError(503,'provider_not_configured','Stripe Connect disconnection is not configured.');
 const fields=new URLSearchParams({client_id:clientId,stripe_user_id:accountId});
 let response:Response;try{response=await fetcher('https://connect.stripe.com/oauth/deauthorize',{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:fields,signal:AbortSignal.timeout(15_000)});}catch{throw stripeError(503,'provider_outcome_unknown','Stripe did not confirm account disconnection. Retry disconnect before issuing new keys.');}
 if(!response.ok)throw stripeError(502,'provider_disconnect_rejected','Stripe did not confirm account disconnection.');
}
/** Verifies Stripe's v1 signature with timestamp tolerance before parsing an event. */
export function verifyStripeWebhook(rawBody:string,signatureHeader:string,webhookSecret:string,nowMs=Date.now(),toleranceSeconds=300):StripeEvent{
 if(!webhookSecret.startsWith('whsec_'))throw stripeError(503,'webhook_not_configured','The Stripe webhook signing secret is not configured.');
 const parts=signatureHeader.split(',').map(v=>v.split('=',2));
 const timestamp=parts.find(([k])=>k==='t')?.[1];
 const signatures=parts.filter(([k])=>k==='v1').map(([,v])=>v).filter((v):v is string=>Boolean(v));
 if(!timestamp||!/^\d+$/.test(timestamp)||!signatures.length||Math.abs(Math.floor(nowMs/1000)-Number(timestamp))>toleranceSeconds)throw stripeError(400,'invalid_webhook_signature','Stripe webhook signature is invalid or expired.');
 const expected=createHmac('sha256',webhookSecret).update(`${timestamp}.${rawBody}`).digest();
 const valid=signatures.some(value=>{if(!/^[a-f0-9]{64}$/i.test(value))return false;const actual=Buffer.from(value,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);});
 if(!valid)throw stripeError(400,'invalid_webhook_signature','Stripe webhook signature is invalid or expired.');
 let event:unknown;try{event=JSON.parse(rawBody);}catch{throw stripeError(400,'invalid_webhook','Stripe webhook body is not valid JSON.');}
 if(!event||typeof event!=='object')throw stripeError(400,'invalid_webhook','Stripe webhook event is malformed.');
 const parsed=event as Partial<StripeEvent>;
 if(typeof parsed.id!=='string'||typeof parsed.type!=='string'||!parsed.data||typeof parsed.data!=='object'||!parsed.data.object||typeof parsed.data.object!=='object'||(parsed.livemode!==undefined&&typeof parsed.livemode!=='boolean'))throw stripeError(400,'invalid_webhook','Stripe webhook event is malformed.');
 return parsed as StripeEvent;
}
