import { ApiError, responseError } from '@/lib/server/local';
import { id, one } from '@/lib/server/db';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request,{params}:{params:Promise<{paymentId:string}>}){
 const requestId=id('req');
 try{
  const {paymentId}=await params;if(!/^[A-Za-z0-9_-]{1,80}$/.test(paymentId))throw new ApiError(404,'not_found','Checkout status not found.');const cookieName=`agora_checkout_status_${paymentId}`;const token=request.headers.get('x-checkout-status-token')||request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
  if(!token||token.length<40)throw new ApiError(404,'not_found','Checkout status not found.');
  const payment=one<{id:string;tenant_id:string;product_name:string;customer:string;amount:number;currency:string;status:string;provider:string;provider_mode:string|null;provider_session_id:string|null;created_at:string}>("SELECT id,tenant_id,product_name,customer,amount,currency,status,provider,provider_mode,provider_session_id,created_at FROM payments WHERE id=? AND checkout_token=? AND sample=0",paymentId,token);
  if(!payment||payment.provider!=='stripe')throw new ApiError(404,'not_found','Checkout status not found.');
  const sessionId=new URL(request.url).searchParams.get('session_id');
  if(sessionId&&sessionId!==payment.provider_session_id)throw new ApiError(404,'not_found','Checkout status not found.');
  const headers=new Headers({'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Request-Id':requestId});if(payment.status==='failed')headers.append('Set-Cookie',`${cookieName}=; Path=/api/checkout/status/${paymentId}; HttpOnly; SameSite=Lax; Max-Age=0${new URL(request.url).protocol==='https:'||process.env.NODE_ENV==='production'?'; Secure':''}`);
  const merchant=one<{business_name:string}>("SELECT business_name FROM tenants WHERE id=? AND status='approved'",payment.tenant_id);
  if(!merchant)throw new ApiError(404,'not_found','Checkout status not found.');
  const paidAt=payment.status==='succeeded'?one<{created_at:string}>("SELECT created_at FROM events WHERE object_id=? AND type='payment.succeeded' ORDER BY created_at LIMIT 1",payment.id)?.created_at:undefined;
  return Response.json({id:payment.id,product_name:payment.product_name,amount:payment.amount,currency:payment.currency,status:payment.status,provider:payment.provider,provider_mode:payment.provider_mode,...(payment.status==='succeeded'?{receipt:{reference:payment.id,merchant:merchant.business_name,customer:payment.customer||'Guest',product_name:payment.product_name,amount:payment.amount,currency:payment.currency,...(paidAt?{paid_at:paidAt}:{})}}:{})},{headers});
 }catch(error){return responseError(error,requestId);}
}
