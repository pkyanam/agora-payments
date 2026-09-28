import { id } from '@/lib/server/db';
import { bodyOf, responseError, setMfaCookie, setSessionCookie, verifyAdminMfa } from '@/lib/server/local';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
 const requestId=id('req');
 try{
  const {cookie}=verifyAdminMfa(request,await bodyOf(request));
  const response=Response.json({authenticated:true,role:'owner',access_status:'approved',mfa_stage:'complete'},{headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});
  return setMfaCookie(setSessionCookie(response,request,cookie),request,'pending');
 }catch(error){return responseError(error,requestId)}
}
