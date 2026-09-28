import Link from "next/link"
const endpoints = [
  ["GET", "/api/v1/products", "List your catalog.", "products:read"],
  [
    "POST",
    "/api/v1/products",
    "Create a fixed-price USD product.",
    "products:write",
  ],
  ["GET", "/api/v1/payments", "List payments.", "payments:read"],
  [
    "POST",
    "/api/v1/payments",
    "Create a pending payment and checkout URL.",
    "payments:write",
  ],
  [
    "GET",
    "/api/v1/payments/:id",
    "Read a payment’s current state.",
    "payments:read",
  ],
  [
    "POST",
    "/api/v1/payments/:id/reconcile",
    "Verify a stored hosted-checkout session with the provider.",
    "payments:write",
  ],
  [
    "POST",
    "/api/v1/refunds",
    "Refund or request human approval.",
    "refunds:write",
  ],
  [
    "GET",
    "/api/v1/events",
    "Poll an ordered, persisted event stream.",
    "events:read",
  ],
]
export default function Reference() {
  return (
    <main className="reference-page">
      <header>
        <Link className="wordmark" href="/">
          agora<span>·</span>
        </Link>
        <Link href="/?view=Developers">Back to your workspace ↗</Link>
      </header>
      <p className="eyebrow">THE API / V1</p>
      <h1>API reference</h1>
      <p className="reference-intro">
        REST API for applications and agents. All amounts are integer USD cents.
        This deployment uses Stripe test mode; its payments and refunds do not
        move real money.
      </p>
      <section>
        <h2>Start with a key.</h2>
        <p>
          Create a scoped key in Developers or Access. Send it as{" "}
          <code>Authorization: Bearer ag_test_…</code>. Keys never belong in
          browser code. Each key is restricted to its merchant workspace and
          provider mode.
        </p>
        <pre>{`POST /api/v1/payments\nAuthorization: Bearer $AGORA_API_KEY\nIdempotency-Key: order-001\nContent-Type: application/json\n\n{ "product_id": "prod_studio", "customer": "Alex" }`}</pre>
        <p>
          The response includes an absolute <code>checkout_url</code>. Send the
          buyer there; it opens Stripe-hosted Checkout in this deployment’s
          test mode. The app confirms payment only after a signed Stripe event
          updates the payment record. The local test checkout, when configured,
          simulates outcomes and never collects card details.
        </p>
      </section>
      <section>
        <h2>Eight endpoints. One model.</h2>
        {endpoints.map(([method, path, description, scope]) => (
          <article className="endpoint" key={method + path}>
            <span>{method}</span>
            <div>
              <code>{path}</code>
              <p>{description}</p>
              <small>{scope}</small>
            </div>
          </article>
        ))}
      </section>
      <section>
        <h2>Retries that don’t repeat the money.</h2>
        <p>
          Every POST requires an <code>Idempotency-Key</code>. Repeat the same
          key and JSON payload to retrieve the original result. Reusing it with
          changed data returns 409. Keys are scoped to the authenticated
          credential and endpoint. If a request times out, keep the same key; do
          not assume failure or generate a new operation.
        </p>
        <p>
          Revoked keys cannot replay past requests. Idempotency records are
          retained without automatic expiry.
        </p>
      </section>
      <section>
        <h2>Delegation with boundaries.</h2>
        <p>
          A key has scopes, a maximum payment amount, and a cumulative
          autonomous refund allowance. A checkout exceeding its payment limit
          returns 403. A refund exceeding the remaining allowance returns{" "}
          <code>status: requires_approval</code> with an approval ID. This is a
          request, not a refund. The owner reviews it in Agents.
        </p>
        <p>
          Approvals bind the exact payment, amount and reason. The server
          rechecks refundable funds and key revocation before executing. Agents
          cannot mint keys, approve requests, or increase their own permissions.
          Human-approved refunds do not consume the autonomous allowance.
        </p>
        <pre>{`POST /api/v1/refunds\n\n{\n  "payment_id": "pay_…",\n  "amount": 4900,\n  "reason": "Customer requested cancellation"\n}`}</pre>
      </section>
      <section>
        <h2>Follow what happened.</h2>
        <p>
          List endpoints accept <code>?cursor=0&limit=25</code> with a maximum
          limit of 100. Responses include <code>data</code> and{" "}
          <code>next_cursor</code>. Events are ordered by insertion and include
          type, actor, object ID and timestamp. Signed Stripe webhooks update
          payment and refund state. The API event stream is polled separately;
          this deployment does not configure merchant-directed outgoing webhooks.
        </p>
        <p>
          Payment states are <code>pending</code>, <code>succeeded</code>, and{" "}
          <code>failed</code>. Refunds are separate records; the payment’s{" "}
          <code>refunded</code> field tracks its cumulative refunded amount.
          Stripe refund status follows the processor response and verified
          webhook events. Sample records are marked with <code>sample: 1</code>.
        </p>
      </section>
      <section>
        <h2>Errors you can act on.</h2>
        <pre>{`{\n  "error": {\n    "code": "limit_exceeded",\n    "message": "This price exceeds the key’s per-payment limit.",\n    "request_id": "req_…"\n  }\n}`}</pre>
        <p>
          401: invalid key. 403: insufficient permission or payment limit. 404:
          unknown object. 409: conflicting retry or payment state. 413: request
          too large. 422: invalid input. 500: unexpected server error. Successes
          and errors include a request ID header.
        </p>
      </section>
      <section>
        <h2>Your tools. Same API.</h2>
        <p>
          The standalone Agora CLI is maintained separately from this payment
          service. It reads <code>AGORA_URL</code> and{" "}
          <code>AGORA_API_KEY</code>, returns JSON, and exits nonzero on errors.
          Source and installation guidance are in the{" "}
          <a href="https://github.com/pkyanam/agora-cli" target="_blank" rel="noreferrer">CLI repository</a>;
          access follows that repository’s permissions.
        </p>
        <a className="reference-link" href="/openapi.json">
          Download the OpenAPI specification ↗
        </a>
        <a className="reference-link" href="/llms.txt">
          Read the agent integration guide ↗
        </a>
      </section>
    </main>
  )
}
