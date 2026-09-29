import { test } from "node:test"
import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const directory = mkdtempSync(join(tmpdir(), "agora-sales-flow-"))
const env = process.env as Record<string, string | undefined>
const previous = {
  database: env.AGORA_DATABASE_PATH,
  seed: env.AGORA_SEED,
  node: env.NODE_ENV,
  deployment: env.AGORA_DEPLOYMENT_ENV,
  provider: env.AGORA_PAYMENT_PROVIDER,
  mode: env.AGORA_STRIPE_MODE,
  publicOrigin: env.AGORA_PUBLIC_ORIGIN,
  encryptionKey: env.AGORA_SECRETS_ENCRYPTION_KEY,
  testKey: env.STRIPE_TEST_SECRET_KEY,
  webhook: env.STRIPE_TEST_WEBHOOK_SECRET,
}
env.AGORA_DATABASE_PATH = join(directory, "sales.sqlite")
env.AGORA_SEED = "false"
env.NODE_ENV = "production"
env.AGORA_DEPLOYMENT_ENV = "qa"
env.AGORA_PAYMENT_PROVIDER = "stripe"
env.AGORA_STRIPE_MODE = "test"
env.AGORA_PUBLIC_ORIGIN = "https://agora.example"
env.AGORA_SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")
env.STRIPE_TEST_SECRET_KEY = "sk_test_salesfixture123"
env.STRIPE_TEST_WEBHOOK_SECRET = "whsec_salesfixture123"

const service = await import("../lib/server/local")
const db = await import("../lib/server/db")
const reviewRoute = await import("../app/api/quote/review/route")
const acceptRoute = await import("../app/api/quote/accept/route")
const prepareRoute = await import("../app/api/checkout/prepare/route")
const statusRoute = await import("../app/api/checkout/status/[paymentId]/route")
const webhookRoute = await import("../app/api/webhooks/stripe/route")

await test("customer quote review is read-only; explicit acceptance creates a pending order and checkout", async () => {
  const originalFetch = globalThis.fetch
  const providerRequests: Request[] = []
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    providerRequests.push(request)
    return Response.json({
      id: "cs_test_sales_flow",
      url: "https://checkout.stripe.com/c/pay_sales_flow",
      payment_intent: "pi_test_sales_flow",
      status: "open",
    })
  }

  try {
    const first = service.createProduct(service.owner, {
      name: "Research session",
      amount: 2400,
    })
    const second = service.createProduct(service.owner, {
      name: "Monthly report",
      amount: 1100,
    })
    const quote = service.createQuote(service.owner, {
      customer: { name: "Casey Buyer", email: "casey@example.test" },
      items: [
        { product_id: first.id, quantity: 1 },
        { product_id: second.id, quantity: 2 },
      ],
      discount_amount: 301,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    const token = quote.quote_token
    assert.equal(
      db.one<{ count: number }>("SELECT COUNT(*) AS count FROM orders")?.count,
      0
    )
    assert.equal(
      db.one<{ count: number }>("SELECT COUNT(*) AS count FROM payments")
        ?.count,
      0
    )

    const reviewed = await reviewRoute.POST(
      new Request("https://agora.example/api/quote/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
    )
    assert.equal(reviewed.status, 200)
    const reviewBody = (await reviewed.json()) as {
      status: string
      merchant: string
      customer_name: string
      total_amount: number
      items: Array<{
        product_name: string
        quantity: number
        catalog_version: number
      }>
      tenant_id?: string
      customer_id?: string
      created_by?: string
      quote_token?: string
    }
    assert.equal(reviewBody.status, "open")
    assert.equal(reviewBody.customer_name, "Casey Buyer")
    assert.equal(reviewBody.total_amount, 4299)
    assert.equal(reviewBody.items[0]?.product_name, "Research session")
    assert.equal(reviewBody.items[1]?.quantity, 2)
    assert.equal(reviewBody.items[0]?.catalog_version, 1)
    assert.ok(reviewBody.merchant)
    assert.equal("tenant_id" in reviewBody, false)
    assert.equal("customer_id" in reviewBody, false)
    assert.equal("created_by" in reviewBody, false)
    assert.equal("quote_token" in reviewBody, false)
    assert.equal(JSON.stringify(reviewBody).includes(token), false)
    assert.equal(
      db.one<{ count: number }>("SELECT COUNT(*) AS count FROM orders")?.count,
      0
    )
    assert.equal(
      db.one<{ count: number }>("SELECT COUNT(*) AS count FROM payments")
        ?.count,
      0
    )

    const invalid = await reviewRoute.POST(
      new Request("https://agora.example/api/quote/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "invalid" }),
      })
    )
    assert.equal(invalid.status, 404)

    const accepted = await acceptRoute.POST(
      new Request("https://agora.example/api/quote/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "quote-customer-accept-1",
        },
        body: JSON.stringify({ token }),
      })
    )
    assert.equal(accepted.status, 200)
    const acceptedBody = (await accepted.json()) as {
      order_id: string
      payment: {
        id: string
        amount: number
        checkout_url: string
        checkout_token?: string
      }
    }
    assert.equal(acceptedBody.payment.amount, 4299)
    assert.equal(
      new URL(acceptedBody.payment.checkout_url).origin,
      "https://agora.example"
    )
    assert.equal(
      new URL(acceptedBody.payment.checkout_url).pathname,
      "/checkout/start"
    )
    assert.equal("checkout_token" in acceptedBody.payment, false)
    assert.equal(providerRequests.length, 1)
    assert.equal(
      providerRequests[0]?.url,
      "https://api.stripe.com/v1/checkout/sessions"
    )
    assert.equal(
      db.one<{ status: string }>(
        "SELECT status FROM orders WHERE id=?",
        acceptedBody.order_id
      )?.status,
      "awaiting_payment"
    )

    const paymentToken = new URL(acceptedBody.payment.checkout_url).hash.slice(
      1
    )
    const prepared = await prepareRoute.POST(
      new Request("https://agora.example/api/checkout/prepare", {
        method: "POST",
        headers: { "X-Agora-Checkout-Token": paymentToken },
      })
    )
    assert.equal(prepared.status, 200)
    const cookie = prepared.headers.get("set-cookie")!.split(";", 1)[0]!
    const statusPath = `https://agora.example/api/checkout/status/${acceptedBody.payment.id}?session_id=cs_test_sales_flow`
    const pendingResponse = await statusRoute.GET(
      new Request(statusPath, { headers: { cookie } }),
      {
        params: Promise.resolve({ paymentId: acceptedBody.payment.id }),
      }
    )
    assert.equal(pendingResponse.status, 200)
    const pending = (await pendingResponse.json()) as {
      status: string
      receipt?: unknown
      order?: { status: string; fulfillment_status: string }
    }
    assert.equal(pending.status, "pending")
    assert.equal("receipt" in pending, false)
    assert.equal(pending.order?.status, "awaiting_payment")
    assert.equal(pending.order?.fulfillment_status, "awaiting_payment")
    const pendingQuoteReview = await reviewRoute.POST(
      new Request("https://agora.example/api/quote/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
    )
    const pendingQuoteBody = (await pendingQuoteReview.json()) as {
      status: string
      order?: { status: string; fulfillment_status: string }
    }
    assert.equal(pendingQuoteReview.status, 200)
    assert.equal(pendingQuoteBody.status, "accepted")
    assert.equal(pendingQuoteBody.order?.status, "awaiting_payment")
    assert.equal(pendingQuoteBody.order?.fulfillment_status, "awaiting_payment")
    assert.equal("receipt" in pendingQuoteBody, false)

    const eventBody = JSON.stringify({
      id: "evt_test_sales_paid",
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: "cs_test_sales_flow",
          object: "checkout.session",
          payment_status: "paid",
          amount_total: 4299,
          currency: "usd",
          client_reference_id: acceptedBody.payment.id,
          payment_intent: "pi_test_sales_flow",
          metadata: {
            agora_payment_id: acceptedBody.payment.id,
            agora_tenant_id: "owner",
          },
        },
      },
    })
    const timestamp = Math.floor(Date.now() / 1000)
    const digest = createHmac("sha256", env.STRIPE_TEST_WEBHOOK_SECRET!)
      .update(`${timestamp}.${eventBody}`)
      .digest("hex")
    const webhook = await webhookRoute.POST(
      new Request("https://agora.example/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": `t=${timestamp},v1=${digest}` },
        body: eventBody,
      })
    )
    assert.equal(webhook.status, 200)
    const paidResponse = await statusRoute.GET(
      new Request(statusPath, { headers: { cookie } }),
      {
        params: Promise.resolve({ paymentId: acceptedBody.payment.id }),
      }
    )
    const paid = (await paidResponse.json()) as {
      status: string
      receipt?: {
        amount: number
        order?: {
          id: string
          status: string
          fulfillment_status: string
          items: Array<{ product_name: string; line_total: number }>
        }
      }
      order?: { status: string; fulfillment_status: string }
    }
    assert.equal(paid.status, "succeeded")
    assert.equal(paid.receipt?.amount, 4299)
    assert.equal(paid.receipt?.order?.id, acceptedBody.order_id)
    assert.equal(paid.receipt?.order?.status, "paid")
    assert.equal(paid.receipt?.order?.fulfillment_status, "ready")
    assert.equal(paid.receipt?.order?.items[0]?.line_total, 2400)
    assert.equal(paid.receipt?.order?.items[1]?.product_name, "Monthly report")
    assert.equal(paid.order?.fulfillment_status, "ready")
    const paidQuoteReview = await reviewRoute.POST(
      new Request("https://agora.example/api/quote/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
    )
    const paidQuoteBody = (await paidQuoteReview.json()) as {
      status: string
      order?: {
        id: string
        status: string
        fulfillment_status: string
        total_amount: number
        paid_at: string | null
        items: Array<{ product_name: string; net_total: number }>
      }
    }
    assert.equal(paidQuoteReview.status, 200)
    assert.equal(paidQuoteBody.order?.id, acceptedBody.order_id)
    assert.equal(paidQuoteBody.order?.status, "paid")
    assert.equal(paidQuoteBody.order?.fulfillment_status, "ready")
    assert.equal(paidQuoteBody.order?.total_amount, 4299)
    assert.ok(paidQuoteBody.order?.paid_at)
    assert.equal(paidQuoteBody.order?.items[0]?.net_total, 2243)
    assert.equal("customer_id" in (paidQuoteBody.order || {}), false)

    const anonymous = await statusRoute.GET(new Request(statusPath), {
      params: Promise.resolve({ paymentId: acceptedBody.payment.id }),
    })
    assert.equal(anonymous.status, 404)
  } finally {
    globalThis.fetch = originalFetch
  }
})

await test("catalog edits create a new version while open quote prices remain snapshotted", () => {
  const product = service.createProduct(service.owner, {
    name: "Versioned service",
    amount: 1800,
  })
  const quote = service.createQuote(service.owner, {
    customer: { name: "Version buyer" },
    items: [{ product_id: product.id, quantity: 2 }],
  })
  const updated = service.updateProduct(service.owner, product.id, {
    expected_version: 1,
    name: "Versioned service",
    description: "Revised offer",
    amount: 2100,
  })
  assert.equal(updated.version, 2)
  const snapshot = service.getQuote(service.owner, quote.id)
  assert.equal(snapshot.items[0]?.unit_amount, 1800)
  assert.equal(snapshot.items[0]?.catalog_version, 1)
})

await test("a failed signed checkout shows pending order failure but never a receipt", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    Response.json({
      id: "cs_test_sales_failed",
      url: "https://checkout.stripe.com/c/pay_sales_failed",
      payment_intent: "pi_test_sales_failed",
      status: "open",
    })
  try {
    const product = service.createProduct(service.owner, {
      name: "Unpaid delivery",
      amount: 1700,
    })
    const quote = service.createQuote(service.owner, {
      customer: { name: "Unpaid buyer" },
      items: [{ product_id: product.id, quantity: 1 }],
    })
    db.run("UPDATE quotes SET provider_mode='test' WHERE id=?", quote.id)
    const acceptedResponse = await acceptRoute.POST(
      new Request("https://agora.example/api/quote/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "quote-customer-fail-1",
        },
        body: JSON.stringify({ token: quote.quote_token }),
      })
    )
    assert.equal(acceptedResponse.status, 200)
    const accepted = (await acceptedResponse.json()) as {
      order_id: string
      payment: { id: string; checkout_url: string }
    }
    const paymentToken = new URL(accepted.payment.checkout_url).hash.slice(1)
    const prepared = await prepareRoute.POST(
      new Request("https://agora.example/api/checkout/prepare", {
        method: "POST",
        headers: { "X-Agora-Checkout-Token": paymentToken },
      })
    )
    const cookie = prepared.headers.get("set-cookie")!.split(";", 1)[0]!
    const eventBody = JSON.stringify({
      id: "evt_test_sales_failed",
      type: "checkout.session.async_payment_failed",
      livemode: false,
      data: {
        object: {
          id: "cs_test_sales_failed",
          object: "checkout.session",
          payment_status: "unpaid",
          amount_total: 1700,
          currency: "usd",
          client_reference_id: accepted.payment.id,
          payment_intent: "pi_test_sales_failed",
          metadata: {
            agora_payment_id: accepted.payment.id,
            agora_tenant_id: "owner",
          },
        },
      },
    })
    const timestamp = Math.floor(Date.now() / 1000)
    const digest = createHmac("sha256", env.STRIPE_TEST_WEBHOOK_SECRET!)
      .update(`${timestamp}.${eventBody}`)
      .digest("hex")
    const webhook = await webhookRoute.POST(
      new Request("https://agora.example/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": `t=${timestamp},v1=${digest}` },
        body: eventBody,
      })
    )
    assert.equal(webhook.status, 200)
    const status = await statusRoute.GET(
      new Request(
        `https://agora.example/api/checkout/status/${accepted.payment.id}?session_id=cs_test_sales_failed`,
        { headers: { cookie } }
      ),
      {
        params: Promise.resolve({ paymentId: accepted.payment.id }),
      }
    )
    assert.equal(status.status, 200)
    const body = (await status.json()) as {
      status: string
      receipt?: unknown
      order?: { status: string; fulfillment_status: string }
    }
    assert.equal(body.status, "failed")
    assert.equal("receipt" in body, false)
    assert.equal(body.order?.status, "cancelled")
    assert.equal(body.order?.fulfillment_status, "failed")
    assert.equal(
      db.one<{ status: string }>(
        "SELECT status FROM fulfillments WHERE order_id=?",
        accepted.order_id
      )?.status,
      "failed"
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

db.db.close()
rmSync(directory, { recursive: true, force: true })
for (const [key, value] of Object.entries({
  AGORA_DATABASE_PATH: previous.database,
  AGORA_SEED: previous.seed,
  NODE_ENV: previous.node,
  AGORA_DEPLOYMENT_ENV: previous.deployment,
  AGORA_PAYMENT_PROVIDER: previous.provider,
  AGORA_STRIPE_MODE: previous.mode,
  AGORA_PUBLIC_ORIGIN: previous.publicOrigin,
  AGORA_SECRETS_ENCRYPTION_KEY: previous.encryptionKey,
  STRIPE_TEST_SECRET_KEY: previous.testKey,
  STRIPE_TEST_WEBHOOK_SECRET: previous.webhook,
})) {
  if (value === undefined) delete env[key]
  else env[key] = value
}
