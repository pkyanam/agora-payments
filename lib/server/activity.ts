import type { LedgerStore } from "./store"
import type { PaymentProviderEnvironment } from "./service"

export type ActivityRange = "1h" | "24h" | "7d" | "30d" | "90d" | "1y" | "all" | "custom"
type Bucket = { date: string; successful_payments: number; gross_amount: number; refunded_amount: number }

const DAY = 86_400_000
const HOUR = 3_600_000
const isoDate = (value: Date) => value.toISOString().slice(0, 10)
const monthStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
const nextMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
const monthKey = (date: Date) => date.toISOString().slice(0, 7)

function parseDate(value: string | undefined, label: string): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Provide ${label} as YYYY-MM-DD.`)
  const date = new Date(`${value}T00:00:00.000Z`)
  if (isoDate(date) !== value) throw new Error(`Provide a valid ${label} date.`)
  return date
}

function bounds(range: ActivityRange, now: Date, from?: string, to?: string, earliestPayment?: string | null) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  if (range === "1h") {
    const bucket = 5 * 60_000
    const end = Math.floor(now.getTime() / bucket) * bucket + bucket
    return { start: new Date(end - 12 * bucket), end: new Date(end), bucketMs: bucket, calendar: false }
  }
  if (range === "24h") {
    const end = Math.floor(now.getTime() / HOUR) * HOUR + HOUR
    return { start: new Date(end - 24 * HOUR), end: new Date(end), bucketMs: HOUR, calendar: false }
  }
  if (range === "7d" || range === "30d") {
    const count = range === "7d" ? 7 : 30
    return { start: new Date(today.getTime() - (count - 1) * DAY), end: new Date(today.getTime() + DAY), bucketMs: DAY, calendar: false }
  }
  if (range === "90d") {
    const first = new Date(today.getTime() - 89 * DAY)
    const mondayOffset = (first.getUTCDay() + 6) % 7
    return { start: new Date(first.getTime() - mondayOffset * DAY), end: new Date(today.getTime() + DAY), bucketMs: 7 * DAY, calendar: false }
  }
  if (range === "1y") {
    return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)), end: nextMonth(now), bucketMs: 0, calendar: true }
  }
  if (range === "custom") {
    const start = parseDate(from, "start date")
    const lastDate = parseDate(to, "end date")
    if (lastDate < start) throw new Error("The end date must be on or after the start date.")
    const days = Math.floor((lastDate.getTime() - start.getTime()) / DAY) + 1
    if (days > 3653) throw new Error("Custom ranges are limited to 10 years.")
    const end = new Date(lastDate.getTime() + DAY)
    if (days <= 90) return { start, end, bucketMs: DAY, calendar: false }
    if (days <= 400) {
      const offset = (start.getUTCDay() + 6) % 7
      return { start: new Date(start.getTime() - offset * DAY), end, bucketMs: 7 * DAY, calendar: false }
    }
    return { start: monthStart(start), end, bucketMs: 0, calendar: true }
  }
  return { start: earliestPayment ? monthStart(new Date(earliestPayment)) : monthStart(now), end: nextMonth(now), bucketMs: 0, calendar: true }
}

export function paymentActivity(
  store: LedgerStore,
  tenantId: string,
  range: ActivityRange,
  from: string | undefined,
  to: string | undefined,
  environment: PaymentProviderEnvironment,
  now = new Date(),
) {
  const provider = environment.AGORA_PAYMENT_PROVIDER === "stripe" ? "stripe" : "sandbox"
  const configuredMode = environment.AGORA_STRIPE_MODE
  const providerMode = provider === "stripe"
    ? configuredMode === "test" || configuredMode === "live" ? configuredMode : "__unconfigured__"
    : "sandbox"
  let earliest: string | null = null
  if (range === "all") {
    earliest = store.one<{ created_at: string | null }>(
      "SELECT MIN(created_at) AS created_at FROM payments WHERE tenant_id=? AND provider=? AND COALESCE(provider_mode,'sandbox')=? AND status='succeeded' AND sample=0 AND created_at<=?",
      tenantId, provider, providerMode, now.toISOString(),
    )?.created_at || null
  }
  const window = bounds(range, now, from, to, earliest)
  const start = window.start
  const end = window.end
  const nowIso = now.toISOString()
  let raw: Array<{ bucket: number | string; successful_payments: number; gross_amount: number; refunded_amount: number }>
  if (window.calendar) {
    raw = store.all(
      "SELECT substr(created_at,1,7) AS bucket,COUNT(*) AS successful_payments,COALESCE(SUM(amount),0) AS gross_amount,COALESCE(SUM(refunded),0) AS refunded_amount FROM payments WHERE tenant_id=? AND provider=? AND COALESCE(provider_mode,'sandbox')=? AND status='succeeded' AND sample=0 AND created_at>=? AND created_at<? AND created_at<=? GROUP BY substr(created_at,1,7)",
      tenantId, provider, providerMode, start.toISOString(), end.toISOString(), nowIso,
    )
  } else {
    raw = store.all(
      "SELECT CAST((CAST(strftime('%s',created_at) AS INTEGER)-?)/? AS INTEGER) AS bucket,COUNT(*) AS successful_payments,COALESCE(SUM(amount),0) AS gross_amount,COALESCE(SUM(refunded),0) AS refunded_amount FROM payments WHERE tenant_id=? AND provider=? AND COALESCE(provider_mode,'sandbox')=? AND status='succeeded' AND sample=0 AND created_at>=? AND created_at<? AND created_at<=? GROUP BY bucket",
      Math.floor(start.getTime() / 1000), Math.floor(window.bucketMs / 1000), tenantId, provider, providerMode, start.toISOString(), end.toISOString(), nowIso,
    )
  }
  const rows = new Map(raw.map((row) => [String(row.bucket), row]))
  const buckets: Bucket[] = []
  if (window.calendar) {
    for (let cursor = monthStart(start); cursor < end; cursor = nextMonth(cursor)) {
      const key = monthKey(cursor)
      const row = rows.get(key)
      buckets.push({ date: `${key}-01T00:00:00.000Z`, successful_payments: Number(row?.successful_payments || 0), gross_amount: Number(row?.gross_amount || 0), refunded_amount: Number(row?.refunded_amount || 0) })
    }
  } else {
    const count = Math.ceil((end.getTime() - start.getTime()) / window.bucketMs)
    for (let index = 0; index < count; index++) {
      const date = new Date(start.getTime() + index * window.bucketMs)
      const row = rows.get(String(index))
      buckets.push({ date: date.toISOString(), successful_payments: Number(row?.successful_payments || 0), gross_amount: Number(row?.gross_amount || 0), refunded_amount: Number(row?.refunded_amount || 0) })
    }
  }
  return {
    range,
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    bucket_seconds: window.calendar ? null : window.bucketMs / 1000,
    successful_payments: buckets.reduce((total, bucket) => total + bucket.successful_payments, 0),
    gross_amount: buckets.reduce((total, bucket) => total + bucket.gross_amount, 0),
    refunded_amount: buckets.reduce((total, bucket) => total + bucket.refunded_amount, 0),
    daily: buckets,
  }
}
