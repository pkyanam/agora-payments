export async function register(){
  if(process.env.NEXT_RUNTIME!=='nodejs')return;
  if(process.env.AGORA_DEPLOYMENT_TARGET==='node'&&process.env.AGORA_DEPLOYMENT_TYPE==='community'&&!process.env.VERCEL&&!process.env.VERCEL_ENV){
    await import('./lib/server/db');
  }
}
