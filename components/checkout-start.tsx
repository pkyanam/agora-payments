"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { checkoutTokenFromHash, isCheckoutCapabilityToken } from "@/lib/checkout-token"

export default function CheckoutStart() {
  const [state, setState] = useState<"starting" | "error">("starting")
  const [message, setMessage] = useState("Opening secure checkout…")
  const [retry, setRetry] = useState(0)
  const [canRetry, setCanRetry] = useState(false)
  const tokenRef = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    const start = async () => {
      // React Strict Mode replays effects after the first pass has already
      // removed the capability from the URL. Retain it in the component ref.
      tokenRef.current = checkoutTokenFromHash(window.location.hash, tokenRef.current)
      const token = tokenRef.current
      window.history.replaceState(null, "", window.location.pathname)
      if (!isCheckoutCapabilityToken(token)) {
        if (active) {
          setState("error")
          setMessage("This checkout link is incomplete. Request a new link from the merchant.")
          setCanRetry(false)
        }
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
        setCanRetry(true)
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
      {state === "error" && canRetry && (
        <button
          className="checkout-control checkout-control-secondary"
          onClick={() => {
            setCanRetry(false)
            setState("starting")
            setMessage("Opening secure checkout…")
            setRetry((value) => value + 1)
          }}
        >
          Try again
        </button>
      )}
    </main>
  )
}
