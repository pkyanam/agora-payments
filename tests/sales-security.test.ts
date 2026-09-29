import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const directory = mkdtempSync(join(tmpdir(), "agora-sales-security-"))
const env = process.env as Record<string, string | undefined>
const previous = {
  database: env.AGORA_DATABASE_PATH,
  seed: env.AGORA_SEED,
  node: env.NODE_ENV,
  deployment: env.AGORA_DEPLOYMENT_ENV,
  provider: env.AGORA_PAYMENT_PROVIDER,
  mode: env.AGORA_STRIPE_MODE,
  key: env.AGORA_SECRETS_ENCRYPTION_KEY,
}
env.AGORA_DATABASE_PATH = join(directory, "sales-security.sqlite")
env.AGORA_SEED = "false"
env.NODE_ENV = "test"
env.AGORA_DEPLOYMENT_ENV = "qa"
env.AGORA_PAYMENT_PROVIDER = "sandbox"
delete env.AGORA_STRIPE_MODE
env.AGORA_SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 73).toString("base64")

const service = await import("../lib/server/local")
const db = await import("../lib/server/db")
const scopes = [
  "products:read",
  "products:write",
  "customers:read",
  "customers:write",
  "quotes:read",
  "quotes:write",
  "payments:read",
  "payments:write",
  "orders:read",
  "fulfillment:read",
  "fulfillment:write",
] as const
type RefundReceipt = {
  payment_status: string
  refunded_amount: number
  net_amount: number
}

function agent(name: string, tenant_id?: string) {
  const credential = service.createCredential(service.owner, {
    name,
    kind: "agent",
    scopes: [...scopes],
    max_amount: 100_000,
    refund_budget: 0,
    ...(tenant_id ? { tenant_id } : {}),
  })
  return service.authenticate(
    new Request("https://api.example", {
      headers: { Authorization: `Bearer ${credential.secret}` },
    })
  )
}

await test("sales records cannot be read across tenant boundaries", () => {
  const otherTenant = "tenant_sales_security"
  db.run(
    "INSERT INTO tenants(id,business_name,email,status,provider,created_at) VALUES(?,?,?,'approved','stripe',?)",
    otherTenant,
    "Other Shop",
    "other@example.test",
    new Date().toISOString()
  )
  const ownerActor = agent("owner-sales-reader")
  const otherActor = agent("other-sales-reader", otherTenant)
  const product = service.createProduct(service.owner, {
    name: "Private item",
    amount: 1200,
  })
  const customer = service.createCustomer(service.owner, {
    name: "Private buyer",
    email: "private@example.test",
  })
  const quote = service.createQuote(service.owner, {
    customer: { name: "Private buyer" },
    items: [{ product_id: product.id, quantity: 1 }],
  })
  const accepted = service.acceptQuote(service.owner, quote.id)
  for (const read of [
    () => service.getCustomer(otherActor, customer.id),
    () => service.getQuote(otherActor, quote.id),
    () => service.getOrder(otherActor, accepted.order_id),
    () =>
      service.getFulfillment(
        otherActor,
        db.one<{ id: string }>(
          "SELECT id FROM fulfillments WHERE order_id=?",
          accepted.order_id
        )!.id
      ),
  ]) {
    assert.throws(
      read,
      (error: unknown) =>
        error instanceof service.ApiError && error.status === 404
    )
  }
  assert.equal(service.getQuote(ownerActor, quote.id).id, quote.id)
})

await test("quote acceptance replay with one idempotency key creates only one order", () => {
  const product = service.createProduct(service.owner, {
    name: "Replay-safe service",
    amount: 1900,
  })
  const quote = service.createQuote(service.owner, {
    customer: { name: "Replay buyer" },
    items: [{ product_id: product.id, quantity: 1 }],
  })
  const body = { quote_id: quote.id }
  const first = service.mutate<ReturnType<typeof service.acceptQuote>>(
    service.owner,
    `quotes/${quote.id}/accept`,
    "sales-accept-replay-1",
    body,
    () => service.acceptQuote(service.owner, quote.id)
  )
  const replay = service.mutate<ReturnType<typeof service.acceptQuote>>(
    service.owner,
    `quotes/${quote.id}/accept`,
    "sales-accept-replay-1",
    body,
    () => {
      throw new Error("Idempotent replay executed quote acceptance again")
    }
  )
  assert.equal(replay.order_id, first.order_id)
  assert.equal(
    db.one<{ count: number }>(
      "SELECT COUNT(*) AS count FROM orders WHERE quote_id=?",
      quote.id
    )?.count,
    1
  )
  assert.throws(
    () =>
      service.mutate(
        service.owner,
        `quotes/${quote.id}/accept`,
        "sales-accept-replay-1",
        { quote_id: "different" },
        () => null
      ),
    (error: unknown) =>
      error instanceof service.ApiError && error.code === "idempotency_conflict"
  )
})

await test("a mode-pinned key cannot read or accept a quote issued in another mode", () => {
  const reader = agent("sandbox-sales-reader")
  const product = service.createProduct(service.owner, {
    name: "Mode-specific offer",
    amount: 1500,
  })
  const quote = service.createQuote(service.owner, {
    customer: { name: "Mode buyer" },
    items: [{ product_id: product.id, quantity: 1 }],
  })
  db.run("UPDATE quotes SET provider_mode='live' WHERE id=?", quote.id)
  assert.throws(
    () => service.getQuote(reader, quote.id),
    (error: unknown) =>
      error instanceof service.ApiError && error.status === 404
  )
  assert.equal(
    service
      .listQuotes(reader, 0, 100)
      .data.some((item) => item.id === quote.id),
    false
  )
  assert.throws(
    () => service.acceptQuote(reader, quote.id),
    (error: unknown) =>
      error instanceof service.ApiError &&
      (error.status === 404 ||
        error.code === "quote_mode_changed" ||
        error.code === "key_mode_mismatch")
  )
  assert.equal(
    db.one<{ status: string }>("SELECT status FROM quotes WHERE id=?", quote.id)
      ?.status,
    "open"
  )
})

await test("mode-pinned keys cannot read order, receipt, or fulfillment records from another mode", () => {
  const reader = agent("sandbox-order-reader")
  const product = service.createProduct(service.owner, {
    name: "Live order",
    amount: 2600,
  })
  const quote = service.createQuote(service.owner, {
    customer: { name: "Live buyer" },
    items: [{ product_id: product.id, quantity: 1 }],
  })
  const accepted = service.acceptQuote(service.owner, quote.id)
  service.simulate(accepted.payment.checkout_token, { outcome: "succeeded" })
  const fulfillmentId = db.one<{ id: string }>(
    "SELECT id FROM fulfillments WHERE order_id=?",
    accepted.order_id
  )!.id
  db.run(
    "UPDATE payments SET provider='stripe',provider_mode='live' WHERE id=?",
    accepted.payment.id
  )
  assert.throws(
    () => service.getOrder(reader, accepted.order_id),
    (error: unknown) =>
      error instanceof service.ApiError && error.status === 404
  )
  assert.throws(
    () => service.getOrderReceipt(reader, accepted.order_id),
    (error: unknown) =>
      error instanceof service.ApiError && error.status === 404
  )
  assert.throws(
    () => service.getFulfillment(reader, fulfillmentId),
    (error: unknown) =>
      error instanceof service.ApiError && error.status === 404
  )
  assert.equal(
    service
      .listOrders(reader, 0, 100)
      .data.some((item) => item.id === accepted.order_id),
    false
  )
  assert.equal(
    service
      .listFulfillments(reader, 0, 100)
      .data.some((item) => item.id === fulfillmentId),
    false
  )
})

await test("full refunds cancel unfinished fulfillment and prevent later claims or completion", () => {
  const product = service.createProduct(service.owner, {
    name: "Refunded delivery",
    amount: 3100,
  })
  const quote = service.createQuote(service.owner, {
    customer: { name: "Refund buyer" },
    items: [{ product_id: product.id, quantity: 1 }],
  })
  const accepted = service.acceptQuote(service.owner, quote.id)
  service.simulate(accepted.payment.checkout_token, { outcome: "succeeded" })
  const fulfillmentId = db.one<{ id: string }>(
    "SELECT id FROM fulfillments WHERE order_id=?",
    accepted.order_id
  )!.id
  service.transitionFulfillment(service.owner, fulfillmentId, "claim", {})
  service.createRefund(service.owner, {
    payment_id: accepted.payment.id,
    amount: 3100,
    reason: "Order cancelled",
  })
  assert.equal(
    service.getFulfillment(service.owner, fulfillmentId).status,
    "cancelled"
  )
  assert.throws(
    () =>
      service.transitionFulfillment(
        service.owner,
        fulfillmentId,
        "complete",
        {}
      ),
    (error: unknown) =>
      error instanceof service.ApiError &&
      error.code === "fulfillment_cancelled"
  )
  assert.throws(
    () =>
      service.transitionFulfillment(service.owner, fulfillmentId, "claim", {}),
    (error: unknown) =>
      error instanceof service.ApiError &&
      error.code === "fulfillment_cancelled"
  )
  const order = service.getOrderReceipt(
    service.owner,
    accepted.order_id
  ) as ReturnType<typeof service.getOrderReceipt> & RefundReceipt
  assert.equal(order.payment_status, "refunded")
  assert.equal(order.refunded_amount, 3100)
  assert.equal(order.net_amount, 0)
})

await test("partial refunds preserve fulfillment; completed delivery remains historical after a full refund", () => {
  const product = service.createProduct(service.owner, {
    name: "Delivered service",
    amount: 4200,
  })
  const partialQuote = service.createQuote(service.owner, {
    customer: { name: "Partial refund buyer" },
    items: [{ product_id: product.id, quantity: 1 }],
  })
  const partial = service.acceptQuote(service.owner, partialQuote.id)
  service.simulate(partial.payment.checkout_token, { outcome: "succeeded" })
  const partialFulfillment = db.one<{ id: string }>(
    "SELECT id FROM fulfillments WHERE order_id=?",
    partial.order_id
  )!.id
  service.createRefund(service.owner, {
    payment_id: partial.payment.id,
    amount: 900,
    reason: "Partial service credit",
  })
  assert.equal(
    service.getFulfillment(service.owner, partialFulfillment).status,
    "ready"
  )
  const partialReceipt = service.getOrderReceipt(
    service.owner,
    partial.order_id
  ) as ReturnType<typeof service.getOrderReceipt> & RefundReceipt
  assert.equal(partialReceipt.payment_status, "partially_refunded")
  assert.equal(partialReceipt.refunded_amount, 900)
  assert.equal(partialReceipt.net_amount, 3300)

  const completedQuote = service.createQuote(service.owner, {
    customer: { name: "Completed buyer" },
    items: [{ product_id: product.id, quantity: 1 }],
  })
  const completed = service.acceptQuote(service.owner, completedQuote.id)
  service.simulate(completed.payment.checkout_token, { outcome: "succeeded" })
  const completedFulfillment = db.one<{ id: string }>(
    "SELECT id FROM fulfillments WHERE order_id=?",
    completed.order_id
  )!.id
  service.transitionFulfillment(
    service.owner,
    completedFulfillment,
    "claim",
    {}
  )
  service.transitionFulfillment(
    service.owner,
    completedFulfillment,
    "complete",
    {}
  )
  service.createRefund(service.owner, {
    payment_id: completed.payment.id,
    amount: 4200,
    reason: "Post-delivery full refund",
  })
  assert.equal(
    service.getFulfillment(service.owner, completedFulfillment).status,
    "completed"
  )
  const completedReceipt = service.getOrderReceipt(
    service.owner,
    completed.order_id
  ) as ReturnType<typeof service.getOrderReceipt> & RefundReceipt
  assert.equal(completedReceipt.payment_status, "refunded")
})

await test("sales operations keep the fresh database referentially and structurally valid", () => {
  assert.deepEqual(db.all("PRAGMA foreign_key_check"), [])
  assert.equal(
    db.one<{ integrity_check: string }>("PRAGMA integrity_check")
      ?.integrity_check,
    "ok"
  )
})

process.on("exit", () => {
  try {
    db.db.close()
  } catch {}
  rmSync(directory, { recursive: true, force: true })
  for (const [key, value] of Object.entries({
    AGORA_DATABASE_PATH: previous.database,
    AGORA_SEED: previous.seed,
    NODE_ENV: previous.node,
    AGORA_DEPLOYMENT_ENV: previous.deployment,
    AGORA_PAYMENT_PROVIDER: previous.provider,
    AGORA_STRIPE_MODE: previous.mode,
    AGORA_SECRETS_ENCRYPTION_KEY: previous.key,
  })) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
})
