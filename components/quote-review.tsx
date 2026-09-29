"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"

type QuoteReview = {
  id: string
  merchant: string
  customer_name?: string
  status: "open" | "accepted" | "expired" | "cancelled"
  expires_at: string
  currency: string
  subtotal_amount: number
  discount_amount: number
  total_amount: number
  items: Array<{
    product_name: string
    quantity: number
    unit_amount: number
    line_total: number
    discount_amount: number
    net_total: number
    catalog_version: number
  }>
  order?: {
    id: string
    status: "awaiting_payment" | "paid" | "cancelled"
    fulfillment_status:
      "awaiting_payment" | "ready" | "claimed" | "completed" | "failed" | null
    total_amount: number
    paid_at: string | null
    payment_status?: "paid" | "partially_refunded" | "refunded"
    refunded_amount?: number
    net_amount?: number
    items: Array<{
      product_name: string
      quantity: number
      unit_amount: number
      line_total: number
      discount_amount: number
      net_total: number
    }>
  }
}

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100)

export function QuoteReview() {
  const [quote, setQuote] = useState<QuoteReview | null>(null)
  const capability = useRef("")
  const acceptKey = useRef("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    const token =
      new URLSearchParams(window.location.hash.slice(1)).get("token") ||
      window.location.hash.slice(1)
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`
    )
    if (!token || token.length < 32 || token.length > 256) {
      queueMicrotask(() => {
        if (active) {
          setError(
            "This quote link is missing or invalid. Ask the seller to send a new link."
          )
          setLoaded(true)
        }
      })
      return () => {
        active = false
      }
    }
    capability.current = token
    void (async () => {
      try {
        const response = await fetch("/api/quote/review", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        })
        const body = (await response.json()) as QuoteReview & {
          error?: { message?: string }
        }
        if (!response.ok)
          throw new Error(
            body.error?.message || "Quote details could not be loaded."
          )
        if (active) setQuote(body)
      } catch (reason) {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Quote details could not be loaded."
          )
      } finally {
        if (active) setLoaded(true)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!quote || quote.status !== "open") return
    if (!capability.current) {
      setError(
        "The quote link is no longer available. Ask the seller to send a new link."
      )
      return
    }
    setBusy(true)
    setError("")
    if (!acceptKey.current) acceptKey.current = crypto.randomUUID()
    try {
      const response = await fetch("/api/quote/accept", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": acceptKey.current,
        },
        body: JSON.stringify({ token: capability.current }),
      })
      const body = (await response.json()) as {
        checkout_url?: string
        error?: { message?: string }
      }
      if (!response.ok || !body.checkout_url)
        throw new Error(
          body.error?.message || "The quote could not be accepted."
        )
      const destination = new URL(body.checkout_url, window.location.origin)
      if (destination.origin !== window.location.origin)
        throw new Error("The checkout link is not valid for this Agora site.")
      window.location.assign(destination.href)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The quote could not be accepted."
      )
      setBusy(false)
    }
  }

  const canAccept = quote?.status === "open"
  const statusLabel = quote?.status
  return (
    <main className="checkout-page">
      <span className="wordmark">
        agora<span>·</span>
      </span>
      <span className="checkout-review-mark">PURCHASE QUOTE</span>
      {error && (
        <p role="alert" aria-live="polite">
          {error}
        </p>
      )}
      {!loaded ? (
        <>
          <h1>Loading quote…</h1>
          <p>Checking the seller’s current quote details.</p>
        </>
      ) : !quote ? (
        <>
          <h1>Quote unavailable</h1>
          <p>{error || "The seller’s quote could not be found."}</p>
        </>
      ) : (
        <>
          <h1>Review your purchase</h1>
          <p>
            From {quote.merchant}
            {quote.customer_name
              ? ` · Prepared for ${quote.customer_name}`
              : ""}
          </p>
          <section className="checkout-review-card" aria-label="Quote details">
            <dl>
              {quote.items.map((item, index) => (
                <div key={`${quote.id}-${index}`}>
                  <dt>
                    {item.quantity} × {item.product_name}
                    <small>
                      Unit price {money(item.unit_amount, quote.currency)} ·
                      catalog v{item.catalog_version}
                    </small>
                  </dt>
                  <dd>{money(item.line_total, quote.currency)}</dd>
                  {item.discount_amount > 0 && (
                    <small>
                      After discount: {money(item.net_total, quote.currency)}
                    </small>
                  )}
                </div>
              ))}
              {quote.discount_amount > 0 && (
                <div>
                  <dt>Subtotal</dt>
                  <dd>{money(quote.subtotal_amount, quote.currency)}</dd>
                </div>
              )}
              {quote.discount_amount > 0 && (
                <div>
                  <dt>Discount</dt>
                  <dd>−{money(quote.discount_amount, quote.currency)}</dd>
                </div>
              )}
              <div className="checkout-review-amount">
                <dt>Total</dt>
                <dd>
                  {money(quote.total_amount, quote.currency)}{" "}
                  <span>{quote.currency.toUpperCase()}</span>
                </dd>
              </div>
              <div>
                <dt>Quote expires</dt>
                <dd>{new Date(quote.expires_at).toLocaleString()}</dd>
              </div>
            </dl>
          </section>
          {quote.order ? (
            <section className="checkout-review-card" aria-label="Order status">
              <h2>
                {quote.order.status === "paid"
                  ? "Payment confirmed"
                  : "Order status"}
              </h2>
              <p role="status">
                {quote.order.status === "paid"
                  ? `Order ${quote.order.id} is ${quote.order.payment_status === "refunded" ? "refunded" : quote.order.payment_status === "partially_refunded" ? "partially refunded" : "paid"}. Fulfillment: ${quote.order.fulfillment_status ?? "pending"}.`
                  : quote.order.status === "cancelled"
                    ? `Order ${quote.order.id} was not paid. No receipt was issued.`
                    : `Order ${quote.order.id} is awaiting payment. Fulfillment has not started.`}
              </p>
              {quote.order.status === "paid" && (
                <>
                  <dl>
                    {quote.order.items.map((item, index) => (
                      <div key={`${quote.order?.id}-${index}`}>
                        <dt>
                          {item.quantity} × {item.product_name}
                        </dt>
                        <dd>{money(item.net_total, quote.currency)}</dd>
                      </div>
                    ))}
                    <div className="checkout-review-amount">
                      <dt>Total charged</dt>
                      <dd>{money(quote.order.total_amount, quote.currency)}</dd>
                    </div>
                    {(quote.order.refunded_amount || 0) > 0 && (
                      <>
                        <div>
                          <dt>Refunded</dt>
                          <dd>
                            −
                            {money(
                              quote.order.refunded_amount || 0,
                              quote.currency
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Net after refund</dt>
                          <dd>
                            {money(quote.order.net_amount || 0, quote.currency)}
                          </dd>
                        </div>
                      </>
                    )}
                    {quote.order.paid_at && (
                      <div>
                        <dt>Paid on</dt>
                        <dd>
                          {new Date(quote.order.paid_at).toLocaleString()}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>Order reference</dt>
                      <dd>{quote.order.id}</dd>
                    </div>
                  </dl>
                  <button
                    className="checkout-control"
                    type="button"
                    onClick={() => window.print()}
                  >
                    Print / Save receipt as PDF
                  </button>
                </>
              )}
            </section>
          ) : canAccept ? (
            <form
              className="form-stack"
              onSubmit={(event) => void accept(event)}
            >
              <button
                className="checkout-control"
                disabled={busy}
                type="submit"
              >
                {busy
                  ? "Preparing secure checkout…"
                  : "Accept quote and continue to secure checkout"}
              </button>
              <p className="checkout-review-footer">
                You’ll review the order once more before continuing to the
                payment provider. You can close this page without accepting.
              </p>
            </form>
          ) : (
            <p className="checkout-review-footer" role="status">
              This quote is {statusLabel}. Ask the seller for an updated quote.
            </p>
          )}
        </>
      )}
    </main>
  )
}
