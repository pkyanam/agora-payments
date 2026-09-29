"use client"
import { useEffect, useState, useCallback, useRef, type FormEvent } from "react"
import QRCode from "qrcode"
import Image from "next/image"
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
  Settings05Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { QuoteDetails } from "@/components/quote-details"
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
import { StripeSetup } from "@/components/stripe-setup"
import { InstallationPanel } from "@/components/installation-panel"
import { OutgoingWebhooks } from "@/components/outgoing-webhooks"
import { RiskSignals } from "@/components/risk-signals"
import { PasswordChangeForm } from "@/components/password-change-form"
import { ProductEditor } from "@/components/product-editor"
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
const activityLabel = (value: string, bucketSeconds?: number | null) => {
  const parsed = new Date(value)
  if (
    bucketSeconds !== null &&
    bucketSeconds !== undefined &&
    bucketSeconds <= 3600
  ) {
    return parsed.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    })
  }
  if (bucketSeconds === null)
    return parsed.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}
const activityAccessibleLabel = (
  value: string,
  bucketSeconds?: number | null
) => {
  const parsed = new Date(value)
  return bucketSeconds !== null &&
    bucketSeconds !== undefined &&
    bucketSeconds <= 3600
    ? parsed.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      })
    : bucketSeconds === null
      ? parsed.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        })
      : parsed.toLocaleDateString("en-US", {
          dateStyle: "long",
          timeZone: "UTC",
        })
}
const views = [
  "Overview",
  "Payments",
  "Catalog",
  "Orders",
  "Agents",
  "Developers",
  "Settings",
] as const
type View = (typeof views)[number]
type SalesQuote = {
  id: string
  version?: number
  status: string
  customer_name?: string
  customer_email?: string | null
  expires_at: string
  subtotal_amount: number
  discount_amount: number
  total_amount: number
  currency: string
  items: Array<{
    product_id?: string
    product_name: string
    quantity: number
    unit_amount: number
    line_total: number
    catalog_version?: number
  }>
  order_id?: string | null
  checkout_url?: string | null
  quote_url?: string | null
  quote_link_available?: boolean
  created_at: string
}
type SalesOrder = {
  id: string
  quote_id?: string
  payment_id?: string
  customer_id?: string
  customer_name: string
  customer_email?: string | null
  status: string
  total_amount: number
  payment_status?: "pending" | "paid" | "partially_refunded" | "refunded" | "failed"
  refunded_amount?: number
  net_amount?: number
  currency: string
  created_at: string
  fulfillment_status?: string
}
type SalesCustomer = {
  id: string
  name: string
  email?: string | null
  order_count: number
  total_paid: number
  created_at: string
}
type CreatedPayment = Omit<Payment, "checkout_token"> & {
  checkout_url?: string
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
type ActivityRange =
  "1h" | "24h" | "7d" | "30d" | "90d" | "1y" | "all" | "custom"
type OverviewActivity = Snapshot["activity"] & {
  range?: ActivityRange
  bucket_seconds?: number | null
}
const parseApiResponse = (raw: string): ApiResponse => {
  const value: unknown = JSON.parse(raw)
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ApiResponse)
    : {}
}
const isProviderMode = (value: unknown): value is "test" | "live" =>
  value === "test" || value === "live"
const isProviderStatus = (
  value: unknown
): value is MerchantProvider["status"] =>
  value === "not_connected" ||
  value === "charges_pending" ||
  value === "connected" ||
  value === "disconnected"
const icons = [
  Home03Icon,
  CreditCardIcon,
  PackageIcon,
  CreditCardIcon,
  AiBrain01Icon,
  CodeIcon,
  Settings05Icon,
]
const keyModeLabel = (mode?: "sandbox" | "test" | "live") =>
  mode === "test"
    ? "Agora test mode"
    : mode === "live"
      ? "Agora live mode"
      : mode === "sandbox"
        ? "Agora sandbox"
        : "Mode unavailable"
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
  const [deploymentType, setDeploymentType] = useState<
    "community" | "hosted" | null
  >(null)
  const [activityRange, setActivityRange] = useState<ActivityRange>("30d")
  const [customStart, setCustomStart] = useState(() =>
    new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)
  )
  const [customEnd, setCustomEnd] = useState(() =>
    new Date().toISOString().slice(0, 10)
  )
  const [activityData, setActivityData] = useState<OverviewActivity | null>(
    null
  )
  const [activityError, setActivityError] = useState("")
  const [error, setError] = useState("")
  const [authState, setAuthState] = useState<
    | "checking"
    | "setup"
    | "signed-out"
    | "enroll"
    | "verify"
    | "recovery"
    | "pending"
    | "signed-in"
  >("checking")
  const [authPassword, setAuthPassword] = useState("")
  const [authEmail, setAuthEmail] = useState("")
  const [setupToken, setSetupToken] = useState("")
  const [setupTokenFromFragment, setSetupTokenFromFragment] = useState(false)
  const [setupLinkExpired, setSetupLinkExpired] = useState(false)
  const [setupPassword, setSetupPassword] = useState("")
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState("")
  const [authRole, setAuthRole] = useState<"owner" | "merchant">("owner")
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false)
  const [authTenantId, setAuthTenantId] = useState("")
  const [authError, setAuthError] = useState("")
  const [authNotice, setAuthNotice] = useState("")
  const [authErrorDetails, setAuthErrorDetails] =
    useState<ApiDiagnostic | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [mfaSecret, setMfaSecret] = useState("")
  const [mfaUri, setMfaUri] = useState("")
  const [mfaQrData, setMfaQrData] = useState<{
    uri: string
    data: string
  } | null>(null)
  const [mfaCode, setMfaCode] = useState("")
  const [useRecoveryCode, setUseRecoveryCode] = useState(false)
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const recoveryPending = useRef(false)
  const [dialog, setDialog] = useState<
    "payment" | "product" | "quote" | "key" | null
  >(null)
  const [selected, setSelected] = useState<Payment | null>(null)
  const [filter, setFilter] = useState("all")
  const [showArchived, setShowArchived] = useState(false)
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [product, setProduct] = useState("")
  const [editingProduct, setEditingProduct] = useState<
    (Snapshot["products"][number] & { version?: number }) | null
  >(null)
  const [salesBusy, setSalesBusy] = useState(false)
  const [salesError, setSalesError] = useState("")
  const [selectedQuote, setSelectedQuote] = useState<SalesQuote | null>(null)
  const [quoteDetail, setQuoteDetail] = useState<SalesQuote | null>(null)
  const [editingQuote, setEditingQuote] = useState<SalesQuote | null>(null)
  const [quoteLines, setQuoteLines] = useState<
    Array<{ product_id: string; quantity: number }>
  >([])
  const [salesTab, setSalesTab] = useState<"orders" | "quotes" | "customers">(
    "orders"
  )
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
  const [merchantProvider, setMerchantProvider] =
    useState<MerchantProvider | null>(null)
  const [merchantProviderError, setMerchantProviderError] = useState("")
  const [providerRefresh, setProviderRefresh] = useState(0)
  const [permission, setPermission] =
    useState<keyof typeof permissionSets>("full")
  const [codeTab, setCodeTab] = useState("typescript")
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarReady, setSidebarReady] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const mobileNavTrigger = useRef<HTMLButtonElement | null>(null)
  const mobileNavWasOpen = useRef(false)
  const [providerBusyTenant, setProviderBusyTenant] = useState("")
  function setApiAuthError(
    response: Response,
    body: ApiResponse,
    fallback: string
  ) {
    setAuthError(body.error?.message || fallback)
    setAuthErrorDetails({
      status: response.status,
      requestId:
        body.error?.request_id ||
        response.headers.get("X-Request-Id") ||
        undefined,
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
            {authErrorDetails.requestId && (
              <p>Reference: {authErrorDetails.requestId}</p>
            )}
            {authErrorDetails.storage && (
              <p>Storage: {authErrorDetails.storage}</p>
            )}
          </details>
        )}
      </div>
    )
  }
  const load = useCallback(
    async (includeArchived = showArchived) => {
    try {
        const r = await fetch(
          `/api/console${includeArchived ? "?include_archived=1" : ""}`,
          { cache: "no-store" }
        )
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
        if (b.deployment_type === "community" || b.deployment_type === "hosted")
          setDeploymentType(b.deployment_type)
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
    },
    [showArchived]
  )
  const checkSession = useCallback(async () => {
    if (recoveryPending.current) return
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" })
      const body = (await response.json()) as ApiResponse & {
        role?: string
        tenant_id?: string
        access_status?: string
        mfa_stage?: string
        authenticated?: boolean
        password_change_required?: boolean
        owner_setup_required?: boolean
        owner_setup_expired?: boolean
      }
      if (!response.ok)
        throw new Error(
          body.error?.message || "Unable to verify account access."
        )
      setAuthRole(body.role === "merchant" ? "merchant" : "owner")
      setPasswordChangeRequired(body.password_change_required === true)
      setAuthTenantId(typeof body.tenant_id === "string" ? body.tenant_id : "")
      if (body.owner_setup_required || body.owner_setup_expired) {
        setSetupLinkExpired(body.owner_setup_expired === true)
        setData(null)
        setAuthState("setup")
        return
      }
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
      if (
        !body.authenticated ||
        body.access_status !== "approved" ||
        body.mfa_stage !== "complete"
      ) {
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
    let active = true
    if (mfaUri) {
      // Render the provisioning URI locally. It is never sent to a QR service.
      void QRCode.toDataURL(mfaUri, {
        width: 220,
        margin: 2,
        errorCorrectionLevel: "M",
      })
        .then((dataUrl) => {
          if (active) setMfaQrData({ uri: mfaUri, data: dataUrl })
        })
        .catch(() => {
          if (active) setMfaQrData(null)
        })
    }
    return () => {
      active = false
    }
  }, [mfaUri])
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
    if (mobileNavWasOpen.current && !mobileNavOpen) {
      window.requestAnimationFrame(() => mobileNavTrigger.current?.focus())
    }
    mobileNavWasOpen.current = mobileNavOpen
  }, [mobileNavOpen])
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch("/api/health", {
          cache: "no-store",
          signal: controller.signal,
        })
        if (!response.ok) return
        const body = (await response.json()) as { deployment_type?: unknown }
        if (
          body.deployment_type === "community" ||
          body.deployment_type === "hosted"
        )
          setDeploymentType(body.deployment_type)
      } catch {
        /* Login remains available when deployment metadata is unavailable. */
      }
    })()
    return () => controller.abort()
  }, [])
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    const token = fragment.get("setup")
    if (token) {
      setSetupToken(token)
      setSetupTokenFromFragment(true)
      history.replaceState(
        history.state,
        "",
        `${location.pathname}${location.search}`
      )
    }
  }, [])
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
  useEffect(() => {
    if (authState !== "signed-in" || view !== "Overview") return
    if (activityRange === "custom" && (!customStart || !customEnd)) return
    const controller = new AbortController()
    const params = new URLSearchParams({ range: activityRange })
    if (activityRange === "custom") {
      params.set("from", customStart)
      params.set("to", customEnd)
    }
    void (async () => {
      try {
        const response = await fetch(`/api/console/activity?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        })
        const body = (await response.json()) as OverviewActivity & ApiResponse
        if (!response.ok)
          throw new Error(
            body.error?.message || "Activity could not be loaded."
          )
        setActivityData(body)
        setActivityError("")
      } catch (reason) {
        if (!controller.signal.aborted)
          setActivityError(
            reason instanceof Error
              ? reason.message
              : "Activity could not be loaded."
          )
      }
    })()
    return () => controller.abort()
  }, [authState, view, activityRange, customStart, customEnd])
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
    setAuthNotice("")
    setAuthErrorDetails(null)
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: authEmail.trim(),
          password: authPassword,
        }),
      })
      const body = (await response.json()) as ApiResponse & {
        role?: string
        tenant_id?: string
        stage?: string
        secret?: string
        otpauth_url?: string
        authenticated?: boolean
        access_status?: string
      }
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
  async function claimOwnerSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAuthBusy(true)
    setAuthError("")
    setAuthErrorDetails(null)
    if (setupPassword !== setupPasswordConfirm) {
      setAuthError("The passwords do not match.")
      setAuthBusy(false)
      return
    }
    if (setupPassword.length < 12) {
      setAuthError("Choose a password with at least 12 characters.")
      setAuthBusy(false)
      return
    }
    if (!setupToken) {
      setAuthError(
        "Open the one-time setup link from your installer, then try again."
      )
      setAuthBusy(false)
      return
    }
    try {
      const response = await fetch("/api/auth/setup/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: setupToken,
          email: authEmail.trim(),
          password: setupPassword,
        }),
      })
      const body = (await response.json()) as ApiResponse & {
        stage?: string
        email?: string
        secret?: string
        otpauth_url?: string
      }
      if (!response.ok) {
        setApiAuthError(response, body, "Owner setup could not be completed.")
        return
      }
      if (body.stage !== "enroll" || !body.secret || !body.otpauth_url) {
        throw new Error(
          "Setup response did not include the authenticator step. Contact your installer administrator."
        )
      }
      setSetupToken("")
      setSetupPassword("")
      setSetupPasswordConfirm("")
      setAuthEmail(
        typeof body.email === "string" ? body.email : authEmail.trim()
      )
      setAuthRole("owner")
      setAuthTenantId("")
      setMfaSecret(body.secret)
      setMfaUri(body.otpauth_url)
      setAuthState("enroll")
    } catch (reason) {
      setAuthError(
        reason instanceof Error
          ? reason.message
          : "Owner setup could not be completed."
      )
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
          ? authRole === "merchant"
            ? "/api/auth/merchant/mfa/enroll"
            : "/api/auth/mfa/enroll"
          : authRole === "merchant"
            ? "/api/auth/merchant/mfa/verify"
            : "/api/auth/mfa/verify",
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
      const body = (await response.json()) as ApiResponse & {
        recovery_codes?: unknown
      }
      if (!response.ok) {
        setApiAuthError(response, body, "Code was not accepted.")
        return
      }
      setMfaCode("")
      if (enrolling) {
        const codes = Array.isArray(body.recovery_codes)
          ? body.recovery_codes.filter(
              (code): code is string => typeof code === "string"
            )
          : []
        if (!codes.length)
          throw new Error("Recovery codes were not returned. Contact support.")
        setMfaSecret("")
        setMfaUri("")
        recoveryPending.current = true
        setRecoveryCodes(codes)
        setAuthState("recovery")
      } else {
        await checkSession()
      }
    } catch (reason) {
      setAuthError(
        reason instanceof Error ? reason.message : "Code was not accepted."
      )
    } finally {
      setAuthBusy(false)
    }
  }
  function finishRecoverySetup() {
    recoveryPending.current = false
    setRecoveryCodes([])
    void checkSession()
  }
  function finishPasswordChange() {
    setPasswordChangeRequired(false)
    setData(null)
    setAuthError("")
    setAuthNotice(
      "Password updated. Sign in with your new password to continue."
    )
    setAuthState("signed-out")
  }
  async function logout() {
    setAuthBusy(true)
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" })
      const body = (await response.json()) as ApiResponse
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
  async function action<T = ApiResponse>(
    action: string,
    payload: unknown
  ): Promise<T> {
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
  async function setArchivedRecord(
    kind: "products" | "payments",
    id: string,
    archived: boolean
  ) {
    if (
      archived &&
      !window.confirm(
        "Archive this record? It will be hidden from the default list. Its ledger, refunds, and event history remain unchanged."
      )
    )
      return
    setBusy(true)
    try {
      const response = await fetch(
        `/api/console/${kind}/${encodeURIComponent(id)}`,
        {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
        }
      )
      const body = (await response.json()) as ApiResponse
      if (!response.ok)
        throw new Error(
          body.error?.message || "The record could not be updated."
        )
      toast.success(
        archived
          ? "Record archived. Financial history is unchanged."
          : "Record restored."
      )
      await load(showArchived)
    } catch (reason) {
      toast.error(
        reason instanceof Error
          ? reason.message
          : "The record could not be updated."
      )
    } finally {
      setBusy(false)
    }
  }
  const salesData = data as
    | (Omit<Snapshot, "quotes" | "orders" | "customers" | "fulfillments"> & {
        quotes?: SalesQuote[]
        orders?: SalesOrder[]
        customers?: SalesCustomer[]
        fulfillments?: Array<{
          id: string
          order_id: string
          status: string
          claimed_by?: string | null
        }>
      })
    | null
  const salesQuotes = salesData?.quotes || []
  const salesOrders = salesData?.orders || []
  const salesCustomers = salesData?.customers || []
  const fulfillments = salesData?.fulfillments || []
  async function createQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSalesBusy(true)
    setSalesError("")
    try {
      const customer = {
        name: String(form.get("customer_name") || "").trim(),
        email: String(form.get("customer_email") || "").trim() || undefined,
      }
      const expiryChoice = String(form.get("expires_in_seconds") || "604800")
      const expiresAt =
        editingQuote && expiryChoice === "keep"
          ? editingQuote.expires_at
          : new Date(Date.now() + Number(expiryChoice) * 1000).toISOString()
      const quote = editingQuote
        ? await action<SalesQuote>("update_quote", {
            quote_id: editingQuote.id,
            expected_version: editingQuote.version,
            customer,
            ...(quoteLines.length !== editingQuote.items.length ||
            quoteLines.some(
              (line, index) =>
                line.product_id !== editingQuote.items[index]?.product_id ||
                line.quantity !== editingQuote.items[index]?.quantity
            )
              ? { items: quoteLines }
              : {}),
            ...(Math.round(
              Number(form.get("discount_amount") || 0) * 100
            ) !== editingQuote.discount_amount
              ? {
                  discount_amount: Math.round(
                    Number(form.get("discount_amount") || 0) * 100
                  ),
                }
              : {}),
            ...(expiryChoice === "keep" ? {} : { expires_at: expiresAt }),
          })
        : await action<SalesQuote>("create_quote", {
            customer,
            items: quoteLines,
            expires_at: expiresAt,
            discount_amount: Math.round(
              Number(form.get("discount_amount") || 0) * 100
            ),
          })
      setSelectedQuote(
        editingQuote
          ? {
              ...quote,
              quote_url: editingQuote.quote_url,
              quote_link_available: editingQuote.quote_link_available,
            }
          : quote
      )
      setEditingQuote(null)
      setDialog(null)
      setQuoteLines([])
      toast.success(editingQuote ? "Quote updated" : "Quote created")
    } catch (reason) {
      setSalesError(
        reason instanceof Error ? reason.message : "Quote could not be created."
      )
    } finally {
      setSalesBusy(false)
    }
  }
  async function updateFulfillment(
    actionName: "claim_fulfillment" | "complete_fulfillment" | "fail_fulfillment" | "retry_fulfillment",
    fulfillment_id: string
  ) {
    setSalesBusy(true)
    setSalesError("")
    try {
      await action(actionName, { id: fulfillment_id })
      toast.success({
        claim_fulfillment: "Fulfillment claimed",
        complete_fulfillment: "Fulfillment marked complete",
        fail_fulfillment: "Fulfillment marked failed",
        retry_fulfillment: "Fulfillment returned to ready",
      }[actionName])
    } catch (reason) {
      setSalesError(
        reason instanceof Error
          ? reason.message
          : "Fulfillment could not be updated."
      )
    } finally {
      setSalesBusy(false)
    }
  }
  function toggleArchivedView() {
    const next = !showArchived
    setShowArchived(next)
    setFilter(next ? "archived" : "all")
    void load(next)
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
      const response = await fetch(
        `/api/merchants/${encodeURIComponent(tenantId)}/stripe/connect`,
        {
        method: "POST",
        cache: "no-store",
        }
      )
      const raw = await response.text()
      let body: ApiResponse & { authorize_url?: string }
      try {
        body = parseApiResponse(raw)
      } catch {
        throw new Error(
          `Provider API returned ${response.status}. Please retry.`
        )
      }
      if (!response.ok)
        throw new Error(
          body.error?.message || "Stripe connection could not be started."
        )
      const authorize = new URL(body.authorize_url || "")
      if (
        authorize.protocol !== "https:" ||
        authorize.hostname !== "connect.stripe.com"
      ) {
        throw new Error(
          "The provider returned an unexpected authorization URL. Contact support."
        )
      }
      window.location.assign(authorize.toString())
    } catch (reason) {
      toast.error(
        reason instanceof Error
          ? reason.message
          : "Stripe connection could not be started."
      )
      setProviderBusyTenant("")
    }
  }
  async function disconnectTenant(
    tenantId: string,
    businessName = "this merchant"
  ) {
    if (
      !window.confirm(
        `Disconnect Stripe from ${businessName}? This revokes its API keys and stops new payments.`
      )
    )
      return
    setProviderBusyTenant(tenantId)
    try {
      const response = await fetch(
        `/api/merchants/${encodeURIComponent(tenantId)}/stripe/connect`,
        {
        method: "DELETE",
        cache: "no-store",
        }
      )
      const raw = await response.text()
      let body: ApiResponse
      try {
        body = parseApiResponse(raw)
      } catch {
        throw new Error(
          `Provider API returned ${response.status}. Please retry.`
        )
      }
      if (!response.ok)
        throw new Error(
          body.error?.message || "Stripe could not be disconnected."
        )
      toast.success(
        "Stripe disconnected. New payments are disabled and tenant API keys were revoked."
      )
      await load()
      setProviderRefresh((current) => current + 1)
    } catch (reason) {
      toast.error(
        reason instanceof Error
          ? reason.message
          : "Stripe could not be disconnected."
      )
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
    fetch(`/api/merchants/${encodeURIComponent(authTenantId)}/stripe/connect`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const body = (await response.json()) as ApiResponse & {
          mode?: unknown
          status?: unknown
          charges_enabled?: unknown
          provider?: unknown
        }
        if (!response.ok)
          throw new Error(
            body.error?.message || "Unable to load Stripe connection status."
          )
        if (
          body.provider !== "stripe" ||
          !isProviderMode(body.mode) ||
          !isProviderStatus(body.status)
        ) {
          throw new Error(
            "The Stripe connection status response was incomplete."
          )
        }
        if (active)
          setMerchantProvider({
            provider: "stripe",
            mode: body.mode,
            status: body.status,
            charges_enabled: body.charges_enabled === true,
          })
      })
      .catch((reason) => {
        if (active)
          setMerchantProviderError(
            reason instanceof Error
              ? reason.message
              : "Unable to load Stripe connection status."
          )
      })
    return () => {
      active = false
    }
  }, [authRole, authState, authTenantId, providerRefresh])
  useEffect(() => {
    const url = new URL(window.location.href)
    const result = url.searchParams.get("stripe_connect")
    if (!result) return
    url.searchParams.delete("stripe_connect")
    window.history.replaceState(null, "", `${url.pathname}${url.search}`)
    if (result === "connected") {
      toast.success(
        "Stripe connection saved. Payment eligibility is checked when you create a payment."
      )
    } else {
      toast.error(
        "Stripe connection was not completed. You can try again from this page."
      )
    }
    setProviderRefresh((current) => current + 1)
    void load()
  }, [load])
  async function inviteMerchant(registration: Registration) {
    setInviteBusyTenant(registration.tenant_id)
    try {
      const result = await action("create_invite", {
        tenant_id: registration.tenant_id,
      })
      if (
        typeof result.invite_url !== "string" ||
        typeof result.expires_at !== "string"
      ) {
        throw new Error("The invite response was incomplete. Please retry.")
      }
      setMerchantInvite({
        business_name: registration.business_name,
        email:
          typeof result.email === "string" ? result.email : registration.email,
        invite_url: result.invite_url,
        expires_at: result.expires_at,
      })
    } catch (reason) {
      toast.error(
        reason instanceof Error
          ? reason.message
          : "Merchant invite could not be created."
      )
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
    const blob = new Blob(
      [`Agora recovery codes\n\n${recoveryCodes.join("\n")}\n`],
      { type: "text/plain" }
    )
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
  const activity = activityData
  const volume = activity?.gross_amount
  const refunded = activity?.refunded_amount
  const filtered =
    data?.payments.filter(
      (p) =>
        (filter === "archived"
          ? Boolean(p.archived_at)
          : !p.archived_at &&
            (filter === "all" ||
              (filter === "refunded"
                ? p.refunded > 0
                : p.status === filter))) &&
        `${p.customer} ${p.product_name} ${p.id}`
          .toLowerCase()
          .includes(query.toLowerCase())
    ) || []
  const selectedCurrent = selected
    ? data?.payments.find((p) => p.id === selected.id) || selected
    : null
  const merchantCheckoutReady =
    authRole !== "merchant" ||
    data?.provider_status === "sandbox" ||
    Boolean(
      merchantProvider?.status === "connected" &&
      merchantProvider.charges_enabled &&
      merchantProvider.mode === data?.provider_mode
    )
  const checkoutAvailable =
    data?.checkout_enabled === true && merchantCheckoutReady
  const keyIssuanceAvailable =
    data?.provider_status === "sandbox" || data?.provider_status === "ready"
  const keyIssuanceUnavailableMessage =
    "API key issuance is unavailable until the workspace owner finishes provider setup. No key was created."
  const checkoutUnavailableMessage =
    data?.provider_status === "setup_required"
    ? "Checkout setup is required. Payment creation is disabled until the workspace owner configures the required Stripe credentials and verified webhook. No simulator fallback is active."
    : authRole === "merchant" && !merchantCheckoutReady
      ? "This merchant’s Stripe account is not connected and verified in the active mode. Connect it before creating a payment."
      : "Payment creation is disabled because provider readiness has not been confirmed. Ask the workspace owner to check setup."
  let cumulative = 0
  const volumeSeries = (activity?.daily || []).map((day) => {
    const dateUtc = new Date(day.date)
    return {
      day: dateUtc,
      label: activityLabel(day.date, activity?.bucket_seconds),
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
    cli: `# Run once after creating a scoped API key. The key is entered at a hidden prompt.\nagora auth login --url ${typeof location !== "undefined" ? location.origin : "https://agora.example.com"}\n\nagora products list\nagora payments create \\\n  --product ${data?.products[0]?.id || "prod_studio"} \\\n  --idempotency-key order-001\n\nagora payments reconcile --id pay_…\n\n# Install (Node.js 20.9+; authenticate with gh first):\n(set -o pipefail; gh api repos/pkyanam/agora-cli/contents/install.sh -H 'Accept: application/vnd.github.raw+json' | bash)`,
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
        <span className="avatar" aria-hidden="true">
          A
        </span>
        <div className="workspace-copy">
          {authRole === "merchant"
            ? "Merchant"
            : data?.deployment_type === "community"
              ? "Agora"
              : "Belweave"}
          <small>Workspace</small>
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
              <span
                className="nav-count"
                aria-label={`${pending.length} pending approvals`}
              >
                {pending.length}
              </span>
            )}
          </a>
        ))}
      </nav>
      <div className="sidebar-bottom">
        {mobile ? (
          <span
            className="sandbox-mark"
            role="note"
            aria-label={
              data?.provider_status === "setup_required"
                ? "Payment setup required"
                : data?.provider_status === "sandbox"
                  ? "Test mode"
                  : data?.mode === "stripe"
                    ? `Stripe ${data.provider_mode || "mode unavailable"}`
                    : "Provider mode unavailable"
            }
          >
            {data?.provider_status === "setup_required"
              ? "Setup required"
              : data?.provider_status === "sandbox"
                ? "Test mode"
                : data?.mode === "stripe"
                  ? data.provider_mode
                    ? `Stripe ${data.provider_mode}`
                    : "Mode unavailable"
                  : "Mode unavailable"}
          </span>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className="sandbox-mark"
                  tabIndex={0}
                  role="note"
                  aria-label={
                    data?.provider_status === "setup_required"
                      ? "Payment setup required"
                      : data?.provider_status === "sandbox"
                        ? "Test mode"
                        : data?.mode === "stripe"
                          ? `Stripe ${data.provider_mode || "mode unavailable"}`
                          : "Provider mode unavailable"
                  }
                />
              }
            >
              {data?.provider_status === "setup_required"
                ? "Setup required"
                : data?.provider_status === "sandbox"
                  ? "Test mode"
                  : data?.mode === "stripe"
                    ? data.provider_mode
                      ? `Stripe ${data.provider_mode}`
                      : "Mode unavailable"
                    : "Mode unavailable"}
            </TooltipTrigger>
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
        )}
        <a
          className="quiet-link"
          href="/api-reference"
          aria-label="API reference"
        >
          <span className="quiet-link-label">API reference</span>
          <HugeiconsIcon
            icon={ArrowUpRight01Icon}
            size={13}
            aria-hidden="true"
          />
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
  if (authState === "setup") {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="owner-setup-title">
          <Link className="wordmark" href="/" aria-label="Agora home">
            agora<span>·</span>
          </Link>
          <h1 id="owner-setup-title">Set up your Agora workspace</h1>
          <p>
            Create the owner account for this installation, then secure it with
            an authenticator app.
          </p>
          {setupLinkExpired ? (
            <p role="status">
              The setup link expired. On the host, run{" "}
              <code>node current/scripts/reset-owner-setup.mjs</code> from the
              Agora install directory, then open the replacement link saved in
              the private credentials file.
            </p>
          ) : (
            !setupToken && (
              <p role="status">
                Open the one-time setup link printed by the installer. Its token
                is only accepted once.
              </p>
            )
          )}
          <form className="form-stack" onSubmit={claimOwnerSetup}>
            <div className="field">
              <Label htmlFor="setup-email">Owner email</Label>
              <Input
                id="setup-email"
                name="email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={254}
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                aria-invalid={authError ? true : undefined}
                aria-describedby={authError ? "auth-error" : undefined}
                required
                autoFocus
                disabled={authBusy}
              />
            </div>
            {!setupTokenFromFragment && (
              <div className="field">
              <Label htmlFor="setup-token">One-time setup token</Label>
                <Input
                  id="setup-token"
                  name="setup_token"
                  type="password"
                  autoComplete="off"
                  maxLength={256}
                  value={setupToken}
                  onChange={(event) => setSetupToken(event.target.value.trim())}
                  aria-invalid={authError ? true : undefined}
                  aria-describedby={
                    authError ? "auth-error" : "setup-token-help"
                  }
                  required
                  disabled={authBusy}
                />
                <small id="setup-token-help">
                  Paste the token from the private setup link printed by the
                  installer.
                </small>
              </div>
            )}
            <div className="field">
              <Label htmlFor="setup-password">Password</Label>
              <Input
                id="setup-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                value={setupPassword}
                onChange={(event) => setSetupPassword(event.target.value)}
                aria-invalid={authError ? true : undefined}
                aria-describedby={
                  authError ? "auth-error" : "setup-password-requirements"
                }
                required
                disabled={authBusy}
              />
            </div>
            <div className="field">
              <Label htmlFor="setup-password-confirm">Confirm password</Label>
              <Input
                id="setup-password-confirm"
                name="password_confirmation"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                value={setupPasswordConfirm}
                onChange={(event) =>
                  setSetupPasswordConfirm(event.target.value)
                }
                aria-invalid={authError ? true : undefined}
                aria-describedby={
                  authError ? "auth-error" : "setup-password-requirements"
                }
                required
                disabled={authBusy}
              />
              <small id="setup-password-requirements">
                Use at least 12 characters. You will set up MFA next.
              </small>
            </div>
            {renderAuthError()}
            <Button
              type="submit"
              disabled={
                authBusy ||
                !setupToken ||
                !authEmail.trim() ||
                !setupPassword ||
                !setupPasswordConfirm
              }
            >
              {authBusy ? "Creating owner account…" : "Create owner account"}
            </Button>
          </form>
        </section>
      </main>
    )
  }
  if (authState === "pending") {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="auth-title">
          <Link className="wordmark" href="/" aria-label="Agora home">
            agora<span>·</span>
          </Link>
          <h1 id="auth-title">Registration pending</h1>
          <p>
            Your account is awaiting approval. Payment data and API access
            remain unavailable until approval is complete.
          </p>
          <p>
            Questions?{" "}
            <a className="inline-link" href="mailto:info@belweave.com">
              info@belweave.com
            </a>
          </p>
          <Button variant="secondary" onClick={logout} disabled={authBusy}>
            Sign out
          </Button>
        </section>
      </main>
    )
  }
  if (authState === "enroll") {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="auth-title">
          <Link className="wordmark" href="/" aria-label="Agora home">
            agora<span>·</span>
          </Link>
          <h1 id="auth-title">Set up an authenticator</h1>
          {mfaSecret ? (
            <>
              <p>
                Scan this QR code with your authenticator app, then enter its
                current six-digit code. The QR is generated in this browser and
                is not sent to another service.
              </p>
              {mfaQrData?.uri === mfaUri ? (
                <div className="mfa-qr-wrap">
                  <Image
                    className="mfa-qr"
                    src={mfaQrData.data}
                    alt="Authenticator setup QR code"
                    width={220}
                    height={220}
                    unoptimized
                  />
                  <span>Scan with your authenticator app</span>
                </div>
              ) : (
                <p className="form-note" role="status">
                  Preparing a private QR code… If it does not appear, use the
                  setup key below.
                </p>
              )}
              <div className="mfa-secret-block">
                <details className="mfa-manual-setup">
                  <summary>Set up manually instead</summary>
                <Label htmlFor="mfa-secret">Setup key</Label>
                  <code id="mfa-secret" className="mfa-secret">
                    {mfaSecret}
                  </code>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void copy(mfaSecret)}
                  >
                    Copy setup key{" "}
                    <HugeiconsIcon icon={Copy01Icon} aria-hidden="true" />
                </Button>
                {mfaUri && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => void copy(mfaUri)}
                    >
                      Copy authenticator setup URI{" "}
                      <HugeiconsIcon icon={Copy01Icon} aria-hidden="true" />
                  </Button>
                )}
                </details>
              </div>
              <form className="form-stack" onSubmit={submitMfa}>
                <div className="field">
                  <Label htmlFor="mfa-code">Authenticator code</Label>
                  <Input
                    id="mfa-code"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    minLength={6}
                    maxLength={6}
                    value={mfaCode}
                    onChange={(event) =>
                      setMfaCode(
                        event.target.value.replace(/\D/g, "").slice(0, 6)
                      )
                    }
                    aria-invalid={authError ? true : undefined}
                    aria-describedby={authError ? "auth-error" : undefined}
                    required
                    autoFocus
                  />
                </div>
                {renderAuthError()}
                <Button
                  type="submit"
                  disabled={authBusy || mfaCode.length !== 6}
                >
                  {authBusy ? "Verifying…" : "Verify and finish setup"}
                </Button>
              </form>
            </>
          ) : (
            <>
              <p>
                Sign in again to retrieve the unfinished authenticator setup.
              </p>
              <Button onClick={logout} disabled={authBusy}>
                Sign out
              </Button>
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
          <Link className="wordmark" href="/" aria-label="Agora home">
            agora<span>·</span>
          </Link>
          <h1 id="auth-title">Verify your identity</h1>
          <p>
            Enter a code from your authenticator app
            {useRecoveryCode ? " or recovery list" : ""}.
          </p>
          <form className="form-stack" onSubmit={submitMfa}>
            <div className="field">
              <Label htmlFor="mfa-code">
                {useRecoveryCode ? "Recovery code" : "Authenticator code"}
              </Label>
              <Input
                id="mfa-code"
                name="code"
                type="text"
                inputMode={useRecoveryCode ? "text" : "numeric"}
                autoComplete={useRecoveryCode ? "off" : "one-time-code"}
                maxLength={useRecoveryCode ? 32 : 6}
                value={mfaCode}
                onChange={(event) =>
                  setMfaCode(
                    event.target.value.trim().slice(0, useRecoveryCode ? 32 : 6)
                  )
                }
                aria-invalid={authError ? true : undefined}
                aria-describedby={authError ? "auth-error" : undefined}
                required
                autoFocus
              />
            </div>
            {renderAuthError()}
            <Button type="submit" disabled={authBusy || !mfaCode.trim()}>
              {authBusy ? "Verifying…" : "Verify and sign in"}
            </Button>
          </form>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setUseRecoveryCode((value) => !value)
              setMfaCode("")
              setAuthError("")
            }}
          >
            {useRecoveryCode
              ? "Use an authenticator code"
              : "Use a recovery code"}
          </button>
          <Button variant="ghost" onClick={logout} disabled={authBusy}>
            Sign out
          </Button>
        </section>
      </main>
    )
  }
  if (authState === "recovery") {
    return (
      <main className="auth-page">
        <section
          className="auth-card recovery-card"
          aria-labelledby="auth-title"
        >
          <Link className="wordmark" href="/" aria-label="Agora home">
            agora<span>·</span>
          </Link>
          <h1 id="auth-title">Save your recovery codes</h1>
          <p>
            Each code works once. Store these somewhere private; they will not
            be shown again.
          </p>
          <ul
            className="recovery-code-list"
            aria-label="One-time recovery codes"
          >
            {recoveryCodes.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ul>
          <Button variant="secondary" onClick={downloadRecoveryCodes}>
            Download codes
          </Button>
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
          {authNotice && <p role="status">{authNotice}</p>}
          <p className="auth-account">
            {deploymentType === "community"
              ? "Workspace owner account"
              : deploymentType === "hosted"
                ? "Owner and merchant accounts"
                : "Account access"}
          </p>
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
          {deploymentType === "hosted" && (
            <p className="auth-register">
              New merchant?{" "}
              <a className="inline-link" href="/register">
                Request access
              </a>
            </p>
          )}
          <p className="support-note">
            Support:{" "}
            <a className="inline-link" href="mailto:info@belweave.com">
              info@belweave.com
            </a>
          </p>
        </section>
      </main>
    )
  }
  if (
    authState === "signed-in" &&
    authRole === "owner" &&
    passwordChangeRequired
  ) {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="password-change-title">
          <Link className="wordmark" href="/" aria-label="Agora home">
            agora<span>·</span>
          </Link>
          <h1 id="password-change-title">Choose your password</h1>
          <p>
            Your temporary bootstrap password got you started. Set a private
            password to continue into Agora.
          </p>
          <PasswordChangeForm required onChanged={finishPasswordChange} />
          <Button variant="ghost" onClick={logout} disabled={authBusy}>
            Sign out
          </Button>
        </section>
      </main>
    )
  }
  return (
    <TooltipProvider>
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <div
          className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
        >
        {renderSidebar()}
        <main className="main">
          <header className="topbar">
            <div className="topbar-location">
              <button
                type="button"
                className="sidebar-toggle desktop-sidebar-toggle"
                  aria-label={
                    sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
                  }
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
                    ref={mobileNavTrigger}
                    aria-label="Open navigation"
                    aria-controls="mobile-navigation"
                    aria-expanded={mobileNavOpen}
                  />
                }
              >
                <span aria-hidden="true">☰</span>
              </SheetTrigger>
              <span>
                  Workspace <span className="breadcrumb-slash">/</span>{" "}
                  <b>{view}</b>
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
              <section
                className="error-state"
                role="alert"
                aria-live="assertive"
              >
              <h1>Let’s reconnect.</h1>
              <p>{error}</p>
              <Button onClick={() => void load()}>Try again</Button>
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
                  <section
                    className="merchant-provider-panel provider-setup-alert"
                    aria-labelledby="provider-setup-title"
                  >
                  <div>
                    <h2 id="provider-setup-title">Checkout setup required</h2>
                    <p>
                        Payments are paused until this deployment connects
                        Stripe and verifies a signed webhook. Configure Stripe
                        to continue.
                    </p>
                  </div>
                    {authRole === "owner" && (
                      <Button onClick={() => navigate("Settings")}>
                        Configure Stripe
                      </Button>
                    )}
                </section>
              )}
              {view === "Settings" && (
                <>
                    <section className="page-heading">
                      <div>
                        <h1>Settings</h1>
                        <p>
                          Manage account security and connect Stripe for this
                          Agora deployment.
                        </p>
                      </div>
                    </section>
                    {authRole === "owner" ? (
                      <>
                        <section
                          className="settings-panel"
                          aria-labelledby="security-settings-title"
                        >
                          <div>
                            <h2 id="security-settings-title">Security</h2>
                            <p>
                              Change the password used with your authenticator
                              to sign in.
                            </p>
                          </div>
                          <PasswordChangeForm
                            onChanged={finishPasswordChange}
                          />
                    </section>
                    <StripeSetup onChange={() => void load()} />
                        <InstallationPanel
                          version={data.current_version}
                          target={data.deployment_target}
                          hosting={data.deployment_hosting}
                        />
                      </>
                    ) : (
                      <p role="status">
                        Only the workspace owner can change workspace settings.
                      </p>
                    )}
                </>
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
                    <div
                      className="activity-range-controls"
                      role="group"
                      aria-label="Payment activity time range"
                    >
                      {(
                        [
                          ["1h", "1 hour"],
                          ["24h", "24 hours"],
                          ["7d", "7 days"],
                          ["30d", "30 days"],
                          ["90d", "90 days"],
                          ["1y", "1 year"],
                          ["all", "All time"],
                          ["custom", "Custom"],
                        ] as const
                      ).map(([value, label]) => (
                        <Button
                          key={value}
                          type="button"
                          size="sm"
                          variant={
                            activityRange === value ? "secondary" : "ghost"
                          }
                          aria-pressed={activityRange === value}
                          onClick={() => setActivityRange(value)}
                        >
                          {label}
                        </Button>
                    ))}
                      {activityRange === "custom" && (
                        <span className="activity-custom-range">
                          <Label htmlFor="activity-from">From</Label>
                          <Input
                            id="activity-from"
                            type="date"
                            value={customStart}
                            onChange={(event) =>
                              setCustomStart(event.target.value)
                            }
                          />
                          <Label htmlFor="activity-to">To</Label>
                          <Input
                            id="activity-to"
                            type="date"
                            value={customEnd}
                            onChange={(event) =>
                              setCustomEnd(event.target.value)
                            }
                          />
                        </span>
                      )}
                  </div>
                    <p className="subtle activity-timezone-note">
                      All time boundaries use UTC. Archived transactions stay in
                      financial totals.
                    </p>
                    {activityError && (
                      <p className="form-note" role="status">
                        {activityError}
                      </p>
                    )}
                  <section className="overview-volume">
                    <div>
                      <div className="section-label">
                          Gross processed{" "}
                          <span>
                            Successful payments created ·{" "}
                            {activityRange === "custom"
                              ? `${customStart} to ${customEnd}`
                              : activityRange === "all"
                                ? "all time"
                                : `last ${activityRange}`}{" "}
                            · UTC · before provider fees
                          </span>
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
                          {activity?.successful_payments ?? "Unavailable"}{" "}
                          successful payments{" "}
                        <span className="inline-dot">·</span> UTC
                      </p>
                      {!activity ? (
                          <p className="chart-empty" role="status">
                            Payment activity is unavailable.
                          </p>
                        ) : volumeSeries.some((day) => day.amount > 0) ? (
                          <div className="volume-chart">
                        <AreaChart
                          data={volumeSeries}
                          config={{
                                total: {
                                  label: "Gross processed amount",
                                  color: "grey",
                                },
                          }}
                          ariaLabel={`Cumulative gross amount from successful payments created for ${activityRange} in UTC, before provider fees. Exact bucket counts, amounts, and refunds attributed to those payments are available in the accessible table after the chart.`}
                          animate={false}
                          bloom="off"
                          className="dither-area-chart"
                              margins={{
                                top: 12,
                                right: 8,
                                bottom: 28,
                                left: 64,
                              }}
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
                        ) : (
                          <p className="chart-empty">
                            No successful payments were created in this period.
                          </p>
                        )}
                      <div className="accessible-chart-data">
                      <table>
                        <caption>
                              Successful payments created for the selected UTC
                              time range. Refunds are attributed to the date the
                              payment was created.
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
                                    {activityAccessibleLabel(
                                      day.day.toISOString(),
                                      activity?.bucket_seconds
                                    )}
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
                        <strong>
                          {volume === undefined || refunded === undefined
                            ? "Unavailable"
                            : money(volume - refunded)}
                        </strong>
                    </div>
                    <div>
                      <span>Refunded on these payments</span>
                        <strong>
                          {refunded === undefined
                            ? "Unavailable"
                            : money(refunded)}
                        </strong>
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
                    {authRole === "owner" && (
                      <RiskSignals
                        key={data.provider_mode || "test"}
                        preferredMode={data.provider_mode}
                      />
                    )}
                  <p className="subtle finance-note">
                      These totals do not include provider fees or payout timing
                      and are not an available bank balance.
                  </p>
                  <section className="recent">
                    <div className="section-heading">
                      <h2>Recent payments</h2>
                      <Button
                        variant="ghost"
                        onClick={() => navigate("Payments")}
                      >
                          All payments{" "}
                          <HugeiconsIcon icon={ArrowUpRight01Icon} />
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
                    <div className="button-row">
                        <Button
                          variant="secondary"
                          onClick={toggleArchivedView}
                        >
                          {showArchived ? "Hide archived" : "Show archived"}
                        </Button>
                      <Button onClick={() => openPayment()}>
                        <HugeiconsIcon icon={PlusSignIcon} />
                        Create payment
                      </Button>
                    </div>
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
                          ...(showArchived ? ["archived"] : []),
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
                        <Button
                          variant="secondary"
                          onClick={() => openPayment()}
                        >
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
                    <div className="button-row">
                        <Button
                          variant="secondary"
                          onClick={toggleArchivedView}
                        >
                          {showArchived ? "Hide archived" : "Show archived"}
                        </Button>
                      <Button onClick={() => setDialog("product")}>
                        <HugeiconsIcon icon={PlusSignIcon} />
                        New product
                      </Button>
                    </div>
                  </section>
                  <div className="catalog-grid">
                    {data.products.map((p) => (
                        <article
                          key={p.id}
                          className={`product-item${p.archived_at ? "product-item-archived" : ""}`}
                        >
                        <code className="product-id">{p.id}</code>
                        <h2>{p.name}</h2>
                          {p.archived_at && (
                            <span className="archived-label">Archived</span>
                          )}
                        <p>{p.description || "No description"}</p>
                        <div className="product-price">
                          {money(p.amount)}
                            <span>
                              USD · one time · v
                              {(p as typeof p & { version?: number }).version ??
                                1}
                            </span>
                        </div>
                        <div className="product-actions">
                            <Button
                              variant="secondary"
                              disabled={Boolean(p.archived_at) || busy}
                              onClick={() => {
                                setEditingProduct(
                                  p as typeof p & { version?: number }
                                )
                                setDialog("product")
                              }}
                            >
                              Edit
                            </Button>
                          <Button
                            variant="secondary"
                            disabled={Boolean(p.archived_at)}
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
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                void setArchivedRecord(
                                  "products",
                                  p.id,
                                  !p.archived_at
                                )
                              }
                            >
                              {p.archived_at ? "Restore" : "Archive"}
                            </Button>
                          </div>
                        </article>
                      ))}
                    </div>
                    <p className="catalog-note">
                      Prices are fixed to keep every payment explainable. Create
                      a new product for a new price.
                    </p>
                  </>
                )}
                {view === "Orders" && (
                  <>
                    <section className="page-heading">
                      <div>
                        <h1>Orders</h1>
                        <p>
                          Quotes, customer orders, and payment-confirmed
                          fulfillment.
                        </p>
                      </div>
                      {salesTab === "quotes" && (
                        <Button
                          onClick={() => {
                            setQuoteLines(
                              data.products
                                .filter((p) => !p.archived_at)
                                .slice(0, 1)
                                .map((p) => ({ product_id: p.id, quantity: 1 }))
                            )
                            setDialog("quote")
                          }}
                          disabled={!data.products.some((p) => !p.archived_at)}
                        >
                          <HugeiconsIcon icon={PlusSignIcon} />
                          New quote
                        </Button>
                      )}
                    </section>
                    <Tabs
                      value={salesTab}
                      onValueChange={(value) =>
                        setSalesTab(value as typeof salesTab)
                      }
                    >
                      <TabsList variant="line">
                        <TabsTrigger value="orders">Orders</TabsTrigger>
                        <TabsTrigger value="quotes">Quotes</TabsTrigger>
                        <TabsTrigger value="customers">Customers</TabsTrigger>
                      </TabsList>
                    </Tabs>
                    {salesError && (
                      <p className="form-note" role="alert">
                        {salesError}
                      </p>
                    )}
                    {salesTab === "orders" &&
                      (salesOrders.length ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Order</TableHead>
                              <TableHead>Customer</TableHead>
                              <TableHead>Amount</TableHead>
                              <TableHead>Payment</TableHead>
                              <TableHead>Fulfillment</TableHead>
                              <TableHead>Created</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {salesOrders.map((order) => {
                              const f = fulfillments.find(
                                (x) => x.order_id === order.id
                              )
                              return (
                                <TableRow key={order.id}>
                                  <TableCell>
                                    <code>{order.id}</code>
                                  </TableCell>
                                  <TableCell>{order.customer_name}</TableCell>
                                  <TableCell>
                                    <div>{money(order.total_amount)}</div>
                                    {!!order.refunded_amount && (
                                      <small className="text-muted-foreground">
                                        Refunded {money(order.refunded_amount)}
                                        {order.net_amount !== undefined &&
                                          ` · net ${money(order.net_amount)}`}
                                      </small>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="secondary">
                                      {order.payment_status === "refunded"
                                        ? "Refunded"
                                        : order.payment_status === "partially_refunded"
                                          ? "Partially refunded"
                                          : order.status === "paid"
                                        ? "Paid"
                                        : order.status === "awaiting_payment"
                                          ? "Awaiting payment"
                                          : order.status}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    {f ? (
                                      <div className="product-actions">
                                        <Badge variant="secondary">
                                          {f.status.replaceAll("_", " ")}
                                        </Badge>
                                        {f.status === "ready" && (
                                          <Button
                                            size="sm"
                                            variant="secondary"
                                            disabled={salesBusy}
                                            onClick={() =>
                                              void updateFulfillment(
                                                "claim_fulfillment",
                                                f.id
                                              )
                                            }
                                          >
                                            Claim
                                          </Button>
                                        )}
                                        {f.status === "claimed" && (
                                          <>
                                            <Button
                                              size="sm"
                                              disabled={salesBusy}
                                              onClick={() => void updateFulfillment("complete_fulfillment", f.id)}
                                            >
                                              Mark delivered
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="secondary"
                                              disabled={salesBusy}
                                              onClick={() => void updateFulfillment("fail_fulfillment", f.id)}
                                            >
                                              Mark failed
                                            </Button>
                                          </>
                                        )}
                                        {f.status === "failed" && order.status === "paid" && (
                                          <Button
                                            size="sm"
                                            variant="secondary"
                                            disabled={salesBusy}
                                            onClick={() => void updateFulfillment("retry_fulfillment", f.id)}
                                          >
                                            Retry fulfillment
                                          </Button>
                                        )}
                                      </div>
                                    ) : (
                                      "—"
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {date(order.created_at)}
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      ) : (
                        <div className="empty-state">
                          <h2>No orders yet.</h2>
                          <p>
                            Accept a quote to create an order. Payment
                            confirmation and fulfillment progress will appear
                            here.
                          </p>
                          <Button
                            variant="secondary"
                            onClick={() => setSalesTab("quotes")}
                          >
                            View quotes
                          </Button>
                        </div>
                      ))}
                    {salesTab === "quotes" && (
                      <>
                        {selectedQuote && (
                          <section className="checkout-result">
                            <strong>Share this quote</strong>
                            <span>
                              {selectedQuote.customer_name} ·{" "}
                              {money(selectedQuote.total_amount)} · expires{" "}
                              {new Date(
                                selectedQuote.expires_at
                              ).toLocaleString()}
                            </span>
                            {selectedQuote.quote_url &&
                            selectedQuote.quote_link_available !== false ? (
                              <>
                                <a
                                  className="checkout-share-link"
                                  href={selectedQuote.quote_url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {selectedQuote.quote_url}
                                </a>
                                <Button
                                  variant="secondary"
                                  onClick={() => copy(selectedQuote.quote_url!)}
                                >
                                  Copy quote link
                                </Button>
                              </>
                            ) : (
                              <>
                                <p role="status">
                                  This older quote has no recoverable customer
                                  link. Create a replacement quote to share with
                                  the customer.
                                </p>
                                <Button variant="secondary" disabled>
                                  Copy quote link unavailable
                                </Button>
                              </>
                            )}
                          </section>
                        )}
                        {salesQuotes.length ? (
                          <div className="catalog-grid">
                            {salesQuotes.map((q) => (
                              <article className="product-item" key={q.id}>
                                <code className="product-id">{q.id}</code>
                                <h2>{q.customer_name || "Quote"}</h2>
                                <p>{q.customer_email || "No email provided"}</p>
                                <div className="product-price">
                                  {money(q.total_amount)}
                                  <span>
                                    {q.currency.toUpperCase()} · expires{" "}
                                    {new Date(q.expires_at).toLocaleString()}
                                  </span>
                                </div>
                                <ul>
                                  {q.items.map((item, i) => (
                                    <li key={`${q.id}-${i}`}>
                                      {item.quantity} × {item.product_name} ·{" "}
                                      {money(item.unit_amount)} each ·{" "}
                                      {money(item.line_total)}
                                      {item.catalog_version
                                        ? ` · v${item.catalog_version}`
                                        : ""}
                                    </li>
                                  ))}
                                </ul>
                                {q.discount_amount > 0 && (
                                  <p>
                                    Subtotal {money(q.subtotal_amount)} ·
                                    Discount −{money(q.discount_amount)}
                                  </p>
                                )}
                                <div className="product-actions">
                                  <Badge variant="secondary">{q.status}</Badge>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    aria-label={`View quote for ${q.customer_name || "customer"}`}
                                    onClick={() => setQuoteDetail(q)}
                                  >
                                    View quote
                                  </Button>
                                </div>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <div className="empty-state">
                            <h2>No quotes yet.</h2>
                            <p>
                              Create a quote with a fixed item and expiry. Share
                              it with the customer so they can review and
                              accept.
                            </p>
                            <Button
                              variant="secondary"
                              onClick={() => setDialog("quote")}
                              disabled={
                                !data.products.some((p) => !p.archived_at)
                              }
                            >
                              Create quote
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                    {salesTab === "customers" &&
                      (salesCustomers.length ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Name</TableHead>
                              <TableHead>Email</TableHead>
                              <TableHead>Orders</TableHead>
                              <TableHead>Net paid</TableHead>
                              <TableHead>Added</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {salesCustomers.map((customer) => {
                              const related = salesOrders.filter(
                                (o) => o.customer_id === customer.id
                              )
                              const paid = related
                                .filter((o) => o.status === "paid")
                                .reduce(
                                  (sum, o) => sum + (o.net_amount ?? o.total_amount),
                                  0
                                )
                              return (
                                <TableRow key={customer.id}>
                                  <TableCell>{customer.name}</TableCell>
                                  <TableCell>{customer.email || "—"}</TableCell>
                                  <TableCell>{related.length}</TableCell>
                                  <TableCell>{money(paid)}</TableCell>
                                  <TableCell>
                                    {date(customer.created_at)}
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      ) : (
                        <div className="empty-state">
                          <h2>No customers yet.</h2>
                          <p>
                            Customer records appear when you create a quote or
                            order.
                          </p>
                          <Button
                            variant="secondary"
                            onClick={() => setSalesTab("quotes")}
                            >
                            Create a quote
                          </Button>
                        </div>
                    ))}
                </>
              )}
              {view === "Agents" && (
                <>
                  <section className="page-heading">
                    <div>
                      <h1>{authRole === "merchant" ? "Access" : "Agents"}</h1>
                        <p>
                          {authRole === "merchant"
                            ? "Provider connection, API keys, and refund approvals."
                            : data.deployment_type === "community"
                              ? "Scoped API keys for your applications and agents."
                              : "Keys, permissions, and approvals."}
                        </p>
                    </div>
                    <Button onClick={() => openKey()}>
                      <HugeiconsIcon icon={PlusSignIcon} />
                      Add agent
                    </Button>
                  </section>
                  {authRole === "merchant" && (
                      <section
                        className="merchant-provider-panel"
                        aria-labelledby="merchant-provider-title"
                      >
                      <div>
                          <h2 id="merchant-provider-title">
                            Stripe connection
                          </h2>
                        {merchantProviderError ? (
                          <p role="alert">{merchantProviderError}</p>
                        ) : merchantProvider ? (
                          <p>
                              {merchantProvider.status === "connected" &&
                              merchantProvider.charges_enabled
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
                          <Button
                            variant="secondary"
                            onClick={() =>
                              setProviderRefresh((current) => current + 1)
                            }
                          >
                            Retry status
                          </Button>
                        ) : merchantProvider &&
                          !(
                            merchantProvider.status === "connected" &&
                            merchantProvider.charges_enabled
                          ) ? (
                          <Button
                            disabled={providerBusyTenant === authTenantId}
                            onClick={() => void connectTenant(authTenantId)}
                          >
                            {providerBusyTenant === authTenantId
                              ? "Opening Stripe…"
                              : merchantProvider.status === "charges_pending"
                                ? "Continue Stripe setup"
                                : "Connect Stripe"}
                        </Button>
                        ) : (
                          merchantProvider?.status === "connected" && (
                            <Button
                              variant="secondary"
                              disabled={providerBusyTenant === authTenantId}
                              onClick={() =>
                                void disconnectTenant(
                                  authTenantId,
                                  "your merchant account"
                                )
                              }
                            >
                          Disconnect Stripe
                        </Button>
                          )
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
                                    toast.success(
                                      "Refund approved and completed"
                                    )
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
                    {data.deployment_type !== "community" &&
                      data.registrations.length > 0 && (
                        <section
                          className="merchant-registrations"
                          aria-labelledby="merchant-registrations-title"
                        >
                      <div className="section-heading">
                            <h2 id="merchant-registrations-title">
                              Merchant access
                            </h2>
                            <span className="subtle">
                              Approval grants API access. Payments also require
                              a connected provider account.
                            </span>
                      </div>
                      <div className="registration-list">
                        {data.registrations.map((registration) => {
                          const tenantHasKey = data.credentials.some(
                                (credential) =>
                                  credential.tenant_id ===
                                    registration.tenant_id &&
                                  !credential.revoked
                          )
                          return (
                                <article
                                  className="registration-row"
                                  key={registration.id}
                                >
                              <div className="registration-info">
                                <h3>{registration.business_name}</h3>
                                    <p>
                                      {registration.owner_name} ·{" "}
                                      <a
                                        className="inline-link"
                                        href={`mailto:${registration.email}`}
                                      >
                                        {registration.email}
                                      </a>
                                    </p>
                                <p className="registration-status">
                                  <span>Status: {registration.status}</span>
                                      <span>
                                        Stripe:{" "}
                                        {registration.provider_status ===
                                        "not_connected"
                                          ? "Not connected"
                                          : registration.provider_status ===
                                              "charges_pending"
                                            ? "Setup in progress"
                                            : registration.provider_status ===
                                                "connected"
                                              ? `Connected${registration.provider_mode ? ` · ${registration.provider_mode === "test" ? "test" : "live"} mode` : ""}`
                                              : "Disconnected"}
                                      </span>
                                </p>
                                {registration.status === "approved" && (
                                  <p className="registration-note">
                                        {registration.provider_status ===
                                          "connected" &&
                                        registration.provider_mode === "live"
                                      ? "Stripe is connected in live mode. Payment eligibility is checked again when each payment is created."
                                          : registration.provider_status ===
                                              "connected"
                                        ? "Stripe is connected in test mode. Live payments remain unavailable until a live provider account is separately verified."
                                            : registration.provider_status ===
                                                "charges_pending"
                                          ? "Stripe setup is incomplete. Payments remain unavailable until the account is verified."
                                      : "API access is approved. Processor payments stay unavailable until the merchant’s Stripe account is connected and verified."}
                                  </p>
                                )}
                                    {registration.review_reason && (
                                      <p className="registration-note">
                                        Review note:{" "}
                                        {registration.review_reason}
                                      </p>
                                    )}
                              </div>
                              <div className="registration-actions">
                                {registration.status === "pending" ? (
                                  <>
                                        <Button
                                          variant="secondary"
                                          disabled={busy}
                                          onClick={() =>
                                            setRegistrationReview({
                                              registration,
                                              decision: "reject",
                                            })
                                          }
                                        >
                                          Reject
                                        </Button>
                                        <Button
                                          disabled={busy}
                                          onClick={() =>
                                            setRegistrationReview({
                                              registration,
                                              decision: "approve",
                                            })
                                          }
                                        >
                                          Approve merchant
                                        </Button>
                                  </>
                                ) : registration.status === "approved" ? (
                                  <>
                                    <Button
                                          variant={
                                            registration.provider_status ===
                                            "connected"
                                              ? "secondary"
                                              : "default"
                                          }
                                          disabled={
                                            providerBusyTenant ===
                                            registration.tenant_id
                                          }
                                          onClick={() =>
                                            registration.provider_status ===
                                            "connected"
                                              ? disconnectTenant(
                                                  registration.tenant_id,
                                                  registration.business_name
                                                )
                                              : connectTenant(
                                                  registration.tenant_id
                                                )
                                          }
                                    >
                                          {providerBusyTenant ===
                                          registration.tenant_id
                                        ? "Working…"
                                            : registration.provider_status ===
                                                "connected"
                                          ? "Disconnect Stripe"
                                              : registration.provider_status ===
                                                  "charges_pending"
                                            ? "Continue Stripe setup"
                                            : "Connect Stripe"}
                                    </Button>
                                        <Button
                                          variant={
                                            tenantHasKey
                                              ? "secondary"
                                              : "default"
                                          }
                                          onClick={() =>
                                            openKey("developer", {
                                              id: registration.tenant_id,
                                              name: registration.business_name,
                                            })
                                          }
                                        >
                                          {tenantHasKey
                                            ? "Issue another API key"
                                            : "Issue API key"}
                                    </Button>
                                    <Button
                                      variant="secondary"
                                          disabled={
                                            inviteBusyTenant ===
                                            registration.tenant_id
                                          }
                                          onClick={() =>
                                            void inviteMerchant(registration)
                                          }
                                    >
                                          {inviteBusyTenant ===
                                          registration.tenant_id
                                            ? "Creating invite…"
                                            : "Create merchant invite"}
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
                              <p>
                                Key mode:{" "}
                                {keyModeLabel(k.provider_mode ?? "sandbox")}
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
                                  {money(
                                    Math.max(0, k.refund_budget - k.spent)
                                  )}{" "}
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
                        <a
                          href="/openapi.json"
                          target="_blank"
                          rel="noreferrer"
                        >
                        OpenAPI specification{" "}
                        <HugeiconsIcon icon={ArrowUpRight01Icon} size={16} />
                      </a>
                        <small>
                          Install the separate{" "}
                          <a
                            href="https://github.com/pkyanam/agora-cli"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Agora CLI repository
                          </a>
                          .
                        </small>
                    </div>
                  </div>
                    {authRole === "owner" ? (
                      <OutgoingWebhooks />
                    ) : (
                      <p role="status" className="form-note">
                        Outgoing webhook endpoints can be managed by the
                        workspace owner.
                      </p>
                    )}
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
                              <TableHead>Limits</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.credentials.map((k) => (
                            <TableRow key={k.id}>
                              <TableCell>
                                {k.name}
                                  <small className="subtle block">
                                    {k.kind}
                                  </small>
                              </TableCell>
                              <TableCell>
                                <code>{k.prefix}••••</code>
                              </TableCell>
                                <TableCell>
                                  {keyModeLabel(k.provider_mode)}
                                </TableCell>
                              <TableCell>
                                {k.scopes.length} permissions
                              </TableCell>
                                <TableCell>
                                  <small>
                                    Per payment: {money(k.max_amount)}
                                  </small>
                                  <small className="subtle block">
                                    Refund budget: {money(k.refund_budget)} ·
                                    used {money(k.spent)}
                                  </small>
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
                      <Button variant="ghost" onClick={() => void load()}>
                        Refresh
                      </Button>
                    </div>
                    <p className="subtle mb-5">
                        Persisted payment, refund, approval, and provider
                        events.
                    </p>
                    {data.events.slice(0, 12).map((e) => (
                      <div className="event-row" key={e.id}>
                        <span className="event-icon">↗</span>
                        <code>{e.type}</code>
                        <span>{e.actor}</span>
                        <time>
                          {date(e.created_at)} ·{" "}
                            {new Date(e.created_at).toLocaleTimeString(
                              "en-US",
                              {
                            hour: "2-digit",
                            minute: "2-digit",
                              }
                            )}
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
            setEditingProduct(null)
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
                : dialog === "quote"
                  ? "Create a quote"
                    : dialog === "product"
                    ? editingProduct
                      ? "Edit product"
                      : "New product"
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
                : dialog === "quote"
                  ? "Review this fixed-price quote before accepting it. Acceptance creates an order and hosted checkout; no card details enter Agora."
                : dialog === "product"
                    ? editingProduct
                      ? `Editing creates catalog version ${(editingProduct.version ?? 1) + 1}. Existing quotes remain unchanged.`
                      : "Set a fixed price in USD."
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
                  {created.checkout_url && (
                    <a
                      className="checkout-share-link"
                      href={created.checkout_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {created.checkout_url}
                    </a>
                  )}
                </div>
                <Button
                  onClick={() => {
                    const url = created.checkout_url
                    if (url) location.assign(url)
                  }}
                  disabled={!created.checkout_url}
                >
                  Open checkout <HugeiconsIcon icon={ArrowUpRight01Icon} />
                </Button>
                <Button
                  variant="secondary"
                  disabled={!created.checkout_url}
                  onClick={() =>
                    created.checkout_url && copy(created.checkout_url)
                  }
                >
                  Copy checkout link
                </Button>
              </div>
            ) : !checkoutAvailable ? (
              <p className="form-note" role="status">
                {checkoutUnavailableMessage}
              </p>
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
          {dialog === "quote" && (
            <form className="form-stack" onSubmit={(e) => void createQuote(e)}>
              <div className="field">
                <Label htmlFor="quote-customer-name">Customer name</Label>
                <Input
                  id="quote-customer-name"
                  name="customer_name"
                  required
                  maxLength={120}
                  defaultValue={editingQuote?.customer_name || ""}
                />
              </div>
              <div className="field">
                <Label htmlFor="quote-customer-email">
                  Email <span className="optional">optional</span>
                </Label>
                <Input
                  id="quote-customer-email"
                  name="customer_email"
                  type="email"
                  maxLength={254}
                  defaultValue={editingQuote?.customer_email || ""}
                />
              </div>
              {quoteLines.map((line, index) => (
                <div className="field" key={index}>
                  <Label>Item {index + 1}</Label>
                  <div className="button-row">
                    <select
                      aria-label={`Quote item ${index + 1}`}
                      value={line.product_id}
                      onChange={(e) =>
                        setQuoteLines((lines) =>
                          lines.map((x, i) =>
                            i === index
                              ? { ...x, product_id: e.target.value }
                              : x
                          )
                        )
                      }
                    >
                      {data?.products
                        .filter(
                          (p) => !p.archived_at || p.id === line.product_id
                        )
                        .map((p) => (
                          <option value={p.id} key={p.id}>
                            {p.name} · {money(p.amount)}
                          </option>
                        ))}
                    </select>
                    <Input
                      aria-label={`Quantity ${index + 1}`}
                      type="number"
                      min="1"
                      max="1000"
                      value={line.quantity}
                      onChange={(e) =>
                        setQuoteLines((lines) =>
                          lines.map((x, i) =>
                            i === index
                              ? {
                                  ...x,
                                  quantity: Math.max(
                                    1,
                                    Math.min(1000, Number(e.target.value) || 1)
                                  ),
                                }
                              : x
                          )
                        )
                      }
                />
                    {quoteLines.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          setQuoteLines((lines) =>
                            lines.filter((_, i) => i !== index)
                          )
                        }
                      >
                        Remove
                      </Button>
                    )}
              </div>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                disabled={quoteLines.length >= 20}
                onClick={() => {
                  const p = data?.products.find((x) => !x.archived_at)
                  if (p)
                    setQuoteLines((lines) => [
                      ...lines,
                      { product_id: p.id, quantity: 1 },
                    ])
                }}
              >
                Add item
              </Button>
              <div className="field">
                <Label htmlFor="quote-discount">
                  Discount in USD <span className="optional">optional</span>
                </Label>
                <Input
                  id="quote-discount"
                  name="discount_amount"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={
                    editingQuote
                      ? String(editingQuote.discount_amount / 100)
                      : "0"
                  }
                />
              </div>
              <div className="field">
                <Label htmlFor="quote-expiry">Quote expires</Label>
                <select
                  id="quote-expiry"
                  name="expires_in_seconds"
                  defaultValue={editingQuote ? "keep" : "604800"}
                >
                  {editingQuote && (
                    <option value="keep">Keep current expiry</option>
                  )}
                  <option value="3600">In 1 hour</option>
                  <option value="86400">In 1 day</option>
                  <option value="604800">In 7 days</option>
                  <option value="2592000">In 30 days</option>
                </select>
              </div>
              <p className="form-note">
                Prices and product names are snapshotted on the quote. Editing
                creates a new version while accepted quote history stays fixed.
              </p>
              {salesError && (
                <p className="form-note" role="alert">
                  {salesError}
                </p>
              )}
              <Button
                disabled={salesBusy || quoteLines.length === 0}
                type="submit"
              >
                {salesBusy
                  ? editingQuote
                    ? "Saving…"
                    : "Creating…"
                  : editingQuote
                    ? "Save quote"
                    : "Create quote"}
              </Button>
              {editingQuote && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditingQuote(null)
                    setQuoteLines([])
                    setSalesError("")
                    setDialog(null)
                  }}
                >
                  Cancel editing
                </Button>
              )}
            </form>
          )}
          {dialog === "product" && (
            <ProductEditor
              product={editingProduct}
              onSave={async (payload) => {
                try {
                  if (payload.product_id) {
                    await action("update_product", payload)
                    toast.success(
                      "Product updated. Existing quotes keep their original price snapshot."
                    )
                  } else {
                    await action("create_product", payload)
                    toast.success("Product created")
                  }
                  setDialog(null)
                  setEditingProduct(null)
                } catch (reason) {
                  toast.error(
                    reason instanceof Error
                      ? reason.message
                      : "Product could not be saved."
                  )
                  throw reason
                }
              }}
            />
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
                {!keyTenantId && keyKind === "developer" && (
                  <div className="cli-link-step">
                    <strong>Link the Agora CLI</strong>
                    <p>
                      Run this command, then paste the API key at the hidden
                      prompt. Agora saves it locally with owner-only file
                      permissions.
                    </p>
                    <code>
                      agora auth login --url{" "}
                      {typeof location !== "undefined"
                        ? location.origin
                        : "https://agora.example.com"}
                    </code>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        copy(`agora auth login --url ${location.origin}`)
                      }
                    >
                      Copy login command <HugeiconsIcon icon={Copy01Icon} />
                    </Button>
                  </div>
                )}
                <Button
                  variant="secondary"
                  onClick={() => {
                    const tenantKey = Boolean(keyTenantId)
                    setDialog(null)
                    setSecret("")
                    setKeyTenantId("")
                    setKeyTenantName("")
                    if (!tenantKey)
                      navigate(keyKind === "agent" ? "Agents" : "Developers")
                  }}
                >
                  Done
                </Button>
              </div>
            ) : !keyIssuanceAvailable ? (
              <p className="form-note" role="status">
                {keyIssuanceUnavailableMessage}
              </p>
            ) : (
              <form
                className="form-stack"
                onSubmit={(e) => {
                  e.preventDefault()
                  const f = new FormData(e.currentTarget)
                  perform(async () => {
                    const k = await action<ApiResponse & { secret?: string }>(
                      "create_key",
                      {
                      name: f.get("name"),
                      kind: keyKind,
                      scopes: permissionSets[permission],
                      max_amount: Math.round(Number(f.get("max")) * 100),
                        refund_budget: Math.round(
                          Number(f.get("budget")) * 100
                        ),
                      ...(keyTenantId ? { tenant_id: keyTenantId } : {}),
                      }
                    )
                    if (typeof k.secret !== "string")
                      throw new Error(
                        "The API key response was incomplete. Contact support."
                      )
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
              This one-time link lets {merchantInvite?.email} set a password and
              authenticator. It expires{" "}
              {merchantInvite
                ? new Date(merchantInvite.expires_at).toLocaleString()
                : ""}
              . Share it privately; anyone with the link can claim this merchant
              account.
            </DialogDescription>
          </DialogHeader>
          {merchantInvite && (
            <div className="form-stack">
              <div className="field">
                <Label htmlFor="merchant-invite-url">
                  One-time invite link
                </Label>
                <Input
                  id="merchant-invite-url"
                  readOnly
                  value={merchantInvite.invite_url}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </div>
              <p className="form-note">
                The link is shown once here. Copy it before closing this window;
                it is not emailed automatically.
              </p>
              <Button onClick={() => copy(merchantInvite.invite_url)}>
                Copy invite link{" "}
                <HugeiconsIcon icon={Copy01Icon} aria-hidden="true" />
              </Button>
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
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setRegistrationReview(null)}
            >
              Cancel
            </Button>
            <Button
              variant={
                registrationReview?.decision === "reject"
                  ? "destructive"
                  : "default"
              }
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
                  toast.success(
                    review.decision === "approve"
                      ? "Merchant approved"
                      : "Registration rejected"
                  )
                })
              }}
            >
              {busy
                ? "Saving…"
                : registrationReview?.decision === "approve"
                  ? "Approve merchant"
                  : "Reject registration"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={quoteDetail !== null}
        onOpenChange={(open) => {
          if (!open) setQuoteDetail(null)
        }}
      >
        <DialogContent className="agora-dialog sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Quote details</DialogTitle>
            <DialogDescription>
              {quoteDetail?.id} · {quoteDetail?.customer_name}
            </DialogDescription>
          </DialogHeader>
          {quoteDetail && (
            <QuoteDetails
              quote={quoteDetail}
              onCopy={(url) => void copy(url)}
              onEdit={() => {
                setEditingQuote(quoteDetail)
                setQuoteLines(
                  quoteDetail.items.map((item) => ({
                    product_id: item.product_id || "",
                    quantity: item.quantity,
                  }))
                )
                setSalesError("")
                setQuoteDetail(null)
                setDialog("quote")
              }}
            />
          )}
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
              <span className={`payment-status ${selectedCurrent.status}`}>
                {status(selectedCurrent)}
              </span>
              <dl>
                <div>
                  <dt>Created</dt>
                  <dd>
                    {new Date(selectedCurrent.created_at).toLocaleString()}
                  </dd>
                </div>
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
                  <dt>Gross amount</dt>
                  <dd>{money(selectedCurrent.amount)}</dd>
                </div>
                <div>
                  <dt>Refunded</dt>
                  <dd>{money(selectedCurrent.refunded)}</dd>
                </div>
                <div>
                  <dt>Remaining refundable</dt>
                  <dd>
                    {money(
                      Math.max(
                        0,
                        selectedCurrent.amount - selectedCurrent.refunded
                      )
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Payment mode</dt>
                  <dd>
                    {selectedCurrent.provider === "stripe"
                    ? selectedCurrent.provider_mode
                      ? `Stripe ${selectedCurrent.provider_mode}`
                      : "Stripe · mode unavailable"
                    : selectedCurrent.provider === "sandbox"
                      ? "Sandbox"
                        : "Provider unavailable"}
                  </dd>
                </div>
              </dl>
              {selectedCurrent.provider === "stripe" && (
                <p className="form-note" role="note">
                  Agora has no Radar risk signal for this payment record. If
                  Radar is enabled, review available signals in the{" "}
                  <a
                    href="https://dashboard.stripe.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Stripe Dashboard
                  </a>
                  .
                </p>
              )}
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void setArchivedRecord(
                    "payments",
                    selectedCurrent.id,
                    !selectedCurrent.archived_at
                  )
                }
              >
                {selectedCurrent.archived_at
                  ? "Restore transaction"
                  : "Archive transaction"}
              </Button>
              {selectedCurrent.sample === 0 &&
                selectedCurrent.status === "pending" &&
                !selectedCurrent.archived_at &&
                Boolean(selectedCurrent.checkout_url) && (
                  <div className="button-row">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        window.open(
                          selectedCurrent.checkout_url!,
                          "_blank",
                          "noopener"
                        )
                      }
                    >
                      Open checkout <HugeiconsIcon icon={ArrowUpRight01Icon} />
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => copy(selectedCurrent.checkout_url!)}
                    >
                      Copy checkout link <HugeiconsIcon icon={Copy01Icon} />
                    </Button>
                  </div>
                )}
              {selectedCurrent.status === "succeeded" &&
                selectedCurrent.refunded < selectedCurrent.amount &&
                (selectedCurrent.provider === "stripe" &&
                data?.provider_status === "setup_required" ? (
                    <p className="form-note" role="status">
                    Refund actions are unavailable until Stripe setup is
                    complete. No local refund record was created.
                    </p>
                ) : (
                  <form
                    className="form-stack refund-form"
                    key={selectedCurrent.refunded}
                    onSubmit={(e) => {
                      e.preventDefault()
                      const f = new FormData(e.currentTarget)
                      perform(async () => {
                        const result = await action<
                          ApiResponse & { provider?: string; status?: string }
                        >("refund", {
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
                    {(selectedCurrent as Payment & { provider?: string })
                      .provider === "stripe" &&
                    !selectedCurrent.provider_mode ? (
                      <p className="form-note" role="status">
                        Stripe mode is unknown. Refunds are disabled until the
                        payment mode can be verified.
                      </p>
                    ) : (
                    <>
                        {(selectedCurrent as Payment & { provider?: string })
                          .provider === "stripe" && (
                      <p className="form-note" role="status">
                            Stripe {selectedCurrent.provider_mode} mode. The
                            refund is sent to the same connected account; final
                            status follows Stripe’s response and verified
                            events.
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
                              (selectedCurrent.amount -
                                selectedCurrent.refunded) /
                          100
                        }
                        defaultValue={(
                              (selectedCurrent.amount -
                                selectedCurrent.refunded) /
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
                          {busy
                            ? "Submitting…"
                            : (
                                  selectedCurrent as Payment & {
                                    provider?: string
                                  }
                                ).provider === "stripe"
                              ? "Submit Stripe refund"
                              : "Confirm refund"}
                    </Button>
                    </>
                    )}
                  </form>
                ))}
              <p className="form-note mt-6">
                {(selectedCurrent as Payment & { provider?: string })
                  .provider === "stripe"
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
