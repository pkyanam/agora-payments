import { id } from '@/lib/server/db';
import { clearMerchantCookie, logout, requireSameOrigin, responseError, setSessionCookie, setMfaCookie } from '@/lib/server/local';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
 const requestId=id('req');
 try{
  requireSameOrigin(request,true);
  logout(request);
  const response=Response.json({authenticated:false},{headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});
  setMfaCookie(setSessionCookie(response,request),request,'pending');response.headers.append('Set-Cookie',clearMerchantCookie(request));return response;
 }catch(error){return responseError(error,requestId)}
}
