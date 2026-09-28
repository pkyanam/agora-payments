import { id } from '@/lib/server/db';
import { bodyOf, beginAdminLogin, ownerLoginEmail, merchantLogin, responseError, setMfaCookie, setMerchantCookie } from '@/lib/server/local';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
 const requestId=id('req');
 try{
  const body=await bodyOf(request);
  if(body&&typeof body==='object'&&typeof (body as {email?:unknown}).email==='string'){
   const {email,...credentials}=body as {email:string;password?:string};
   if(email.trim().toLowerCase()===ownerLoginEmail().trim().toLowerCase()){
    const result=beginAdminLogin(request,credentials);const{cookie,...payload}=result;const response=Response.json({role:'owner',...payload},{headers:{'Cache-Control':'no-store','X-Request-Id':requestId,'Referrer-Policy':'no-referrer'}});return setMfaCookie(response,request,'pending',cookie);
   }
   const result=await merchantLogin(request,{email,...credentials});const {cookie,...payload}=result;const response=Response.json({role:'merchant',...payload},{headers:{'Cache-Control':'no-store','X-Request-Id':requestId,'Referrer-Policy':'no-referrer'}});return setMerchantCookie(response,request,'pending',cookie);
  }
  const result=beginAdminLogin(request,body);
  const {cookie,...payload}=result;
  const response=Response.json(payload,{headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});
  return setMfaCookie(response,request,'pending',cookie);
 }catch(error){return responseError(error,requestId)}
}
