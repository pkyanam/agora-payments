"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"

type Signal = {
  id: string
  payment_id: string
  kind: "early_fraud_warning" | "review"
  state: "actionable" | "inactive" | "open" | "closed" | "unknown"
  actionable: boolean | null
  fraud_type: string | null
  reason: string | null
  created_at: string
  updated_at: string
}
type SignalResult = {
  status: "unconfigured" | "awaiting_verification" | "ready"
  mode: "test" | "live"
  source: "verified_stripe_webhooks"
  data: Signal[]
  next_cursor: string | null
  error?: { message?: string }
}

function when(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString()
}

export function RiskSignals({ preferredMode }: { preferredMode?: "test" | "live" }) {
  const [mode, setMode] = useState<"test" | "live">(preferredMode || "test")
  const [items, setItems] = useState<Signal[]>([])
  const [status, setStatus] = useState<SignalResult["status"] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [reloadToken, setReloadToken] = useState(0)
  const activeMode = useRef(mode)

  useEffect(() => {
    activeMode.current = mode
    const controller = new AbortController()
    const params = new URLSearchParams({ mode, limit: "25" })
    void (async () => {
      setLoading(true)
      setError("")
      setItems([])
      setStatus(null)
      setCursor(null)
      try {
        const response = await fetch(`/api/console/risk-signals?${params}`, { cache: "no-store", signal: controller.signal })
        const result = await response.json() as SignalResult
        if (!response.ok) throw new Error(response.status === 404 ? "Risk signal feed is unavailable in this deployment." : "Risk signals could not be loaded. Try again.")
        if (controller.signal.aborted) return
        setStatus(result.status)
        setItems(result.data)
        setCursor(result.next_cursor)
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Risk signals could not be loaded.")
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [mode, reloadToken])

  const loadMore = async () => {
    if (!cursor || loading) return
    const requestedMode = mode
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams({ mode, limit: "25", cursor })
      const response = await fetch(`/api/console/risk-signals?${params}`, { cache: "no-store" })
      const result = await response.json() as SignalResult
      if (!response.ok) throw new Error(response.status === 404 ? "Risk signal feed is unavailable in this deployment." : "More risk signals could not be loaded. Try again.")
      if (activeMode.current !== requestedMode) return
      setItems((current) => [...current, ...result.data])
      setCursor(result.next_cursor)
    } catch (reason) {
      if (activeMode.current === requestedMode) setError(reason instanceof Error ? reason.message : "More risk signals could not be loaded.")
    } finally { setLoading(false) }
  }

  return <section className="risk-signals" aria-labelledby="risk-signals-title">
    <div className="section-heading risk-signals-heading">
      <div><h2 id="risk-signals-title">Stripe risk signals</h2><p>Verified Radar warnings and Stripe Review events mapped to Agora payments.</p></div>
      <div className="risk-mode-controls" role="group" aria-label="Risk signal payment mode">
        <Button type="button" size="sm" variant={mode === "test" ? "secondary" : "ghost"} aria-pressed={mode === "test"} onClick={() => setMode("test")}>Test mode</Button>
        <Button type="button" size="sm" variant={mode === "live" ? "secondary" : "ghost"} aria-pressed={mode === "live"} onClick={() => setMode("live")}>Live mode</Button>
      </div>
    </div>
    <p className="form-note" role="note">Only mapped, signed Stripe signals appear here. No signal is not a risk assessment.</p>
    {status === "unconfigured" && <p className="risk-status" role="status">Stripe webhook setup is not configured for {mode} mode.</p>}
    {status === "awaiting_verification" && <p className="risk-status" role="status">Waiting for a valid signed Stripe webhook in {mode} mode before showing signals.</p>}
    {error && <p className="risk-status" role="alert">{error} <Button type="button" variant="ghost" size="sm" onClick={() => setReloadToken((value) => value + 1)}>Retry</Button></p>}
    {loading && items.length === 0 ? <p role="status">Loading signals…</p> : items.length === 0 ? status === "ready" ? <p className="empty-row">No mapped Radar warnings or Reviews received in {mode} mode.</p> : null : <div className="risk-signal-list">
      {items.map((signal) => <details className="risk-signal-card" key={`${mode}-${signal.id}`}>
        <summary className="risk-signal-title"><strong>{signal.kind === "early_fraud_warning" ? "Early fraud warning" : "Stripe Review"}</strong><span className={`risk-state risk-state-${signal.state}`}>{signal.state.replaceAll("_", " ")}</span><time dateTime={signal.updated_at}>{when(signal.updated_at)}</time></summary>
        <dl>
          <div><dt>Payment</dt><dd><code>{signal.payment_id}</code></dd></div>
          {signal.fraud_type && <div><dt>Signal type</dt><dd>{signal.fraud_type.replaceAll("_", " ")}</dd></div>}
          {signal.kind === "early_fraud_warning" && <div><dt>Actionable</dt><dd>{signal.actionable === true ? "Yes" : signal.actionable === false ? "No longer actionable" : "Unknown"}</dd></div>}
          {signal.reason && <div><dt>Review reason</dt><dd>{signal.reason.replaceAll("_", " ")}</dd></div>}
          <div><dt>Received</dt><dd>{when(signal.created_at)}</dd></div>
          {signal.updated_at !== signal.created_at && <div><dt>Updated</dt><dd>{when(signal.updated_at)}</dd></div>}
        </dl>
      </details>)}
    </div>}
    {cursor && <Button type="button" variant="secondary" disabled={loading} onClick={() => void loadMore()}>{loading ? "Loading…" : "Load more signals"}</Button>}
  </section>
}
