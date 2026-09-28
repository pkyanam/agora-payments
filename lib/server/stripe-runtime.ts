import { ApiError } from './errors';
import { recordStripeRefundResult, stripeRefundContext, stripeRefundResult, stripePaymentReconcileContext, reconcileStripePayment } from './local';
import { transaction } from './db';
import { createStripeRefund, retrieveStripeCheckout } from './stripe';

/** Runs the external operation only after a pending local request exists. Provider idempotency makes retries safe. */
export async function submitStripeRefund(refundId:string,tenantId:string){
 const saved=stripeRefundResult(refundId,tenantId);if(saved.status!=='pending')return{...saved,provider:'stripe'};
 const request=stripeRefundContext(refundId);
 if(request.tenant_id!==tenantId)throw new ApiError(404,'refund_not_found','Refund request not found.');
 const mode=request.provider_mode;
 if(mode!=='test'&&mode!=='live')throw new ApiError(409,'provider_mode_invalid','Stripe refund mode is missing.');
 const key=mode==='live'?process.env.STRIPE_LIVE_SECRET_KEY:process.env.STRIPE_TEST_SECRET_KEY;
 if(!key||!key.startsWith(mode==='live'?'sk_live_':'sk_test_'))throw new ApiError(503,'provider_not_configured',`Set a mode-matched STRIPE_${mode.toUpperCase()}_SECRET_KEY before enabling Stripe refunds.`);
 let providerRefund;
 try{providerRefund=await createStripeRefund(key,{paymentIntent:request.payment_intent!,amount:request.amount,refundId:request.id,idempotencyKey:`agora-refund-${request.id}`,stripeAccountId:request.provider_account_id||undefined});}
 catch(error){if(error instanceof ApiError&&error.code==='provider_rejected')transaction(()=>recordStripeRefundResult(request.id,null,'failed'));throw error;}
 return{...transaction(()=>recordStripeRefundResult(request.id,providerRefund.id,providerRefund.status)),provider:'stripe'};
}

/** Reconcile one authenticated tenant's payment from Stripe's authoritative Checkout state. */
export async function reconcileStripeCheckout(paymentId:string,tenantId:string){
 const payment=stripePaymentReconcileContext(paymentId,tenantId);const mode=payment.provider_mode;
 if(mode!=='test'&&mode!=='live')throw new ApiError(409,'provider_mode_invalid','Stripe payment mode is missing.');
 const key=mode==='live'?process.env.STRIPE_LIVE_SECRET_KEY:process.env.STRIPE_TEST_SECRET_KEY;
 if(!key||!key.startsWith(mode==='live'?'sk_live_':'sk_test_'))throw new ApiError(503,'provider_not_configured',`Set a mode-matched STRIPE_${mode.toUpperCase()}_SECRET_KEY before enabling payment reconciliation.`);
 const session=await retrieveStripeCheckout(key,payment.provider_session_id!,payment.provider_account_id||undefined);
 return reconcileStripePayment(paymentId,tenantId,session);
}
