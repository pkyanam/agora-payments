import { id } from '@/lib/server/db';
import { bodyOf, enrollAdminMfa, responseError, setMfaCookie, setSessionCookie } from '@/lib/server/local';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
 const requestId=id('req');
 try{
  const {cookie,...payload}=enrollAdminMfa(request,await bodyOf(request));
  const response=Response.json({...payload,authenticated:true,role:'owner',access_status:'approved'},{headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});
  return setMfaCookie(setSessionCookie(response,request,cookie),request,'pending');
 }catch(error){return responseError(error,requestId)}
}
