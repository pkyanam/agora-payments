"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

export default function CheckoutStart() {
  const [state, setState] = useState<"starting" | "error">("starting")
  const [message, setMessage] = useState("Opening secure checkout…")
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    const start = async () => {
      const token = window.location.hash.slice(1)
      window.history.replaceState(null, "", window.location.pathname)
      if (!/^[a-f0-9]{32,128}$/i.test(token)) {
        setState("error")
        setMessage("This checkout link is incomplete. Request a new link from the merchant.")
        return
      }
      try {
        const response = await fetch("/api/checkout/prepare", {
          method: "POST",
          headers: { "X-Agora-Checkout-Token": token },
          cache: "no-store",
        })
        const body = (await response.json()) as {
          checkout_url?: string
          error?: { message?: string }
        }
        if (!response.ok || !body.checkout_url) {
          throw new Error(body.error?.message || "Secure checkout could not be opened.")
        }
        const url = new URL(body.checkout_url)
        if (url.protocol !== "https:" || !url.hostname.endsWith(".stripe.com")) {
          throw new Error("The provider returned an invalid secure checkout address.")
        }
        if (active) window.location.assign(url.toString())
      } catch (error) {
        if (!active) return
        setState("error")
        setMessage(error instanceof Error ? error.message : "Secure checkout could not be opened.")
      }
    }
    void start()
    return () => {
      active = false
    }
  }, [retry])

  return (
    <main className="checkout-page checkout-return">
      <Link className="wordmark" href="/">
        agora<span>·</span>
      </Link>
      <h1>{state === "starting" ? "Opening checkout." : "Checkout unavailable."}</h1>
      <p role={state === "error" ? "alert" : "status"} aria-live="polite">
        {message}
      </p>
      {state === "error" && (
        <button
          className="checkout-control checkout-control-secondary"
          onClick={() => setRetry((value) => value + 1)}
        >
          Try again
        </button>
      )}
    </main>
  )
}
