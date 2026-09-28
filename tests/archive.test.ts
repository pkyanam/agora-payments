import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const directory = mkdtempSync(join(tmpdir(), "agora-archive-test-"))
process.env.AGORA_DATABASE_PATH = join(directory, "archive.sqlite")
process.env.AGORA_SEED = "false"
process.env.AGORA_DEPLOYMENT_ENV = "qa"
const service = await import("../lib/server/local")
const db = await import("../lib/server/db")

await test("product archive is reversible metadata and prevents new checkouts", () => {
  const product = service.createProduct(service.owner, { name: "Archive test", amount: 1200 })
  const payment = service.createPayment(service.owner, { product_id: product.id })
  const journalBefore = db.all("SELECT * FROM journal")
  const archive = service.archiveProduct(service.owner, product.id, true)
  assert.equal(archive.archived, true)
  assert.equal(typeof archive.archived_at, "string")
  assert.equal(service.archiveProduct(service.owner, product.id, true).archived_at, archive.archived_at)
  assert.equal(service.snapshot("owner").products.some((item) => item.id === product.id), false)
  assert.equal(service.snapshot("owner", true).products.some((item) => item.id === product.id), true)
  assert.throws(() => service.createPayment(service.owner, { product_id: product.id }), (error: unknown) => error instanceof service.ApiError && error.status === 404)
  assert.equal(service.archiveProduct(service.owner, product.id, false).archived, false)
  assert.equal(service.createPayment(service.owner, { product_id: product.id }).product_id, product.id)
  assert.equal(db.one<{ id: string }>("SELECT id FROM payments WHERE id=?", payment.id)?.id, payment.id)
  assert.equal(db.all("SELECT * FROM journal").length, journalBefore.length)
})

await test("payment archive hides it from the default snapshot without deleting financial rows", () => {
  const product = service.createProduct(service.owner, { name: "Payment archive test", amount: 2200 })
  const payment = service.createPayment(service.owner, { product_id: product.id })
  service.simulate(payment.checkout_token, { outcome: "succeeded" })
  const paymentRowsBefore = db.one<{ id: string; amount: number; status: string; refunded: number }>("SELECT id,amount,status,refunded FROM payments WHERE id=?", payment.id)
  const journalBefore = db.all("SELECT * FROM journal WHERE reference_id=?", payment.id).length
  const archived = service.archivePayment(service.owner, payment.id, true)
  assert.equal(archived.archived, true)
  assert.equal(service.snapshot("owner").payments.some((item) => item.id === payment.id), false)
  assert.equal(service.snapshot("owner", true).payments.some((item) => item.id === payment.id), true)
  assert.deepEqual(db.one("SELECT id,amount,status,refunded FROM payments WHERE id=?", payment.id), paymentRowsBefore)
  assert.equal(db.all("SELECT * FROM journal WHERE reference_id=?", payment.id).length, journalBefore)
  assert.equal(service.archivePayment(service.owner, payment.id, false).archived, false)
  assert.equal(service.snapshot("owner").payments.some((item) => item.id === payment.id), true)
})

process.once("beforeExit", () => rmSync(directory, { recursive: true, force: true }))
