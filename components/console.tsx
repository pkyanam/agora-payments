"use client"
import { useEffect, useState, useCallback, useRef, type FormEvent } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Home03Icon,
  CreditCardIcon,
  PackageIcon,
  CodeIcon,
  ArrowUpRight01Icon,
  AiBrain01Icon,
  PlusSignIcon,
  Copy01Icon,
  Search01Icon,
  ArrowRight01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip"
import { toast } from "sonner"
import type { Snapshot, Payment } from "@/lib/types"
import { AreaChart } from "@/components/dither-kit/area-chart"
import { Area } from "@/components/dither-kit/area"
import { Grid } from "@/components/dither-kit/grid"
import { XAxis } from "@/components/dither-kit/x-axis"
import { YAxis } from "@/components/dither-kit/y-axis"
import { Tooltip as ChartTooltip } from "@/components/dither-kit/tooltip"
const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n / 100
  )
const date = (s: string) =>
  new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" })
const views = [
  "Overview",
  "Payments",
  "Catalog",
  "Agents",
  "Developers",
] as const
type View = (typeof views)[number]
const icons = [Home03Icon, CreditCardIcon, PackageIcon, AiBrain01Icon, CodeIcon]
const permissionSets = {
  read: ["products:read", "payments:read", "events:read"],
  payments: ["products:read", "payments:read", "payments:write", "events:read"],
  full: [
    "products:read",
    "products:write",
    "payments:read",
    "payments:write",
    "refunds:write",
    "events:read",
  ],
}
export default function Console() {
  const pendingWrites = useRef(new Map<string, string>())
  const [view, setView] = useState<View>("Overview")
  const [data, setData] = useState<Snapshot | null>(null)
  const [error, setError] = useState("")
  const [authState, setAuthState] = useState<
    "checking" | "signed-out" | "enroll" | "verify" | "recovery" | "pending" | "signed-in"
  >("checking")
  const [authPassword, setAuthPassword] = useState("")
  const [authError, setAuthError] = useState("")
  const [authBusy, setAuthBusy] = useState(false)
  const [mfaSecret, setMfaSecret] = useState("")
  const [mfaCode, setMfaCode] = useState("")
  const [useRecoveryCode, setUseRecoveryCode] = useState(false)
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const recoveryPending = useRef(false)
  const [dialog, setDialog] = useState<"payment" | "product" | "key" | null>(
    null
  )
  const [selected, setSelected] = useState<Payment | null>(null)
  const [filter, setFilter] = useState("all")
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [product, setProduct] = useState("")
  const [created, setCreated] = useState<Payment | null>(null)
  const [secret, setSecret] = useState("")
  const [keyKind, setKeyKind] = useState("agent")
  const [permission, setPermission] =
    useState<keyof typeof permissionSets>("full")
  const [codeTab, setCodeTab] = useState("typescript")
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarReady, setSidebarReady] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/console", { cache: "no-store" })
      const raw = await r.text()
      let b: any
      try {
        b = JSON.parse(raw)
      } catch {
        throw new Error(`Workspace API returned ${r.status}. Please retry.`)
      }
      if (!r.ok)
        throw new Error(b.error?.message || "Unable to load workspace.")
      setData(b)
      setError("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load workspace.")
    }
  }, [])
  const checkSession = useCallback(async () => {
    if (recoveryPending.current) return
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" })
      const body: any = await response.json()
      if (!response.ok)
        throw new Error(
          body.error?.message || "Unable to verify account access."
        )
      if (body.access_status === "pending") {
        setData(null)
        setAuthState("pending")
        return
      }
      if (body.mfa_stage === "enroll") {
        setData(null)
        setAuthState("enroll")
        return
      }
      if (body.mfa_stage === "verify") {
        setData(null)
        setAuthState("verify")
        return
      }
      if (!body.authenticated || body.access_status !== "approved" || body.mfa_stage !== "complete") {
        setData(null)
        setAuthState("signed-out")
        return
      }
      setAuthState("signed-in")
      await load()
    } catch (reason) {
      setData(null)
      setAuthState("signed-out")
      setAuthError(
        reason instanceof Error
          ? reason.message
          : "Unable to verify account access."
      )
    }
  }, [load])
  useEffect(() => {
    setSidebarCollapsed(
      window.localStorage.getItem("agora.sidebar.collapsed") === "true"
    )
    setSidebarReady(true)
  }, [])
  useEffect(() => {
    if (sidebarReady) {
      window.localStorage.setItem(
        "agora.sidebar.collapsed",
        String(sidebarCollapsed)
      )
    }
  }, [sidebarCollapsed, sidebarReady])
  useEffect(() => {
    checkSession()
    const onFocus = () => checkSession()
    window.addEventListener("focus", onFocus)
    const sync = () => {
      const v = new URLSearchParams(location.search).get("view")
      setView(v && views.includes(v as View) ? (v as View) : "Overview")
    }
    sync()
    window.addEventListener("popstate", sync)
    return () => {
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("popstate", sync)
    }
  }, [checkSession])
  const navigate = (v: View) => {
    setView(v)
    setQuery("")
    setMobileNavOpen(false)
    const nextUrl = v === "Overview" ? "/" : `/?view=${v}`
    if (`${location.pathname}${location.search}` !== nextUrl) {
      history.pushState(null, "", nextUrl)
    }
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAuthBusy(true)
    setAuthError("")
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: authPassword }),
      })
      const body: any = await response.json()
      if (!response.ok)
        throw new Error(body.error?.message || "Sign-in failed.")
      setAuthPassword("")
      if (body.stage === "enroll") {
        setMfaSecret(body.secret || "")
        setAuthState("enroll")
      } else if (body.stage === "verify") {
        setAuthState("verify")
      } else if (body.authenticated && body.access_status === "approved") {
        setAuthState("signed-in")
        await load()
      } else {
        throw new Error("Sign-in response did not include an MFA step.")
      }
    } catch (reason) {
      setAuthError(reason instanceof Error ? reason.message : "Sign-in failed.")
    } finally {
      setAuthBusy(false)
    }
  }
  async function submitMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAuthBusy(true)
    setAuthError("")
    try {
      const enrolling = authState === "enroll"
      const response = await fetch(
        enrolling ? "/api/auth/mfa/enroll" : "/api/auth/mfa/verify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            enrolling
              ? { code: mfaCode }
              : useRecoveryCode
                ? { recovery_code: mfaCode }
                : { code: mfaCode }
          ),
        }
      )
      const body: any = await response.json()
      if (!response.ok) throw new Error(body.error?.message || "Code was not accepted.")
      setMfaCode("")
      if (enrolling) {
        const codes = Array.isArray(body.recovery_codes) ? body.recovery_codes : []
        if (!codes.length) throw new Error("Recovery codes were not returned. Contact support.")
        recoveryPending.current = true
        setRecoveryCodes(codes)
        setAuthState("recovery")
      } else {
        setAuthState("signed-in")
        await load()
      }
    } catch (reason) {
      setAuthError(reason instanceof Error ? reason.message : "Code was not accepted.")
    } finally {
      setAuthBusy(false)
    }
  }
  function finishRecoverySetup() {
    recoveryPending.current = false
    setRecoveryCodes([])
    setAuthState("signed-in")
    void load()
  }
  async function logout() {
    setAuthBusy(true)
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" })
      const body: any = await response.json()
      if (!response.ok)
        throw new Error(body.error?.message || "Sign-out failed.")
      setData(null)
      setAuthError("")
      setMfaSecret("")
      setRecoveryCodes([])
      setAuthState("signed-out")
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Sign-out failed.")
    } finally {
      setAuthBusy(false)
    }
  }
  async function action(action: string, payload: unknown) {
    const fingerprint = JSON.stringify({ action, payload })
    const key = pendingWrites.current.get(fingerprint) || crypto.randomUUID()
    pendingWrites.current.set(fingerprint, key)
    const r = await fetch("/api/console", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: fingerprint,
    })
    const b: any = await r.json()
    if (!r.ok) {
      if (r.status < 500) pendingWrites.current.delete(fingerprint)
      throw new Error(b.error?.message || "The action could not be completed.")
    }
    pendingWrites.current.delete(fingerprint)
    await load()
    return b
  }
  async function perform(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.")
    } finally {
      setBusy(false)
    }
  }
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Copied to clipboard")
    } catch {
      toast.error("Clipboard unavailable. Select and copy the text.")
    }
  }
  const downloadRecoveryCodes = () => {
    const blob = new Blob([`Agora recovery codes\n\n${recoveryCodes.join("\n")}\n`], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "agora-recovery-codes.txt"
    link.click()
    URL.revokeObjectURL(url)
  }
  const openPayment = (id?: string) => {
    setProduct(id || data?.products[0]?.id || "")
    setCreated(null)
    setDialog("payment")
  }
  const openKey = (kind = "agent") => {
    setKeyKind(kind)
    setSecret("")
    setDialog("key")
  }
  const pending = data?.approvals.filter((a) => a.status === "pending") || []
  const paid = data?.payments.filter((p) => p.status === "succeeded") || []
  const volume = paid.reduce((n, p) => n + p.amount, 0)
  const refunded = paid.reduce((n, p) => n + p.refunded, 0)
  const filtered =
    data?.payments.filter(
      (p) =>
        (filter === "all" ||
          (filter === "refunded" ? p.refunded > 0 : p.status === filter)) &&
        `${p.customer} ${p.product_name} ${p.id}`
          .toLowerCase()
          .includes(query.toLowerCase())
    ) || []
  const selectedCurrent = selected
    ? data?.payments.find((p) => p.id === selected.id) || selected
    : null
  const chartData = Array.from({ length: 28 }, (_, i) => {
    const day = new Date()
    day.setHours(0, 0, 0, 0)
    day.setDate(day.getDate() - 27 + i)
    const amount = paid
      .filter((payment) => {
        const createdAt = new Date(payment.created_at)
        return createdAt.toDateString() === day.toDateString()
      })
      .reduce((total, payment) => total + payment.amount, 0)
    const label = date(day.toISOString())
    return { day, amount, label }
  })
  let cumulative = 0
  const volumeSeries = chartData.map((day) => ({
    ...day,
    total: (cumulative += day.amount),
  }))
  const status = (p: Payment) =>
    p.refunded === p.amount
      ? "Refunded"
      : p.refunded > 0
        ? "Partially refunded"
        : p.status === "succeeded"
          ? "Succeeded"
          : p.status === "failed"
            ? "Failed"
            : "Pending"
  function paymentTable(rows: Payment[]) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead className="text-right">Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow
              key={p.id}
              className="payment-row"
              onClick={() => setSelected(p)}
            >
              <TableCell>
                <button
                  className="customer-button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelected(p)
                  }}
                >
                  <span className="customer-avatar">
                    {p.customer.slice(0, 1)}
                  </span>
                  <span>
                    {p.customer.replace(" · example", "")}
                    <small>
                      {p.actor}
                      {p.sample ? " · Sample" : ""}
                    </small>
                  </span>
                </button>
              </TableCell>
              <TableCell className="product-cell">{p.product_name}</TableCell>
              <TableCell>
                <span className={`payment-status ${p.status}`}>
                  <span>
                    {p.status === "succeeded"
                      ? "✓"
                      : p.status === "failed"
                        ? "×"
                        : "◷"}
                  </span>
                  {status(p)}
                </span>
              </TableCell>
              <TableCell className="amount-cell">
                {money(p.amount)}
                <small>USD</small>
              </TableCell>
              <TableCell className="date-cell text-right">
                {date(p.created_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }
  const code = {
    typescript: `import { Agora } from './sdk/agora';\n\nconst agora = new Agora({\n  apiKey: process.env.AGORA_API_KEY!,\n  baseUrl: '${typeof location !== "undefined" ? location.origin : "http://agora.localhost:1355"}'\n});\n\nconst payment = await agora.payments.create(\n  { product_id: '${data?.products[0]?.id || "prod_studio"}' },\n  { idempotencyKey: 'order-001' }\n);\n\n// Send the customer to payment.checkout_url`,
    curl: `curl -X POST "$AGORA_URL/api/v1/payments" \\\n  -H "Authorization: Bearer $AGORA_API_KEY" \\\n  -H "Idempotency-Key: order-001" \\\n  -H "Content-Type: application/json" \\\n  -d '{"product_id":"${data?.products[0]?.id || "prod_studio"}"}'`,
    cli: `export AGORA_URL="${typeof location !== "undefined" ? location.origin : "http://agora.localhost:1355"}"\nexport AGORA_API_KEY="your-test-key"\n\nnode cli/agora.mjs products list\n\nnode cli/agora.mjs payments create \\\n  --product ${data?.products[0]?.id || "prod_studio"} \\\n  --idempotency-key order-001\n\n# JSON in. JSON out. Human or agent.`,
  }
  const renderSidebar = (mobile = false) => (
    <aside
      className={`sidebar ${mobile ? "mobile-sidebar" : "desktop-sidebar"}`}
      aria-label="Workspace sidebar"
    >
      <a
        className="wordmark"
        href="/"
        onClick={(e) => {
          e.preventDefault()
          navigate("Overview")
        }}
        aria-label="Agora overview"
      >
        agora<span>·</span>
      </a>
      <div className="workspace">
        <span className="avatar" aria-hidden="true">A</span>
        <div className="workspace-copy">
          Acme Studio<small>Workspace</small>
        </div>
      </div>
      <nav aria-label="Main navigation">
        {views.map((title, i) => (
          <button
            className={`nav-item ${view === title ? "active" : ""}`}
            aria-current={view === title ? "page" : undefined}
            aria-label={title}
            title={sidebarCollapsed && !mobile ? title : undefined}
            onClick={() => navigate(title)}
            key={title}
          >
            <HugeiconsIcon icon={icons[i]} size={19} aria-hidden="true" />
            <span className="nav-item-label">{title}</span>
            {title === "Agents" && pending.length > 0 && (
              <span className="nav-count" aria-label={`${pending.length} pending approvals`}>
                {pending.length}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <Tooltip>
          <TooltipTrigger render={<button className="sandbox-mark" />}>Test mode</TooltipTrigger>
          <TooltipContent>
            Test transactions only. No live processing is connected.
          </TooltipContent>
        </Tooltip>
        <a className="quiet-link" href="/api-reference" aria-label="API reference">
          <span className="quiet-link-label">API reference</span>
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={13} aria-hidden="true" />
        </a>
      </div>
    </aside>
  )
  if (authState === "checking") {
    return (
      <main className="auth-page" aria-live="polite">
        Checking account access…
      </main>
    )
  }
  if (authState === "pending") {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="auth-title">
          <a className="wordmark" href="/" aria-label="Agora home">agora<span>·</span></a>
          <h1 id="auth-title">Registration pending</h1>
          <p>Your account is awaiting approval. Payment data and API access remain unavailable until approval is complete.</p>
          <p>Questions? <a className="inline-link" href="mailto:info@belweave.com">info@belweave.com</a></p>
          <Button variant="secondary" onClick={logout} disabled={authBusy}>Sign out</Button>
        </section>
      </main>
    )
  }
  if (authState === "enroll") {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="auth-title">
          <a className="wordmark" href="/" aria-label="Agora home">agora<span>·</span></a>
          <h1 id="auth-title">Set up an authenticator</h1>
          {mfaSecret ? (
            <>
              <p>Add this account to an authenticator app, then enter its current six-digit code.</p>
              <div className="mfa-secret-block">
                <Label htmlFor="mfa-secret">Setup key</Label>
                <code id="mfa-secret" className="mfa-secret">{mfaSecret}</code>
                <Button type="button" variant="secondary" onClick={() => void copy(mfaSecret)}>
                  Copy setup key <HugeiconsIcon icon={Copy01Icon} aria-hidden="true" />
                </Button>
              </div>
              <form className="form-stack" onSubmit={submitMfa}>
                <div className="field">
                  <Label htmlFor="mfa-code">Authenticator code</Label>
                  <Input id="mfa-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))} aria-invalid={authError ? true : undefined} aria-describedby={authError ? "auth-error" : undefined} required autoFocus />
                </div>
                {authError && <p id="auth-error" className="auth-error" role="alert">{authError}</p>}
                <Button type="submit" disabled={authBusy || mfaCode.length !== 6}>{authBusy ? "Verifying…" : "Verify and finish setup"}</Button>
              </form>
            </>
          ) : (
            <>
              <p>Sign in again to retrieve the unfinished authenticator setup.</p>
              <Button onClick={logout} disabled={authBusy}>Sign out</Button>
            </>
          )}
        </section>
      </main>
    )
  }
  if (authState === "verify") {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="auth-title">
          <a className="wordmark" href="/" aria-label="Agora home">agora<span>·</span></a>
          <h1 id="auth-title">Verify your identity</h1>
          <p>Enter a code from your authenticator app{useRecoveryCode ? " or recovery list" : ""}.</p>
          <form className="form-stack" onSubmit={submitMfa}>
            <div className="field">
              <Label htmlFor="mfa-code">{useRecoveryCode ? "Recovery code" : "Authenticator code"}</Label>
              <Input id="mfa-code" name="code" type="text" inputMode={useRecoveryCode ? "text" : "numeric"} autoComplete={useRecoveryCode ? "off" : "one-time-code"} maxLength={useRecoveryCode ? 32 : 6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.trim().slice(0, useRecoveryCode ? 32 : 6))} aria-invalid={authError ? true : undefined} aria-describedby={authError ? "auth-error" : undefined} required autoFocus />
            </div>
            {authError && <p id="auth-error" className="auth-error" role="alert">{authError}</p>}
            <Button type="submit" disabled={authBusy || !mfaCode.trim()}>{authBusy ? "Verifying…" : "Verify and sign in"}</Button>
          </form>
          <button type="button" className="text-button" onClick={() => { setUseRecoveryCode((value) => !value); setMfaCode(""); setAuthError("") }}>
            {useRecoveryCode ? "Use an authenticator code" : "Use a recovery code"}
          </button>
          <Button variant="ghost" onClick={logout} disabled={authBusy}>Sign out</Button>
        </section>
      </main>
    )
  }
  if (authState === "recovery") {
    return (
      <main className="auth-page">
        <section className="auth-card recovery-card" aria-labelledby="auth-title">
          <a className="wordmark" href="/" aria-label="Agora home">agora<span>·</span></a>
          <h1 id="auth-title">Save your recovery codes</h1>
          <p>Each code works once. Store these somewhere private; they will not be shown again.</p>
          <ul className="recovery-code-list" aria-label="One-time recovery codes">
            {recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}
          </ul>
          <Button variant="secondary" onClick={downloadRecoveryCodes}>Download codes</Button>
          <Button onClick={finishRecoverySetup}>I’ve saved these codes</Button>
        </section>
      </main>
    )
  }
  if (authState === "signed-out") {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="auth-title">
          <a className="wordmark" href="/">
            agora<span>·</span>
          </a>
          <h1 id="auth-title">Sign in</h1>
          <p>Sign in to your Agora account.</p>
          <form className="form-stack" onSubmit={login}>
            <div className="field">
              <Label htmlFor="owner-password">Password</Label>
              <Input
                id="owner-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                aria-invalid={authError ? true : undefined}
                aria-describedby={authError ? "auth-error" : undefined}
                required
                autoFocus
              />
            </div>
            {authError && (
              <p id="auth-error" className="auth-error" role="alert">
                {authError}
              </p>
            )}
            <Button type="submit" disabled={authBusy}>
              {authBusy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <p className="auth-register">New merchant? <a className="inline-link" href="/register">Request access</a></p>
          <p className="support-note">Support: <a className="inline-link" href="mailto:info@belweave.com">info@belweave.com</a></p>
        </section>
      </main>
    )
  }
  return (
    <TooltipProvider>
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
      <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        {renderSidebar()}
        <main className="main">
          <header className="topbar">
            <div className="topbar-location">
              <button
                type="button"
                className="sidebar-toggle desktop-sidebar-toggle"
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!sidebarCollapsed}
                onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              >
                <span aria-hidden="true">{sidebarCollapsed ? "»" : "«"}</span>
              </button>
              <SheetTrigger
                render={
                  <button
                    type="button"
                    className="sidebar-toggle mobile-sidebar-toggle"
                    aria-label="Open navigation"
                    aria-controls="mobile-navigation"
                    aria-expanded={mobileNavOpen}
                  />
                }
              >
                <span aria-hidden="true">☰</span>
              </SheetTrigger>
              <span>
                Workspace <span className="breadcrumb-slash">/</span> <b>{view}</b>
              </span>
            </div>
            <div className="topbar-right">
              <span>US · USD</span>
              {typeof window !== "undefined" &&
              !["localhost", "127.0.0.1"].includes(window.location.hostname) &&
              !window.location.hostname.endsWith(".localhost") ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={logout}
                  disabled={authBusy}
                >
                  Sign out
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={<button className="profile-circle" />}
                  >
                    A
                  </TooltipTrigger>
                  <TooltipContent>Acme Studio · Workspace owner</TooltipContent>
                </Tooltip>
              )}
            </div>
          </header>
          {error ? (
            <section className="error-state">
              <h1>Let’s reconnect.</h1>
              <p>{error}</p>
              <Button onClick={load}>Try again</Button>
            </section>
          ) : !data ? (
            <div className="loading-state">
              <Skeleton className="h-10 w-80" />
              <Skeleton className="h-52 w-full" />
              <Skeleton className="h-36 w-full" />
            </div>
          ) : (
            <>
              {view === "Overview" && (
                <>
                  <section className="page-heading">
                    <div>
                      <h1>Overview</h1>
                    </div>
                    <Button onClick={() => openPayment()}>
                      <HugeiconsIcon icon={PlusSignIcon} />
                      Create payment
                    </Button>
                  </section>
                  <section className="overview-volume">
                    <div>
                      <div className="section-label">
                        Payment volume <span>Last 28 days</span>
                      </div>
                      <div className="hero-number">
                        {money(volume).split(".")[0]}
                        <span>.{money(volume).split(".")[1]}</span>
                      </div>
                      <p className="subtle">
                        {paid.length} successful payments{" "}
                        <span className="inline-dot">·</span> Includes sample
                        activity
                      </p>
                      <div className="volume-chart">
                        <AreaChart
                          data={volumeSeries}
                          config={{
                            total: { label: "Payment volume", color: "grey" },
                          }}
                          ariaLabel="Cumulative successful payment volume over the last 28 days. Exact daily amounts are available in the accessible table after the chart."
                          animate={false}
                          bloom="off"
                          className="dither-area-chart"
                          margins={{ top: 12, right: 8, bottom: 28, left: 64 }}
                        >
                          <Grid
                            horizontal
                            vertical={false}
                            strokeDasharray="2 6"
                          />
                          <YAxis
                            tickCount={4}
                            tickFormatter={(value) => money(value)}
                          />
                          <XAxis dataKey="label" maxTicks={5} />
                          <Area dataKey="total" variant="dotted" />
                          <ChartTooltip
                            labelKey="label"
                            valueFormatter={(value) => money(value)}
                          />
                        </AreaChart>
                      </div>
                      <table className="sr-only">
                        <caption>
                          Daily payments and cumulative payment volume for the
                          last 28 days
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">Date</th>
                            <th scope="col">Successful payments</th>
                            <th scope="col">Cumulative payment volume</th>
                          </tr>
                        </thead>
                        <tbody>
                          {volumeSeries.map((day) => (
                            <tr key={day.day.toISOString()}>
                              <th scope="row">
                                {day.day.toLocaleDateString("en-US", {
                                  dateStyle: "long",
                                })}
                              </th>
                              <td>{money(day.amount)}</td>
                              <td>{money(day.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section className="small-stats">
                    <div>
                      <span>Net payments</span>
                      <strong>{money(volume - refunded)}</strong>
                    </div>
                    <div>
                      <span>Refunded</span>
                      <strong>{money(refunded)}</strong>
                    </div>
                    <div>
                      <span>Active agents</span>
                      <strong>
                        {
                          data.credentials.filter(
                            (k) => k.kind === "agent" && !k.revoked
                          ).length
                        }{" "}
                        <button onClick={() => openKey()}>
                          Add an agent ↗
                        </button>
                      </strong>
                    </div>
                  </section>
                  <section className="recent">
                    <div className="section-heading">
                      <h2>Recent payments</h2>
                      <Button
                        variant="ghost"
                        onClick={() => navigate("Payments")}
                      >
                        All payments <HugeiconsIcon icon={ArrowUpRight01Icon} />
                      </Button>
                    </div>
                    {paymentTable(data.payments.slice(0, 5))}
                  </section>
                </>
              )}
              {view === "Payments" && (
                <>
                  <section className="page-heading">
                    <div>
                      <h1>Payments</h1>
                    </div>
                    <Button onClick={() => openPayment()}>
                      <HugeiconsIcon icon={PlusSignIcon} />
                      Create payment
                    </Button>
                  </section>
                  <div className="list-toolbar">
                    <Tabs value={filter} onValueChange={setFilter}>
                      <TabsList variant="line">
                        {[
                          "all",
                          "succeeded",
                          "pending",
                          "refunded",
                          "failed",
                        ].map((t) => (
                          <TabsTrigger key={t} value={t}>
                            {t[0].toUpperCase() + t.slice(1)}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                    <div className="search-field">
                      <HugeiconsIcon icon={Search01Icon} size={16} />
                      <Input
                        aria-label="Search payments"
                        placeholder="Find a payment…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                  </div>
                  {filtered.length ? (
                    paymentTable(filtered)
                  ) : (
                    <div className="empty-state">
                      <h2>No payments here yet.</h2>
                      <p>No payments match the current filters.</p>
                      <Button variant="secondary" onClick={() => openPayment()}>
                        Create payment
                      </Button>
                    </div>
                  )}
                </>
              )}
              {view === "Catalog" && (
                <>
                  <section className="page-heading">
                    <div>
                      <h1>Catalog</h1>
                    </div>
                    <Button onClick={() => setDialog("product")}>
                      <HugeiconsIcon icon={PlusSignIcon} />
                      New product
                    </Button>
                  </section>
                  <div className="catalog-grid">
                    {data.products.map((p, i) => (
                      <article key={p.id} className="product-item">
                        <code className="product-id">{p.id}</code>
                        <h2>{p.name}</h2>
                        <p>{p.description || "No description"}</p>
                        <div className="product-price">
                          {money(p.amount)}
                          <span>USD · one time</span>
                        </div>
                        <div className="product-actions">
                          <Button
                            variant="secondary"
                            onClick={() => openPayment(p.id)}
                          >
                            Create checkout{" "}
                            <HugeiconsIcon icon={ArrowUpRight01Icon} />
                          </Button>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Copy ${p.name} product ID`}
                                  onClick={() => copy(p.id)}
                                />
                              }
                            >
                              <HugeiconsIcon icon={Copy01Icon} />
                            </TooltipTrigger>
                            <TooltipContent>Copy product ID</TooltipContent>
                          </Tooltip>
                        </div>
                      </article>
                    ))}
                  </div>
                  <p className="catalog-note">
                    Prices are fixed to keep every payment explainable. Create a
                    new product for a new price.
                  </p>
                </>
              )}
              {view === "Agents" && (
                <>
                  <section className="page-heading">
                    <div>
                      <h1>Agents</h1>
                      <p>Keys, permissions, and approvals.</p>
                    </div>
                    <Button onClick={() => openKey()}>
                      <HugeiconsIcon icon={PlusSignIcon} />
                      Add agent
                    </Button>
                  </section>
                  {pending.length > 0 && (
                    <section className="approvals">
                      <div className="section-heading">
                        <h2>
                          Refund approvals{" "}
                          <Badge variant="secondary">{pending.length}</Badge>
                        </h2>
                        <span className="subtle">
                          Nothing moves until you approve.
                        </span>
                      </div>
                      {pending.map((a) => (
                        <div className="approval-row" key={a.id}>
                          <span className="agent-glyph">
                            <HugeiconsIcon icon={AiBrain01Icon} size={22} />
                          </span>
                          <div>
                            <strong>
                              {a.actor} requested a {money(a.amount)} refund
                            </strong>
                            <p>{a.reason}</p>
                            <small>{a.payment_id}</small>
                          </div>
                          <div className="approval-actions">
                            <Button
                              disabled={busy}
                              variant="ghost"
                              onClick={() =>
                                perform(async () => {
                                  await action("resolve_approval", {
                                    approval_id: a.id,
                                    decision: "decline",
                                  })
                                  toast.success("Request declined")
                                })
                              }
                            >
                              Decline
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() =>
                                perform(async () => {
                                  await action("resolve_approval", {
                                    approval_id: a.id,
                                    decision: "approve",
                                  })
                                  toast.success("Refund approved and completed")
                                })
                              }
                            >
                              Approve refund
                            </Button>
                          </div>
                        </div>
                      ))}
                    </section>
                  )}
                  <div className="agent-list">
                    {data.credentials
                      .filter((k) => k.kind === "agent")
                      .map((k) => (
                        <article className="agent-row" key={k.id}>
                          <span className="agent-glyph">
                            <HugeiconsIcon icon={AiBrain01Icon} size={24} />
                          </span>
                          <div className="agent-info">
                            <h2>
                              {k.name}{" "}
                              <Badge variant="secondary">
                                {k.revoked ? "Revoked" : "Active"}
                              </Badge>
                            </h2>
                            <p>
                              {k.scopes.includes("refunds:write")
                                ? "Payments & refund requests"
                                : k.scopes.includes("payments:write")
                                  ? "Create checkouts"
                                  : "Read-only access"}
                            </p>
                            <code>{k.prefix}••••</code>
                          </div>
                          <div className="agent-limits">
                            <span>
                              Per-payment limit <b>{money(k.max_amount)}</b>
                            </span>
                            <span>
                              Autonomous refund allowance{" "}
                              <b>
                                {money(Math.max(0, k.refund_budget - k.spent))}{" "}
                                left
                              </b>
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            disabled={!!k.revoked || busy}
                            onClick={() =>
                              perform(async () => {
                                await action("revoke_key", { key_id: k.id })
                                toast.success("Key revoked immediately")
                              })
                            }
                          >
                            Revoke
                          </Button>
                        </article>
                      ))}
                    {!data.credentials.some((k) => k.kind === "agent") && (
                      <div className="agent-empty">
                        <span className="agent-glyph">
                          <HugeiconsIcon
                            icon={AiBrain01Icon}
                            size={36}
                            strokeWidth={1}
                          />
                        </span>
                        <h2>No agent keys</h2>
                        <p>Create a scoped key for an agent or service.</p>
                        <Button onClick={() => openKey()}>
                          Create an agent key{" "}
                          <HugeiconsIcon icon={ArrowRight01Icon} />
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}
              {view === "Developers" && (
                <>
                  <section className="page-heading">
                    <div>
                      <h1>Developers</h1>
                      <p>API keys, documentation, and events.</p>
                    </div>
                    <Button onClick={() => openKey("developer")}>
                      <HugeiconsIcon icon={PlusSignIcon} />
                      Create API key
                    </Button>
                  </section>
                  <div className="developer-grid">
                    <div className="code-panel">
                      <Tabs value={codeTab} onValueChange={setCodeTab}>
                        <div className="code-toolbar">
                          <TabsList variant="line">
                            <TabsTrigger value="typescript">
                              TypeScript
                            </TabsTrigger>
                            <TabsTrigger value="curl">cURL</TabsTrigger>
                            <TabsTrigger value="cli">CLI</TabsTrigger>
                          </TabsList>
                          <Button
                            aria-label="Copy code example"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() =>
                              copy(code[codeTab as keyof typeof code])
                            }
                          >
                            <HugeiconsIcon icon={Copy01Icon} />
                          </Button>
                        </div>
                        {Object.entries(code).map(([key, value]) => (
                          <TabsContent key={key} value={key}>
                            <pre>
                              <code>{value}</code>
                            </pre>
                          </TabsContent>
                        ))}
                      </Tabs>
                    </div>
                    <div className="developer-notes">
                      <h2>Integration</h2>
                      <p>Create a key, then make your first API request.</p>
                      <a href="/api-reference">
                        Read the API reference{" "}
                        <HugeiconsIcon icon={ArrowUpRight01Icon} size={16} />
                      </a>
                      <a href="/openapi.json" target="_blank" rel="noreferrer">
                        OpenAPI specification{" "}
                        <HugeiconsIcon icon={ArrowUpRight01Icon} size={16} />
                      </a>
                      <small>
                        The SDK and CLI are included in this project.
                        <br />
                        Not published to a package registry yet.
                      </small>
                    </div>
                  </div>
                  <section className="keys-section">
                    <div className="section-heading">
                      <h2>API keys</h2>
                      <span className="subtle">
                        Secrets are shown once. Revoke any time.
                      </span>
                    </div>
                    {!data.credentials.length ? (
                      <p className="empty-row">
                        Create a key to make your first API call.
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Key</TableHead>
                            <TableHead>Access</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.credentials.map((k) => (
                            <TableRow key={k.id}>
                              <TableCell>
                                {k.name}
                                <small className="subtle block">{k.kind}</small>
                              </TableCell>
                              <TableCell>
                                <code>{k.prefix}••••</code>
                              </TableCell>
                              <TableCell>
                                {k.scopes.length} permissions
                              </TableCell>
                              <TableCell>
                                {k.revoked ? "Revoked" : "Active"}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={!!k.revoked || busy}
                                  onClick={() =>
                                    perform(async () => {
                                      await action("revoke_key", {
                                        key_id: k.id,
                                      })
                                      toast.success("Key revoked")
                                    })
                                  }
                                >
                                  Revoke
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </section>
                  <section className="events-section">
                    <div className="section-heading">
                      <h2>Event log</h2>
                      <Button variant="ghost" onClick={load}>
                        Refresh
                      </Button>
                    </div>
                    <p className="subtle mb-5">
                      Persisted events, ready to poll. Outgoing webhook delivery
                      is not connected yet.
                    </p>
                    {data.events.slice(0, 12).map((e) => (
                      <div className="event-row" key={e.id}>
                        <span className="event-icon">↗</span>
                        <code>{e.type}</code>
                        <span>{e.actor}</span>
                        <time>
                          {date(e.created_at)} ·{" "}
                          {new Date(e.created_at).toLocaleTimeString("en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                    ))}
                  </section>
                </>
              )}
            </>
          )}
        </main>
        <SheetContent
          id="mobile-navigation"
          side="left"
          showCloseButton
          className="mobile-nav-sheet"
          aria-label="Workspace navigation"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Workspace navigation</SheetTitle>
            <SheetDescription>Choose a workspace section.</SheetDescription>
          </SheetHeader>
          {renderSidebar(true)}
        </SheetContent>
      </div>
      </Sheet>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDialog(null)
            setSecret("")
          }
        }}
      >
        <DialogContent className="agora-dialog sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dialog === "payment"
                ? created
                  ? "Your checkout is ready."
                  : "Create a payment"
                : dialog === "product"
                  ? "New product"
                  : secret
                    ? "Your key. Your boundaries."
                    : keyKind === "agent"
                      ? "Give your agent a key."
                      : "Create an API key."}
            </DialogTitle>
            <DialogDescription>
              {dialog === "payment"
                ? "Test mode checkout. No live charge will be made."
                : dialog === "product"
                  ? "Set a fixed price in USD."
                  : secret
                    ? "Copy this secret now. It won’t be shown again."
                    : "Choose what this key can do. Change your mind? Revoke it anytime."}
            </DialogDescription>
          </DialogHeader>
          {dialog === "payment" &&
            (created ? (
              <div className="form-stack">
                <div className="checkout-result">
                  <span>{created.product_name}</span>
                  <strong>{money(created.amount)}</strong>
                  <code>{created.id}</code>
                </div>
                <Button
                  onClick={() =>
                    window.open(
                      `/checkout/${created.checkout_token}`,
                      "_blank",
                      "noopener"
                    )
                  }
                >
                  Open checkout <HugeiconsIcon icon={ArrowUpRight01Icon} />
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    copy(
                      `${location.origin}/checkout/${created.checkout_token}`
                    )
                  }
                >
                  Copy checkout link
                </Button>
              </div>
            ) : (
              <form
                className="form-stack"
                onSubmit={(e) => {
                  e.preventDefault()
                  const f = new FormData(e.currentTarget)
                  perform(async () => {
                    const p = await action("create_payment", {
                      product_id: product,
                      customer: String(f.get("customer") || "Guest"),
                    })
                    setCreated(p)
                    toast.success("Checkout created")
                  })
                }}
              >
                <div className="field">
                  <Label>Product</Label>
                  <Select
                    value={product}
                    onValueChange={(v) => setProduct(v || "")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {data?.products.find((p) => p.id === product)?.name ||
                          "Choose a product"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {data?.products.map((p) => (
                        <SelectItem value={p.id} key={p.id}>
                          {p.name} · {money(p.amount)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="field">
                  <Label htmlFor="customer">
                    Customer <span className="optional">optional</span>
                  </Label>
                  <Input
                    id="customer"
                    name="customer"
                    maxLength={120}
                    placeholder="Name or reference"
                  />
                </div>
                <p className="form-note">
                  Share checkout links only with people who should complete the
                  payment.
                </p>
                <Button disabled={busy || !product} type="submit">
                  {busy ? "Creating…" : "Create checkout"}
                </Button>
              </form>
            ))}
          {dialog === "product" && (
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault()
                const f = new FormData(e.currentTarget)
                perform(async () => {
                  await action("create_product", {
                    name: f.get("name"),
                    description: f.get("description"),
                    amount: Math.round(Number(f.get("amount")) * 100),
                    currency: "usd",
                  })
                  setDialog(null)
                  toast.success("Product created")
                })
              }}
            >
              <div className="field">
                <Label htmlFor="product-name">Product name</Label>
                <Input
                  id="product-name"
                  name="name"
                  required
                  maxLength={120}
                  placeholder="Design consultation"
                />
              </div>
              <div className="field">
                <Label htmlFor="description">
                  Description <span className="optional">optional</span>
                </Label>
                <Textarea
                  id="description"
                  name="description"
                  maxLength={400}
                  placeholder="A few words about what you’re selling."
                />
              </div>
              <div className="field">
                <Label htmlFor="amount">Price in USD</Label>
                <Input
                  id="amount"
                  name="amount"
                  type="number"
                  min="0.01"
                  max="100000"
                  step="0.01"
                  required
                  placeholder="49.00"
                />
              </div>
              <p className="form-note">
                One-time price. Create a new product if your price changes.
              </p>
              <Button disabled={busy} type="submit">
                {busy ? "Creating…" : "Create product"}
              </Button>
            </form>
          )}
          {dialog === "key" &&
            (secret ? (
              <div className="form-stack">
                <code className="secret-value">{secret}</code>
                <Button onClick={() => copy(secret)}>
                  Copy secret key <HugeiconsIcon icon={Copy01Icon} />
                </Button>
                <p className="form-note">
                  Use this on a trusted server or in your agent’s secret store.
                  Never put it in frontend code.
                </p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDialog(null)
                    setSecret("")
                    navigate(keyKind === "agent" ? "Agents" : "Developers")
                  }}
                >
                  Done
                </Button>
              </div>
            ) : (
              <form
                className="form-stack"
                onSubmit={(e) => {
                  e.preventDefault()
                  const f = new FormData(e.currentTarget)
                  perform(async () => {
                    const k = await action("create_key", {
                      name: f.get("name"),
                      kind: keyKind,
                      scopes: permissionSets[permission],
                      max_amount: Math.round(Number(f.get("max")) * 100),
                      refund_budget: Math.round(Number(f.get("budget")) * 100),
                    })
                    setSecret(k.secret)
                    toast.success("Key created")
                  })
                }}
              >
                <div className="field">
                  <Label htmlFor="key-name">Name</Label>
                  <Input
                    id="key-name"
                    name="name"
                    placeholder={
                      keyKind === "agent"
                        ? "e.g. Support agent"
                        : "e.g. Development server"
                    }
                    required
                    maxLength={120}
                  />
                </div>
                <div className="field">
                  <Label>Permissions</Label>
                  <Select
                    value={permission}
                    onValueChange={(v) =>
                      setPermission(v as keyof typeof permissionSets)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {permission === "full"
                          ? "Payments, catalog & refund requests"
                          : permission === "payments"
                            ? "Create checkouts & read activity"
                            : "Read-only access"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="read">Read-only access</SelectItem>
                      <SelectItem value="payments">
                        Create checkouts & read activity
                      </SelectItem>
                      <SelectItem value="full">
                        Payments, catalog & refund requests
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="two-fields">
                  <div className="field">
                    <Label htmlFor="key-max">Max payment · USD</Label>
                    <Input
                      id="key-max"
                      name="max"
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="100000"
                      defaultValue="500"
                      required
                    />
                  </div>
                  <div className="field">
                    <Label htmlFor="key-budget">Refund allowance · USD</Label>
                    <Input
                      id="key-budget"
                      name="budget"
                      type="number"
                      step="0.01"
                      min="0"
                      max="100000"
                      defaultValue="0"
                      required
                    />
                  </div>
                </div>
                <p className="form-note">
                  The refund allowance is cumulative for this key, not daily.
                  Requests over the remaining allowance need your approval. With
                  $0, every refund needs approval.
                </p>
                <Button disabled={busy} type="submit">
                  {busy ? "Creating…" : "Create key"}
                </Button>
              </form>
            ))}
        </DialogContent>
      </Dialog>
      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <SheetContent className="payment-sheet sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Payment details</SheetTitle>
            <SheetDescription>{selectedCurrent?.id}</SheetDescription>
          </SheetHeader>
          {selectedCurrent && (
            <div className="sheet-body">
              <div className="detail-amount">
                {money(selectedCurrent.amount)}
              </div>
              <span className="payment-status succeeded">
                {status(selectedCurrent)}
              </span>
              <dl>
                <div>
                  <dt>Customer</dt>
                  <dd>{selectedCurrent.customer}</dd>
                </div>
                <div>
                  <dt>Product</dt>
                  <dd>{selectedCurrent.product_name}</dd>
                </div>
                <div>
                  <dt>Created by</dt>
                  <dd>{selectedCurrent.actor}</dd>
                </div>
                <div>
                  <dt>Refunded</dt>
                  <dd>{money(selectedCurrent.refunded)}</dd>
                </div>
              </dl>
              {selectedCurrent.sample === 0 &&
                selectedCurrent.status === "pending" && (
                  <Button
                    onClick={() =>
                      window.open(
                        `/checkout/${selectedCurrent.checkout_token}`,
                        "_blank",
                        "noopener"
                      )
                    }
                  >
                    Open checkout <HugeiconsIcon icon={ArrowUpRight01Icon} />
                  </Button>
                )}
              {selectedCurrent.status === "succeeded" &&
                selectedCurrent.refunded < selectedCurrent.amount && (
                  <form
                    className="form-stack refund-form"
                    key={selectedCurrent.refunded}
                    onSubmit={(e) => {
                      e.preventDefault()
                      const f = new FormData(e.currentTarget)
                      perform(async () => {
                        await action("refund", {
                          payment_id: selectedCurrent.id,
                          amount: Math.round(Number(f.get("amount")) * 100),
                          reason: f.get("reason"),
                        })
                        toast.success("Refund completed")
                      })
                    }}
                  >
                    <h2>Issue a refund</h2>
                    <div className="field">
                      <Label htmlFor="refund-amount">Amount · USD</Label>
                      <Input
                        id="refund-amount"
                        name="amount"
                        type="number"
                        required
                        min="0.01"
                        step="0.01"
                        max={
                          (selectedCurrent.amount - selectedCurrent.refunded) /
                          100
                        }
                        defaultValue={(
                          (selectedCurrent.amount - selectedCurrent.refunded) /
                          100
                        ).toFixed(2)}
                      />
                    </div>
                    <div className="field">
                      <Label htmlFor="refund-reason">Reason</Label>
                      <Input
                        id="refund-reason"
                        name="reason"
                        required
                        minLength={3}
                        maxLength={400}
                        placeholder="Why are you refunding this payment?"
                      />
                    </div>
                    <Button type="submit" disabled={busy}>
                      {busy ? "Refunding…" : "Confirm refund"}
                    </Button>
                  </form>
                )}
              <p className="form-note mt-6">
                Test mode record. No live funds have been collected or returned.
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  )
}
