import { id } from '@/lib/server/db';
import { ApiError, bodyOf, consoleAuth, createWebhookEndpoint, listWebhookEndpoints, responseError } from '@/lib/server/local';
export const runtime='nodejs';export const dynamic='force-dynamic';
function actor(request:Request,write=false){const value=consoleAuth(request,write);if(value.tenant_id!=='owner')throw new ApiError(403,'permission_denied','Only the workspace owner can manage outgoing webhooks.');return value;}
export async function GET(request:Request){const requestId=id('req');try{const value=actor(request);return Response.json({data:listWebhookEndpoints(value,new URL(request.url).searchParams.get('include_archived')==='true')},{headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});}catch(error){return responseError(error,requestId);}}
export async function POST(request:Request){const requestId=id('req');try{const value=actor(request,true);return Response.json(createWebhookEndpoint(value,await bodyOf(request)),{status:201,headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});}catch(error){return responseError(error,requestId);}}
