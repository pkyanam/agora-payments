import { archiveProduct, ApiError, bodyOf, consoleAuth, responseError } from "@/lib/server/local"
import { id as requestId } from "@/lib/server/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ productId: string }> }

export async function PATCH(request: Request, context: Context) {
  const id = requestId("req")
  try {
    const actor = consoleAuth(request, true)
    const body = await bodyOf(request) as { archived?: unknown }
    if (typeof body.archived !== "boolean") throw new ApiError(422, "invalid_request", "Provide archived as true or false.")
    const { productId } = await context.params
    return Response.json(archiveProduct(actor, productId, body.archived), { headers: { "Cache-Control": "no-store", "X-Request-Id": id } })
  } catch (error) { return responseError(error, id) }
}
