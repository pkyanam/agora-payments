import { test } from "node:test"
import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const dir = mkdtempSync(join(tmpdir(), "agora-checkout-test-"))
const env = process.env as Record<string, string | undefined>
env.AGORA_DATABASE_PATH = join(dir, "checkout.sqlite")
env.AGORA_SEED = "false"
env.NODE_ENV = "production"
const s = await import("../lib/server/local")
const d = await import("../lib/server/db")
const prepare = await import("../app/api/checkout/prepare/route")
const statusRoute = await import("../app/api/checkout/status/[paymentId]/route")
const reviewRoute = await import("../app/api/checkout/review/route")

function confirmStripePayment(
  paymentId: string,
  sessionId: string,
  eventId: string,
  paymentIntent: string,
  amount: number
) {
  const secret = "whsec_checkout_flow"
  const previous = env.STRIPE_TEST_WEBHOOK_SECRET
  env.STRIPE_TEST_WEBHOOK_SECRET = secret
  try {
    const event = {
      id: eventId,
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: sessionId,
          payment_status: "paid",
          amount_total: amount,
          currency: "usd",
          payment_intent: paymentIntent,
          metadata: { agora_payment_id: paymentId, agora_tenant_id: "owner" },
        },
      },
    }
    const raw = JSON.stringify(event)
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${raw}`)
      .digest("hex")
    s.handleStripeWebhook(raw, `t=${timestamp},v1=${signature}`)
  } finally {
    if (previous === undefined) delete env.STRIPE_TEST_WEBHOOK_SECRET
    else env.STRIPE_TEST_WEBHOOK_SECRET = previous
  }
}

await test("Stripe purchase review returns authoritative details without exposing the provider URL or capability", async () => {
  const product = s.createProduct(s.owner, {
    name: "Review test",
    amount: 1234,
  })
  const payment = s.createPayment(s.owner, {
    product_id: product.id,
    customer: "A. Customer",
  })
  s.prepareStripePayment(payment.id, "test")
  s.saveStripeSession(
    payment.id,
    {
      id: "cs_test_review",
      url: "https://checkout.stripe.com/c/pay_review",
      payment_intent: "pi_test_review",
      status: "open",
    },
    "test"
  )
  const response = await reviewRoute.POST(
    new Request("https://agora.example/api/checkout/review", {
      method: "POST",
      headers: { "X-Agora-Checkout-Token": payment.checkout_token },
    })
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    id: payment.id,
    merchant: "Agora workspace",
    product_name: "Review test",
    customer: "A. Customer",
    amount: 1234,
    currency: "usd",
    status: "pending",
    provider_mode: "test",
  })
  assert.equal(response.headers.get("cache-control"), "no-store, private")
  const invalid = await reviewRoute.POST(
    new Request("https://agora.example/api/checkout/review", {
      method: "POST",
      headers: { "X-Agora-Checkout-Token": "bad" },
    })
  )
  assert.equal(invalid.status, 404)
  d.run("UPDATE payments SET status='succeeded' WHERE id=?", payment.id)
  d.event("payment.succeeded", "Stripe webhook", payment.id, {
    stripe_event_id: "evt_test_review",
  })
  const completedReview = await reviewRoute.POST(
    new Request("https://agora.example/api/checkout/review", {
      method: "POST",
      headers: { "X-Agora-Checkout-Token": payment.checkout_token },
    })
  )
  assert.equal(completedReview.status, 200)
  assert.match(
    completedReview.headers.get("set-cookie")!,
    new RegExp(`agora_checkout_status_${payment.id}=${payment.checkout_token}`)
  )
})

await test("Stripe payer wrapper exchanges fragment capability for a scoped cookie, never URL/body token", async () => {
  const product = s.createProduct(s.owner, {
    name: "Checkout test",
    amount: 900,
  })
  const payment = s.createPayment(s.owner, { product_id: product.id })
  s.prepareStripePayment(payment.id, "test")
  s.saveStripeSession(
    payment.id,
    {
      id: "cs_test_wrapper",
      url: "https://checkout.stripe.com/c/pay_example",
      payment_intent: "pi_test_wrapper",
      status: "open",
    },
    "test"
  )
  const request = new Request("https://agora.example/api/checkout/prepare", {
    method: "POST",
    headers: { "X-Agora-Checkout-Token": payment.checkout_token },
  })
  const response = await prepare.POST(request)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    checkout_url: "https://checkout.stripe.com/c/pay_example",
  })
  const cookie = response.headers.get("set-cookie")!
  assert.match(
    cookie,
    new RegExp(`agora_checkout_status_${payment.id}=${payment.checkout_token}`)
  )
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /Secure/)
  assert.match(cookie, /SameSite=Lax/)
  assert.match(cookie, new RegExp(`Path=/api/checkout/status/${payment.id}`))
  const statusRequest = new Request(
    `https://agora.example/api/checkout/status/${payment.id}?session_id=cs_test_wrapper`,
    { headers: { cookie: cookie.split(";", 1)[0] } }
  )
  const status = await statusRoute.GET(statusRequest, {
    params: Promise.resolve({ paymentId: payment.id }),
  })
  assert.equal(status.status, 200)
  const directOrder = d.one<{ id: string }>(
    "SELECT id FROM orders WHERE payment_id=?",
    payment.id
  )!
  assert.deepEqual(await status.json(), {
    id: payment.id,
    product_name: "Checkout test",
    amount: 900,
    refunded_amount: 0,
    net_amount: 900,
    currency: "usd",
    status: "pending",
    provider: "stripe",
    provider_mode: "test",
    order: {
      id: directOrder.id,
      status: "awaiting_payment",
      payment_status: "pending",
      refunded_amount: 0,
      net_amount: 900,
      fulfillment_status: "awaiting_payment",
      amount: 900,
      items: [
        {
          product_name: "Checkout test",
          quantity: 1,
          unit_amount: 900,
          line_total: 900,
          discount_amount: 0,
          net_total: 900,
        },
      ],
    },
  })
  const mismatch = new Request(
    `https://agora.example/api/checkout/status/${payment.id}?session_id=cs_test_other`,
    { headers: { cookie: cookie.split(";", 1)[0] } }
  )
  assert.equal(
    (
      await statusRoute.GET(mismatch, {
        params: Promise.resolve({ paymentId: payment.id }),
      })
    ).status,
    404
  )
  const leaked = JSON.stringify(
    await (
      await prepare.POST(
        new Request("https://agora.example/api/checkout/prepare", {
          method: "POST",
          headers: { "X-Agora-Checkout-Token": "not-a-token" },
        })
      )
    ).json()
  )
  assert.equal(leaked.includes(payment.checkout_token), false)
})

await test("customer receipt is capability-scoped and appears only after provider-confirmed success", async () => {
  const product = s.createProduct(s.owner, {
    name: "Receipt item",
    amount: 2575,
  })
  const payment = s.createPayment(s.owner, {
    product_id: product.id,
    customer: "Receipt Customer",
  })
  s.prepareStripePayment(payment.id, "test")
  s.saveStripeSession(
    payment.id,
    {
      id: "cs_test_receipt",
      url: "https://checkout.stripe.com/c/pay_receipt",
      payment_intent: "pi_test_receipt",
      status: "open",
    },
    "test"
  )
  const path = `https://agora.example/api/checkout/status/${payment.id}`
  const withoutCapability = await statusRoute.GET(
    new Request(`${path}?session_id=cs_test_receipt`),
    { params: Promise.resolve({ paymentId: payment.id }) }
  )
  assert.equal(withoutCapability.status, 404)
  const prepared = await prepare.POST(
    new Request("https://agora.example/api/checkout/prepare", {
      method: "POST",
      headers: { "X-Agora-Checkout-Token": payment.checkout_token },
    })
  )
  assert.equal(prepared.status, 200)
  const cookie = prepared.headers.get("set-cookie")!.split(";", 1)[0]
  const pending = await statusRoute.GET(
    new Request(`${path}?session_id=cs_test_receipt`, { headers: { cookie } }),
    { params: Promise.resolve({ paymentId: payment.id }) }
  )
  assert.equal(pending.status, 200)
  const pendingBody = (await pending.json()) as {
    status: string
    receipt?: unknown
    order?: unknown
  }
  assert.equal(pendingBody.status, "pending")
  assert.equal("receipt" in pendingBody, false)
  const order = d.one<{ id: string }>(
    "SELECT id FROM orders WHERE payment_id=?",
    payment.id
  )!
  const orderItems = [
    {
      product_name: "Receipt item",
      quantity: 1,
      unit_amount: 2575,
      line_total: 2575,
      discount_amount: 0,
      net_total: 2575,
    },
  ]
  assert.deepEqual(pendingBody.order, {
    id: order.id,
    status: "awaiting_payment",
    payment_status: "pending",
    refunded_amount: 0,
    net_amount: 2575,
    fulfillment_status: "awaiting_payment",
    amount: 2575,
    items: orderItems,
  })
  confirmStripePayment(
    payment.id,
    "cs_test_receipt",
    "evt_test_receipt",
    "pi_test_receipt",
    2575
  )
  const paid = await statusRoute.GET(
    new Request(`${path}?session_id=cs_test_receipt`, { headers: { cookie } }),
    { params: Promise.resolve({ paymentId: payment.id }) }
  )
  assert.equal(paid.status, 200)
  const paidBody = (await paid.json()) as { status: string; receipt?: unknown }
  assert.equal(paidBody.status, "succeeded")
  assert.deepEqual(paidBody.receipt, {
    reference: payment.id,
    merchant: "Agora workspace",
    customer: "Receipt Customer",
    product_name: "Receipt item",
    amount: 2575,
    refunded_amount: 0,
    net_amount: 2575,
    payment_status: "paid",
    currency: "usd",
    paid_at: d.one<{ created_at: string }>(
      "SELECT created_at FROM events WHERE object_id=? AND type='payment.succeeded'",
      payment.id
    )?.created_at,
    order: {
      id: order.id,
      status: "paid",
      payment_status: "paid",
      refunded_amount: 0,
      net_amount: 2575,
      fulfillment_status: "ready",
      amount: 2575,
      items: orderItems,
    },
  })
  const wrongSession = await statusRoute.GET(
    new Request(`${path}?session_id=cs_test_other`, { headers: { cookie } }),
    { params: Promise.resolve({ paymentId: payment.id }) }
  )
  assert.equal(wrongSession.status, 404)
  const failedProduct = s.createProduct(s.owner, {
    name: "Unpaid item",
    amount: 100,
  })
  const failed = s.createPayment(s.owner, { product_id: failedProduct.id })
  s.prepareStripePayment(failed.id, "test")
  s.saveStripeSession(
    failed.id,
    {
      id: "cs_test_failed_receipt",
      url: "https://checkout.stripe.com/c/pay_failed",
      payment_intent: "pi_test_failed_receipt",
      status: "open",
    },
    "test"
  )
  const failedPrep = await prepare.POST(
    new Request("https://agora.example/api/checkout/prepare", {
      method: "POST",
      headers: { "X-Agora-Checkout-Token": failed.checkout_token },
    })
  )
  const failedCookie = failedPrep.headers.get("set-cookie")!.split(";", 1)[0]
  d.run("UPDATE payments SET status='failed' WHERE id=?", failed.id)
  const failedResponse = await statusRoute.GET(
    new Request(
      `https://agora.example/api/checkout/status/${failed.id}?session_id=cs_test_failed_receipt`,
      { headers: { cookie: failedCookie } }
    ),
    { params: Promise.resolve({ paymentId: failed.id }) }
  )
  assert.equal(failedResponse.status, 200)
  const failedBody = (await failedResponse.json()) as {
    status: string
    receipt?: unknown
  }
  assert.equal(failedBody.status, "failed")
  assert.equal("receipt" in failedBody, false)
})

process.once("beforeExit", () => rmSync(dir, { recursive: true, force: true }))
