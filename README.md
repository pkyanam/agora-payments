# Install the Agora CLI

Install the standalone command with Node.js 20.9 or newer:

```bash
curl -fsSL https://agora-payments.vercel.app/install.sh | bash
```

For source-based development installs, use the CLI repository directly:

```bash
gh repo clone pkyanam/agora-cli
cd agora-cli
bash install.sh
```

The installer places `agora` in `~/.local/bin` (or `$AGORA_INSTALL_DIR`), verifies the pinned SHA-256 of the standalone client, updates only its own managed CLI, and adds one PATH block to zsh or bash login configuration. It backs up an existing shell file before editing it. Open a new login shell and run `agora --help`. The CLI source and installer live in [pkyanam/agora-cli](https://github.com/pkyanam/agora-cli).

## What Agora does today

Agora provides a hosted Checkout, a versioned REST API, and a standalone CLI for products, payments, events, and refunds. The current public deployment is an isolated Stripe **test-mode** preview. Stripe's official test card can be used there; test transactions do not move money. Live charges and payouts are disabled. New merchant registrations require review, and processor access requires each merchant's own approved, connected account.

## Run the app locally

```bash
gh repo clone pkyanam/agora-payments
cd agora-payments
bun install
portless agora bun run dev
```

Open [https://agora-payments.vercel.app](https://agora-payments.vercel.app) for the hosted test preview. For local development, open [http://agora.localhost](http://agora.localhost) when the local preview proxy is running, or use the loopback URL printed by Next.js. The local database is stored under `.data/` and stays out of Git. Copy `.env.example` to `.env.local` only if local owner sign-in is configured; do not commit environment files or paste secrets into support messages.

## Use the API or CLI

The CLI reads its URL and merchant API key from environment variables. It does not save credentials for you. Set the URL to the hosted app or your local server, and use a scoped key issued for your merchant account. Each key is pinned to the provider mode selected when it was created; issue a new key when switching between sandbox, Stripe test, or Stripe live modes.

```bash
export AGORA_URL='https://agora-payments.vercel.app'
export AGORA_API_KEY='your-merchant-api-key'
agora products list
agora products create --name 'Studio license' --amount 4900 --idempotency-key product-studio-v1
agora payments create --product prod_... --customer 'Alex' --idempotency-key order-001
agora payments get --id pay_...
agora refunds create --payment pay_... --amount 4900 --reason 'Customer request' --idempotency-key refund-001
```

Amounts are integer cents: `4900` means `$49.00`. Give each mutation a stable idempotency key and reuse it when retrying the same request. API keys are shown once; store them in a secret manager or a short-lived shell environment, never in source control. The CLI supports product, payment, refund, and event API operations; it does not accept card details or decide the provider mode. In the hosted preview all provider traffic is Stripe test mode; never use a real card or treat test results as money movement.

Use `agora --help` for the full command list. The versioned REST API is documented in the Developers section of the console and at `/api-reference`.

## Finance and operations

The app records products, payment state, refunds, approvals, and an internal journal. It does not provide a bank reconciliation, tax calculation, provider fee statement, settlement report, or accounting ledger for real funds. Do not use test balances as business records or for close.

Live acceptance is not enabled. Each merchant must receive provider approval and connect its own account; Agora must then complete the required pricing, liability, dispute, reconciliation, and security reviews before any live activation. See [the partner paths and written questions](../agora-partner-paths.md) for current research and an unsent outreach draft.

## Development

```bash
bun run lint
bun run typecheck
bun test
```

The web app runs on Next.js 16; the hosted API runs on a Cloudflare Worker and SQLite Durable Object. The current Vercel deployment routes to a separate QA store and Stripe test credentials. It is a test preview, not a production money-processing service.
