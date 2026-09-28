"use client"
import { useEffect, useState, useCallback, useRef, type FormEvent } from "react"
import Link from "next/link"
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
import type { Snapshot, Payment, Registration } from "@/lib/types"
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
  new Date(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
const views = [
  "Overview",
  "Payments",
  "Catalog",
  "Agents",
  "Developers",
] as const
type View = (typeof views)[number]
type CreatedPayment = Payment & {
  checkout_url?: string
  checkout_token?: string
  provider?: "sandbox" | "stripe"
  provider_mode?: "test" | "live"
}
type MerchantProvider = {
  provider: "stripe"
  mode: "test" | "live"
  status: "not_connected" | "charges_pending" | "connected" | "disconnected"
  charges_enabled: boolean
}
type ApiResponse = {
  error?: { message?: string; request_id?: string }
  [key: string]: unknown
}
type ApiDiagnostic = { status: number; requestId?: string; storage?: string }
const parseApiResponse = (raw: string): ApiResponse => {
  const value: unknown = JSON.parse(raw)
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ApiResponse
    : {}
}
const isProviderMode = (value: unknown): value is "test" | "live" =>
  value === "test" || value === "live"
const isProviderStatus = (value: unknown): value is MerchantProvider["status"] =>
  value === "not_connected" || value === "charges_pending" || value === "connected" || value === "disconnected"
const icons = [Home03Icon, CreditCardIcon, PackageIcon, AiBrain01Icon, CodeIcon]
const keyModeLabel = (mode?: "sandbox" | "test" | "live") =>
  mode === "test" ? "Stripe test" : mode === "live" ? "Stripe live" : mode === "sandbox" ? "Sandbox" : "Mode unavailable"
const workspaceKeyModeLabel = (data: Snapshot | null) =>
  data?.provider_status === "setup_required"
    ? keyModeLabel(data.provider_mode)
    : data?.provider_status === "sandbox"
      ? "Sandbox"
      : data?.mode === "stripe"
        ? keyModeLabel(data.provider_mode)
        : "Mode unavailable"
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
  const [authEmail, setAuthEmail] = useState("")
  const [authRole, setAuthRole] = useState<"owner" | "merchant">("owner")
  const [authTenantId, setAuthTenantId] = useState("")
  const [authError, setAuthError] = useState("")
  const [authErrorDetails, setAuthErrorDetails] = useState<ApiDiagnostic | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [mfaSecret, setMfaSecret] = useState("")
  const [mfaUri, setMfaUri] = useState("")
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
  const [created, setCreated] = useState<CreatedPayment | null>(null)
  const [secret, setSecret] = useState("")
  const [keyKind, setKeyKind] = useState("agent")
  const [keyTenantId, setKeyTenantId] = useState("")
  const [keyTenantName, setKeyTenantName] = useState("")
  const [registrationReview, setRegistrationReview] = useState<{
    registration: Registration
    decision: "approve" | "reject"
  } | null>(null)
  const [merchantInvite, setMerchantInvite] = useState<{
    business_name: string
    email: string
    invite_url: string
    expires_at: string
  } | null>(null)
  const [inviteBusyTenant, setInviteBusyTenant] = useState("")
  const [merchantProvider, setMerchantProvider] = useState<MerchantProvider | null>(null)
  const [merchantProviderError, setMerchantProviderError] = useState("")
  const [providerRefresh, setProviderRefresh] = useState(0)
  const [permission, setPermission] =
    useState<keyof typeof permissionSets>("full")
  const [codeTab, setCodeTab] = useState("typescript")
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarReady, setSidebarReady] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [providerBusyTenant, setProviderBusyTenant] = useState("")
  function setApiAuthError(response: Response, body: ApiResponse, fallback: string) {
    setAuthError(body.error?.message || fallback)
    setAuthErrorDetails({
      status: response.status,
      requestId: body.error?.request_id || response.headers.get("X-Request-Id") || undefined,
      storage: response.headers.get("X-Agora-Storage") || undefined,
    })
  }
  function renderAuthError() {
    if (!authError) return null
    return (
      <div id="auth-error" className="auth-error" role="alert">
        <p>{authError}</p>
        {authErrorDetails && (
          <details>
            <summary>Technical details</summary>
            <p>HTTP {authErrorDetails.status}</p>
            {authErrorDetails.requestId && <p>Reference: {authErrorDetails.requestId}</p>}
            {authErrorDetails.storage && <p>Storage: {authErrorDetails.storage}</p>}
          </details>
        )}
      </div>
    )
  }
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/console", { cache: "no-store" })
      const raw = await r.text()
      let b: ApiResponse
      try {
        b = parseApiResponse(raw)
      } catch {
        throw new Error(`Workspace API returned ${r.status}. Please retry.`)
      }
      if (!r.ok) {
        if (r.status === 401) {
          setData(null)
          setAuthState("signed-out")
          setAuthError("Your session expired. Sign in again to continue.")
        }
        throw new Error(b.error?.message || "Unable to load workspace.")
      }
      setData(b as unknown as Snapshot)
      setError("")
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "Connection failed. Check the network and try again."
          : e instanceof Error
            ? e.message
            : "Unable to load workspace."
      )
    }
  }, [])
  const checkSession = useCallback(async () => {
    if (recoveryPending.current) return
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" })
      const body = await response.json() as ApiResponse & { role?: string; tenant_id?: string; access_status?: string; mfa_stage?: string; authenticated?: boolean }
      if (!response.ok)
        throw new Error(
          body.error?.message || "Unable to verify account access."
        )
      setAuthRole(body.role === "merchant" ? "merchant" : "owner")
      setAuthTenantId(typeof body.tenant_id === "string" ? body.tenant_id : "")
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
    setAuthErrorDetails(null)
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail.trim(), password: authPassword }),
      })
      const body = await response.json() as ApiResponse & { role?: string; tenant_id?: string; stage?: string; secret?: string; otpauth_url?: string; authenticated?: boolean; access_status?: string }
      if (!response.ok) {
        setApiAuthError(response, body, "Sign-in failed.")
        return
      }
      setAuthPassword("")
      setAuthRole(body.role === "merchant" ? "merchant" : "owner")
      setAuthTenantId(typeof body.tenant_id === "string" ? body.tenant_id : "")
      if (body.stage === "enroll") {
        setMfaSecret(body.secret || "")
        setMfaUri(body.otpauth_url || "")
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
    setAuthErrorDetails(null)
    try {
      const enrolling = authState === "enroll"
      const response = await fetch(
        enrolling
          ? authRole === "merchant" ? "/api/auth/merchant/mfa/enroll" : "/api/auth/mfa/enroll"
          : authRole === "merchant" ? "/api/auth/merchant/mfa/verify" : "/api/auth/mfa/verify",
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
      const body = await response.json() as ApiResponse & { recovery_codes?: unknown }
      if (!response.ok) {
        setApiAuthError(response, body, "Code was not accepted.")
        return
      }
      setMfaCode("")
      if (enrolling) {
        const codes = Array.isArray(body.recovery_codes)
          ? body.recovery_codes.filter((code): code is string => typeof code === "string")
          : []
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
      const body = await response.json() as ApiResponse
      if (!response.ok)
        throw new Error(body.error?.message || "Sign-out failed.")
      setData(null)
      setAuthError("")
      setMfaSecret("")
      setMfaUri("")
      setRecoveryCodes([])
      setAuthState("signed-out")
      setAuthRole("owner")
      setAuthTenantId("")
      setAuthEmail("")
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Sign-out failed.")
    } finally {
      setAuthBusy(false)
    }
  }
  async function action<T = ApiResponse>(action: string, payload: unknown): Promise<T> {
    const fingerprint = JSON.stringify({ action, payload })
    const key = pendingWrites.current.get(fingerprint) || crypto.randomUUID()
    pendingWrites.current.set(fingerprint, key)
    let r: Response
    try {
      r = await fetch("/api/console", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: fingerprint,
      })
    } catch {
      throw new Error("Connection failed. Check the network and try again.")
    }
    const raw = await r.text()
    let b: ApiResponse
    try {
      b = parseApiResponse(raw)
    } catch {
      throw new Error(`Workspace API returned ${r.status}. Please retry.`)
    }
    if (!r.ok) {
        if (r.status === 401) {
          setData(null)
          setAuthState("signed-out")
          setAuthError("Your session expired. Sign in again to continue.")
        }
        if (r.status < 500) pendingWrites.current.delete(fingerprint)
      throw new Error(b.error?.message || "The action could not be completed.")
    }
    pendingWrites.current.delete(fingerprint)
    await load()
    return b as unknown as T
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
  async function connectTenant(tenantId: string) {
    setProviderBusyTenant(tenantId)
    try {
      const response = await fetch(`/api/merchants/${encodeURIComponent(tenantId)}/stripe/connect`, {
        method: "POST",
        cache: "no-store",
      })
      const raw = await response.text()
      let body: ApiResponse & { authorize_url?: string }
      try {
        body = parseApiResponse(raw)
      } catch {
        throw new Error(`Provider API returned ${response.status}. Please retry.`)
      }
      if (!response.ok) throw new Error(body.error?.message || "Stripe connection could not be started.")
      const authorize = new URL(body.authorize_url || "")
      if (authorize.protocol !== "https:" || authorize.hostname !== "connect.stripe.com") {
        throw new Error("The provider returned an unexpected authorization URL. Contact support.")
      }
      window.location.assign(authorize.toString())
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Stripe connection could not be started.")
      setProviderBusyTenant("")
    }
  }
  async function disconnectTenant(tenantId: string, businessName = "this merchant") {
    if (!window.confirm(`Disconnect Stripe from ${businessName}? This revokes its API keys and stops new payments.`)) return
    setProviderBusyTenant(tenantId)
    try {
      const response = await fetch(`/api/merchants/${encodeURIComponent(tenantId)}/stripe/connect`, {
        method: "DELETE",
        cache: "no-store",
      })
      const raw = await response.text()
      let body: ApiResponse
      try {
        body = parseApiResponse(raw)
      } catch {
        throw new Error(`Provider API returned ${response.status}. Please retry.`)
      }
      if (!response.ok) throw new Error(body.error?.message || "Stripe could not be disconnected.")
      toast.success("Stripe disconnected. New payments are disabled and tenant API keys were revoked.")
      await load()
      setProviderRefresh((current) => current + 1)
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Stripe could not be disconnected.")
    } finally {
      setProviderBusyTenant("")
    }
  }
  useEffect(() => {
    if (authState !== "signed-in" || authRole !== "merchant" || !authTenantId) {
      setMerchantProvider(null)
      setMerchantProviderError("")
      return
    }
    let active = true
    setMerchantProvider(null)
    setMerchantProviderError("")
    fetch(`/api/merchants/${encodeURIComponent(authTenantId)}/stripe/connect`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as ApiResponse & { mode?: unknown; status?: unknown; charges_enabled?: unknown; provider?: unknown }
        if (!response.ok) throw new Error(body.error?.message || "Unable to load Stripe connection status.")
        if (body.provider !== "stripe" || !isProviderMode(body.mode) || !isProviderStatus(body.status)) {
          throw new Error("The Stripe connection status response was incomplete.")
        }
        if (active) setMerchantProvider({ provider: "stripe", mode: body.mode, status: body.status, charges_enabled: body.charges_enabled === true })
      })
      .catch((reason) => {
        if (active) setMerchantProviderError(reason instanceof Error ? reason.message : "Unable to load Stripe connection status.")
      })
    return () => { active = false }
  }, [authRole, authState, authTenantId, providerRefresh])
  useEffect(() => {
    const url = new URL(window.location.href)
    const result = url.searchParams.get("stripe_connect")
    if (!result) return
    url.searchParams.delete("stripe_connect")
    window.history.replaceState(null, "", `${url.pathname}${url.search}`)
    if (result === "connected") {
      toast.success("Stripe connection saved. Payment eligibility is checked when you create a payment.")
    } else {
      toast.error("Stripe connection was not completed. You can try again from this page.")
    }
    setProviderRefresh((current) => current + 1)
    void load()
  }, [load])
  async function inviteMerchant(registration: Registration) {
    setInviteBusyTenant(registration.tenant_id)
    try {
      const result = await action("create_invite", { tenant_id: registration.tenant_id })
      if (typeof result.invite_url !== "string" || typeof result.expires_at !== "string") {
        throw new Error("The invite response was incomplete. Please retry.")
      }
      setMerchantInvite({
        business_name: registration.business_name,
        email: typeof result.email === "string" ? result.email : registration.email,
        invite_url: result.invite_url,
        expires_at: result.expires_at,
      })
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Merchant invite could not be created.")
    } finally {
      setInviteBusyTenant("")
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
  const openKey = (kind = "agent", tenant?: { id: string; name: string }) => {
    setKeyKind(kind)
    setSecret("")
    setKeyTenantId(tenant?.id || "")
    setKeyTenantName(tenant?.name || "")
    if (tenant) setPermission("payments")
    setDialog("key")
  }
  const pending = data?.approvals.filter((a) => a.status === "pending") || []
  const activity = data?.activity
  const volume = activity?.gross_amount
  const refunded = activity?.refunded_amount
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
  const merchantCheckoutReady = authRole !== "merchant" ||
    data?.provider_status === "sandbox" ||
    Boolean(
      merchantProvider?.status === "connected" &&
      merchantProvider.charges_enabled &&
      merchantProvider.mode === data?.provider_mode,
    )
  const checkoutAvailable = data?.checkout_enabled === true && merchantCheckoutReady
  const keyIssuanceAvailable = data?.provider_status === "sandbox" || data?.provider_status === "ready"
  const keyIssuanceUnavailableMessage = "API key issuance is unavailable until the workspace owner finishes provider setup. No key was created."
  const checkoutUnavailableMessage = data?.provider_status === "setup_required"
    ? "Checkout setup is required. Payment creation is disabled until the workspace owner configures the required Stripe credentials and verified webhook. No simulator fallback is active."
    : authRole === "merchant" && !merchantCheckoutReady
      ? "This merchant’s Stripe account is not connected and verified in the active mode. Connect it before creating a payment."
      : "Payment creation is disabled because provider readiness has not been confirmed. Ask the workspace owner to check setup."
  let cumulative = 0
  const volumeSeries = (activity?.daily || []).map((day) => {
    const dateUtc = new Date(`${day.date}T00:00:00.000Z`)
    return {
      day: dateUtc,
      label: date(day.date),
      amount: day.gross_amount,
      successfulPayments: day.successful_payments,
      refunded: day.refunded_amount,
      total: (cumulative += day.gross_amount),
    }
  })
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
    typescript: `const response = await fetch("${typeof location !== "undefined" ? location.origin : "https://agora.example.com"}/api/v1/payments", {\n  method: "POST",\n  headers: {\n    Authorization: \`Bearer \${process.env.AGORA_API_KEY}\`,\n    "Content-Type": "application/json",\n    "Idempotency-Key": "order-001",\n  },\n  body: JSON.stringify({ product_id: "${data?.products[0]?.id || "prod_studio"}" }),\n});\n\nif (!response.ok) throw new Error(await response.text());\nconst payment = await response.json();\n// Redirect the customer to the returned hosted checkout URL.\nconsole.log(payment.checkout_url);`,
    curl: `curl -X POST "$AGORA_URL/api/v1/payments" \\\n  -H "Authorization: Bearer $AGORA_API_KEY" \\\n  -H "Idempotency-Key: order-001" \\\n  -H "Content-Type: application/json" \\\n  -d '{"product_id":"${data?.products[0]?.id || "prod_studio"}"}'`,
    cli: `export AGORA_URL="${typeof location !== "undefined" ? location.origin : "https://agora.example.com"}"\nexport AGORA_API_KEY="your-mode-bound-key"\n\nagora products list\nagora payments create \\\n  --product ${data?.products[0]?.id || "prod_studio"} \\\n  --idempotency-key order-001\n\nagora payments reconcile --id pay_…\n\n# Install (Node.js 20.9+):\ncurl -fsSL https://agora-payments.vercel.app/install.sh | bash`,
  }
  const renderSidebar = (mobile = false) => (
    <aside
      className={`sidebar ${mobile ? "mobile-sidebar" : "desktop-sidebar"}`}
      id={mobile ? undefined : "desktop-navigation"}
      aria-label="Workspace sidebar"
    >
      <Link
        className="wordmark"
        href="/"
        onClick={(e) => {
          e.preventDefault()
          navigate("Overview")
        }}
        aria-label="Agora overview"
      >
        agora<span>·</span>
      </Link>
      <div className="workspace">
        <span className="avatar" aria-hidden="true">A</span>
        <div className="workspace-copy">
          {authRole === "merchant" ? "Merchant" : "Belweave"}<small>Workspace</small>
        </div>
      </div>
      <nav aria-label="Main navigation">
        {views.map((title, i) => (
          <a
            className={`nav-item ${view === title ? "active" : ""}`}
            aria-current={view === title ? "page" : undefined}
            aria-label={title}
            href={title === "Overview" ? "/" : `/?view=${title}`}
            title={sidebarCollapsed && !mobile ? title : undefined}
            onClick={(event) => {
              event.preventDefault()
              navigate(title)
            }}
            key={title}
          >
            <HugeiconsIcon icon={icons[i]} size={19} aria-hidden="true" />
            <span className="nav-item-label">{title}</span>
            {title === "Agents" && pending.length > 0 && (
              <span className="nav-count" aria-label={`${pending.length} pending approvals`}>
                {pending.length}
              </span>
            )}
          </a>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <Tooltip>
          <TooltipTrigger render={<span className="sandbox-mark" tabIndex={0} role="note" aria-label={data?.provider_status === "setup_required" ? "Payment setup required" : data?.provider_status === "sandbox" ? "Test mode" : data?.mode === "stripe" ? `Stripe ${data.provider_mode || "mode unavailable"}` : "Provider mode unavailable"} />}>{data?.provider_status === "setup_required" ? "Setup required" : data?.provider_status === "sandbox" ? "Test mode" : data?.mode === "stripe" ? data.provider_mode ? `Stripe ${data.provider_mode}` : "Mode unavailable" : "Mode unavailable"}</TooltipTrigger>
          <TooltipContent>
            {data?.provider_status === "setup_required"
              ? "Payment creation is disabled until required Stripe credentials and a verified webhook are configured. No simulator fallback is active."
              : data?.provider_status === "sandbox"
                ? "Explicit test simulation only. No live funds move."
                : data?.mode === "stripe"
              ? data.provider_mode
                ? `Payments use the configured Stripe ${data.provider_mode} account. Payment status follows verified provider events.`
                : "The payment provider mode is unavailable. Verify configuration before creating a payment."
              : "Provider readiness has not been confirmed. Payment creation is unavailable."}
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
          <Link className="wordmark" href="/" aria-label="Agora home">agora<span>·</span></Link>
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
          <Link className="wordmark" href="/" aria-label="Agora home">agora<span>·</span></Link>
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
                {mfaUri && (
                  <Button type="button" variant="ghost" onClick={() => void copy(mfaUri)}>
                    Copy authenticator setup URI <HugeiconsIcon icon={Copy01Icon} aria-hidden="true" />
                  </Button>
                )}
              </div>
              <form className="form-stack" onSubmit={submitMfa}>
                <div className="field">
                  <Label htmlFor="mfa-code">Authenticator code</Label>
                  <Input id="mfa-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))} aria-invalid={authError ? true : undefined} aria-describedby={authError ? "auth-error" : undefined} required autoFocus />
                </div>
                {renderAuthError()}
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
          <Link className="wordmark" href="/" aria-label="Agora home">agora<span>·</span></Link>
          <h1 id="auth-title">Verify your identity</h1>
          <p>Enter a code from your authenticator app{useRecoveryCode ? " or recovery list" : ""}.</p>
          <form className="form-stack" onSubmit={submitMfa}>
            <div className="field">
              <Label htmlFor="mfa-code">{useRecoveryCode ? "Recovery code" : "Authenticator code"}</Label>
              <Input id="mfa-code" name="code" type="text" inputMode={useRecoveryCode ? "text" : "numeric"} autoComplete={useRecoveryCode ? "off" : "one-time-code"} maxLength={useRecoveryCode ? 32 : 6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.trim().slice(0, useRecoveryCode ? 32 : 6))} aria-invalid={authError ? true : undefined} aria-describedby={authError ? "auth-error" : undefined} required autoFocus />
            </div>
            {renderAuthError()}
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
          <Link className="wordmark" href="/" aria-label="Agora home">agora<span>·</span></Link>
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
          <Link className="wordmark" href="/">
            agora<span>·</span>
          </Link>
          <h1 id="auth-title">Sign in</h1>
          <p>Sign in to your Agora account.</p>
          <p className="auth-account">Owner and merchant accounts</p>
          <form className="form-stack" onSubmit={login}>
            <div className="field">
              <Label htmlFor="account-email">Email address</Label>
              <Input
                id="account-email"
                name="email"
                type="email"
                autoComplete="username"
                placeholder="you@example.com"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                aria-invalid={authError ? true : undefined}
                aria-describedby={authError ? "auth-error" : undefined}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <Label htmlFor="auth-password">Password</Label>
              <Input
                id="auth-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                aria-invalid={authError ? true : undefined}
                aria-describedby={authError ? "auth-error" : undefined}
                required
              />
            </div>
            {renderAuthError()}
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
                aria-controls="desktop-navigation"
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
              {authState === "signed-in" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={logout}
                  disabled={authBusy}
                >
                  Sign out
                </Button>
              )}
            </div>
          </header>
          {error ? (
            <section className="error-state" role="alert" aria-live="assertive">
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
              {data.provider_status === "setup_required" && (
                <section className="merchant-provider-panel provider-setup-alert" role="status" aria-labelledby="provider-setup-title">
                  <div>
                    <h2 id="provider-setup-title">Checkout setup required</h2>
                    <p>
                      Payment creation is disabled until the workspace owner configures the required Stripe credentials and verifies the webhook. This deployment has no simulator fallback.
                    </p>
                  </div>
                </section>
              )}
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
                        Gross processed <span>Successful payments created · 28 UTC days · before provider fees</span>
                      </div>
                      <div className="hero-number">
                        {volume === undefined ? (
                          "Unavailable"
                        ) : (
                          <>
                            {money(volume).split(".")[0]}
                            <span>.{money(volume).split(".")[1]}</span>
                          </>
                        )}
                      </div>
                      <p className="subtle">
                        {activity?.successful_payments ?? "Unavailable"} successful payments{" "}
                        <span className="inline-dot">·</span> UTC
                      </p>
                      {!activity ? (
                        <p className="chart-empty" role="status">Payment activity is unavailable.</p>
                      ) : volumeSeries.some((day) => day.amount > 0) ? <div className="volume-chart">
                        <AreaChart
                          data={volumeSeries}
                          config={{
                            total: { label: "Gross processed amount", color: "grey" },
                          }}
                          ariaLabel="Cumulative gross amount from successful payments created in the last 28 UTC dates, before provider fees. Exact daily counts, amounts, and refunds attributed to those payments are available in the accessible table after the chart."
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
                      </div> : <p className="chart-empty">No successful payments were created in this period.</p>}
                      <div className="accessible-chart-data">
                      <table>
                        <caption>
                          Daily successful payments created in the last 28 UTC dates. Refunds are attributed to the date the payment was created.
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">Date</th>
                            <th scope="col">Successful payment count</th>
                            <th scope="col">Gross processed</th>
                            <th scope="col">Cumulative gross processed</th>
                            <th scope="col">Refunded on these payments</th>
                          </tr>
                        </thead>
                        <tbody>
                          {volumeSeries.map((day) => (
                            <tr key={day.day.toISOString()}>
                              <th scope="row">
                                {day.day.toLocaleDateString("en-US", {
                                  dateStyle: "long",
                                  timeZone: "UTC",
                                })}
                              </th>
                              <td>{day.successfulPayments}</td>
                              <td>{money(day.amount)}</td>
                              <td>{money(day.total)}</td>
                              <td>{money(day.refunded)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    </div>
                  </section>
                  <section className="small-stats">
                    <div>
                      <span>Net after refunds</span>
                      <strong>{volume === undefined || refunded === undefined ? "Unavailable" : money(volume - refunded)}</strong>
                    </div>
                    <div>
                      <span>Refunded on these payments</span>
                      <strong>{refunded === undefined ? "Unavailable" : money(refunded)}</strong>
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
                  <p className="subtle finance-note">
                    These totals do not include provider fees or payout timing and are not an available bank balance.
                  </p>
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
                      <h1>{authRole === "merchant" ? "Access" : "Agents"}</h1>
                      <p>{authRole === "merchant" ? "Provider connection, API keys, and refund approvals." : "Keys, permissions, and approvals."}</p>
                    </div>
                    <Button onClick={() => openKey()}>
                      <HugeiconsIcon icon={PlusSignIcon} />
                      Add agent
                    </Button>
                  </section>
                  {authRole === "merchant" && (
                    <section className="merchant-provider-panel" aria-labelledby="merchant-provider-title">
                      <div>
                        <h2 id="merchant-provider-title">Stripe connection</h2>
                        {merchantProviderError ? (
                          <p role="alert">{merchantProviderError}</p>
                        ) : merchantProvider ? (
                          <p>
                            {merchantProvider.status === "connected" && merchantProvider.charges_enabled
                              ? `Connected in ${merchantProvider.mode} mode. Stripe reports charges enabled.`
                              : merchantProvider.status === "charges_pending"
                                ? `Stripe setup is incomplete in ${merchantProvider.mode} mode. Payments are unavailable until charges are enabled.`
                                : `No verified Stripe account is connected in ${merchantProvider.mode} mode. Payments remain unavailable.`}
                          </p>
                        ) : (
                          <p role="status">Checking provider connection…</p>
                        )}
                      </div>
                      {merchantProviderError ? (
                        <Button variant="secondary" onClick={() => setProviderRefresh((current) => current + 1)}>Retry status</Button>
                      ) : merchantProvider && !(merchantProvider.status === "connected" && merchantProvider.charges_enabled) ? (
                        <Button disabled={providerBusyTenant === authTenantId} onClick={() => void connectTenant(authTenantId)}>
                          {providerBusyTenant === authTenantId ? "Opening Stripe…" : merchantProvider.status === "charges_pending" ? "Continue Stripe setup" : "Connect Stripe"}
                        </Button>
                      ) : merchantProvider?.status === "connected" && (
                        <Button variant="secondary" disabled={providerBusyTenant === authTenantId} onClick={() => void disconnectTenant(authTenantId, "your merchant account")}>
                          Disconnect Stripe
                        </Button>
                      )}
                    </section>
                  )}
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
                  {data.registrations.length > 0 && (
                    <section className="merchant-registrations" aria-labelledby="merchant-registrations-title">
                      <div className="section-heading">
                        <h2 id="merchant-registrations-title">Merchant access</h2>
                        <span className="subtle">Approval grants API access. Payments also require a connected provider account.</span>
                      </div>
                      <div className="registration-list">
                        {data.registrations.map((registration) => {
                          const tenantHasKey = data.credentials.some(
                            (credential) => credential.tenant_id === registration.tenant_id && !credential.revoked
                          )
                          return (
                            <article className="registration-row" key={registration.id}>
                              <div className="registration-info">
                                <h3>{registration.business_name}</h3>
                                <p>{registration.owner_name} · <a className="inline-link" href={`mailto:${registration.email}`}>{registration.email}</a></p>
                                <p className="registration-status">
                                  <span>Status: {registration.status}</span>
                                  <span>Stripe: {registration.provider_status === "not_connected" ? "Not connected" : registration.provider_status === "charges_pending" ? "Setup in progress" : registration.provider_status === "connected" ? `Connected${registration.provider_mode ? ` · ${registration.provider_mode === "test" ? "test" : "live"} mode` : ""}` : "Disconnected"}</span>
                                </p>
                                {registration.status === "approved" && (
                                  <p className="registration-note">
                                    {registration.provider_status === "connected" && registration.provider_mode === "live"
                                      ? "Stripe is connected in live mode. Payment eligibility is checked again when each payment is created."
                                      : registration.provider_status === "connected"
                                        ? "Stripe is connected in test mode. Live payments remain unavailable until a live provider account is separately verified."
                                        : registration.provider_status === "charges_pending"
                                          ? "Stripe setup is incomplete. Payments remain unavailable until the account is verified."
                                      : "API access is approved. Processor payments stay unavailable until the merchant’s Stripe account is connected and verified."}
                                  </p>
                                )}
                                {registration.review_reason && <p className="registration-note">Review note: {registration.review_reason}</p>}
                              </div>
                              <div className="registration-actions">
                                {registration.status === "pending" ? (
                                  <>
                                    <Button variant="secondary" disabled={busy} onClick={() => setRegistrationReview({ registration, decision: "reject" })}>Reject</Button>
                                    <Button disabled={busy} onClick={() => setRegistrationReview({ registration, decision: "approve" })}>Approve merchant</Button>
                                  </>
                                ) : registration.status === "approved" ? (
                                  <>
                                    <Button
                                      variant={registration.provider_status === "connected" ? "secondary" : "default"}
                                      disabled={providerBusyTenant === registration.tenant_id}
                                      onClick={() => registration.provider_status === "connected" ? disconnectTenant(registration.tenant_id, registration.business_name) : connectTenant(registration.tenant_id)}
                                    >
                                      {providerBusyTenant === registration.tenant_id
                                        ? "Working…"
                                        : registration.provider_status === "connected"
                                          ? "Disconnect Stripe"
                                          : registration.provider_status === "charges_pending"
                                            ? "Continue Stripe setup"
                                            : "Connect Stripe"}
                                    </Button>
                                    <Button variant={tenantHasKey ? "secondary" : "default"} onClick={() => openKey("developer", { id: registration.tenant_id, name: registration.business_name })}>
                                      {tenantHasKey ? "Issue another API key" : "Issue API key"}
                                    </Button>
                                    <Button
                                      variant="secondary"
                                      disabled={inviteBusyTenant === registration.tenant_id}
                                      onClick={() => void inviteMerchant(registration)}
                                    >
                                      {inviteBusyTenant === registration.tenant_id ? "Creating invite…" : "Create merchant invite"}
                                    </Button>
                                  </>
                                ) : (
                                  <span>Request rejected</span>
                                )}
                              </div>
                            </article>
                          )
                        })}
                      </div>
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
                            <p>Key mode: {keyModeLabel(k.provider_mode ?? "sandbox")}</p>
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
                      <small>Install the separate <a href="https://github.com/pkyanam/agora-cli" target="_blank" rel="noreferrer">Agora CLI repository</a>.</small>
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
                            <TableHead>Mode</TableHead>
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
                              <TableCell>{keyModeLabel(k.provider_mode)}</TableCell>
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
                      Persisted payment, refund, approval, and provider events.
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
            setKeyTenantId("")
            setKeyTenantName("")
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
                    ? keyTenantName
                        ? `${workspaceKeyModeLabel(data)} key for ${keyTenantName}`
                      : "API key created"
                    : keyKind === "agent"
                      ? "Give your agent a key."
                      : keyTenantName
                        ? `Issue a ${workspaceKeyModeLabel(data)} key for ${keyTenantName}`
                        : "Create an API key."}
            </DialogTitle>
            <DialogDescription>
              {dialog === "payment"
                ? !checkoutAvailable
                  ? checkoutUnavailableMessage
                  : data?.provider_status === "sandbox"
                    ? "Explicit test simulation only. No live charge will be made."
                    : data?.provider_mode
                      ? `A hosted checkout will open with the configured Stripe ${data.provider_mode} account. Payment status follows verified provider events.`
                      : "Provider mode is unavailable. Check configuration before creating a payment."
                : dialog === "product"
                ? "Set a fixed price in USD."
                  : !secret && !keyIssuanceAvailable
                    ? keyIssuanceUnavailableMessage
                  : secret
                    ? `Copy this ${workspaceKeyModeLabel(data)} key now. It will not be shown again. Keys remain bound to this mode; create another key if the workspace changes modes. Share it through a secure channel.`
                    : keyTenantName
                      ? `This key is restricted to this merchant’s data and bound to ${workspaceKeyModeLabel(data)}. Switching modes requires another key. It does not connect a processor.`
                      : `Choose the access this key needs. It will be bound to ${workspaceKeyModeLabel(data)}; create another key if the workspace changes modes. You can revoke it at any time.`}
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
                  onClick={() => {
                    const url = created.checkout_url ||
                      (created.checkout_token
                        ? `/checkout/${created.checkout_token}`
                        : null)
                    if (url) location.assign(url)
                  }}
                  disabled={!created.checkout_url && !created.checkout_token}
                >
                  Open checkout <HugeiconsIcon icon={ArrowUpRight01Icon} />
                </Button>
                <Button
                  variant="secondary"
                  disabled={!created.checkout_url && !created.checkout_token}
                  onClick={() =>
                    copy(
                      created.checkout_url || `${location.origin}/checkout/${created.checkout_token}`
                    )
                  }
                >
                  Copy checkout link
                </Button>
              </div>
            ) : !checkoutAvailable ? (
              <p className="form-note" role="status">{checkoutUnavailableMessage}</p>
            ) : (
              <form
                className="form-stack"
                onSubmit={(e) => {
                  e.preventDefault()
                  const f = new FormData(e.currentTarget)
                  perform(async () => {
                    const p = await action<CreatedPayment>("create_payment", {
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
                  {keyTenantName
                    ? `This key is bound to ${keyTenantName}. Deliver it through a secure channel, and store it on a trusted server. It will not be shown again.`
                    : "Use this on a trusted server or in your agent’s secret store. Never put it in frontend code."}
                </p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const tenantKey = Boolean(keyTenantId)
                    setDialog(null)
                    setSecret("")
                    setKeyTenantId("")
                    setKeyTenantName("")
                    if (!tenantKey) navigate(keyKind === "agent" ? "Agents" : "Developers")
                  }}
                >
                  Done
                </Button>
              </div>
            ) : !keyIssuanceAvailable ? (
              <p className="form-note" role="status">{keyIssuanceUnavailableMessage}</p>
            ) : (
              <form
                className="form-stack"
                onSubmit={(e) => {
                  e.preventDefault()
                  const f = new FormData(e.currentTarget)
                  perform(async () => {
                    const k = await action<ApiResponse & { secret?: string }>("create_key", {
                      name: f.get("name"),
                      kind: keyKind,
                      scopes: permissionSets[permission],
                      max_amount: Math.round(Number(f.get("max")) * 100),
                      refund_budget: Math.round(Number(f.get("budget")) * 100),
                      ...(keyTenantId ? { tenant_id: keyTenantId } : {}),
                    })
                    if (typeof k.secret !== "string") throw new Error("The API key response was incomplete. Contact support.")
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
      <Dialog
        open={merchantInvite !== null}
        onOpenChange={(open) => {
          if (!open) setMerchantInvite(null)
        }}
      >
        <DialogContent className="agora-dialog sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Invite {merchantInvite?.business_name}</DialogTitle>
            <DialogDescription>
              This one-time link lets {merchantInvite?.email} set a password and authenticator. It expires {merchantInvite ? new Date(merchantInvite.expires_at).toLocaleString() : ""}. Share it privately; anyone with the link can claim this merchant account.
            </DialogDescription>
          </DialogHeader>
          {merchantInvite && (
            <div className="form-stack">
              <div className="field">
                <Label htmlFor="merchant-invite-url">One-time invite link</Label>
                <Input id="merchant-invite-url" readOnly value={merchantInvite.invite_url} onFocus={(event) => event.currentTarget.select()} />
              </div>
              <p className="form-note">The link is shown once here. Copy it before closing this window; it is not emailed automatically.</p>
              <Button onClick={() => copy(merchantInvite.invite_url)}>Copy invite link <HugeiconsIcon icon={Copy01Icon} aria-hidden="true" /></Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={registrationReview !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRegistrationReview(null)
        }}
      >
        <DialogContent className="agora-dialog sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {registrationReview?.decision === "approve"
                ? `Approve ${registrationReview.registration.business_name}?`
                : `Reject ${registrationReview?.registration.business_name ?? "this registration"}?`}
            </DialogTitle>
            <DialogDescription>
              {registrationReview?.decision === "approve"
                ? "This approves API access. It does not issue a key or create a login. Processor payments require the merchant’s own connected and verified provider account."
                : "The merchant registration will be marked rejected. No API key or payment access will be issued."}
            </DialogDescription>
          </DialogHeader>
          <div className="registration-confirm-actions">
            <Button variant="secondary" disabled={busy} onClick={() => setRegistrationReview(null)}>Cancel</Button>
            <Button
              variant={registrationReview?.decision === "reject" ? "destructive" : "default"}
              disabled={busy || !registrationReview}
              onClick={() => {
                const review = registrationReview
                if (!review) return
                perform(async () => {
                  await action("review_registration", {
                    registration_id: review.registration.id,
                    decision: review.decision,
                  })
                  setRegistrationReview(null)
                  toast.success(review.decision === "approve" ? "Merchant approved" : "Registration rejected")
                })
              }}
            >
              {busy ? "Saving…" : registrationReview?.decision === "approve" ? "Approve merchant" : "Reject registration"}
            </Button>
          </div>
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
                  selectedCurrent.provider === "stripe" && data?.provider_status === "setup_required" ? (
                    <p className="form-note" role="status">
                      Refund actions are unavailable until Stripe setup is complete. No local refund record was created.
                    </p>
                  ) : <form
                    className="form-stack refund-form"
                    key={selectedCurrent.refunded}
                    onSubmit={(e) => {
                      e.preventDefault()
                      const f = new FormData(e.currentTarget)
                      perform(async () => {
                        const result = await action<ApiResponse & { provider?: string; status?: string }>("refund", {
                          payment_id: selectedCurrent.id,
                          amount: Math.round(Number(f.get("amount")) * 100),
                          reason: f.get("reason"),
                        })
                        toast.success(
                          result.provider === "stripe"
                            ? result.status === "succeeded"
                              ? "Stripe reports the refund succeeded."
                              : "Refund submitted. Waiting for provider confirmation."
                            : "Refund completed in test mode."
                        )
                      })
                    }}
                  >
                    <h2>Issue a refund</h2>
                    {(selectedCurrent as Payment & { provider?: string }).provider === "stripe" && !selectedCurrent.provider_mode ? (
                      <p className="form-note" role="status">Stripe mode is unknown. Refunds are disabled until the payment mode can be verified.</p>
                    ) : (
                    <>
                    {(selectedCurrent as Payment & { provider?: string }).provider === "stripe" && (
                      <p className="form-note" role="status">
                        Stripe {selectedCurrent.provider_mode} mode. The refund is sent to the same connected account; final status follows Stripe’s response and verified events.
                      </p>
                    )}
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
                      {busy ? "Submitting…" : (selectedCurrent as Payment & { provider?: string }).provider === "stripe" ? "Submit Stripe refund" : "Confirm refund"}
                    </Button>
                    </>
                    )}
                  </form>
                )}
              <p className="form-note mt-6">
                {(selectedCurrent as Payment & { provider?: string }).provider === "stripe"
                  ? "Processor status is updated by verified provider events."
                  : "Test mode record. No live funds have been collected or returned."}
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  )
}
