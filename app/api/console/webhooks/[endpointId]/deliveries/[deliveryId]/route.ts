import { id } from '@/lib/server/db';
import { ApiError, consoleAuth, responseError, webhookDeliveryDetail } from '@/lib/server/local';
export const runtime='nodejs';export const dynamic='force-dynamic';type Context={params:Promise<{endpointId:string;deliveryId:string}>};
export async function GET(request:Request,{params}:Context){const requestId=id('req');try{const actor=consoleAuth(request);if(actor.tenant_id!=='owner')throw new ApiError(403,'permission_denied','Only the workspace owner can inspect outgoing webhooks.');const p=await params;return Response.json(webhookDeliveryDetail(actor,p.endpointId,p.deliveryId),{headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});}catch(error){return responseError(error,requestId);}}
