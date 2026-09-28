import { ApiError, responseError } from '@/lib/server/local';
import { id, one } from '@/lib/server/db';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
 const requestId=id('req');
 try{
  const token=request.headers.get('x-agora-checkout-token');
  if(!token||!/^[a-f0-9]{48}$/.test(token))throw new ApiError(404,'not_found','Checkout not found.');
  const payment=one<{id:string;provider:string;status:string;provider_checkout_url:string|null}>('SELECT id,provider,status,provider_checkout_url FROM payments WHERE checkout_token=? AND sample=0',token);
  if(!payment||payment.provider!=='stripe'||!payment.provider_checkout_url)throw new ApiError(404,'not_found','Checkout not found.');
  if(payment.status!=='pending')throw new ApiError(409,'checkout_not_pending','This payment is no longer awaiting checkout.');
  const target=new URL(payment.provider_checkout_url);
  if(target.protocol!=='https:'||target.hostname!=='checkout.stripe.com')throw new ApiError(502,'provider_invalid_response','The stored provider checkout URL is invalid.');
  const secure=new URL(request.url).protocol==='https:'||process.env.NODE_ENV==='production';
  const cookieName=`agora_checkout_status_${payment.id}`;
  const cookie=`${cookieName}=${token}; Path=/api/checkout/status/${payment.id}; HttpOnly; SameSite=Lax; Max-Age=3600${secure?'; Secure':''}`;
  return Response.json({checkout_url:target.toString()},{headers:{'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Request-Id':requestId,'Set-Cookie':cookie}});
 }catch(error){return responseError(error,requestId);}
}
