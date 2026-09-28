import { id, one } from '@/lib/server/db';
import { bodyOf, ApiError, responseError, simulate } from '@/lib/server/local';
import type { Payment } from '@/lib/types';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{token:string}>}){try{const p=one<Payment>('SELECT * FROM payments WHERE checkout_token=? AND sample=0',(await params).token);if(!p)throw new ApiError(404,'not_found','Checkout not found.');return Response.json({id:p.id,product_name:p.product_name,amount:p.amount,status:p.status,currency:p.currency},{headers:{'Cache-Control':'no-store'}})}catch(e){return responseError(e,id('req'))}}
export async function POST(request:Request,{params}:{params:Promise<{token:string}>}){try{return Response.json(simulate((await params).token,await bodyOf(request)),{headers:{'Cache-Control':'no-store'}})}catch(e){return responseError(e,id('req'))}}
