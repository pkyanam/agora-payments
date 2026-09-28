"use client"

import { useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function Register() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [registrationId, setRegistrationId] = useState("")
  const [deploymentType, setDeploymentType] = useState<"community" | "hosted" | "unavailable" | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store", signal: controller.signal })
        const body = await response.json() as { deployment_type?: unknown }
        setDeploymentType(response.ok && (body.deployment_type === "community" || body.deployment_type === "hosted") ? body.deployment_type : "unavailable")
      } catch {
        if (!controller.signal.aborted) setDeploymentType("unavailable")
      }
    })()
    return () => controller.abort()
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    const form = new FormData(event.currentTarget)
    try {
      const response = await fetch("/api/registrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_name: String(form.get("business_name") || "").trim(),
          owner_name: String(form.get("owner_name") || "").trim(),
          email: String(form.get("email") || "").trim(),
        }),
      })
      const raw = await response.text()
      let body: { error?: { message?: string }; registration_id?: string; status?: string }
      try {
        body = JSON.parse(raw)
      } catch {
        throw new Error(`Registration service returned ${response.status}. Please try again.`)
      }
      if (!response.ok) throw new Error(body.error?.message || "Unable to submit your request.")
      if (body.status !== "pending" || !body.registration_id) {
        throw new Error("The registration response was incomplete. Contact support before retrying.")
      }
      setRegistrationId(body.registration_id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to submit your request.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="register-title">
        <Link className="wordmark" href="/" aria-label="Agora sign in">agora<span>·</span></Link>
        {deploymentType === null ? <p role="status">Checking whether merchant registration is available…</p> : deploymentType === "community" ? (
          <div role="status"><h1 id="register-title">Single workspace</h1><p>Community installations use one workspace owner account. Merchant registration and approval are not enabled.</p></div>
        ) : deploymentType === "unavailable" ? (
          <div role="status"><h1 id="register-title">Registration unavailable</h1><p>Could not confirm merchant registration availability for this deployment. Return to sign in or contact support.</p></div>
        ) : registrationId ? (
          <div role="status" aria-live="polite">
            <h1 id="register-title">Request received</h1>
            <p>Your registration is pending review. Payment data and API access stay locked until approval.</p>
            <p className="registration-id">Request ID<br /><code>{registrationId}</code></p>
            <p>No email is sent automatically. Include this request ID when contacting <a className="inline-link" href="mailto:info@belweave.com">info@belweave.com</a> for status.</p>
          </div>
        ) : (
          <>
            <h1 id="register-title">Request merchant access</h1>
            <p>Submit your business details for review. Approval is required before payment data or API access is available.</p>
            <form className="form-stack" onSubmit={submit}>
              <div className="field">
                <Label htmlFor="business-name">Business name</Label>
                <Input id="business-name" name="business_name" autoComplete="organization" maxLength={120} required />
              </div>
              <div className="field">
                <Label htmlFor="owner-name">Your name</Label>
                <Input id="owner-name" name="owner_name" autoComplete="name" maxLength={120} required />
              </div>
              <div className="field">
                <Label htmlFor="owner-email">Work email</Label>
                <Input id="owner-email" name="email" type="email" autoComplete="email" maxLength={254} required />
              </div>
              {error && <p className="auth-error" role="alert">{error}</p>}
              <Button type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit for review"}</Button>
            </form>
          </>
        )}
        <p className="auth-register">Already registered? <Link className="inline-link" href="/">Sign in</Link></p>
        <p className="support-note">Support: <a className="inline-link" href="mailto:info@belweave.com">info@belweave.com</a></p>
      </section>
    </main>
  )
}
