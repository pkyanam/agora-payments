import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const directory = mkdtempSync(join(tmpdir(), "agora-activity-test-"))
process.env.AGORA_DATABASE_PATH = join(directory, "activity.sqlite")
process.env.AGORA_SEED = "false"
process.env.AGORA_DEPLOYMENT_ENV = "qa"
process.env.AGORA_PAYMENT_PROVIDER = "sandbox"
const service = await import("../lib/server/local")
const db = await import("../lib/server/db")
const activity = await import("../lib/server/activity")
const now = new Date("2026-01-30T15:37:00.000Z")

await test("range aggregation uses real ledger rows, UTC buckets, and includes archived payments", () => {
  const product = service.createProduct(service.owner, { name: "Range test", amount: 1700 })
  const payment = service.createPayment(service.owner, { product_id: product.id })
  service.simulate(payment.checkout_token, { outcome: "succeeded" })
  db.run("UPDATE payments SET created_at=?,refunded=300 WHERE id=?", "2026-01-30T15:10:00.000Z", payment.id)
  service.archivePayment(service.owner, payment.id, true)
  const result = activity.paymentActivity(db.localStore, "owner", "1h", undefined, undefined, { AGORA_PAYMENT_PROVIDER: "sandbox" }, now)
  assert.equal(result.daily.length, 12)
  assert.equal(result.successful_payments, 1)
  assert.equal(result.gross_amount, 1700)
  assert.equal(result.refunded_amount, 300)
  assert.equal(result.daily.find((bucket) => bucket.successful_payments)?.date, "2026-01-30T15:10:00.000Z")
  assert.equal(result.daily[0].date, "2026-01-30T14:40:00.000Z")
})

await test("empty and all-time ranges stay finite and custom dates are validated", () => {
  const all = activity.paymentActivity(db.localStore, "owner", "all", undefined, undefined, { AGORA_PAYMENT_PROVIDER: "sandbox" }, now)
  assert.equal(all.daily[0].date, "2026-01-01T00:00:00.000Z")
  assert.equal(all.successful_payments, 1)
  const empty = activity.paymentActivity(db.localStore, "owner", "24h", undefined, undefined, { AGORA_PAYMENT_PROVIDER: "stripe", AGORA_STRIPE_MODE: "live" }, now)
  assert.equal(empty.daily.length, 24)
  assert.equal(empty.successful_payments, 0)
  assert.throws(() => activity.paymentActivity(db.localStore, "owner", "custom", "2026-02-01", "2026-01-01", { AGORA_PAYMENT_PROVIDER: "sandbox" }, now), /on or after/)
})

process.once("beforeExit", () => rmSync(directory, { recursive: true, force: true }))
