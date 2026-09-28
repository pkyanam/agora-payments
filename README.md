<div align="center">
  <h1>Agora Community</h1>
  <p>Simple payments for your business.</p>
  <p>
    <a href="https://github.com/pkyanam/agora-payments"><img alt="GitHub stars" src="https://img.shields.io/github/stars/pkyanam/agora-payments"></a>
    <a href="https://github.com/pkyanam/agora-payments/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/pkyanam/agora-payments"></a>
  </p>
</div>

![Agora overview page screenshot placeholder](assets/overview-placeholder.svg)

## Install

The local install needs Node.js 22.16 or newer. Open Terminal and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/pkyanam/agora-payments/main/community-install.sh | bash
```

Enter your email when asked. When setup finishes, start Agora with the command shown on screen, then open [http://localhost:3000](http://localhost:3000).

### Install in Boat

To install Agora in a Boat Linux sandbox from your Mac, first install and sign in to the [Boat CLI](https://docs.boat.dev/quickstart), then run:

```bash
curl -fsSL https://raw.githubusercontent.com/pkyanam/agora-payments/main/community-install.sh | bash -s -- --target boat
```

The installer lets you select an existing running sandbox or create one. A new sandbox defaults to the `default` size (4 vCPU / 8 GB) and an auto-stop after one hour. `small` is 2 vCPU / 4 GB at half rate. Disabling auto-stop can require a payment method and bills for as long as the VM runs; the installer asks before choosing it. Newly created sandboxes use `--no-env`, so account environment secrets are not copied into the app build.

For an existing sandbox, pass `--boat-id ID --owner-email YOU@example.com --non-interactive`. To create one without prompts, add `--create-boat --type small --owner-email YOU@example.com --non-interactive`. For continuous runtime, add `--no-auto-stop` only after deciding to pay for it. To update an existing deployment, run the same command with `--boat-id ID --update`; on Boat, use this wrapper so it can stop systemd, snapshot the database and restore the prior release if the new version fails its health check.

Agora listens on port 3000 at `0.0.0.0`, and the installer publishes the sandbox’s stable HTTPS Boat URL only after the app is healthy. It also attempts to install the Agora CLI in the sandbox; a CLI download failure leaves the healthy app running and prints a retry instruction. For a fresh install, open the one-time setup link in the private `~/.local/share/agora/state/community-owner-credentials.txt` file, choose your owner email and password in the browser, then enroll MFA. The link expires after seven days and is single-use. If it expires, SSH to the host and run `node current/scripts/reset-owner-setup.mjs` from the Agora install directory; the replacement link is saved to the same private file. After setup, remove that file. To recover a forgotten owner password, run `node current/scripts/reset-owner-password.mjs`; it creates a temporary password in that private file, leaves MFA enabled, and revokes existing owner sessions. Sign in, choose a new password, then remove the file. Owner password changes require the current password and revoke all owner sessions. Stripe starts in test mode. Add the test API key and webhook signing secret in Agora’s Stripe setup screen, register the displayed HTTPS webhook URL in Stripe test mode, and send a signed `account.updated` event to verify delivery.

Stopping a Boat VM snapshots its filesystem but stops the app process. The installer enables an always-on systemd service so Agora starts again after resume. A sandbox with auto-stop still needs you to resume it after Boat stops it; a no-auto-stop sandbox runs until you stop it with `boat stop ID`.

## Need help?

Run `agora --help` or [open an issue](https://github.com/pkyanam/agora-payments/issues).
