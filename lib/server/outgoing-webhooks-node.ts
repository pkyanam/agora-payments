import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import { isPublicWebhookAddress } from './outgoing-webhooks';

type Environment=Record<string,string|undefined>;
type ResolvedAddress={address:string;family:4|6};
type Resolver=(hostname:string,options:{all:true;verbatim:true})=>Promise<ResolvedAddress[]>;

function isLoopbackAddress(raw:string){
  const value=raw.toLowerCase().replace(/^\[|\]$/g,'');
  return value==='127.0.0.1'||value==='::1'||value.startsWith('127.');
}
function isLocalDevelopmentTarget(url:URL,environment:Environment){
  const host=url.hostname.toLowerCase();const localHost=host==='localhost'||host.endsWith('.localhost')||host==='127.0.0.1'||host==='[::1]';
  return localHost&&environment.AGORA_DEPLOYMENT_TYPE==='community'&&environment.AGORA_DEPLOYMENT_TARGET==='node'&&environment.NODE_ENV!=='production'&&environment.VERCEL!=='1'&&!environment.VERCEL_ENV&&environment.AGORA_ALLOW_LOCAL_WEBHOOKS==='true';
}

/** Resolve once, reject the entire answer set if any address is unsafe, then pin one address at socket connect. */
export async function resolvePinnedWebhookAddresses(hostname:string,environment:Environment=process.env,resolver:Resolver=dnsLookup as Resolver):Promise<ResolvedAddress[]>{
  const host=hostname.replace(/^\[|\]$/g,'');const family=isIP(host);let addresses:ResolvedAddress[];
  if(family===4||family===6)addresses=[{address:host,family}];
  else addresses=await resolver(host,{all:true,verbatim:true});
  if(!addresses.length)throw new Error('webhook_dns_failed');
  const allowLocal=environment.AGORA_DEPLOYMENT_TYPE==='community'&&environment.AGORA_DEPLOYMENT_TARGET==='node'&&environment.NODE_ENV!=='production'&&environment.VERCEL!=='1'&&!environment.VERCEL_ENV&&environment.AGORA_ALLOW_LOCAL_WEBHOOKS==='true'&&(host==='localhost'||host.endsWith('.localhost')||host==='127.0.0.1'||host==='::1');
  const safe=addresses.every(({address,family:addressFamily})=>isIP(address)===addressFamily&&(allowLocal?isLoopbackAddress(address):isPublicWebhookAddress(address)));
  if(!safe)throw new Error('webhook_destination_blocked');
  return addresses.sort((left,right)=>left.family-right.family);
}

export async function resolvePinnedWebhookAddress(hostname:string,environment:Environment=process.env,resolver:Resolver=dnsLookup as Resolver){
  return (await resolvePinnedWebhookAddresses(hostname,environment,resolver))[0];
}

export function pinnedWebhookLookup(addresses:ResolvedAddress[]):LookupFunction {
  return (_hostname,options,callback)=>{
    const candidates=options?.family?addresses.filter(value=>value.family===options.family):addresses;
    if(!candidates.length){callback(new Error('webhook_address_family_unavailable'),'',0);return;}
    if(options?.all)callback(null,candidates.map(({address,family})=>({address,family})));
    else callback(null,candidates[0].address,candidates[0].family);
  };
}

/** Node-only fetch implementation: no redirects and no second DNS lookup at connect time. */
export function createNodeWebhookFetch(environment:Environment=process.env,resolver?:Resolver):typeof fetch {
  return async(input,init={})=>{
    const url=input instanceof URL?input:new URL(typeof input==='string'?input:input.url);
    const local=isLocalDevelopmentTarget(url,environment);
    if(url.protocol!=='https:'&&!(local&&url.protocol==='http:'))throw new Error('webhook_protocol_blocked');
    const addresses=await resolvePinnedWebhookAddresses(url.hostname,environment,resolver);
    const requestUrl=new URL(url);
    const headers=Object.fromEntries(new Headers(init.headers).entries());
    const requestOptions={
      protocol:requestUrl.protocol,
      hostname:requestUrl.hostname.replace(/^\[|\]$/g,''),
      port:requestUrl.port||undefined,
      path:`${requestUrl.pathname}${requestUrl.search}`,
      method:init.method||'GET',
      headers,
      lookup:pinnedWebhookLookup(addresses),
      autoSelectFamily:true,
      autoSelectFamilyAttemptTimeout:250,
      agent:false as const,
      ...(isIP(requestUrl.hostname.replace(/^\[|\]$/g,''))?{}:{servername:requestUrl.hostname.replace(/\.$/, '')}),
      signal:init.signal||undefined,
    };
    const request=(requestUrl.protocol==='https:'?httpsRequest:httpRequest)(requestOptions);
    return await new Promise<Response>((resolve,reject)=>{
      request.once('error',reject);
      request.once('response',response=>{
        const status=response.statusCode||502;
        response.destroy();
        resolve(new Response(null,{status}));
      });
      if(typeof init.body==='string'||init.body instanceof Uint8Array)request.write(init.body);
      request.end();
    });
  };
}
