import { archivePayment, ApiError, bodyOf, consoleAuth, responseError } from "@/lib/server/local"
import { id as requestId } from "@/lib/server/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ paymentId: string }> }

export async function PATCH(request: Request, context: Context) {
  const id = requestId("req")
  try {
    const actor = consoleAuth(request, true)
    const body = await bodyOf(request) as { archived?: unknown }
    if (typeof body.archived !== "boolean") throw new ApiError(422, "invalid_request", "Provide archived as true or false.")
    const { paymentId } = await context.params
    return Response.json(archivePayment(actor, paymentId, body.archived), { headers: { "Cache-Control": "no-store", "X-Request-Id": id } })
  } catch (error) { return responseError(error, id) }
}
