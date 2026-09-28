import { id } from '@/lib/server/db';
import { ApiError, consoleAuth, responseError, rotateWebhookSecret } from '@/lib/server/local';
export const runtime='nodejs';export const dynamic='force-dynamic';type Context={params:Promise<{endpointId:string}>};
export async function POST(request:Request,{params}:Context){const requestId=id('req');try{const actor=consoleAuth(request,true);if(actor.tenant_id!=='owner')throw new ApiError(403,'permission_denied','Only the workspace owner can rotate outgoing webhook secrets.');return Response.json(rotateWebhookSecret(actor,(await params).endpointId),{headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});}catch(error){return responseError(error,requestId);}}
