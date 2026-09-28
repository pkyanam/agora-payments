import { ApiError, beginStripeConnect, consoleAuth, disconnectStripeAccount, responseError, stripeAccountForTenant } from '@/lib/server/local';
import { id } from '@/lib/server/db';
import { deauthorizeStripeAccount } from '@/lib/server/stripe';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request,{params}:{params:Promise<{tenantId:string}>}){
 const requestId=id('req');
 try{const actor=consoleAuth(request);const {tenantId}=await params;if(actor.tenant_id!=='owner'&&actor.tenant_id!==tenantId)throw new ApiError(404,'not_found','Merchant workspace not found.');const mode=process.env.AGORA_STRIPE_MODE;const linked=mode==='test'||mode==='live'?stripeAccountForTenant(tenantId,mode):null;return Response.json({provider:'stripe',mode:mode==='test'||mode==='live'?mode:null,status:linked?.status||'not_connected',charges_enabled:linked?.charges_enabled||false},{headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});}catch(error){return responseError(error,requestId);}
}

export async function POST(request:Request,{params}:{params:Promise<{tenantId:string}>}){
 const requestId=id('req');
 try{
  const actor=consoleAuth(request,true);const {tenantId}=await params;
  const mode=process.env.AGORA_STRIPE_MODE;
  const clientId=mode==='live'?process.env.STRIPE_LIVE_CONNECT_CLIENT_ID:mode==='test'?process.env.STRIPE_TEST_CONNECT_CLIENT_ID:undefined;
  if((mode!=='test'&&mode!=='live')||!clientId)throw new ApiError(503,'provider_not_configured','Stripe Connect is not configured for this mode.');
  const origin=process.env.AGORA_PUBLIC_ORIGIN;if(!origin)throw new ApiError(503,'provider_not_configured','AGORA_PUBLIC_ORIGIN is required for Stripe Connect.');
  const redirectUri=new URL('/api/provider/stripe/callback',origin).toString();
  const result=beginStripeConnect(actor,tenantId,mode,clientId,redirectUri);
  return Response.json({authorize_url:result.authorize_url,expires_at:result.expires_at,mode},{headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});
 }catch(error){return responseError(error,requestId);}
}

export async function DELETE(request:Request,{params}:{params:Promise<{tenantId:string}>}){
 const requestId=id('req');
 try{
  const actor=consoleAuth(request,true);const {tenantId}=await params;const mode=process.env.AGORA_STRIPE_MODE;
  if(mode!=='test'&&mode!=='live')throw new ApiError(503,'provider_not_configured','Stripe Connect is not configured for this mode.');
  const linked=stripeAccountForTenant(tenantId,mode);if(!linked)return Response.json({disconnected:false},{headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});
  const clientId=mode==='live'?process.env.STRIPE_LIVE_CONNECT_CLIENT_ID:process.env.STRIPE_TEST_CONNECT_CLIENT_ID;const secretKey=mode==='live'?process.env.STRIPE_LIVE_SECRET_KEY:process.env.STRIPE_TEST_SECRET_KEY;
  if(!clientId||!secretKey)throw new ApiError(503,'provider_not_configured','Stripe Connect disconnection is not configured for this mode.');
  const result=disconnectStripeAccount(actor,tenantId,mode);
  await deauthorizeStripeAccount(secretKey,clientId,linked.account_id);
  return Response.json(result,{headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});
 }catch(error){return responseError(error,requestId);}
}
