import { authenticate, ApiError, bodyOf, createPayment, createProduct, createRefund, mutate, requireScope, responseError } from '@/lib/server/local';
import { all, one, id } from '@/lib/server/db';
import type { Payment } from '@/lib/types';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handle(request:Request,{params}:{params:Promise<{path:string[]}>}){const requestId=id('req');try{const actor=authenticate(request);const path=(await params).path.join('/');let result:unknown;
 if(request.method==='GET'){
 const table=path==='products'?'products':path==='payments'?'payments':path==='events'?'events':null;
 if(table){requireScope(actor,`${table}:read`);const u=new URL(request.url);const cursor=Number(u.searchParams.get('cursor')||0);const limit=Number(u.searchParams.get('limit')||25);if(!Number.isInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>100)throw new ApiError(422,'invalid_pagination','limit must be 1–100 and cursor a non-negative integer.');const rows=all<Record<string,unknown>>(`SELECT rowid AS cursor_id,* FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT ?`,cursor,limit+1);const hasMore=rows.length>limit;const items=rows.slice(0,limit);result={data:items.map(r=>{const {cursor_id,checkout_token,...item}=r;return table==='events'?{...item,data:JSON.parse(String(item.data))}:item;}),next_cursor:hasMore?items.at(-1)?.cursor_id:null};}
 else if(path.startsWith('payments/')&&path.split('/').length===2){requireScope(actor,'payments:read');const p=one<Payment>('SELECT * FROM payments WHERE id=?',path.split('/')[1]);if(!p)throw new ApiError(404,'not_found','Payment not found.');const {checkout_token,...payment}=p;result=payment;}else throw new ApiError(404,'not_found','Endpoint not found.');
 }else{const body=await bodyOf(request);const handlers:Record<string,()=>unknown>={products:()=>createProduct(actor,body),payments:()=>{const p=createPayment(actor,body);const {checkout_token,...payment}=p;return{...payment,checkout_url:`/checkout/${checkout_token}`}},refunds:()=>createRefund(actor,body)};const fn=handlers[path];if(!fn)throw new ApiError(404,'not_found','Endpoint not found.');result=mutate(actor,path,request.headers.get('idempotency-key'),body,fn);}
 return Response.json(result,{status:request.method==='POST'?201:200,headers:{'X-Request-Id':requestId,'Cache-Control':'no-store'}});
 }catch(e){return responseError(e,requestId)}}
export const GET=handle;export const POST=handle;
