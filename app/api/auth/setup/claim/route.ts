import { id } from '@/lib/server/db';
import { bodyOf, claimOwnerSetup, responseError, setMfaCookie } from '@/lib/server/local';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
 const requestId=id('req');
 try{
  const {cookie,...payload}=claimOwnerSetup(request,await bodyOf(request));
  const response=Response.json(payload,{headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Request-Id':requestId}});
  return setMfaCookie(response,request,'pending',cookie);
 }catch(error){return responseError(error,requestId)}
}
