# Agent and human sales workflow verification

Single-merchant USD scope. This checklist records source behavior and checks; it is not a deployment or payment-readiness claim.

| Requirement | Implementation | Evidence |
|---|---|---|
| Mode, scopes, provider readiness, payment/refund limits | `GET /api/v1/account`; API keys remain mode-pinned and scopes are explicit | Node service/security tests; Wrangler local HTTP account call |
| Editable catalog with history | Optimistic `PATCH /api/v1/products/:id` (`expected_version`), append-only product revisions; archive prevents new sales without changing snapshots | `sales-ui`, `sales`, `sales-security` tests; Wrangler local create/PATCH/history flow |
| Customers, expiring quotes, discounts | Durable customer records; quote expiry; immutable multi-line item/version snapshots and per-line discount allocation | `sales`, `sales-flow` tests; Wrangler local quote create/list flow |
| Safe quote links and explicit customer review | Canonical fragment `quote_url`; token hash and encrypted recovery value; review is read-only; public acceptance is explicit; API acceptance is separately audited and idempotent | `sales-flow` UI/API tests; Wrangler local public review/accept flow; same-key API accept replay and amount-limit rollback |
| Direct payments and quotes create sale records | Every new payment creates a customer, order, immutable line, and awaiting-payment fulfillment in the same idempotent transaction; existing historical payments are left intact | Direct-payment `sales` test; signed Stripe webhook order transition in `payments` tests; quote acceptance flow tests |
| Payment-confirmed fulfillment | Only verified Stripe success/reconciliation or enabled sandbox success advances an order to paid and fulfillment to ready; claim/fail/retry/complete are idempotent, actor-bound, and never execute arbitrary commands | `payments`, `sales`, `sales-security` tests; Wrangler local fulfillment claim/fail/retry/complete flow |
| Refund behavior | Partial refunds show refunded/net totals and preserve fulfillment; full refund cancels unfinished work and prevents further action; completed fulfillment remains historical | `sales-security` tests; checkout-flow UI assertions for refunded receipts |
| Receipts and status | Capability-protected status includes linked order/items; receipt appears only after verified payment; authenticated `GET /api/v1/orders/:id/receipt` is paid-only | `checkout-flow` and `sales-flow` tests; Wrangler local pending-receipt denial then paid receipt |
| Existing data and API compatibility | Node and Worker schema changes are additive; existing products backfill to version 1; old payment rows remain readable; unrecoverable hash-only legacy quote links are marked unavailable, never fabricated | `db-migration` tests; isolated local Worker upgrade from baseline schema preserved a legacy product and backfilled revision 1 |
| API, UI, and CLI discoverability | User-facing API reference, dashboard sales/quote/catalog/fulfillment views, and CLI/SDK commands describe the same resource and acceptance contracts | Node production build and UI tests; CLI repo tests reported green at commit `46b26fd` |

Checks run in the app repository: `npm run typecheck`, `npm test` (88 tests), `npm run build`, `npm run lint` (zero errors; warnings reported separately), and `git diff --check`. The Cloudflare checks used local Wrangler/DO SQLite only; no cloud deployment or live payment was created.
