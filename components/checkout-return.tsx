"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

type ProviderStatus = {
  status: "pending" | "succeeded" | "failed" | "expired"
}

export default function CheckoutReturn({
  paymentId,
  sessionId,
  canceled = false,
}: {
  paymentId?: string
  sessionId?: string
  canceled?: boolean
}) {
  const [status, setStatus] = useState<ProviderStatus["status"] | "unknown">(
    "pending"
  )
  const [message, setMessage] = useState("Checking for provider confirmation…")
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    const poll = async () => {
      if (!paymentId) {
        setStatus("unknown")
        setMessage("The payment reference is missing. Check the payment record with the merchant.")
        return
      }
      for (let i = 0; i < 8 && active; i += 1) {
        try {
          const query = new URLSearchParams()
          if (sessionId) query.set("session_id", sessionId)
          const suffix = query.size ? `?${query.toString()}` : ""
          const response = await fetch(
            `/api/checkout/status/${encodeURIComponent(paymentId)}${suffix}`,
            {
              cache: "no-store",
            }
          )
          const body = (await response.json()) as {
            error?: { message?: string }
            status?: ProviderStatus["status"]
          }
          if (!response.ok || !body.status) {
            throw new Error(body.error?.message || "Status is not available yet.")
          }
          if (!active) return
          setStatus(body.status)
          if (body.status !== "pending") {
            setMessage(
              body.status === "succeeded"
                ? "Payment confirmed by the payment provider."
                : "The payment provider confirmed that this payment did not complete."
            )
            return
          }
          setMessage(
            canceled
              ? "Checkout was closed. The provider has not confirmed a final payment status."
              : "The payment is still pending provider confirmation. This return page does not mark a payment as successful."
          )
        } catch (error) {
          if (!active) return
          setStatus("unknown")
          setMessage(
            error instanceof Error
              ? `${error.message} The payment is not confirmed.`
              : "Unable to check provider status. The payment is not confirmed."
          )
        }
        if (i < 7) await new Promise((resolve) => setTimeout(resolve, 1500))
      }
    }
    void poll()
    return () => {
      active = false
    }
  }, [paymentId, sessionId, canceled, attempt])

  const title =
    status === "succeeded"
      ? "Payment confirmed."
      : status === "failed" || status === "expired"
        ? "Payment not completed."
        : canceled
          ? "Checkout closed."
          : "Payment status is pending."

  return (
    <main className="checkout-page checkout-return">
      <Link className="wordmark" href="/">
        agora<span>·</span>
      </Link>
      <span className="sandbox-mark">Provider status</span>
      <h1>{title}</h1>
      <p role="status" aria-live="polite">{message}</p>
      <div className="form-stack">
        {status !== "succeeded" && status !== "failed" && status !== "expired" && (
          <button className="checkout-control checkout-control-secondary" onClick={() => setAttempt((value) => value + 1)}>
            Check again
          </button>
        )}
        <Link className="inline-link" href="/?view=Payments">
          Return to payments
        </Link>
      </div>
    </main>
  )
}
