import { id } from '@/lib/server/db';
import { ApiError, consoleAuth, replayWebhookDelivery, responseError } from '@/lib/server/local';
export const runtime='nodejs';export const dynamic='force-dynamic';type Context={params:Promise<{endpointId:string;deliveryId:string}>};
export async function POST(request:Request,{params}:Context){const requestId=id('req');try{const actor=consoleAuth(request,true);if(actor.tenant_id!=='owner')throw new ApiError(403,'permission_denied','Only the workspace owner can replay outgoing webhooks.');const p=await params;return Response.json(replayWebhookDelivery(actor,p.endpointId,p.deliveryId),{status:202,headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});}catch(error){return responseError(error,requestId);}}
