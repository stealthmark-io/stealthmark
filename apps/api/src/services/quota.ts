import { and, eq, gte, sql } from 'drizzle-orm'
import { organizations, usageRecords, type DbClient } from '@stealthmark/db'
import { BILLING_MODES, type BillingMode } from '@stealthmark/shared'
import type { DbExecutor } from './usage.js'

type Transaction = Parameters<Parameters<DbClient['transaction']>[0]>[0]

export interface OrgQuotaRow {
  billingMode: string
  monthlyEventCap: number
  creditBalanceEvents: number
  quotaAlert80SentAt: Date | null
  quotaAlert100SentAt: Date | null
}

export interface QuotaSnapshot {
  billingMode: BillingMode
  /** Reported cap. free: monthly cap. credits: used + remaining balance. enterprise: null. */
  cap: number | null
  /** Cap used for alert thresholds: enterprise keeps monthly_event_cap here even though it never blocks. */
  alertCap: number
  used: number
  remaining: number | null
  percent: number | null
  periodMonth: string
  periodStart: Date
  alert80SentAt: Date | null
  alert100SentAt: Date | null
}

export interface ReserveResult<TPlan, TStored> {
  accepted: number
  rejected: number
  quota: QuotaSnapshot
  /** The plan returned by `prepare`, so the caller can report what it filtered before the reservation. */
  plan: TPlan
  /** What `persist` returned. */
  stored: TStored
}

export interface ReservePlan<TPlan> {
  unitsPerEvent: readonly number[]
  plan: TPlan
}

export function periodStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export function periodMonthString(now: Date): string {
  return periodStartUtc(now).toISOString().slice(0, 10)
}

function normalizeBillingMode(value: string): BillingMode {
  return BILLING_MODES.find((mode) => mode === value) ?? 'free'
}

export function computeQuota(org: OrgQuotaRow, used: number, now: Date): QuotaSnapshot {
  const billingMode = normalizeBillingMode(org.billingMode)
  let cap: number | null
  let remaining: number | null
  let alertCap: number

  if (billingMode === 'enterprise') {
    cap = null
    remaining = null
    alertCap = org.monthlyEventCap
  } else if (billingMode === 'credits') {
    remaining = Math.max(0, org.creditBalanceEvents)
    cap = used + remaining
    alertCap = cap
  } else {
    cap = org.monthlyEventCap
    remaining = Math.max(0, cap - used)
    alertCap = cap
  }

  const percentBase = billingMode === 'enterprise' ? null : cap
  const percent = percentBase && percentBase > 0 ? Math.round((used / percentBase) * 1000) / 10 : null

  return {
    billingMode,
    cap,
    alertCap,
    used,
    remaining,
    percent,
    periodMonth: periodMonthString(now),
    periodStart: periodStartUtc(now),
    alert80SentAt: org.quotaAlert80SentAt,
    alert100SentAt: org.quotaAlert100SentAt,
  }
}

const orgQuotaColumns = {
  billingMode: organizations.billingMode,
  monthlyEventCap: organizations.monthlyEventCap,
  creditBalanceEvents: organizations.creditBalanceEvents,
  quotaAlert80SentAt: organizations.quotaAlert80SentAt,
  quotaAlert100SentAt: organizations.quotaAlert100SentAt,
}

/**
 * Quota usage is the sum of `units` for the organization in the current UTC month, recomputed on every ingest.
 * It stays a SUM over the ledger (the ledger is the single source of truth, there is no counter to drift), and
 * is served by usage_records_org_period_units_idx (org_id, period_month) INCLUDE (units) from
 * supabase/migrations/20261001_metering_hardening.sql, which makes it an index-only scan of one org-month.
 * Revisit with a per-period counter row only if a single organization's month grows into the tens of millions.
 */
async function sumPeriodUnits(db: DbExecutor, orgId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ used: sql<number>`coalesce(sum(${usageRecords.units}), 0)::int` })
    .from(usageRecords)
    .where(and(eq(usageRecords.orgId, orgId), eq(usageRecords.periodMonth, periodMonthString(now))))
  return Number(row?.used ?? 0)
}

export async function getQuota(db: DbExecutor, orgId: string, now: Date = new Date()): Promise<QuotaSnapshot | null> {
  const [org] = await db.select(orgQuotaColumns).from(organizations).where(eq(organizations.id, orgId)).limit(1)
  if (!org) return null
  return computeQuota(org, await sumPeriodUnits(db, orgId, now), now)
}

/**
 * Atomically accepts the longest prefix of `unitsPerEvent` that fits in the remaining quota.
 * The organization row is locked for the whole transaction, so concurrent ingests for one org
 * serialize and the cap can never be overshot. `prepare` runs first, under that lock, and decides the units of
 * each event (it is where duplicates and rate limited free rows are filtered with race free reads). `persist`
 * always runs inside the same transaction (also when nothing was accepted, so the caller can store events that
 * cost no units alongside) and receives how many leading events were accepted. In credits mode the balance is
 * decremented under a WHERE guard and never goes below zero. Returns null when the organization does not exist.
 */
export async function reserveEvents<TPlan, TStored>(
  db: DbClient,
  orgId: string,
  prepare: (tx: Transaction) => Promise<ReservePlan<TPlan>>,
  persist: (tx: Transaction, acceptedEvents: number, plan: TPlan) => Promise<TStored>,
  now: Date = new Date(),
): Promise<ReserveResult<TPlan, TStored> | null> {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .select(orgQuotaColumns)
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for('update')
      .limit(1)
    if (!org) return null

    const { unitsPerEvent, plan } = await prepare(tx)
    const used = await sumPeriodUnits(tx, orgId, now)
    const before = computeQuota(org, used, now)

    let acceptedEvents = 0
    let grantedUnits = 0
    for (const units of unitsPerEvent) {
      if (before.remaining !== null && grantedUnits + units > before.remaining) break
      grantedUnits += units
      acceptedEvents += 1
    }

    let creditBalance = org.creditBalanceEvents
    if (before.billingMode === 'credits' && grantedUnits > 0) {
      const debited = await tx
        .update(organizations)
        .set({ creditBalanceEvents: creditBalance - grantedUnits })
        .where(and(eq(organizations.id, orgId), gte(organizations.creditBalanceEvents, grantedUnits)))
        .returning({ id: organizations.id })
      if (debited.length === 0) {
        acceptedEvents = 0
        grantedUnits = 0
      } else {
        creditBalance -= grantedUnits
      }
    }

    const stored = await persist(tx, acceptedEvents, plan)

    const quota = computeQuota({ ...org, creditBalanceEvents: creditBalance }, used + grantedUnits, now)
    return { accepted: acceptedEvents, rejected: unitsPerEvent.length - acceptedEvents, quota, plan, stored }
  })
}
