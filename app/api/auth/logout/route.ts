import { id } from '@/lib/server/db';
import { requireSameOrigin, responseError, setSessionCookie, setMfaCookie } from '@/lib/server/local';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
 const requestId=id('req');
 try{
  requireSameOrigin(request,true);
  const response=Response.json({authenticated:false},{headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});
  return setMfaCookie(setSessionCookie(response,request),request,'pending');
 }catch(error){return responseError(error,requestId)}
}
