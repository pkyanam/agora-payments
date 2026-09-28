"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"

type Endpoint = {
  id: string
  url: string
  mode: "test" | "live"
  event_types: string[]
  status: "active" | "paused" | "archived"
  created_at?: string
  secret_updated_at?: string | null
  last_delivery_at?: string | null
  last_status?: string | null
  success_count?: number
  fail_count?: number
}
type Delivery = {
  id: string
  event_id?: string
  event_type?: string
  status?: string
  attempt_count?: number
  last_http_status?: number | null
  last_error?: string | null
  last_attempt_at?: string | null
  created_at?: string
  delivered_at?: string | null
  next_attempt_at?: string | null
}
type DeliveryAttempt = {
  attempt: number
  started_at?: string
  finished_at?: string | null
  http_status?: number | null
  duration_ms?: number | null
  error?: string | null
}
type ApiResult = {
  error?: { message?: string }
  data?: Endpoint[] | Delivery[]
  endpoint?: Endpoint
  signing_secret?: string
  deliveries?: Delivery[]
  next_cursor?: string | null
  [key: string]: unknown
}

class WebhookApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

const eventOptions = [
  "product.created", "product.archived", "product.restored", "payment.created", "payment.succeeded", "payment.failed", "payment.archived", "payment.restored",
  "refund.requested", "refund.succeeded", "refund.failed", "approval.requested",
  "key.created", "key.revoked", "provider.stripe.connected", "provider.stripe.disconnected",
  "registration.created",
]

async function request(path: string, init?: RequestInit): Promise<ApiResult> {
  const response = await fetch(path, { cache: "no-store", ...init })
  let result: ApiResult = {}
  try { result = await response.json() as ApiResult } catch { /* handled below */ }
  if (!response.ok) throw new WebhookApiError(result.error?.message || `Webhook request failed (${response.status}).`, response.status)
  return result
}

function safeDate(value?: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString()
}

export function OutgoingWebhooks() {
  const [items, setItems] = useState<Endpoint[]>([])
  const [url, setUrl] = useState("")
  const [events, setEvents] = useState<string[]>(["payment.succeeded", "payment.failed"])
  const [mode, setMode] = useState<"test" | "live">("test")
  const [loading, setLoading] = useState(true)
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [revealedSecret, setRevealedSecret] = useState("")
  const [selected, setSelected] = useState<Endpoint | null>(null)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<DeliveryAttempt[]>([])
  const [attemptsFor, setAttemptsFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [result, config] = await Promise.all([
        request("/api/console/webhooks"),
        request("/api/console/stripe-config"),
      ])
      setItems(Array.isArray(result.data) ? result.data as Endpoint[] : [])
      if (config.mode === "test" || config.mode === "live") setMode(config.mode)
      setAvailable(true)
    } catch (reason) {
      if (reason instanceof WebhookApiError && reason.status === 404) setAvailable(false)
      setError(reason instanceof Error ? reason.message : "Outgoing webhooks could not be loaded.")
    } finally { setLoading(false) }
  }, [])
  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) return load() })
    return () => { cancelled = true }
  }, [load])

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      const result = await request("/api/console/webhooks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), mode, event_types: events }),
      })
      if (!result.signing_secret) throw new Error("The endpoint was created, but its signing secret was not returned. Check the endpoint list before retrying.")
      setRevealedSecret(result.signing_secret)
      setUrl("")
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The endpoint could not be created.")
    } finally { setBusy(false) }
  }

  const update = async (item: Endpoint, body: Record<string, unknown>) => {
    setBusy(true); setError("")
    try {
      await request(`/api/console/webhooks/${encodeURIComponent(item.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })
      await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Endpoint update failed.") }
    finally { setBusy(false) }
  }

  const rotate = async (item: Endpoint) => {
    if (!window.confirm(`Rotate the signing secret for ${item.url}? The old secret stops working immediately.`)) return
    setBusy(true); setError("")
    try {
      const result = await request(`/api/console/webhooks/${encodeURIComponent(item.id)}/rotate-secret`, { method: "POST" })
      if (!result.signing_secret) throw new Error("No new signing secret was returned. Refresh endpoint status before retrying.")
      setRevealedSecret(result.signing_secret)
      await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Secret rotation failed.") }
    finally { setBusy(false) }
  }

  const archive = async (item: Endpoint) => {
    if (!window.confirm(`Archive ${item.url}? Existing delivery history will remain available.`)) return
    setBusy(true); setError("")
    try {
      await request(`/api/console/webhooks/${encodeURIComponent(item.id)}`, { method: "DELETE" })
      if (selected?.id === item.id) setSelected(null)
      await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Endpoint could not be archived.") }
    finally { setBusy(false) }
  }

  const loadDeliveries = async (item: Endpoint, cursor?: string | null) => {
    setBusy(true); setError("")
    try {
      const query = new URLSearchParams({ limit: "25" })
      if (cursor) query.set("cursor", cursor)
      const result = await request(`/api/console/webhooks/${encodeURIComponent(item.id)}/deliveries?${query}`)
      const rows = Array.isArray(result.data) ? result.data as Delivery[] : Array.isArray(result.deliveries) ? result.deliveries : []
      setSelected(item)
      setDeliveries(cursor ? [...deliveries, ...rows] : rows)
      setNextCursor(typeof result.next_cursor === "string" ? result.next_cursor : null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Delivery history could not be loaded.") }
    finally { setBusy(false) }
  }

  const replay = async (item: Endpoint, delivery: Delivery) => {
    setBusy(true); setError("")
    try {
      await request(`/api/console/webhooks/${encodeURIComponent(item.id)}/deliveries/${encodeURIComponent(delivery.id)}/replay`, { method: "POST" })
      toast.success("A new delivery attempt was queued.")
      await loadDeliveries(item)
      await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Delivery could not be replayed.") }
    finally { setBusy(false) }
  }

  const loadAttempts = async (item: Endpoint, delivery: Delivery) => {
    if (attemptsFor === delivery.id) { setAttemptsFor(null); return }
    setBusy(true); setError("")
    try {
      const result = await request(`/api/console/webhooks/${encodeURIComponent(item.id)}/deliveries/${encodeURIComponent(delivery.id)}`)
      setAttempts(Array.isArray(result.attempts) ? result.attempts as DeliveryAttempt[] : [])
      setAttemptsFor(delivery.id)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Attempt history could not be loaded.") }
    finally { setBusy(false) }
  }

  const copySecret = async () => {
    try { await navigator.clipboard.writeText(revealedSecret); toast.success("Signing secret copied") }
    catch { toast.error("Clipboard unavailable; select and copy the secret.") }
  }

  return <section className="outgoing-webhooks" aria-labelledby="outgoing-webhooks-title">
    <div className="section-heading">
      <div><h2 id="outgoing-webhooks-title">Outgoing webhooks</h2><p>Send signed Agora events to your server. Secrets are shown only once.</p></div>
    </div>
    {revealedSecret && <div className="webhook-secret-reveal" role="alert">
      <strong>Copy this signing secret now</strong>
      <p>It will not be shown again. Store it on your server; never add it to browser or mobile code.</p>
      <code>{revealedSecret}</code>
      <div><Button type="button" variant="secondary" onClick={() => void copySecret()}>Copy secret</Button><Button type="button" variant="ghost" onClick={() => setRevealedSecret("")}>Done</Button></div>
    </div>}
    {available && <form className="form-stack webhook-create-form" onSubmit={create}>
      <div className="field"><Label htmlFor="webhook-url">Destination URL</Label><Input id="webhook-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://api.example.com/agora-events" required /><small>HTTPS endpoint on a server you control. Do not use a browser or mobile-app URL.</small></div>
      <div className="field"><Label htmlFor="webhook-mode">Payment event mode</Label><select id="webhook-mode" value={mode} onChange={(event) => setMode(event.target.value as "test" | "live")}><option value="test">Test / sandbox</option><option value="live">Live</option></select><small>Payment and refund events are delivered only to endpoints for their matching mode. Administrative events are available in both.</small></div>
      <fieldset className="webhook-event-picker"><legend>Events to send</legend><div>{eventOptions.map((value) => <label key={value}><input type="checkbox" checked={events.includes(value)} onChange={(event) => setEvents((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value))} /> <code>{value}</code></label>)}</div></fieldset>
      {error && <p className="setup-message" role="alert">{error}</p>}
      <Button type="submit" disabled={busy || events.length === 0}>{busy ? "Saving…" : "Add endpoint"}</Button>
    </form>}
    {!available && <div className="form-note" role="status">
      {loading ? "Checking webhook support…" : error
        ? <>{error} Webhook controls are hidden until this deployment’s API is ready. <Button type="button" variant="ghost" onClick={() => void load()}>Retry</Button></>
        : "Webhook controls are unavailable in this deployment."}
    </div>}
    {available && <div className="webhook-endpoint-list">
      {loading ? <p role="status">Loading endpoints…</p> : items.length === 0 ? <p className="empty-row">No outgoing webhook endpoints yet.</p> : items.map((item) => <article className="webhook-endpoint-card" key={item.id}>
        <div className="webhook-endpoint-card-heading"><div><strong>{item.url}</strong><p>{item.mode === "test" ? "Test / sandbox" : "Live"} · {item.event_types.join(" · ")}</p></div><span className={`setup-state ${item.status === "active" ? "is-ready" : ""}`}>{item.status}</span></div>
        <div className="webhook-metrics"><span>Delivered {item.success_count ?? 0}</span><span>Failed {item.fail_count ?? 0}</span><span>Last delivery {safeDate(item.last_delivery_at)}</span><span>Last result {item.last_status || "—"}</span><span>Secret rotated {safeDate(item.secret_updated_at)}</span></div>
        <div className="stripe-setup-actions">
          <Button type="button" variant="secondary" size="sm" disabled={busy || item.status === "archived"} onClick={() => void update(item, { status: item.status === "active" ? "paused" : "active" })}>{item.status === "active" ? "Pause" : "Resume"}</Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void rotate(item)}>Rotate secret</Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void loadDeliveries(item)}>Deliveries</Button>
          {item.status !== "archived" && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void archive(item)}>Archive</Button>}
        </div>
      </article>)}
    </div>}
    {available && selected && <section className="webhook-deliveries" aria-labelledby="webhook-deliveries-title">
      <div className="section-heading"><div><h3 id="webhook-deliveries-title">Delivery history</h3><p>{selected.url}</p></div><Button type="button" variant="ghost" onClick={() => setSelected(null)}>Close</Button></div>
      {deliveries.length === 0 ? <p className="empty-row">No delivery attempts recorded.</p> : deliveries.map((delivery) => <article key={delivery.id} className="webhook-delivery-row">
        <div className="webhook-delivery-main"><div><strong>{delivery.event_type || "Event"}</strong><p>{delivery.id} · {safeDate(delivery.last_attempt_at || delivery.created_at)}</p><small>{delivery.attempt_count ?? 0} attempts · HTTP {delivery.last_http_status ?? "—"} · {delivery.last_error || delivery.status || "No response details"}</small></div>
          <div className="stripe-setup-actions"><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void loadAttempts(selected, delivery)}>{attemptsFor === delivery.id ? "Hide attempts" : "Attempts"}</Button>{delivery.status === "failed" && <Button type="button" size="sm" variant="secondary" disabled={busy || selected.status === "archived"} onClick={() => void replay(selected, delivery)}>Replay</Button>}</div>
          {attemptsFor === delivery.id && <div className="webhook-attempt-history">{attempts.length ? attempts.map((attempt) => <div key={`${delivery.id}-${attempt.attempt}`}><strong>Attempt {attempt.attempt}</strong><span>{safeDate(attempt.started_at)} · HTTP {attempt.http_status ?? "—"} · {attempt.duration_ms ?? "—"} ms</span>{attempt.error && <small>{attempt.error}</small>}</div>) : <p>No network attempts recorded for this delivery yet.</p>}</div>}
        </div>
      </article>)}
      {nextCursor && <Button type="button" variant="secondary" disabled={busy} onClick={() => void loadDeliveries(selected, nextCursor)}>Load more</Button>}
    </section>}
  </section>
}
