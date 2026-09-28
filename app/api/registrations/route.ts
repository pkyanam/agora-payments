import { id } from '@/lib/server/db';
import { bodyOf, registerMerchant, requireSameOrigin, responseError } from '@/lib/server/local';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
 const requestId=id('req');
 try {
  requireSameOrigin(request,true);
  const result=registerMerchant(await bodyOf(request));
  return Response.json(result,{status:201,headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});
 } catch(error) { return responseError(error,requestId); }
}
