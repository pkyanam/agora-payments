import { ApiError, bodyOf, reviewPublicQuote, responseError } from '@/lib/server/local';
import { id } from '@/lib/server/db';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){const requestId=id('req');try{const body=await bodyOf(request) as {token?:unknown};if(typeof body?.token!=='string')throw new ApiError(404,'not_found','Quote not found.');const {quote}=reviewPublicQuote(body.token);return Response.json(quote,{headers:{'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer'}});}catch(error){return responseError(error,requestId)}}
