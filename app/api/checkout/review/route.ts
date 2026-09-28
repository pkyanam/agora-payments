import { ApiError, responseError } from '@/lib/server/local';
import { id, one } from '@/lib/server/db';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
 const requestId=id('req');
 try{
  const token=request.headers.get('x-agora-checkout-token');
  if(!token||!/^[a-f0-9]{48}$/.test(token))throw new ApiError(404,'not_found','Checkout not found.');
  const payment=one<{id:string;tenant_id:string;product_name:string;customer:string;amount:number;currency:string;status:string;provider:string;provider_mode:string|null}>('SELECT id,tenant_id,product_name,customer,amount,currency,status,provider,provider_mode FROM payments WHERE checkout_token=? AND sample=0',token);
  if(!payment||payment.provider!=='stripe'||!payment.provider_mode||!['test','live'].includes(payment.provider_mode))throw new ApiError(404,'not_found','Checkout not found.');
  const merchant=one<{business_name:string}>('SELECT business_name FROM tenants WHERE id=? AND status=\'approved\'',payment.tenant_id);
  if(!merchant)throw new ApiError(404,'not_found','Checkout not found.');
  const headers=new Headers({'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Request-Id':requestId});
  if(payment.status==='succeeded'){
   const secure=new URL(request.url).protocol==='https:'||process.env.NODE_ENV==='production';
   headers.append('Set-Cookie',`agora_checkout_status_${payment.id}=${token}; Path=/api/checkout/status/${payment.id}; HttpOnly; SameSite=Lax; Max-Age=3600${secure?'; Secure':''}`);
  }
  return Response.json({id:payment.id,merchant:merchant.business_name,product_name:payment.product_name,customer:payment.customer||'Guest',amount:payment.amount,currency:payment.currency,status:payment.status,provider_mode:payment.provider_mode},{headers});
 }catch(error){return responseError(error,requestId);}
}
