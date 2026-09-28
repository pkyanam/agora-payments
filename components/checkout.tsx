"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
export default function Checkout({ token }: { token: string }) {
  const [data, setData] = useState<{
    product_name: string
    amount: number
    status: string
    id: string
    provider: "sandbox" | "stripe"
    provider_mode: "test" | "live" | null
    checkout_url?: string
  } | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    fetch(`/api/checkout/${token}`)
      .then(async (r) => {
        const b: { error?: { message?: string }; product_name: string; amount: number; status: string; id: string; provider?: "sandbox" | "stripe"; provider_mode?: "test" | "live" | null; checkout_url?: string } = await r.json()
        if (!r.ok) throw new Error(b.error?.message || "Checkout is unavailable.")
        if (b.provider !== "sandbox" && b.provider !== "stripe") {
          throw new Error(
            "This checkout’s payment mode could not be verified. Ask the merchant for a current checkout link."
          )
        }
        const provider = b.provider
        if (provider === "stripe") {
          if (!b.checkout_url) throw new Error("Hosted provider checkout is unavailable.")
          const checkoutUrl = new URL(b.checkout_url)
          if (checkoutUrl.protocol !== "https:" || !checkoutUrl.hostname.endsWith(".stripe.com")) {
            throw new Error("The provider returned an invalid secure checkout address.")
          }
          window.location.assign(checkoutUrl.toString())
          return
        }
        setData({ ...b, provider, provider_mode: b.provider_mode || null })
      })
      .catch((e) => setError(e.message))
  }, [token, reload])
  async function simulate(outcome: string) {
    setBusy(true)
    try {
      const r = await fetch(`/api/checkout/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      })
      const b: { error?: { message?: string }; status: string } = await r.json()
      if (!r.ok) throw new Error(b.error?.message || "Payment could not be completed.")
      setData((d) => (d ? { ...d, status: b.status } : d))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to simulate payment")
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="checkout-page">
      <Link className="wordmark" href="/">
        agora<span>·</span>
      </Link>
      {data && (
        <span className="sandbox-mark">
          {data.provider === "stripe"
            ? data.provider_mode
              ? `Stripe ${data.provider_mode}`
              : "Stripe mode unknown"
            : "Test mode"}
        </span>
      )}
      {error ? (
        <>
          <h1>Checkout unavailable.</h1>
          <p role="alert">{error}</p>
          <button className="checkout-control" onClick={() => setReload((value) => value + 1)}>
            Try again
          </button>
        </>
      ) : !data ? (
          <p role="status" aria-live="polite">Loading your checkout…</p>
      ) : (
        <>
          <h1>
            {data.status === "succeeded" && data.provider === "sandbox"
              ? "Payment simulated successfully."
              : data.status === "failed" && data.provider === "sandbox"
                ? "Payment declined."
                : data.product_name}
          </h1>
          <p>
            {data.provider === "stripe"
              ? data.status === "pending"
                ? "Payment status is waiting for confirmation from the payment provider. This page does not confirm payment. Check again later or return to the merchant."
                : `The payment provider reports this payment as ${data.status}.`
              : data.status === "succeeded"
              ? "Your simulated payment succeeded."
              : data.status === "failed"
                ? "This simulated payment was declined. Create another checkout to try again."
                : "Try a payment without entering a card."}
          </p>
          <div className="checkout-total">
            {new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
            }).format(data.amount / 100)}
            <span>USD · {data.product_name}</span>
          </div>
          {data.status === "pending" && data.provider === "sandbox" ? (
            <form
              className="form-stack"
              aria-label="Test payment outcome"
              onSubmit={(event) => {
                event.preventDefault()
                const outcome = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value")
                if (outcome === "succeeded" || outcome === "failed") {
                  void simulate(outcome)
                }
              }}
            >
              <button type="submit" name="outcome" value="succeeded" className="checkout-control" disabled={busy}>
                {busy ? "Processing…" : "Simulate successful payment"}
              </button>
              <button
                type="submit"
                name="outcome"
                value="failed"
                className="checkout-control checkout-control-secondary"
                disabled={busy}
              >
                Simulate decline
              </button>
            </form>
          ) : (
            <button className="checkout-control" onClick={() => location.assign("/?view=Payments")}>
              {data.provider === "stripe" ? "Return to merchant" : "Back to payments"}
            </button>
          )}
          <p className="form-note">{data.provider === "stripe" ? "Payment status is finalized by verified provider events." : "No live charge will be made."}</p>
          <code>{data.id}</code>
        </>
      )}
    </main>
  )
}
