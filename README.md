# Install the Agora CLI

Install the standalone command with Node.js 20.9 or newer. The installer and CLI are served from the private GitHub repository through your authenticated GitHub CLI session:

```bash
(set -o pipefail; gh api repos/pkyanam/agora-cli/contents/install.sh -H 'Accept: application/vnd.github.raw+json' | bash)
```

For source-based development installs, use the CLI repository directly:

```bash
gh repo clone pkyanam/agora-cli
cd agora-cli
bash install.sh
```

The installer places `agora` in `~/.local/bin` (or `$AGORA_INSTALL_DIR`), verifies the pinned SHA-256 of the standalone client, updates only its own managed CLI, and adds one PATH block to zsh or bash login configuration. It backs up an existing shell file before editing it. Open a new login shell and run `agora --help`. The CLI source and installer live in [pkyanam/agora-cli](https://github.com/pkyanam/agora-cli).

## Install Agora Community

The local Community install uses one Node.js 22.16+ process and persistent SQLite storage. It is suited to a Mac or Linux server; Raspberry Pi compatibility depends on a supported 64-bit Node build and has not yet been validated across board generations. The source repository is private during prerelease, so the bootstrap requires `gh` authenticated with repository access. It fetches source into a temporary private directory and removes that checkout after installation:

```bash
(set -o pipefail; gh api repos/pkyanam/agora-payments/contents/community-install.sh -H 'Accept: application/vnd.github.raw+json' | bash)
```

For an existing authenticated checkout, run `bash install.sh` directly. The default target is local Node + SQLite. A separate Cloudflare Worker + Durable Object API and Vercel UI can be installed with `bash install.sh --target cloudflare`; Wrangler and Vercel CLIs must already be installed and authenticated (`npx wrangler login`, `vercel login`). This creates a distinct Vercel project and does not replace the experimental hosted deployment. Use `--help` for interactive and noninteractive configuration options. Cloud updates use the same state directory and `--update`; Cloudflare/Vercel credentials remain in their local CLI auth stores.

The installer asks for an owner email, creates private configuration and bootstrap credentials, installs dependencies, and builds the app. It never deletes files or resets the database. Set the install directory and run without prompts with:

```bash
bash install.sh --dir "$HOME/.local/share/agora" --url http://localhost:3000 \
  --owner-email owner@example.com --non-interactive
```

SQLite lives at `<install-directory>/state/data/agora.sqlite`; configuration is in `state/.env.local`, and the generated first-login password is in `state/community-owner-credentials.txt`. Releases live under `releases/` and `current` points to the active one. Keep state files private and change the bootstrap password after signing in. Community defaults to Stripe test mode. Add test credentials, configure a webhook endpoint, and verify a signed test event in the workspace's Stripe setup before issuing API keys. Community production deployments have no simulator fallback. Live mode remains an explicit operator choice after test verification.

Start the app with `<install-directory>/start.sh` and open the configured origin. For public access, put the app behind HTTPS and configure `AGORA_PUBLIC_ORIGIN` to that public origin. The CLI's `agora server update --dir <install-directory>` fetches the pinned private Git repository, refuses modified release files, builds a separate release, saves a SQLite backup, and switches releases. If started with `start.sh`, it stops, restarts, and health-checks the service; a failed restart rolls back to the previous release and database backup. Back up SQLite before upgrades. Run the app as an unprivileged service account and keep it behind HTTPS; the default listener binds only to loopback.

The current hosted deployment remains experimental. Installer distribution uses GitHub; the hosted app frontend can still be deployed to Vercel, and Vercel's ephemeral filesystem is not a supported SQLite data store. The community cloud profile stores API state in a Cloudflare SQLite Durable Object and pairs it with a separate Vercel UI project. Webhook endpoint delivery is at-least-once; webhook target hostnames are not DNS-resolved to detect private-address rebinding, so operators should only configure trusted HTTPS endpoints.

## What Agora does today

Agora provides a hosted Checkout, a versioned REST API, and a standalone CLI for products, payments, events, refunds, and hosted-checkout reconciliation. The canonical production deployment is connected to the clean owner environment and currently reports **Setup required**. Payment creation is disabled until the required Stripe credentials and signed webhook are configured and verified. There is no simulator fallback on production. The isolated Stripe test QA preview is separate; its data and test payments are not part of the canonical workspace. Live acceptance remains blocked.

## Run the app locally

```bash
gh repo clone pkyanam/agora-payments
cd agora-payments
bun install
portless agora bun run dev
```

Open [https://agora-payments.vercel.app](https://agora-payments.vercel.app) for the canonical workspace. Its current provider state disables payment creation; do not attempt live Checkout until the dashboard reports the provider is ready. For local development, open [http://agora.localhost](http://agora.localhost) when the local preview proxy is running, or use the loopback URL printed by Next.js. The local database is stored under `.data/` and stays out of Git. Copy `.env.example` to `.env.local` only if local owner sign-in is configured; do not commit environment files or paste secrets into support messages.

## Use the API or CLI

Use the Developers page to create a scoped, mode-bound Agora API key. From a terminal, run the origin-specific command it provides (or replace the URL with your own deployment). The CLI accepts the key in a hidden prompt and stores it in a mode-0600 local configuration; use environment variables for short-lived scripts. The key is issued by Agora and is separate from your Stripe provider credentials.

```bash
agora auth login --url 'https://agora-payments.vercel.app'
agora auth status
agora products list
agora products create --name 'Studio license' --amount 4900 --idempotency-key product-studio-v1
agora payments create --product prod_... --customer 'Alex' --idempotency-key order-001  # only after provider readiness
agora payments get --id pay_...
agora payments reconcile --id pay_...
agora refunds create --payment pay_... --amount 4900 --reason 'Customer request' --idempotency-key refund-001
```

Amounts are integer cents: `4900` means `$49.00`. Use a unique idempotency key for each new create or refund and reuse it only when retrying the same request. Payment reconciliation is safe to repeat and does not require a key. API keys are shown once; store them in a secret manager or a short-lived shell environment, never in source control. The server selects the mode pinned to each key. A `pending` refund still awaits provider confirmation, and `requires_approval` is only a request. Do not use the payment or refund commands against the canonical workspace until its readiness status is **Ready** and the merchant’s own provider account is verified.

Outgoing webhook endpoints are managed from the owner console. Deliveries carry signed timestamps, event IDs, delivery IDs, and event types. The standalone CLI and TypeScript SDK include a verifier; verify the exact raw request body before parsing it. Delivery is at-least-once, so receivers should deduplicate by event ID and tolerate retries.

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

The web app runs on Next.js 16; local Community stores data in SQLite through Node's built-in SQLite driver, and the hosted API runs on a Cloudflare Worker and SQLite Durable Object. The canonical deployment is not currently enabled for live payment creation. The separate QA store uses Stripe test credentials and does not establish live readiness.
