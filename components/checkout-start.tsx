"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { checkoutTokenFromHash, isCheckoutCapabilityToken } from "@/lib/checkout-token"

type Review = {
  id: string
  merchant: string
  product_name: string
  customer: string
  amount: number
  currency: "usd"
  status: "pending" | "succeeded" | "failed"
  provider_mode: "test" | "live"
}

export default function CheckoutStart() {
  const router = useRouter()
  const [review, setReview] = useState<Review | null>(null)
  const [message, setMessage] = useState("Loading purchase details…")
  const [busy, setBusy] = useState(false)
  const tokenRef = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    tokenRef.current = checkoutTokenFromHash(window.location.hash, tokenRef.current)
    const token = tokenRef.current
    window.history.replaceState(null, "", window.location.pathname)
    if (!isCheckoutCapabilityToken(token)) {
      setMessage("This checkout link is incomplete. Request a new link from the merchant.")
      return () => { active = false }
    }
    void fetch("/api/checkout/review", {
      method: "POST",
      headers: { "X-Agora-Checkout-Token": token },
      cache: "no-store",
    }).then(async (response) => {
      const body = await response.json() as Review & { error?: { message?: string } }
      if (!response.ok) throw new Error(body.error?.message || "Checkout is unavailable.")
      if (active) {
        setReview(body)
        setMessage("")
      }
    }).catch((error: unknown) => {
      if (active) setMessage(error instanceof Error ? error.message : "Checkout is unavailable.")
    })
    return () => { active = false }
  }, [])

  async function continueToStripe() {
    const token = tokenRef.current
    if (!token || !review || review.status !== "pending") return
    setBusy(true)
    setMessage("Opening Stripe checkout…")
    try {
      const response = await fetch("/api/checkout/prepare", {
        method: "POST",
        headers: { "X-Agora-Checkout-Token": token },
        cache: "no-store",
      })
      const body = await response.json() as { checkout_url?: string; error?: { message?: string } }
      if (!response.ok || !body.checkout_url) throw new Error(body.error?.message || "Secure checkout could not be opened.")
      const url = new URL(body.checkout_url)
      if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com") {
        throw new Error("The provider returned an invalid secure checkout address.")
      }
      window.location.assign(url.toString())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Secure checkout could not be opened.")
      setBusy(false)
    }
  }

  return (
    <main className="checkout-page checkout-review">
      <span className="wordmark">agora<span>·</span></span>
      <span className="checkout-review-mark">SECURE CHECKOUT</span>
      <h1>{review ? "Review your purchase" : message.startsWith("This checkout") || message.includes("unavailable") ? "Checkout unavailable" : "Your purchase"}</h1>
      {review ? <>
        <section className="checkout-review-card" aria-label="Purchase details">
          <p className="checkout-review-merchant">{review.merchant}</p>
          <dl>
            <div><dt>Item</dt><dd>{review.product_name}</dd></div>
            <div><dt>Name</dt><dd>{review.customer || "Guest"}</dd></div>
            <div className="checkout-review-amount"><dt>Total</dt><dd>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(review.amount / 100)} <span>USD</span></dd></div>
          </dl>
        </section>
        <p className="checkout-review-note">You’ll continue to Stripe to enter your payment details.</p>
        {review.status === "pending" ? <button className="checkout-control" disabled={busy} onClick={() => void continueToStripe()}>{busy ? "Connecting to Stripe…" : "Continue to payment"}</button> : review.status === "succeeded" ? <button className="checkout-control" onClick={() => router.push(`/checkout/complete?payment_id=${encodeURIComponent(review.id)}`)}>View receipt</button> : <p role="status" className="checkout-review-status">This payment is no longer available.</p>}
        <p className="checkout-review-footer">Secure payment processed by Stripe · {review.provider_mode === "test" ? "Test mode" : "Live mode"}</p>
      </> : <p role="status" aria-live="polite">{message}</p>}
    </main>
  )
}
