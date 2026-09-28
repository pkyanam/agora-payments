import { acceptMerchantInvite, bodyOf, responseError, setMerchantCookie } from '@/lib/server/local';
import { id } from '@/lib/server/db';

export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:Request){const requestId=id('req');try{const result=await acceptMerchantInvite(request,await bodyOf(request));const{cookie,...payload}=result;const response=Response.json({role:'merchant',...payload},{headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Request-Id':requestId}});return setMerchantCookie(response,request,'pending',cookie);}catch(error){return responseError(error,requestId);}}
