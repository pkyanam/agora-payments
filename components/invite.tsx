"use client"

import { useEffect, useState, type FormEvent } from "react"
import Link from "next/link"

type InviteStage = "checking" | "password" | "enroll" | "recovery" | "done" | "invalid"
type InviteResponse = {
  error?: { message?: string; request_id?: string }
  stage?: string
  secret?: string
  email?: string
  otpauth_url?: string
  recovery_codes?: unknown
}

export default function Invite() {
  const [stage, setStage] = useState<InviteStage>("checking")
  const [token, setToken] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [secret, setSecret] = useState("")
  const [otpauthUrl, setOtpauthUrl] = useState("")
  const [code, setCode] = useState("")
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [error, setError] = useState("")
  const [errorDetails, setErrorDetails] = useState<{
    status: number
    requestId?: string
    storage?: string
  } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const fragment = window.location.hash.slice(1)
    window.history.replaceState(null, "", window.location.pathname)
    window.setTimeout(() => {
      if (/^[a-f0-9]{64}$/i.test(fragment)) {
        setToken(fragment)
        setStage("password")
      } else {
        setStage("invalid")
      }
    }, 0)
  }, [])

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.length < 14 || password.length > 128) {
      setError("Use a password between 14 and 128 characters.")
      return
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.")
      return
    }
    setBusy(true)
    setError("")
    setErrorDetails(null)
    try {
      const response = await fetch("/api/auth/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })
      const body = await response.json() as InviteResponse
      if (!response.ok) {
        setError(body.error?.message || "This invitation could not be accepted.")
        setErrorDetails({
          status: response.status,
          requestId: body.error?.request_id || response.headers.get("X-Request-Id") || undefined,
          storage: response.headers.get("X-Agora-Storage") || undefined,
        })
        return
      }
      if (body.stage !== "enroll" || typeof body.secret !== "string") {
        throw new Error("The invitation did not start the required authenticator setup. Contact support.")
      }
      setEmail(typeof body.email === "string" ? body.email : "")
      setPassword("")
      setConfirmPassword("")
      setSecret(body.secret)
      setOtpauthUrl(typeof body.otpauth_url === "string" ? body.otpauth_url : "")
      setStage("enroll")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This invitation could not be accepted.")
      setErrorDetails(null)
    } finally {
      setBusy(false)
    }
  }

  async function enrollAuthenticator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    setErrorDetails(null)
    try {
      const response = await fetch("/api/auth/merchant/mfa/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })
      const body = await response.json() as InviteResponse
      if (!response.ok) {
        setError(body.error?.message || "That authenticator code was not accepted.")
        setErrorDetails({
          status: response.status,
          requestId: body.error?.request_id || response.headers.get("X-Request-Id") || undefined,
          storage: response.headers.get("X-Agora-Storage") || undefined,
        })
        return
      }
      const codes = Array.isArray(body.recovery_codes)
        ? body.recovery_codes.filter((value): value is string => typeof value === "string")
        : []
      if (codes.length === 0) {
        throw new Error("Recovery codes were not returned. Contact support before leaving this page.")
      }
      setCode("")
      setRecoveryCodes(codes)
      setSecret("")
      setOtpauthUrl("")
      setStage("recovery")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Authenticator setup failed.")
      setErrorDetails(null)
    } finally {
      setBusy(false)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      setError("Clipboard access is unavailable. Select and copy the value manually.")
    }
  }

  function downloadRecoveryCodes() {
    const blob = new Blob([`Agora recovery codes\n\n${recoveryCodes.join("\n")}\n`], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "agora-recovery-codes.txt"
    link.click()
    URL.revokeObjectURL(url)
  }

  function renderError() {
    if (!error) return null
    return (
      <div className="auth-error" role="alert">
        <p>{error}</p>
        {errorDetails && (
          <details>
            <summary>Technical details</summary>
            <p>HTTP {errorDetails.status}</p>
            {errorDetails.requestId && <p>Reference: {errorDetails.requestId}</p>}
            {errorDetails.storage && <p>Storage: {errorDetails.storage}</p>}
          </details>
        )}
      </div>
    )
  }

  return (
    <main className="auth-page">
      <Link className="wordmark" href="/">agora<span>·</span></Link>
      {stage === "checking" ? (
        <p role="status">Checking invitation…</p>
      ) : stage === "invalid" ? (
        <section className="auth-card" aria-labelledby="invite-title">
          <h1 id="invite-title">Invitation unavailable</h1>
          <p>This invitation link is incomplete or expired. Ask the workspace owner for a new link.</p>
          <Link className="auth-back-link" href="/">Return to sign in</Link>
        </section>
      ) : stage === "password" ? (
        <section className="auth-card" aria-labelledby="invite-title">
          <h1 id="invite-title">Set up merchant access</h1>
          <p>Create your password. You’ll set up an authenticator before opening your merchant workspace.</p>
          <form onSubmit={submitPassword} className="form-stack">
            <label htmlFor="invite-password">Password</label>
            <input id="invite-password" type="password" autoComplete="new-password" minLength={14} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} />
            <label htmlFor="invite-confirm-password">Confirm password</label>
            <input id="invite-confirm-password" type="password" autoComplete="new-password" minLength={14} maxLength={128} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            <p className="form-note">Use 14–128 characters. Keep this password private.</p>
            {renderError()}
            <button type="submit" className="auth-submit" disabled={busy}>{busy ? "Setting up…" : "Continue to authenticator setup"}</button>
          </form>
        </section>
      ) : stage === "enroll" ? (
        <section className="auth-card" aria-labelledby="invite-title">
          <h1 id="invite-title">Set up an authenticator</h1>
          {email && <p>Merchant account: {email}</p>}
          <p>Add this account to an authenticator app, then enter its current six-digit code. MFA is required for merchant access.</p>
          <div className="mfa-setup-key">
            <span>Setup key</span>
            <code>{secret}</code>
            <button type="button" className="auth-secondary" onClick={() => void copy(secret)}>Copy setup key</button>
            {otpauthUrl && <button type="button" className="auth-secondary" onClick={() => void copy(otpauthUrl)}>Copy authenticator setup URI</button>}
          </div>
          <form onSubmit={enrollAuthenticator} className="form-stack">
            <label htmlFor="merchant-mfa-code">Authenticator code</label>
            <input id="merchant-mfa-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
            {renderError()}
            <button type="submit" className="auth-submit" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Verify and finish setup"}</button>
          </form>
        </section>
      ) : stage === "recovery" ? (
        <section className="auth-card recovery-card" aria-labelledby="invite-title">
          <h1 id="invite-title">Save your recovery codes</h1>
          <p>Each code works once if you lose access to your authenticator. Save them privately before continuing; they won’t be shown again.</p>
          <div className="recovery-codes" aria-label="One-time recovery codes">{recoveryCodes.map((value) => <code key={value}>{value}</code>)}</div>
          <button type="button" className="auth-secondary" onClick={downloadRecoveryCodes}>Download codes</button>
          <button type="button" className="auth-submit" onClick={() => { setRecoveryCodes([]); setStage("done") }}>I’ve saved these codes</button>
        </section>
      ) : (
        <section className="auth-card" aria-labelledby="invite-title">
          <h1 id="invite-title">Merchant access is ready</h1>
          <p>Your password and authenticator are set. Continue to your merchant workspace.</p>
          <Link className="auth-submit auth-submit-link" href="/">Open merchant workspace</Link>
        </section>
      )}
      <footer className="auth-footer">Support: <a href="mailto:info@belweave.com">info@belweave.com</a></footer>
    </main>
  )
}
