"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"

type Mode = "test" | "live"
type SetupState = {
  provider: "stripe" | "sandbox"
  mode: Mode
  readiness: "setup_required" | "ready"
  checkout_enabled: boolean
  webhook_url: string
  public_origin: string
  configured: Record<Mode, { secret_key: boolean; webhook_secret: boolean; webhook_verified: boolean }>
}
type Result = { error?: { message?: string }; [key: string]: unknown }

async function request(path: string, init?: RequestInit): Promise<Result> {
  const response = await fetch(path, { cache: "no-store", ...init })
  const result = await response.json() as Result
  if (!response.ok) throw new Error(result.error?.message || `Stripe setup request failed (${response.status}).`)
  return result
}

export function StripeSetup({ onChange }: { onChange: () => void }) {
  const [setup, setSetup] = useState<SetupState | null>(null)
  const [mode, setMode] = useState<Mode>("test")
  const [testKey, setTestKey] = useState("")
  const [testWebhook, setTestWebhook] = useState("")
  const [liveKey, setLiveKey] = useState("")
  const [liveWebhook, setLiveWebhook] = useState("")
  const [origin, setOrigin] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const load = useCallback(async (initial = false) => {
    if (!initial) setLoading(true)
    try {
      const result = await request("/api/console/stripe-config") as unknown as SetupState
      setSetup(result)
      setMode(result.mode)
      setOrigin(result.public_origin || (typeof location !== "undefined" ? location.origin : ""))
      setMessage("")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Stripe setup could not be loaded.")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(true) }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const active = setup?.configured[mode]
  const listenerCommand = setup ? `stripe listen --forward-to '${setup.webhook_url}'` : ""
  const triggerCommand = "stripe trigger account.updated"
  const copyCommand = (value: string, label: string) => navigator.clipboard.writeText(value)
    .then(() => toast.success(`${label} copied`))
    .catch(() => toast.error("Clipboard unavailable; select and copy the command."))
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setMessage("")
    try {
      const body: Record<string, string> = { provider: "stripe", mode, public_origin: origin.trim() }
      if (testKey.trim()) body.test_secret_key = testKey.trim()
      if (testWebhook.trim()) body.test_webhook_secret = testWebhook.trim()
      if (liveKey.trim()) body.live_secret_key = liveKey.trim()
      if (liveWebhook.trim()) body.live_webhook_secret = liveWebhook.trim()
      const result = await request("/api/console/stripe-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      setTestKey("")
      setTestWebhook("")
      setLiveKey("")
      setLiveWebhook("")
      await load()
      onChange()
      if (result.readiness === "ready") toast.success(`Stripe ${mode} mode is ready.`)
      else toast.success(`Stripe ${mode} settings saved. Send a signed test event to verify the webhook.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Stripe settings could not be saved.")
    } finally {
      setBusy(false)
    }
  }
  const switchMode = async (next: Mode) => {
    if (next === mode || busy) return
    setBusy(true)
    setMessage("")
    try {
      await request("/api/console/stripe-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "stripe", mode: next }),
      })
      setMode(next)
      await load()
      onChange()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment mode could not be changed.")
    } finally {
      setBusy(false)
    }
  }
  const verify = async () => {
    setBusy(true)
    setMessage("")
    try {
      const result = await request("/api/console/stripe-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", mode }),
      }) as { ok?: boolean; account_id?: string; webhook?: { configured?: boolean; verified?: boolean } }
      if (!result.ok) throw new Error("Stripe could not confirm this account. Check the selected mode and key.")
      await load()
      onChange()
      if (!result.webhook?.configured) setMessage(`Stripe account ${result.account_id || "connected"} responded. Add the webhook signing secret, then send a signed test event to ${setup?.webhook_url || "the endpoint above"}.`)
      else if (!result.webhook.verified) setMessage("Stripe account responded. Send a signed test event to the endpoint below; Agora verifies the signature when it arrives.")
      else toast.success(`Stripe ${mode} connection verified.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Stripe could not be verified.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="stripe-setup" aria-labelledby="stripe-setup-title">
      <div className="stripe-setup-heading">
        <div>
          <span className="section-label">Payment provider</span>
          <h2 id="stripe-setup-title">Stripe setup</h2>
          <p>Connect your own Stripe account. Agora never handles card details or adds a payment markup.</p>
        </div>
        <span className={`setup-state ${setup?.checkout_enabled ? "is-ready" : ""}`} role="status">
          {loading ? "Checking…" : setup?.checkout_enabled ? "Ready" : "Setup required"}
        </span>
      </div>
      {loading ? <p className="form-note" role="status">Loading Stripe configuration…</p> : !setup ? (
        <div className="auth-error" role="alert"><p>{message || "Stripe configuration is unavailable."}</p><Button variant="secondary" onClick={() => void load()}>Try again</Button></div>
      ) : (
        <>
          <div className="stripe-mode-row">
            <div>
              <strong>Payment mode</strong>
              <p>Sandbox uses Stripe’s test transactions. Live mode can move real money.</p>
            </div>
            <div className="mode-switch" role="group" aria-label="Stripe payment mode">
              {(["test", "live"] as const).map((value) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => void switchMode(value)} disabled={busy}>{value === "test" ? "Sandbox" : "Live"}</button>)}
            </div>
          </div>
          <div className="stripe-readiness" aria-label={`${mode} mode setup status`}>
            <span className={active?.secret_key ? "complete" : "incomplete"}>{active?.secret_key ? "✓" : "1"} Secret key {active?.secret_key ? "saved" : "needed"}</span>
            <span className={active?.webhook_secret ? "complete" : "incomplete"}>{active?.webhook_secret ? "✓" : "2"} Webhook secret {active?.webhook_secret ? "saved" : "needed"}</span>
            <span className={active?.webhook_verified ? "complete" : "incomplete"}>{active?.webhook_verified ? "✓" : "3"} Signed event {active?.webhook_verified ? "verified" : "to verify"}</span>
          </div>
          <div className="webhook-endpoint">
            <div><strong>Webhook endpoint</strong><p>Add this endpoint in Stripe → Developers → Webhooks for the selected mode. Send Stripe’s <code>account.updated</code> test event to verify webhook delivery. Also subscribe to <code>checkout.session.completed</code>, <code>checkout.session.async_payment_succeeded</code>, <code>checkout.session.async_payment_failed</code>, <code>checkout.session.expired</code>, and <code>refund.updated</code>. Agora reconciles refund updates only for refunds it created and can map by metadata; refunds created outside Agora are not imported. For mapped risk signals, add <code>radar.early_fraud_warning.created</code>, <code>radar.early_fraud_warning.updated</code>, <code>review.opened</code>, and <code>review.closed</code>. Only unambiguous payment matches appear in Agora.</p></div>
            <div className="copyable-value"><code>{setup.webhook_url}</code><Button variant="secondary" size="sm" onClick={() => navigator.clipboard.writeText(setup.webhook_url).then(() => toast.success("Webhook URL copied")).catch(() => toast.error("Clipboard unavailable; select and copy the URL."))}>Copy URL</Button></div>
          </div>
          {mode === "test" && <div className="webhook-endpoint stripe-cli-steps">
            <div><strong>Or verify with Stripe CLI</strong><p>In one terminal, run the listener and paste its temporary <code>whsec_…</code> value into the test webhook secret field. In a second terminal, trigger a harmless test event. Keep the listener running while testing.</p></div>
            <div className="copyable-value"><code>{listenerCommand}</code><Button variant="secondary" size="sm" onClick={() => copyCommand(listenerCommand, "Listener command")}>Copy command</Button></div>
            <div className="copyable-value"><code>{triggerCommand}</code><Button variant="secondary" size="sm" onClick={() => copyCommand(triggerCommand, "Test event command")}>Copy command</Button></div>
            <small>Stripe CLI must be authenticated to the same Stripe account in test mode. For a local TLS certificate error only, add <code>--skip-verify</code> to the listener command.</small>
          </div>}
          <form className="form-stack stripe-setup-form" onSubmit={save}>
            <div className="field">
              <Label htmlFor="agora-public-origin">Public app URL</Label>
              <Input id="agora-public-origin" type="url" autoComplete="url" value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="https://payments.example.com" required />
              <small>Must be the HTTPS address customers use to reach this Agora deployment.</small>
            </div>
            {mode === "test" ? <>
              <div className="field"><Label htmlFor="agora-test-secret">Stripe test secret key</Label><Input id="agora-test-secret" type="password" autoComplete="new-password" value={testKey} onChange={(event) => setTestKey(event.target.value)} placeholder={setup.configured.test.secret_key ? "Saved securely · leave blank to keep" : "sk_test_…"} /><small>Agora currently uses account read, Checkout Session create and retrieve, and refund create operations. The connection check tests account read only; it does not verify all these permissions. The key is never shown again.</small></div>
              <div className="field"><Label htmlFor="agora-test-webhook">Stripe test webhook signing secret</Label><Input id="agora-test-webhook" type="password" autoComplete="new-password" value={testWebhook} onChange={(event) => setTestWebhook(event.target.value)} placeholder={setup.configured.test.webhook_secret ? "Saved securely · leave blank to keep" : "whsec_…"} /><small>Copy this from the webhook endpoint in Stripe test mode. It is different from your API key.</small></div>
            </> : <>
              <div className="field"><Label htmlFor="agora-live-secret">Stripe live secret key</Label><Input id="agora-live-secret" type="password" autoComplete="new-password" value={liveKey} onChange={(event) => setLiveKey(event.target.value)} placeholder={setup.configured.live.secret_key ? "Saved securely · leave blank to keep" : "sk_live_…"} /><small>Live mode can charge real cards. Agora currently uses account read, Checkout Session create and retrieve, and refund create operations. The connection check tests account read only, not all these permissions.</small></div>
              <div className="field"><Label htmlFor="agora-live-webhook">Stripe live webhook signing secret</Label><Input id="agora-live-webhook" type="password" autoComplete="new-password" value={liveWebhook} onChange={(event) => setLiveWebhook(event.target.value)} placeholder={setup.configured.live.webhook_secret ? "Saved securely · leave blank to keep" : "whsec_…"} /><small>Copy this from the webhook endpoint in Stripe live mode. Test and live secrets are separate.</small></div>
            </>}
            {message && <p className="setup-message" role="status">{message}</p>}
            <div className="stripe-setup-actions"><Button type="submit" disabled={busy}>{busy ? "Saving…" : `Save ${mode} settings`}</Button><Button type="button" variant="secondary" disabled={busy || !active?.secret_key} onClick={() => void verify()}>{busy ? "Checking…" : "Check Stripe connection"}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => void load()}>Refresh status</Button></div>
          </form>
        </>
      )}
    </section>
  )
}
