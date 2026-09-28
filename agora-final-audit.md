# Agora final implementation audit

Audit date: September 28, 2026. This records implemented behavior and evidence separately from production blockers. It is not a security certification.

## Requirement status

| Requirement | Evidence/status |
|---|---|
| Owner can accept payments | **Not live-enabled.** Main production Worker reports `setup_required` and `checkout_enabled:false`; payment creation and sandbox settlement are fail-closed. The account’s charges/payouts capabilities and Belweave profile were read-only verified, but no durable live Worker API key or live webhook secret is configured. No live charge/refund was attempted. |
| Stripe TEST Checkout and refunds | **Hosted QA verified.** A Stripe test Checkout completed through the hosted page and signed webhook. A partial test refund and exact same-idempotency replay returned the same Agora and Stripe refund IDs; the balance effect was recorded once. Test payments/refunds do not move real funds. |
| Merchant onboarding and isolation | Public registration, owner approval, single-use expiring invite, password/MFA enrollment, and tenant-scoped sessions/data are implemented. Hosted auth-only QA verified pending-key denial, merchant access denial to owner payment/refund data, owner-only action denial, and key revocation. Stripe Connect signup remains an external blocker; each merchant must connect its own account before live processing. Merchant payments are designed as direct account-scoped charges with no Agora platform fee; Agora does not pool merchants under Belweave. |
| API and CLI | Versioned REST API and OpenAPI 3.1 contract; standalone CLI reads `AGORA_URL` and `AGORA_API_KEY` from the environment and does not persist keys. Hosted installer artifact matches its pinned SHA-256. API keys are bound to sandbox, test, or live mode. |
| Financial correctness | Integer USD cents; provider idempotency; exact amount/currency/account/session checks; signed mode-bound webhook replay protection; pending refund reservations for refundable balance and key budget; terminal same-key refund replay; internal balanced journal. Dashboard metrics aggregate the full authorized tenant/provider/mode cohort over 28 UTC days even when the recent payments table is capped at 200. A regression test covers 203 rows, UTC boundaries, refunds, and tenant/mode isolation. |
| Supported payment methods | Card through Stripe-hosted Checkout only. No ACH, bank debit, or wallet method is implemented. |

## Security review and limits

Owner and merchant access require password plus TOTP MFA. MFA secrets are encrypted at rest; recovery codes are hashed and one-use; TOTP counters prevent replay; sessions can be revoked. Merchant passwords use scrypt (`N=65,536, r=8, p=2`), with persistent rate limits before KDF work and a small serialized in-flight KDF cap. Cookie-authenticated writes check same-origin; cookies are HttpOnly, Secure in HTTPS/production, and use Lax for completed sessions and Strict for pending MFA stages. SQL values are parameterized. Webhooks are size-capped, HMAC/timestamp verified, and checked against mode, tenant, account, session, amount, and currency before applying state.

The operator live-setup script is tested with mocked Stripe/Wrangler calls. It verifies the owner account ID and capabilities, creates or reuses only the exact configured live webhook, deploys a production fail-closed configuration before secret provisioning, then enables Stripe/live only in the final deploy. The script has not been run without the missing durable key and webhook setup. Its mock test makes no payment, refund, or payout API calls.

No card numbers reach Agora because Checkout is hosted by Stripe. No PCI assessment, formal penetration test, SOC report, or compliance certification has been completed. The app is not a bank reconciliation or settlement/fee/tax accounting system; processor pricing and merchant-specific negotiated rates remain external to this verification.

During implementation, QA/local authentication-encryption key material was inadvertently exposed in tool output. The affected encryption keys were rotated, stored MFA records were migrated and checked, previous-key fallbacks and affected sessions/tokens were removed, and no ledger state was reset. No Stripe API key, webhook signing secret, or card data was exposed. The user was informed.

## Verification

- Local: `bun run typecheck`, `bun run lint -- --quiet`, and 32 tests passed, including auth/KDF rate and concurrency, tenant/mode isolation, financial aggregation, refund replay, webhook verification, and operator-script safety.
- Hosted: QA Stripe test Checkout, webhook confirmation, partial refund/replay, and separate merchant auth/isolation flows were completed without real-money activity.
- Read-only deployment probe after final deploy: production health returned `deployment: production`, `provider_status: setup_required`, and `checkout_enabled:false`; QA health returned `deployment: qa`, `provider_status: ready`, and `provider_mode:test`. Canonical Vercel API session is unauthenticated 200/no-store/DO storage; owner console is 401/no-store/DO storage. QA preview has the same session and console results from its separate Worker. The deployed CLI matched its pinned SHA-256 `3813c1e6…590180`.
- Mobile-device/browser verification was not performed. No live transaction was performed.

## Remaining external steps

1. Provision a durable, mode-matched live Stripe API credential and persistent live webhook signing secret, then deploy and verify the signed webhook path without making a real charge. The restricted key is preferred when its required permissions are available; a mode-valid standard key is also supported if securely provisioned.
2. Obtain Stripe Standard Connect platform approval/onboarding, then have each pilot merchant authorize its own account. Until then, merchant live payment acceptance remains disabled.
