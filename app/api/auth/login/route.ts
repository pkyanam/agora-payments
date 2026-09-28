import { id } from '@/lib/server/db';
import { bodyOf, beginAdminLogin, responseError, setMfaCookie } from '@/lib/server/local';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
 const requestId=id('req');
 try{
  const result=beginAdminLogin(request,await bodyOf(request));
  const {cookie,...payload}=result;
  const response=Response.json(payload,{headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});
  return setMfaCookie(response,request,'pending',cookie);
 }catch(error){return responseError(error,requestId)}
}
