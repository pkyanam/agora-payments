import { transaction, id } from '@/lib/server/db';
import { ApiError, bodyOf, consoleAuth, createCredential, createPayment, createProduct, createRefund, mutate, resolveApproval, responseError, revokeCredential, snapshot } from '@/lib/server/local';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){const requestId=id('req');try{consoleAuth(request);return Response.json(snapshot(),{headers:{'Cache-Control':'no-store'}})}catch(e){return responseError(e,requestId)}}
export async function POST(request:Request){const requestId=id('req');try{const actor=consoleAuth(request,true);const b=await bodyOf(request) as {action:string;payload:unknown};const handlers:Record<string,()=>unknown>={create_product:()=>createProduct(actor,b.payload),create_payment:()=>createPayment(actor,b.payload),refund:()=>createRefund(actor,b.payload),resolve_approval:()=>resolveApproval(actor,b.payload),revoke_key:()=>revokeCredential(actor,b.payload)};let result:unknown;
 if(b.action==='create_key'){let secret:string|undefined;result=mutate(actor,b.action,request.headers.get('idempotency-key'),b.payload,()=>{const c=createCredential(actor,b.payload);secret=c.secret;const {secret:_,...metadata}=c;return metadata;});if(secret)result={...result as object,secret};}
 else{const fn=handlers[b.action];if(!fn)throw new ApiError(400,'invalid_action','Unknown console action.');result=mutate(actor,b.action,request.headers.get('idempotency-key'),b.payload,fn);}
 return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){return responseError(e,requestId)}}
