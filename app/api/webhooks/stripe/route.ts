import { id } from '@/lib/server/db';
import { handleStripeWebhook, responseError } from '@/lib/server/local';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
 const requestId=id('req');
 try{
  const signature=request.headers.get('stripe-signature');
  if(!signature)return Response.json({error:{code:'missing_signature',message:'Stripe-Signature is required.',request_id:requestId}},{status:400,headers:{'Cache-Control':'no-store'}});
  const rawBody=await request.text();
  if(rawBody.length>1024*1024)return Response.json({error:{code:'payload_too_large',message:'Webhook payload exceeds 1 MB.',request_id:requestId}},{status:413,headers:{'Cache-Control':'no-store'}});
  const result=handleStripeWebhook(rawBody,signature);
  return Response.json(result,{headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});
 }catch(error){return responseError(error,requestId);}
}
