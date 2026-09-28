"use client"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
export default function Checkout({ token }: { token: string }) {
  const [data, setData] = useState<{
    product_name: string
    amount: number
    status: string
    id: string
  } | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    fetch(`/api/checkout/${token}`)
      .then(async (r) => {
        const b: { error?: { message?: string }; product_name: string; amount: number; status: string; id: string } = await r.json()
        if (!r.ok) throw new Error(b.error?.message || "Checkout is unavailable.")
        setData(b)
      })
      .catch((e) => setError(e.message))
  }, [token])
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
      <a className="wordmark" href="/">
        agora<span>·</span>
      </a>
      <span className="sandbox-mark">Test mode</span>
      {error ? (
        <>
          <h1>Checkout unavailable.</h1>
          <p>{error}</p>
        </>
      ) : !data ? (
        <p>Loading your checkout…</p>
      ) : (
        <>
          <p className="eyebrow">ACME STUDIO</p>
          <h1>
            {data.status === "succeeded"
              ? "Payment simulated successfully."
              : data.status === "failed"
                ? "Payment declined."
                : data.product_name}
          </h1>
          <p>
            {data.status === "succeeded"
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
          {data.status === "pending" ? (
            <div className="form-stack">
              <Button disabled={busy} onClick={() => simulate("succeeded")}>
                {busy ? "Processing…" : "Simulate successful payment"}
              </Button>
              <Button
                disabled={busy}
                variant="ghost"
                onClick={() => simulate("failed")}
              >
                Simulate decline
              </Button>
            </div>
          ) : (
            <Button onClick={() => location.assign("/?view=Payments")}>
              Back to payments
            </Button>
          )}
          <p className="form-note">No live charge will be made.</p>
          <code>{data.id}</code>
        </>
      )}
    </main>
  )
}
