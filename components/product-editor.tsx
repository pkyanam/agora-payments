"use client"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export type EditableProduct = {
  id: string
  version?: number
  name: string
  description?: string | null
  amount: number
}

type ProductPayload = {
  product_id?: string
  expected_version?: number
  name: string
  description: string
  amount: number
  currency: "usd"
}

export function ProductEditor({
  product,
  onSave,
}: {
  product: EditableProduct | null
  onSave: (payload: ProductPayload) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload: ProductPayload = {
      ...(product
        ? { product_id: product.id, expected_version: product.version ?? 1 }
        : {}),
      name: String(form.get("name") || "").trim(),
      description: String(form.get("description") || "").trim(),
      amount: Math.round(Number(form.get("amount")) * 100),
      currency: "usd",
    }
    setBusy(true)
    setError("")
    try {
      await onSave(payload)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Product could not be saved."
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      <div className="field">
        <Label htmlFor="product-name">Product name</Label>
        <Input
          id="product-name"
          name="name"
          required
          maxLength={120}
          placeholder="Design consultation"
          defaultValue={product?.name}
        />
      </div>
      <div className="field">
        <Label htmlFor="description">
          Description <span className="optional">optional</span>
        </Label>
        <Textarea
          id="description"
          name="description"
          maxLength={400}
          placeholder="A few words about what you’re selling."
          defaultValue={product?.description || ""}
        />
      </div>
      <div className="field">
        <Label htmlFor="amount">Price in USD</Label>
        <Input
          id="amount"
          name="amount"
          type="number"
          min="0.01"
          max="100000"
          step="0.01"
          required
          placeholder="49.00"
          defaultValue={product ? (product.amount / 100).toFixed(2) : undefined}
        />
      </div>
      <p className="form-note">
        One-time USD price. Edits create a new version; quote and order history
        keeps its original snapshot.
      </p>
      {error && (
        <p className="form-note" role="alert">
          {error}
        </p>
      )}
      <Button disabled={busy} type="submit">
        {busy ? "Saving…" : product ? "Save new version" : "Create product"}
      </Button>
    </form>
  )
}
