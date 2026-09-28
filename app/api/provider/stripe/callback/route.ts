import { consoleAuth, consumeStripeConnectState, responseError, saveStripeConnectedAccount } from '@/lib/server/local';
import { id } from '@/lib/server/db';
import { exchangeStripeOAuthCode, getStripeConnectedAccount } from '@/lib/server/stripe';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function returnTo(origin:string,result:'connected'|'failed'){
 const url=new URL('/',origin);url.searchParams.set('view','Agents');url.searchParams.set('stripe_connect',result);return Response.redirect(url,303);
}

export async function GET(request:Request){
 const requestId=id('req');
 try{
  const actor=consoleAuth(request);
  const configuredOrigin=process.env.AGORA_PUBLIC_ORIGIN;if(!configuredOrigin)throw new Error('origin_not_configured');
  const origin=new URL(configuredOrigin).origin;const callback=new URL(request.url);
  if(callback.origin!==origin)throw new Error('origin_mismatch');
  const code=callback.searchParams.get('code');const state=callback.searchParams.get('state');const mode=process.env.AGORA_STRIPE_MODE;
  if(!code||!state||(mode!=='test'&&mode!=='live'))throw new Error('oauth_callback_invalid');
  const clientId=mode==='live'?process.env.STRIPE_LIVE_CONNECT_CLIENT_ID:process.env.STRIPE_TEST_CONNECT_CLIENT_ID;
  const secretKey=mode==='live'?process.env.STRIPE_LIVE_SECRET_KEY:process.env.STRIPE_TEST_SECRET_KEY;
  if(!clientId||!secretKey)throw new Error('oauth_not_configured');
  const redirectUri=new URL('/api/provider/stripe/callback',origin).toString();
  const {tenant_id}=consumeStripeConnectState(state,mode,redirectUri);
  if(actor.tenant_id!=='owner'&&actor.tenant_id!==tenant_id)throw new Error('oauth_tenant_mismatch');
  const authorization=await exchangeStripeOAuthCode(secretKey,clientId,code);
  if(authorization.livemode!==(mode==='live'))throw new Error('oauth_mode_mismatch');
  const account=await getStripeConnectedAccount(secretKey,authorization.accountId);
  saveStripeConnectedAccount(tenant_id,mode,account);
  return returnTo(origin,'connected');
 }catch(error){
  const configuredOrigin=process.env.AGORA_PUBLIC_ORIGIN;
  if(configuredOrigin){try{return returnTo(new URL(configuredOrigin).origin,'failed')}catch{}}
  return responseError(error,requestId);
 }
}
