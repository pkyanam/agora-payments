import { id } from '@/lib/server/db';
import { bodyOf, changeAdminPassword, responseError } from '@/lib/server/local';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
 const requestId=id('req');
 try{
  const result=changeAdminPassword(request,await bodyOf(request));
  return Response.json(result,{headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});
 }catch(error){return responseError(error,requestId)}
}
