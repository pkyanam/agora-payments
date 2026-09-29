# Sales platform API contract

This file is the shared implementation contract for the sales workflow UI, public API, and CLI/SDK.

## Catalog

- `GET /api/v1/products` lists the active catalog with a monotonically increasing `version`.
- `POST /api/v1/products` creates version 1.
- `PATCH /api/v1/products/:id` takes `{expected_version, name?, description?, amount?}` and an `Idempotency-Key`; stale versions return `409 catalog_version_conflict`. Each edit stores a version history row. Existing payment/quote snapshots do not change.
- Scope: `products:read` and `products:write`.

## Customers and quotes

- `POST /api/v1/customers` takes `{name, email?}` and an `Idempotency-Key`; `GET /api/v1/customers` and `GET /api/v1/customers/:id` read records. Scopes are `customers:write` and `customers:read`.
- `POST /api/v1/quotes` takes `{customer:{name, email?}, items:[{product_id, quantity}], discount_amount?, expires_at?}` and an `Idempotency-Key`.
- `expires_at` is an ISO timestamp; omission defaults to seven days. Expiry may be at most 30 days in the future. Amounts and discounts are integer USD cents; discount cannot exceed subtotal and total must remain positive.
- Quote item name, unit amount, quantity, line total, and catalog version are immutable snapshots. The response includes the canonical `quote_url`, quote/customer IDs, state, expiry, subtotal/discount/total, and item snapshots. Share the returned URL; do not construct one from IDs. Hash-only legacy quotes remain readable but return `quote_link_available:false` when their original link cannot be recovered.
- `GET /api/v1/quotes`, `GET /api/v1/quotes/:id` use `quotes:read`; creation uses `quotes:write`.
- Customers can review the capability-protected `quote_url` and explicitly accept through the public quote page. An authenticated API key may also accept through `POST /api/v1/quotes/:id/accept` with `quotes:write`, `payments:write`, and an `Idempotency-Key`; the quote audit event records that acceptance as API-authorized rather than customer-capability acceptance. Either path creates at most one order/payment, and the result uses the canonical Agora `checkout_url`.

## Orders and fulfillment

- `GET /api/v1/orders`, `GET /api/v1/orders/:id` use `orders:read`.
- `GET /api/v1/fulfillments`, `GET /api/v1/fulfillments/:id` use `fulfillment:read`.
- A verified payment success moves the linked order to `paid` and its fulfillment to `ready`. A pending or failed payment never unlocks fulfillment.
- `POST /api/v1/fulfillments/:id/claim` and `/complete` require `fulfillment:write` and an `Idempotency-Key`. Claims are assigned to one actor; completion requires the current claimant and records an optional bounded note. These operations record workflow state only; they do not execute arbitrary integrations or commands.
- Orders, order lines, and fulfillments store immutable quote/payment snapshots. Legacy payments without an order remain readable and are not rewritten.

## Account and customer receipts

- `GET /api/v1/account` returns the authenticated key's scopes, provider mode/readiness, max payment amount, and remaining refund allowance. It never returns secrets.
- `GET /api/v1/orders/:id/receipt` requires `orders:read` and returns a receipt only after verified payment. Existing capability-protected checkout status and receipt responses add linked order and fulfillment status when one exists. Refund projections include payment status, refunded amount, and net amount; full refunds cancel unfinished fulfillment while retaining completed history. Existing payment/receipt behavior remains valid for legacy payments.

All collection endpoints use the existing `cursor` and `limit` pagination shape. Read scopes and each new write scope remain separate; existing API keys do not gain new scopes automatically.
