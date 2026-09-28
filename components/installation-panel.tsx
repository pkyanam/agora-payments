"use client"

import { Button } from "@/components/ui/button"
import { toast } from "sonner"

export function InstallationPanel({ version, target }: { version?: string; target?: string }) {
  const resolvedTarget = (target || "node").toLowerCase()
  const label = resolvedTarget === "node" || resolvedTarget === "local"
    ? "Self-hosted · Node.js"
    : resolvedTarget === "cloudflare-worker" || resolvedTarget === "cloudflare"
      ? "Cloudflare Workers"
      : resolvedTarget === "vercel"
        ? "Vercel · experimental hosted"
        : target || "Self-hosted"
  const local = resolvedTarget === "node" || resolvedTarget === "local"
  const command = 'agora server update --dir "$HOME/.local/share/agora"'
  const copyUpdateCommand = async () => {
    try {
      await navigator.clipboard.writeText(command)
      toast.success("Update command copied")
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
      {local ? (
        <div className="installation-update">
          <div><strong>Update from the host terminal</strong><p>The updater stages a new release, backs up the SQLite database, and rolls back if the update fails. It does not run inside this browser.</p></div>
          <code>{command}</code>
          <Button type="button" variant="secondary" onClick={() => void copyUpdateCommand()}>Copy update command</Button>
          <p className="form-note">This command assumes the default install directory. If you selected a custom directory during installation, replace the path after <code>--dir</code>.</p>
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
