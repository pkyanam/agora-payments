import { test } from "node:test"
import assert from "node:assert/strict"
import { JSDOM, VirtualConsole } from "jsdom"

const virtualConsole = new VirtualConsole()
virtualConsole.on("jsdomError", (error) => {
  if (!error.message.includes("Not implemented: navigation")) {
    process.emitWarning(error)
  }
})
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://agora.example/quote#" + "a".repeat(43),
  pretendToBeVisual: true,
  virtualConsole,
})
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  FormData: dom.window.FormData,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  IS_REACT_ACT_ENVIRONMENT: true,
})
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
})

const React = await import("react")
const { act, cleanup, fireEvent, render, screen, waitFor } =
  await import("@testing-library/react")
const { QuoteReview } = await import("../components/quote-review")
const { default: CheckoutReturn } =
  await import("../components/checkout-return")
const { ProductEditor } = await import("../components/product-editor")
const { QuoteDetails } = await import("../components/quote-details")

const token = "a".repeat(43)
await test("quote details reopen the original link and only allow editing open quotes", async () => {
  const openQuote = {
    id: "quo_open_ui",
    version: 2,
    status: "open",
    customer_name: "Austin Hedges",
    customer_email: "info@belweave.com",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    subtotal_amount: 49999,
    discount_amount: 2500,
    total_amount: 47499,
    currency: "usd",
    quote_url: `https://agora.example/quote#${token}`,
    items: [
      {
        product_id: "prod_vr",
        product_name: "Meta VR Glasses",
        quantity: 1,
        unit_amount: 49999,
        line_total: 49999,
      },
    ],
  }
  let copied = ""
  let edited = 0
  const detailView = render(
    React.createElement(QuoteDetails, {
      quote: openQuote,
      onCopy: (url: string) => (copied = url),
      onEdit: () => edited++,
    })
  )
  assert.ok(screen.getByText(/Meta VR Glasses/))
  assert.equal(
    (
      screen.getByRole("link", {
        name: "Open original quote",
      }) as HTMLAnchorElement
    ).href,
    openQuote.quote_url
  )
  fireEvent.click(
    screen.getByRole("button", { name: "Copy original quote link" })
  )
  fireEvent.click(
    await screen.findByRole("button", { name: "Edit open quote" })
  )
  assert.equal(copied, openQuote.quote_url)
  assert.equal(edited, 1)
  const refreshedUrl = `https://agora.example/quote#${"b".repeat(43)}`
  detailView.rerender(
    React.createElement(QuoteDetails, {
      quote: { ...openQuote, version: 3, quote_url: refreshedUrl },
      onCopy: (url: string) => (copied = url),
      onEdit: () => edited++,
    })
  )
  fireEvent.click(
    screen.getByRole("button", { name: "Copy original quote link" })
  )
  assert.equal(copied, refreshedUrl)
  cleanup()

  render(
    React.createElement(QuoteDetails, {
      quote: { ...openQuote, status: "accepted" },
      onCopy: () => {},
      onEdit: () => edited++,
    })
  )
  assert.equal(screen.queryByRole("button", { name: "Edit open quote" }), null)
  assert.match(
    (await screen.findByText(/read only/i)).textContent || "",
    /read only/i
  )
  assert.equal(edited, 1)
  cleanup()
})

const quote = {
  id: "quo_ui_test",
  merchant: "Agora Shop",
  customer_name: "Casey Buyer",
  status: "open",
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  currency: "usd",
  subtotal_amount: 2500,
  discount_amount: 0,
  total_amount: 2500,
  items: [
    {
      product_name: "Research session",
      quantity: 1,
      unit_amount: 2500,
      line_total: 2500,
      discount_amount: 0,
      net_total: 2500,
      catalog_version: 2,
    },
  ],
}
const originalFetch = globalThis.fetch
const settleEffects = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25))
  })

await test("quote page requires an explicit click and submits acceptance only once", async () => {
  let acceptCalls = 0
  let finishAcceptance!: (response: Response) => void
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url === "/api/quote/review") return Response.json(quote)
    if (url === "/api/quote/accept") {
      acceptCalls += 1
      return await new Promise<Response>((resolve) => {
        finishAcceptance = resolve
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }
  try {
    window.history.replaceState({}, "", `/quote#${token}`)
    render(React.createElement(QuoteReview))
    await settleEffects()
    assert.ok(screen.getByRole("heading", { name: "Review your purchase" }))
    assert.equal(acceptCalls, 0)
    const button = screen.getByRole("button", {
      name: /Accept quote and continue/,
    })
    fireEvent.click(button)
    await waitFor(() => assert.equal(acceptCalls, 1))
    assert.equal((button as HTMLButtonElement).disabled, true)
    fireEvent.click(button)
    assert.equal(acceptCalls, 1)
    await act(async () => {
      finishAcceptance(
        Response.json({
          checkout_url: `https://agora.example/checkout/start#${"b".repeat(48)}`,
        })
      )
    })
    assert.equal(acceptCalls, 1)
  } finally {
    cleanup()
    globalThis.fetch = originalFetch
  }
})

await test("expired quote shows an accessible error and no acceptance control", async () => {
  globalThis.fetch = async () =>
    Response.json(
      {
        error: {
          message: "This quote has expired. Ask the seller for a new quote.",
        },
      },
      { status: 410 }
    )
  try {
    window.history.replaceState({}, "", `/quote#${token}`)
    render(React.createElement(QuoteReview))
    await settleEffects()
    assert.match(
      screen.getByRole("alert").textContent || "",
      /quote has expired/i
    )
    assert.ok(
      screen.queryByRole("button", { name: /Accept quote and continue/ }) ===
        null
    )
  } finally {
    cleanup()
    globalThis.fetch = originalFetch
  }
})

await test("checkout status never offers a receipt while pending, and paid refunds keep an annotated receipt", async () => {
  globalThis.fetch = async () =>
    Response.json({
      id: "pay_ui_test",
      status: "pending",
      order: {
        id: "ord_ui_test",
        status: "awaiting_payment",
        fulfillment_status: "awaiting_payment",
        items: [],
      },
    })
  try {
    const pending = render(
      React.createElement(CheckoutReturn, {
        paymentId: "pay_ui_test",
        sessionId: "cs_test_ui",
      })
    )
    await settleEffects()
    assert.ok(screen.getByText(/still pending provider confirmation/i))
    assert.equal(
      screen.queryByRole("button", { name: /print or save receipt/i }),
      null
    )
    pending.unmount()

    globalThis.fetch = async () =>
      Response.json({
        id: "pay_ui_test",
        status: "succeeded",
        order: {
          id: "ord_ui_test",
          status: "paid",
          fulfillment_status: "cancelled",
          items: [],
        },
        receipt: {
          reference: "pay_ui_test",
          merchant: "Agora Shop",
          customer: "Casey Buyer",
          product_name: "Research session",
          amount: 2500,
          refunded_amount: 2500,
          net_amount: 0,
          payment_status: "refunded",
          currency: "usd",
          paid_at: new Date().toISOString(),
          order: {
            id: "ord_ui_test",
            status: "paid",
            fulfillment_status: "cancelled",
            payment_status: "refunded",
            refunded_amount: 2500,
            net_amount: 0,
            items: [],
          },
        },
      })
    render(
      React.createElement(CheckoutReturn, {
        paymentId: "pay_ui_test",
        sessionId: "cs_test_ui",
      })
    )
    await settleEffects()
    assert.ok(screen.getByRole("heading", { name: "Payment confirmed" }))
    assert.equal(screen.getAllByText("Refunded").length, 2)
    assert.ok(screen.getByText("Net after refund"))
    assert.ok(screen.getByText("cancelled"))
    assert.ok(screen.getByRole("button", { name: /print or save receipt/i }))
  } finally {
    cleanup()
    globalThis.fetch = originalFetch
  }
})

await test("catalog editor submits the expected version and reports server conflicts accessibly", async () => {
  const product = {
    id: "prod_versioned",
    version: 7,
    name: "Original",
    description: "Old detail",
    amount: 1234,
  }
  const received: unknown[] = []
  render(
    React.createElement(ProductEditor, {
      product,
      onSave: async (payload) => {
        received.push(payload)
      },
    })
  )
  assert.equal(
    (screen.getByLabelText("Product name") as HTMLInputElement).value,
    "Original"
  )
  assert.equal(
    (screen.getByLabelText(/Description/) as HTMLTextAreaElement).value,
    "Old detail"
  )
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Updated name" },
  })
  fireEvent.change(screen.getByLabelText(/Description/), {
    target: { value: "Updated detail" },
  })
  fireEvent.change(screen.getByLabelText("Price in USD"), {
    target: { value: "45.67" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Save new version" }))
  await waitFor(() => assert.equal(received.length, 1))
  assert.deepEqual(received[0], {
    product_id: "prod_versioned",
    expected_version: 7,
    name: "Updated name",
    description: "Updated detail",
    amount: 4567,
    currency: "usd",
  })
  cleanup()

  render(
    React.createElement(ProductEditor, {
      product,
      onSave: async () => {
        throw new Error("Version conflict. Reload this product and try again.")
      },
    })
  )
  fireEvent.click(screen.getByRole("button", { name: "Save new version" }))
  assert.match(
    (await screen.findByRole("alert")).textContent || "",
    /version conflict/i
  )
})

process.on("exit", () => dom.window.close())
