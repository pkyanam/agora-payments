"use client"

import { Button } from "@/components/ui/button"
import { toast } from "sonner"

export function InstallationPanel({ version, target, hosting }: { version?: string; target?: string; hosting?: string }) {
  const resolvedTarget = (target || "node").toLowerCase()
  const isBoat = hosting === "boat"
  const label = isBoat
    ? "Boat sandbox"
    : resolvedTarget === "node" || resolvedTarget === "local"
    ? "Self-hosted · Node.js"
    : resolvedTarget === "cloudflare-worker" || resolvedTarget === "cloudflare"
      ? "Cloudflare Workers"
      : resolvedTarget === "vercel"
        ? "Vercel · experimental hosted"
        : target || "Self-hosted"
  const local = resolvedTarget === "node" || resolvedTarget === "local"
  const installerManaged = local || isBoat
  const command = isBoat
    ? "curl -fsSL https://raw.githubusercontent.com/pkyanam/agora-payments/main/community-install.sh | bash -s -- --target boat"
    : "curl -fsSL https://raw.githubusercontent.com/pkyanam/agora-payments/main/community-install.sh | bash"
  const cliCommand = 'agora server update --dir "$HOME/.local/share/agora"'
  const copyCommand = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch {
      toast.error("Clipboard unavailable. Select and copy the command.")
    }
  }

  return (
    <section className="installation-panel" aria-labelledby="installation-title">
      <div className="installation-heading">
        <div>
          <span className="section-label">Deployment</span>
          <h2 id="installation-title">Installation &amp; updates</h2>
          <p>See what is running and get the correct update path for this deployment.</p>
        </div>
      </div>
      <dl className="installation-facts">
        <div><dt>Current version</dt><dd>{version || "Version unavailable"}</dd></div>
        <div><dt>Deployment target</dt><dd>{label}</dd></div>
      </dl>
      {installerManaged ? (
        <div className="installation-update">
          <div><strong>Update with the installer</strong><p>{isBoat ? "Run this on your Mac with Boat CLI signed in, then choose the same sandbox. The installer snapshots Agora and rolls back if the new release fails its health check; it keeps your account and configuration." : "Rerun this installer on the host to update Agora. It asks before updating (Yes by default); add --non-interactive to update automatically. The installer backs up the database and rolls back if the new release fails its health check. Reuse your original --dir value if you installed into a custom directory."}</p></div>
          <code>{command}</code>
          <Button type="button" variant="secondary" onClick={() => void copyCommand(command, "Installer command")}>Copy installer command</Button>
          {local && <details className="installation-cli-option"><summary>Optional: update with the Agora CLI</summary><code>{cliCommand}</code><Button type="button" variant="ghost" onClick={() => void copyCommand(cliCommand, "CLI update command")}>Copy CLI command</Button></details>}
        </div>
      ) : (
        <div className="installation-update">
          <strong>Update through your hosting provider</strong>
          <p>Automatic web updates are not available for this target yet. Publish a new release through the deployment platform. Agora will not request cloud credentials or run a deployment from this page.</p>
        </div>
      )}
    </section>
  )
}
