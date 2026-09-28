"use client"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type PasswordChangeFormProps = {
  required?: boolean
  onChanged: () => void
}

export function PasswordChangeForm({ required = false, onChanged }: PasswordChangeFormProps) {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.")
      return
    }
    if (newPassword.length < 12) {
      setError("Choose a password with at least 12 characters.")
      return
    }
    if (newPassword === currentPassword) {
      setError("Choose a password different from your current password.")
      return
    }

    setBusy(true)
    try {
      const response = await fetch("/api/auth/password/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      })
      const body = await response.json() as { error?: { message?: string }; ok?: boolean }
      if (!response.ok || body.ok !== true) {
        setError(body.error?.message || "Password could not be changed. Check your current password and try again.")
        return
      }
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      onChanged()
    } catch {
      setError("Connection failed. Check your network and try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      {required && <p role="status">For your security, replace the temporary bootstrap password before continuing.</p>}
      <div className="field">
        <Label htmlFor="current-password">Current password</Label>
        <Input id="current-password" name="current_password" type="password" autoComplete="current-password" maxLength={256} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? "password-change-error" : "password-requirements"} required autoFocus disabled={busy} />
      </div>
      <div className="field">
        <Label htmlFor="new-password">New password</Label>
        <Input id="new-password" name="new_password" type="password" autoComplete="new-password" minLength={12} maxLength={256} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? "password-change-error" : "password-requirements"} required disabled={busy} />
      </div>
      <div className="field">
        <Label htmlFor="confirm-new-password">Confirm new password</Label>
        <Input id="confirm-new-password" name="confirm_new_password" type="password" autoComplete="new-password" minLength={12} maxLength={256} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? "password-change-error" : "password-requirements"} required disabled={busy} />
        <small id="password-requirements">Use at least 12 characters. Your password is never displayed or logged.</small>
      </div>
      {error && <p id="password-change-error" className="auth-error" role="alert">{error}</p>}
      <Button type="submit" disabled={busy || !currentPassword || !newPassword || !confirmPassword}>
        {busy ? "Updating password…" : required ? "Set my password" : "Update password"}
      </Button>
    </form>
  )
}
