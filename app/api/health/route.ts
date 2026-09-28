import { paymentProviderReadiness, stripeConfigSummary } from '@/lib/server/local';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){
 const deployment=process.env.AGORA_DEPLOYMENT_TYPE==='hosted'?'hosted':process.env.AGORA_DEPLOYMENT_TYPE==='community'?'community':process.env.VERCEL_ENV?'hosted':'community';
 const readiness=paymentProviderReadiness();
 const config=stripeConfigSummary();
 return Response.json({status:'ok',deployment_type:deployment,deployment_target:process.env.AGORA_DEPLOYMENT_TARGET||'node',deployment_hosting:process.env.AGORA_DEPLOYMENT_HOSTING,current_version:process.env.AGORA_VERSION||'0.0.1',provider:{name:config.provider,mode:config.mode,status:readiness.provider_status,checkout_enabled:readiness.checkout_enabled,webhook_url:config.webhook_url,configured:config.configured[config.mode]}},{headers:{'Cache-Control':'no-store'}});
}
