# Agora backend verification

This note records backend behavior verified on September 28, 2026. Test fixtures and credentials remain in ignored, mode-0600 files; this document contains no secrets.

## Verified in hosted QA

- A fresh owner completed password login and mandatory MFA enrollment. A new API key was issued with `provider_mode=test`.
- A Stripe TEST Checkout payment completed through the hosted checkout and signed webhook. The app showed the payment as succeeded after webhook confirmation.
- A 50-cent Stripe TEST partial refund was submitted against the existing settled QA payment. Repeating the exact request with the same idempotency key returned the same Agora refund ID and Stripe refund ID, with status `succeeded`. The payment's refunded total is now 150 cents: the previous 100-cent refund plus this request. The owner snapshot showed two successful refund events for that payment.
- The temporary test API key was revoked; a subsequent request using it returned 401.
- On the isolated auth-only QA Worker, a second merchant completed invitation acceptance, scrypt password setup, and MFA enrollment. A pending merchant could not issue a key (409). After approval, the merchant's API payment list was empty; attempting to read or refund the owner's payment returned 404. Owner-only registration review and invitation actions returned 403. The merchant snapshot did not contain the owner's payment. Revoking the merchant key caused subsequent use to return 401.

## Local checks and financial controls

- `bun run typecheck` passed.
- `bun run lint -- --quiet` passed.
- `bun run test` passed: 32 tests, including mode-pinned keys, tenant boundaries, registration approval, MFA session revocation, webhook signature/mode checks, restricted-key permissions, production fail-closed behavior, replay behavior, refund accounting, and complete 28-day metrics across more than 200 payments.
- Stripe refunds reserve both payment refundable balance and the issuing key's remaining cumulative refund allowance while provider results are pending. An unknown provider outcome stays pending and retries use the same provider idempotency key. A late Checkout webhook can complete before session persistence; session persistence now records the mapping without changing the terminal payment status.
- API credentials remain pinned to the mode in which they were created. Payment listing/detail and refund access are tenant- and mode-scoped. An old sandbox/test key does not become a live key when the service's selected mode changes.
- Merchant passwords use versioned scrypt (`N=65,536, r=8, p=2`). Normal invite acceptance and MFA enrollment succeeded on the Cloudflare Worker runtime. MFA secrets are encrypted at rest; the exposed QA/owner encryption keys were rotated, records migrated, and previous-key fallbacks removed.
- Valid invite submissions now consume the persistent email/IP rate-limit budget before password KDF work, and scrypt jobs are serialized with a small in-flight cap to bound memory under concurrent requests.
- Dashboard financial metrics now aggregate all successful non-sample payments for the authenticated tenant and active provider mode across the full 28-day UTC window. The table may still return only the latest 200 payments; totals and daily chart data do not depend on that page limit. Refund totals are attributed to the payment creation date and shown before fees.
- The live setup operator script has isolated mock tests: Stripe calls are limited to account and webhook endpoint operations, no payment/refund/payout calls are made, and live vars are deployed only after the production Worker is first placed in a fail-closed sandbox configuration and both secrets are provisioned. The script has not been run against a live API key.
- Stripe Checkout currently requests card payments only. No ACH, bank debit, or wallet payment flow is implemented or represented as supported.

## Production status and remaining external work

The production Worker is not configured with a live Stripe API key or live webhook signing secret. Delivery's latest sanitized inventory found neither. The backend now reports `provider_status: setup_required` and `checkout_enabled: false` in production until mode-matched API key, webhook secret, and canonical origin are available; payment creation, key issuance, sandbox settlement, and sandbox refunds fail closed. QA remains explicitly separate. An authenticated Stripe CLI OAuth credential exists, but it is not being treated as a durable Worker API key. No live charge or refund has been made.

The owner account's live charges and payouts capabilities were previously checked as enabled, and its Stripe business/support profile matched Belweave. That establishes account capability, not that Agora's production live integration is configured or that a live payment has been proven.

Merchant live processing requires Stripe Standard Connect OAuth to be enabled for Agora. Stripe's test account creation previously stopped at the external Connect sign-up requirement. The code scopes each merchant's direct charges to that merchant's own connected Stripe account and applies no Agora platform fee; it never routes merchant payments through the Belweave owner account. Until Stripe enables Connect and each merchant links its own account, those merchants cannot accept processor payments.

For owner-only acceptance, a Dashboard restricted key can be used for mode-matched Checkout Session create/read and Refund API requests when it is granted the required resource permissions; Connect OAuth exchange and deauthorization still require the platform secret key. Before describing production live acceptance as configured, provision durable mode-matched live API and webhook credentials, a persistent Stripe webhook endpoint, and verify the signed live webhook path without submitting a real payment. A real live transaction remains unverified by design. The hosted checkout keeps card entry on Stripe; Agora does not receive card numbers. No PCI assessment, formal penetration test, SOC report, or compliance certification has been completed.
