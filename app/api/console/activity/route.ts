import { ApiError, consoleAuth, paymentActivity, responseError } from "@/lib/server/local"
import { id } from "@/lib/server/db"
import type { ActivityRange } from "@/lib/server/activity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const ranges = new Set<ActivityRange>(["1h", "24h", "7d", "30d", "90d", "1y", "all", "custom"])

export async function GET(request: Request) {
  const requestId = id("req")
  try {
    const actor = consoleAuth(request)
    const url = new URL(request.url)
    const value = url.searchParams.get("range") || "30d"
    if (!ranges.has(value as ActivityRange)) throw new ApiError(422, "invalid_request", "Choose a supported activity range.")
    const from = url.searchParams.get("from") || undefined
    const to = url.searchParams.get("to") || undefined
    if (value === "custom" && (!from || !to)) throw new ApiError(422, "invalid_request", "Custom range needs a start and end date.")
    try {
      return Response.json(paymentActivity(actor.tenant_id, value as ActivityRange, from, to), { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } })
    } catch (error) {
      if (error instanceof Error) throw new ApiError(422, "invalid_range", error.message)
      throw error
    }
  } catch (error) { return responseError(error, requestId) }
}
