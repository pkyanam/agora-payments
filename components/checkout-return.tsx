"use client"

import { useEffect, useState } from "react"

type ProviderStatus = {
  status: "pending" | "succeeded" | "failed" | "expired"
  order?: {
    id: string
    status: string
    fulfillment_status?: string | null
    items: Array<{ product_name: string; quantity: number }>
  }
  receipt?: {
    reference: string
    merchant: string
    customer: string
    product_name: string
    amount: number
    currency: string
    paid_at?: string
    order?: {
      id: string
      status: string
      fulfillment_status?: string | null
      payment_status?: "paid" | "partially_refunded" | "refunded"
      refunded_amount?: number
      net_amount?: number
      items?: Array<{
        product_name: string
        quantity: number
        unit_amount: number
        line_total: number
        discount_amount: number
        net_total: number
      }>
    }
  }
}

export default function CheckoutReturn({
  paymentId,
  sessionId,
  canceled = false,
}: {
  paymentId?: string
  sessionId?: string
  canceled?: boolean
}) {
  const [status, setStatus] = useState<ProviderStatus["status"] | "unknown">(
    "pending"
  )
  const [message, setMessage] = useState("Checking for provider confirmation…")
  const [attempt, setAttempt] = useState(0)
  const [receipt, setReceipt] = useState<ProviderStatus["receipt"]>()
  const [order, setOrder] = useState<ProviderStatus["order"]>()

  useEffect(() => {
    let active = true
    const poll = async () => {
      if (!paymentId) {
        setStatus("unknown")
        setMessage(
          "The payment reference is missing. Check the payment record with the merchant."
        )
        return
      }
      for (let i = 0; i < 8 && active; i += 1) {
        try {
          const query = new URLSearchParams()
          if (sessionId) query.set("session_id", sessionId)
          const suffix = query.size ? `?${query.toString()}` : ""
          const response = await fetch(
            `/api/checkout/status/${encodeURIComponent(paymentId)}${suffix}`,
            {
              cache: "no-store",
            }
          )
          const body = (await response.json()) as {
            error?: { message?: string }
            status?: ProviderStatus["status"]
            receipt?: ProviderStatus["receipt"]
            order?: ProviderStatus["order"]
          }
          if (!response.ok || !body.status) {
            throw new Error(
              body.error?.message || "Status is not available yet."
            )
          }
          if (!active) return
          setStatus(body.status)
          setReceipt(body.receipt)
          setOrder(body.order)
          if (body.status !== "pending") {
            setMessage(
              body.status === "succeeded"
                ? "Payment confirmed by the payment provider."
                : "The payment provider confirmed that this payment did not complete."
            )
            return
          }
          setMessage(
            canceled
              ? "Checkout was closed. The provider has not confirmed a final payment status."
              : "The payment is still pending provider confirmation. This return page does not mark a payment as successful."
          )
        } catch (error) {
          if (!active) return
          setStatus("unknown")
          setMessage(
            error instanceof Error
              ? `${error.message} The payment is not confirmed.`
              : "Unable to check provider status. The payment is not confirmed."
          )
        }
        if (i < 7) await new Promise((resolve) => setTimeout(resolve, 1500))
      }
    }
    void poll()
    return () => {
      active = false
    }
  }, [paymentId, sessionId, canceled, attempt])

  const title =
    status === "succeeded"
      ? "Payment confirmed."
      : status === "failed" || status === "expired"
        ? "Payment not completed."
        : canceled
          ? "Checkout closed."
          : "Payment status is pending."

  return (
    <main
      className={`checkout-page checkout-return${status === "succeeded" && receipt ? "checkout-receipt" : ""}`}
    >
      <span className="wordmark">
        agora<span>·</span>
      </span>
      {status === "succeeded" && receipt ? (
        <>
          <span className="checkout-review-mark">PAYMENT RECEIPT</span>
          <h1>Payment confirmed</h1>
          <p role="status" aria-live="polite">
            {message}
          </p>
          <section
            className="checkout-review-card"
            aria-label="Payment receipt"
          >
            <p className="checkout-review-merchant">{receipt.merchant}</p>
            <dl>
              {!receipt.order?.items?.length && (
                <div>
                  <dt>Item</dt>
                  <dd>{receipt.product_name}</dd>
                </div>
              )}
              {receipt.order?.items?.map((item, index) => (
                <div key={`${receipt.order?.id}-${index}`}>
                  <dt>
                    {item.quantity} × {item.product_name}
                  </dt>
                  <dd>
                    {new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: receipt.currency.toUpperCase(),
                    }).format(item.net_total / 100)}
                    {item.discount_amount > 0 && (
                      <small>
                        Before discount:{" "}
                        {new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency: receipt.currency.toUpperCase(),
                        }).format(item.line_total / 100)}{" "}
                        · discount −
                        {new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency: receipt.currency.toUpperCase(),
                        }).format(item.discount_amount / 100)}
                      </small>
                    )}
                  </dd>
                </div>
              ))}
              <div>
                <dt>Name</dt>
                <dd>{receipt.customer}</dd>
              </div>
              {receipt.paid_at && (
                <div>
                  <dt>Payment date</dt>
                  <dd>
                    {new Intl.DateTimeFormat("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(receipt.paid_at))}
                  </dd>
                </div>
              )}
              <div>
                <dt>Reference</dt>
                <dd>{receipt.reference}</dd>
              </div>
              {receipt.order && (
                <div>
                  <dt>Order</dt>
                  <dd>
                    {receipt.order.id} ·{" "}
                    {receipt.order.status === "paid"
                      ? "Paid"
                      : "Status: " + receipt.order.status}
                  </dd>
                </div>
              )}
              {receipt.order?.fulfillment_status && (
                <div>
                  <dt>Delivery</dt>
                  <dd>
                    {receipt.order.fulfillment_status.replaceAll("_", " ")}
                  </dd>
                </div>
              )}
              {receipt.order?.payment_status && (
                <div>
                  <dt>Payment state</dt>
                  <dd>
                    {receipt.order.payment_status === "partially_refunded"
                      ? "Partially refunded"
                      : receipt.order.payment_status === "refunded"
                        ? "Refunded"
                        : "Paid"}
                  </dd>
                </div>
              )}
              <div className="checkout-review-amount">
                <dt>Total charged</dt>
                <dd>
                  {new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: receipt.currency.toUpperCase(),
                  }).format(receipt.amount / 100)}{" "}
                  <span>{receipt.currency.toUpperCase()}</span>
                </dd>
              </div>
              {(receipt.order?.refunded_amount || 0) > 0 && (
                <>
                  <div>
                    <dt>Refunded</dt>
                    <dd>
                      −
                      {new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: receipt.currency.toUpperCase(),
                      }).format((receipt.order?.refunded_amount || 0) / 100)}
                    </dd>
                  </div>
                  <div>
                    <dt>Net after refund</dt>
                    <dd>
                      {new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: receipt.currency.toUpperCase(),
                      }).format((receipt.order?.net_amount || 0) / 100)}
                    </dd>
                  </div>
                </>
              )}
            </dl>
          </section>
          <button
            className="checkout-control checkout-print"
            onClick={() => window.print()}
          >
            Print or save receipt
          </button>
          <p className="checkout-review-footer">
            You can save this receipt as a PDF from your browser’s print dialog.
            You may close this page when you’re done.
          </p>
        </>
      ) : (
        <>
          <span className="sandbox-mark">Payment status</span>
          <h1>{title}</h1>
          <p role="status" aria-live="polite">
            {message}
          </p>
          {order && (
            <section className="checkout-review-card" aria-label="Order status">
              <h2>Order status</h2>
              <dl>
                <div>
                  <dt>Order reference</dt>
                  <dd>{order.id}</dd>
                </div>
                <div>
                  <dt>Payment</dt>
                  <dd>
                    {order.status === "paid" && status === "succeeded"
                      ? "Paid"
                      : order.status === "awaiting_payment"
                        ? "Awaiting payment confirmation"
                        : order.status}
                  </dd>
                </div>
                {order.fulfillment_status && (
                  <div>
                    <dt>Delivery</dt>
                    <dd>{order.fulfillment_status.replaceAll("_", " ")}</dd>
                  </div>
                )}
                {order.items.map((item, index) => (
                  <div key={`${order.id}-${index}`}>
                    <dt>
                      {item.quantity} × {item.product_name}
                    </dt>
                    <dd />
                  </div>
                ))}
              </dl>
            </section>
          )}
          <div className="form-stack">
            {status !== "succeeded" &&
              status !== "failed" &&
              status !== "expired" && (
                <button
                  className="checkout-control checkout-control-secondary"
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  Check again
                </button>
              )}
          </div>
        </>
      )}
    </main>
  )
}
