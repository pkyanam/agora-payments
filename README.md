# Install Agora CLI

Prerequisites: Node.js 20.9+ and GitHub CLI. Sign in to GitHub once with `gh auth login` and confirm you can access the private `pkyanam/agora-payments` repository. Then install or update Agora with:

```bash
set -o pipefail; gh api --header 'Accept: application/vnd.github.raw' repos/pkyanam/agora-payments/contents/install.sh | bash
```

The installer downloads only the CLI, places it in `~/.local/bin` (or `$AGORA_INSTALL_DIR`), refuses to overwrite an unrelated `agora` command, and adds one managed PATH block to the active zsh or bash login file. If that file already exists, it saves a permissions-preserving backup before editing it. Open a new login shell and run `agora --help`.

This repository is private; a public `curl | bash` URL will not work. To inspect the source first:

```bash
gh repo clone pkyanam/agora-payments
cd agora-payments
bash install.sh
```

## What Agora does today

Agora is a single-workspace payment sandbox for a developer selling a small USD catalog. The console, REST API, TypeScript client and CLI share the same payment objects. Create products, make checkout links, simulate a success or decline, inspect status, and record a sandbox refund. A refund that needs approval stays pending until the owner approves the exact amount.

Sandbox examples are labeled in the console. Simulated checkout does not contact a processor, charge a card, settle funds, calculate a real provider fee, or deliver a webhook. Never enter card numbers or security codes. Live card acceptance is not enabled.

## Run the app locally

```bash
gh repo clone pkyanam/agora-payments
cd agora-payments
bun install
bun run dev
```

Open [http://agora.localhost](http://agora.localhost) when the local preview proxy is running, or use the loopback URL printed by Next.js. The local database is stored under `.data/` and stays out of Git. Copy `.env.example` to `.env.local` only if local owner sign-in is configured; do not commit environment files or paste secrets into support messages.

## Use the API or CLI

The CLI reads its URL and scoped sandbox key from environment variables. It does not save credentials for you. In a shell where you have configured a key:

```bash
export AGORA_URL='http://127.0.0.1:3000'
export AGORA_API_KEY='your-sandbox-key'
agora products list
agora products create --name 'Studio license' --amount 4900 --idempotency-key product-studio-v1
agora payments create --product prod_... --customer 'Alex' --idempotency-key order-001
agora payments get --id pay_...
agora refunds create --payment pay_... --amount 4900 --reason 'Customer request' --idempotency-key refund-001
```

Amounts are integer cents: `4900` means `$49.00`. Give each mutation a stable idempotency key and reuse it when retrying the same request. API keys are shown once; store them in a secret manager or a short-lived shell environment, never in source control. Treat refunds as money-moving permissions even though the current provider is a simulator.

Use `agora --help` for the full command list. The versioned REST API is documented in the Developers section of the console and at `/api-reference`.

## Finance and operations

The sandbox records product prices, simulated payment outcomes, refunds, approvals, and an internal journal so a developer can follow how payment state changes. It does not provide a bank reconciliation, tax calculation, provider fee statement, settlement report, or accounting ledger for real funds. Do not use its sandbox balances as business records or for close.

Before any live pilot, Agora needs a provider-approved merchant relationship, real provider adapter and signed webhooks, merchant account ownership and isolation, production authentication, verified refund/dispute rules, reconciliation against provider reports, and the required payment-security validation. No provider has approved this build. See [the partner paths and written questions](../agora-partner-paths.md) for the current research and an unsent outreach draft.

## Development

```bash
bun run lint
bun run typecheck
bun test
```

The application currently runs on Next.js 16 and a local Node.js SQLite database. It is a development sandbox; a production deployment must use a supported persistent store and enforce owner/merchant access before it is shared.
