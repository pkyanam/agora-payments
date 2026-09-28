import { id } from '@/lib/server/db';
import { authSession, responseError } from '@/lib/server/local';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request){
 const requestId=id('req');
 try{
  const state=authSession(request);
  return Response.json(state,{headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});
 }catch(error){return responseError(error,requestId)}
}
