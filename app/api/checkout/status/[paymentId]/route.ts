import { ApiError, responseError } from '@/lib/server/local';
import { all, id, one } from '@/lib/server/db';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request,{params}:{params:Promise<{paymentId:string}>}){
 const requestId=id('req');
 try{
  const {paymentId}=await params;if(!/^[A-Za-z0-9_-]{1,80}$/.test(paymentId))throw new ApiError(404,'not_found','Checkout status not found.');const cookieName=`agora_checkout_status_${paymentId}`;const token=request.headers.get('x-checkout-status-token')||request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
  if(!token||token.length<40)throw new ApiError(404,'not_found','Checkout status not found.');
  const payment=one<{id:string;tenant_id:string;product_name:string;customer:string;amount:number;refunded:number;currency:string;status:string;provider:string;provider_mode:string|null;provider_session_id:string|null;created_at:string}>("SELECT id,tenant_id,product_name,customer,amount,refunded,currency,status,provider,provider_mode,provider_session_id,created_at FROM payments WHERE id=? AND checkout_token=? AND sample=0",paymentId,token);
  if(!payment||payment.provider!=='stripe')throw new ApiError(404,'not_found','Checkout status not found.');
  const sessionId=new URL(request.url).searchParams.get('session_id');
  if(sessionId&&sessionId!==payment.provider_session_id)throw new ApiError(404,'not_found','Checkout status not found.');
  const headers=new Headers({'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Request-Id':requestId});if(payment.status==='failed')headers.append('Set-Cookie',`${cookieName}=; Path=/api/checkout/status/${paymentId}; HttpOnly; SameSite=Lax; Max-Age=0${new URL(request.url).protocol==='https:'||process.env.NODE_ENV==='production'?'; Secure':''}`);
  const merchant=one<{business_name:string}>("SELECT business_name FROM tenants WHERE id=? AND status='approved'",payment.tenant_id);
  if(!merchant)throw new ApiError(404,'not_found','Checkout status not found.');
  const paidAt=payment.status==='succeeded'?one<{created_at:string}>("SELECT created_at FROM events WHERE object_id=? AND type='payment.succeeded' ORDER BY created_at LIMIT 1",payment.id)?.created_at:undefined;
  const rawOrder=one<{id:string;status:string;total_amount:number;fulfillment_status:string|null;cancelled_at:string|null}>('SELECT o.id,o.status,o.total_amount,f.status AS fulfillment_status,f.cancelled_at FROM orders o LEFT JOIN fulfillments f ON f.order_id=o.id AND f.tenant_id=o.tenant_id WHERE o.payment_id=? AND o.tenant_id=?',payment.id,payment.tenant_id);
  const refunded=Number(payment.refunded||0);const paymentStatus=refunded>=payment.amount&&payment.amount>0?'refunded':refunded>0?'partially_refunded':payment.status==='succeeded'?'paid':payment.status==='pending'?'pending':'failed';
  const order=rawOrder?{id:rawOrder.id,status:rawOrder.status,payment_status:paymentStatus,refunded_amount:refunded,net_amount:Math.max(0,payment.amount-refunded),fulfillment_status:rawOrder.cancelled_at?'cancelled':rawOrder.fulfillment_status,amount:rawOrder.total_amount,items:all<{product_name:string;quantity:number;unit_amount:number;line_total:number;discount_amount:number;net_total:number}>('SELECT product_name,quantity,unit_amount,line_total,discount_amount,net_total FROM order_items WHERE order_id=? ORDER BY rowid',rawOrder.id)}:undefined;
  return Response.json({id:payment.id,product_name:payment.product_name,amount:payment.amount,refunded_amount:refunded,net_amount:Math.max(0,payment.amount-refunded),currency:payment.currency,status:payment.status,provider:payment.provider,provider_mode:payment.provider_mode,...(order?{order}:{}),...(payment.status==='succeeded'?{receipt:{reference:payment.id,merchant:merchant.business_name,customer:payment.customer||'Guest',product_name:payment.product_name,amount:payment.amount,refunded_amount:refunded,net_amount:Math.max(0,payment.amount-refunded),payment_status:paymentStatus,currency:payment.currency,...(paidAt?{paid_at:paidAt}:{}),...(order?{order}:{})}}:{})},{headers});
 }catch(error){return responseError(error,requestId);}
}
