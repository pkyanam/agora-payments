"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useEffect, useState } from "react"

export type QuoteDetailsRecord = {
  id: string
  version?: number
  status: string
  customer_name?: string
  customer_email?: string | null
  expires_at: string
  subtotal_amount: number
  discount_amount: number
  total_amount: number
  currency: string
  quote_url?: string | null
  quote_link_available?: boolean
  items: Array<{
    product_id?: string
    product_name: string
    quantity: number
    unit_amount: number
    line_total: number
  }>
}

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100)

export function QuoteDetails({
  quote,
  onCopy,
  onEdit,
}: {
  quote: QuoteDetailsRecord
  onCopy: (url: string) => void
  onEdit: () => void
}) {
  const [expired, setExpired] = useState(false)
  useEffect(() => {
    const delay = Date.parse(quote.expires_at) - Date.now()
    if (delay > 2_147_000_000) return
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, delay))
    return () => window.clearTimeout(timer)
  }, [quote.expires_at])
  const editable = quote.status === "open" && !expired

  return (
    <div className="form-stack">
      <p>
        {quote.customer_email || "No email provided"} ·{" "}
        <Badge variant="secondary">{quote.status}</Badge>
      </p>
      <ul>
        {quote.items.map((item, index) => (
          <li key={`${quote.id}-${index}`}>
            {item.quantity} × {item.product_name} ·{" "}
            {money(item.unit_amount, quote.currency)} each ·{" "}
            {money(item.line_total, quote.currency)}
          </li>
        ))}
      </ul>
      <p>
        Subtotal {money(quote.subtotal_amount, quote.currency)}
        {quote.discount_amount > 0 &&
          ` · Discount −${money(quote.discount_amount, quote.currency)}`}
        {` · Total ${money(quote.total_amount, quote.currency)} ${quote.currency.toUpperCase()}`}
      </p>
      <p>Expires {new Date(quote.expires_at).toLocaleString()}</p>
      {quote.quote_url && quote.quote_link_available !== false ? (
        <>
          <a
            className="checkout-share-link"
            href={quote.quote_url}
            target="_blank"
            rel="noreferrer"
          >
            Open original quote
          </a>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onCopy(quote.quote_url!)}
          >
            Copy original quote link
          </Button>
        </>
      ) : (
        <p role="status">This quote has no recoverable share link.</p>
      )}
      {editable ? (
        <Button type="button" disabled={!quote.version} onClick={onEdit}>
          Edit open quote
        </Button>
      ) : (
        <p className="form-note">
          Accepted, expired, and closed quotes are read only. Their original
          details remain available here.
        </p>
      )}
    </div>
  )
}
