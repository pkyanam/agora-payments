import { bodyOf, enrollMerchantMfa, responseError, setMerchantCookie } from '@/lib/server/local';
import { id } from '@/lib/server/db';

export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:Request){const requestId=id('req');try{const result=enrollMerchantMfa(request,await bodyOf(request));const{cookie,...payload}=result;const response=Response.json({role:'merchant',authenticated:true,access_status:'approved',mfa_stage:'complete',...payload},{headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});setMerchantCookie(response,request,'pending');return setMerchantCookie(response,request,'member',cookie);}catch(error){return responseError(error,requestId);}}
