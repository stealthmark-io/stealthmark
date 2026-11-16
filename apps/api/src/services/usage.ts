import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { usageRecords, type DbClient } from '@stealthmark/db'
import {
  BLOCKED_EVENT_TYPE,
  CAPPED_EVENT_TYPE,
  CLIENT_CAP_REASON,
  MAX_BLOCKED_EVENTS_PER_ORG_PER_HOUR,
  MAX_CAPPED_EVENTS_PER_ORG_PER_HOUR,
  ORG_HOURLY_CAP_REASON,
  defaultUnitsFor,
  isZeroUnitEventType,
  type AgentEventType,
  type EventMetadata,
  type UsageEventInput,
  type UsageEventSource,
} from '@stealthmark/shared'
import { emitEvent } from './events.js'
import { usageLedger, type NewUsageLedgerRow } from './usage-ledger.js'

/** Either the pooled client or a transaction handle: both expose the same query builders. */
export type DbExecutor = Pick<DbClient, 'select' | 'insert' | 'update'>

/** Events older than this are re-stamped to "now" so a batch cannot be backdated into a closed period. */
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000
const MAX_EVENT_FUTURE_SKEW_MS = 5 * 60 * 1000
/** The source of SDK traffic, the only one the hourly ceiling applies to. */
const SDK_SOURCE: UsageEventSource = 'middleware'

export interface RecordUsageParams {
  orgId: string
  apiKeyId?: string
  capabilityId?: string
  requestCount?: number
  cost?: number
  latencyMs?: number
  success?: boolean
  metadata?: Record<string, unknown>
}

export async function recordUsage(db: DbClient, params: RecordUsageParams): Promise<void> {
  const {
    orgId,
    apiKeyId,
    capabilityId,
    requestCount = 1,
    cost = 0,
    latencyMs = 0,
    success = true,
    metadata,
  } = params

  await db.insert(usageRecords).values({
    orgId,
    apiKeyId: apiKeyId || null,
    capabilityId: capabilityId || null,
    requestCount,
    cost: cost !== undefined ? String(cost) : null,
    latencyMs,
    success,
    metadata: metadata || null,
  })

  // Emit event asynchronously
  emitEvent(db, {
    type: 'usage.recorded',
    payload: {
      orgId,
      apiKeyId,
      capabilityId,
      requestCount,
      cost,
      latencyMs,
      success,
    },
    orgId,
  }).catch((err) => {
    console.error('Failed to emit usage.recorded event:', err)
  })
}

export function resolveEventTimestamp(occurredAt: string | undefined, now: Date): Date {
  if (!occurredAt) return now
  const parsed = new Date(occurredAt)
  const delta = now.getTime() - parsed.getTime()
  if (Number.isNaN(delta) || delta > MAX_EVENT_AGE_MS || delta < -MAX_EVENT_FUTURE_SKEW_MS) return now
  return parsed
}

/**
 * Units are server-decided. Only the trusted 'api' source may choose them; SDK traffic is always 1 per counted
 * event. agent_blocked and agent_capped are free for every source.
 */
export function resolveEventUnits(
  eventType: AgentEventType,
  requestedUnits: number | undefined,
  source: UsageEventSource,
): number {
  if (isZeroUnitEventType(eventType)) return 0
  if (source === 'api') return requestedUnits ?? defaultUnitsFor(eventType)
  return defaultUnitsFor(eventType)
}

export interface UsageEventRowContext {
  orgId: string
  apiKeyId: string | null
  source: UsageEventSource
  /** Site ids that belong to the organization; any other site_id is stored as null. */
  ownedSiteIds: ReadonlySet<string>
  now: Date
}

/** An agent_capped event the SDK reports is stamped with its reason, whatever the client sent there. */
function rowMetadata(event: UsageEventInput, eventType: AgentEventType): EventMetadata | null {
  const metadata = eventType === CAPPED_EVENT_TYPE ? { ...event.metadata, reason: CLIENT_CAP_REASON } : event.metadata
  return metadata !== undefined && Object.keys(metadata).length > 0 ? metadata : null
}

export function buildUsageEventRow(event: UsageEventInput, context: UsageEventRowContext): NewUsageLedgerRow {
  const siteId = event.site_id && context.ownedSiteIds.has(event.site_id) ? event.site_id : null
  const eventType = event.event_type ?? 'agent_request'
  return {
    orgId: context.orgId,
    apiKeyId: context.apiKeyId,
    siteId,
    eventType,
    units: resolveEventUnits(eventType, event.units, context.source),
    source: context.source,
    agentIdentifier: event.agent_identifier ?? null,
    metadata: rowMetadata(event, eventType),
    eventId: event.event_id ?? null,
    // Free rows are rate limited by counting rows in the last hour, so a client must not be able to backdate them.
    createdAt: isZeroUnitEventType(eventType) ? context.now : resolveEventTimestamp(event.occurred_at, context.now),
  }
}

export interface BatchDedupe {
  rows: NewUsageLedgerRow[]
  duplicates: number
}

/** Keeps the first row of every event_id inside one batch. Rows without an event_id are never deduplicated. */
export function dedupeBatchByEventId(rows: readonly NewUsageLedgerRow[]): BatchDedupe {
  const seen = new Set<string>()
  const kept: NewUsageLedgerRow[] = []
  for (const row of rows) {
    if (row.eventId) {
      if (seen.has(row.eventId)) continue
      seen.add(row.eventId)
    }
    kept.push(row)
  }
  return { rows: kept, duplicates: rows.length - kept.length }
}

export interface IngestPlan {
  /** Rows that cost no units and passed the dedupe and their hourly cap: agent_blocked first, then agent_capped. */
  zeroUnitRows: NewUsageLedgerRow[]
  /** Counted rows that were not seen before and fit under the hourly ceiling, in request order. The quota decides how many of them fit. */
  billableRows: NewUsageLedgerRow[]
  /** Rows dropped because their event_id is already stored for the organization. */
  duplicates: number
  /** agent_blocked rows dropped by the hourly cap. */
  skippedBlocked: number
  /** agent_capped rows dropped by their hourly cap, counting the rows the hourly ceiling turned into agent_capped. */
  skippedCapped: number
}

const HOUR_MS = 60 * 60 * 1000
const ROW_COUNT = sql<number>`count(*)::int`

function inLastHour(orgId: string, now: Date) {
  return and(eq(usageLedger.orgId, orgId), gte(usageLedger.createdAt, new Date(now.getTime() - HOUR_MS)))
}

async function dropStoredEventIds(
  tx: DbExecutor,
  orgId: string,
  rows: readonly NewUsageLedgerRow[],
): Promise<NewUsageLedgerRow[]> {
  const eventIds = rows.flatMap((row) => (row.eventId ? [row.eventId] : []))
  if (eventIds.length === 0) return [...rows]
  const existing = await tx
    .select({ eventId: usageLedger.eventId })
    .from(usageLedger)
    .where(and(eq(usageLedger.orgId, orgId), inArray(usageLedger.eventId, eventIds)))
  const known = new Set(existing.flatMap((row) => (row.eventId ? [row.eventId] : [])))
  return rows.filter((row) => !row.eventId || !known.has(row.eventId))
}

async function blockedRowsInHour(tx: DbExecutor, orgId: string, now: Date): Promise<number> {
  const [row] = await tx
    .select({ blocked: ROW_COUNT })
    .from(usageLedger)
    .where(and(inLastHour(orgId, now), eq(usageLedger.eventType, BLOCKED_EVENT_TYPE)))
  return Number(row?.blocked ?? 0)
}

async function cappedRowsInHour(tx: DbExecutor, orgId: string, now: Date): Promise<number> {
  const [row] = await tx
    .select({ capped: ROW_COUNT })
    .from(usageLedger)
    .where(and(inLastHour(orgId, now), eq(usageLedger.eventType, CAPPED_EVENT_TYPE)))
  return Number(row?.capped ?? 0)
}

/** Units already billed to SDK traffic in the last hour. Rows of every other source are outside the hourly ceiling. */
async function billableUnitsInHour(tx: DbExecutor, orgId: string, now: Date): Promise<number> {
  const [row] = await tx
    .select({ billable: sql<number>`coalesce(sum(${usageLedger.units}), 0)::int` })
    .from(usageLedger)
    .where(and(inLastHour(orgId, now), eq(usageLedger.source, SDK_SOURCE)))
  return Number(row?.billable ?? 0)
}

function toCappedRow(row: NewUsageLedgerRow, now: Date): NewUsageLedgerRow {
  const metadata = { ...(row.metadata as EventMetadata | null), reason: ORG_HOURLY_CAP_REASON }
  return { ...row, eventType: CAPPED_EVENT_TYPE, units: 0, metadata, createdAt: now }
}

interface CeilingSplit {
  billable: NewUsageLedgerRow[]
  capped: NewUsageLedgerRow[]
}

/** Keeps SDK rows while the hourly allowance lasts, in request order; the rest become agent_capped rows. */
function splitAtHourlyCeiling(rows: readonly NewUsageLedgerRow[], allowance: number, now: Date): CeilingSplit {
  const split: CeilingSplit = { billable: [], capped: [] }
  let left = allowance
  for (const row of rows) {
    if (row.source !== SDK_SOURCE) {
      split.billable.push(row)
    } else if (row.units <= left) {
      left -= row.units
      split.billable.push(row)
    } else {
      split.capped.push(toCappedRow(row, now))
    }
  }
  return split
}

async function applyHourlyCeiling(
  tx: DbExecutor,
  orgId: string,
  rows: readonly NewUsageLedgerRow[],
  now: Date,
  hourlyCeiling: number,
): Promise<CeilingSplit> {
  if (!rows.some((row) => row.source === SDK_SOURCE)) return { billable: [...rows], capped: [] }
  const allowance = Math.max(0, hourlyCeiling - (await billableUnitsInHour(tx, orgId, now)))
  return splitAtHourlyCeiling(rows, allowance, now)
}

/** The leading rows that still fit in an hourly allowance of free rows; the count is only read when there are rows. */
async function withinAllowance(
  rows: NewUsageLedgerRow[],
  maxPerHour: number,
  storedInHour: () => Promise<number>,
): Promise<NewUsageLedgerRow[]> {
  if (rows.length === 0) return rows
  return rows.slice(0, Math.max(0, maxPerHour - (await storedInHour())))
}

/**
 * Must run inside the transaction that holds the organization row lock (see reserveEvents): the event_id
 * lookup and the hourly counts are only race free because concurrent ingests for one org are serialized.
 * Duplicates are removed before quota is reserved so a retried batch never debits quota or credits twice.
 * `hourlyCeiling` is the organization's hourlyBillableCeiling: counted SDK rows beyond it are kept as free
 * agent_capped rows instead of being billed.
 */
export async function planIngest(
  tx: DbExecutor,
  orgId: string,
  rows: readonly NewUsageLedgerRow[],
  now: Date,
  hourlyCeiling: number,
): Promise<IngestPlan> {
  const fresh = await dropStoredEventIds(tx, orgId, rows)
  const blockedRows = fresh.filter((row) => row.eventType === BLOCKED_EVENT_TYPE)
  const reportedCapped = fresh.filter((row) => row.eventType === CAPPED_EVENT_TYPE)
  const counted = fresh.filter((row) => row.eventType !== BLOCKED_EVENT_TYPE && row.eventType !== CAPPED_EVENT_TYPE)

  const ceiling = await applyHourlyCeiling(tx, orgId, counted, now, hourlyCeiling)
  const cappedRows = [...reportedCapped, ...ceiling.capped]
  const storedBlocked = await withinAllowance(blockedRows, MAX_BLOCKED_EVENTS_PER_ORG_PER_HOUR, () =>
    blockedRowsInHour(tx, orgId, now),
  )
  const storedCapped = await withinAllowance(cappedRows, MAX_CAPPED_EVENTS_PER_ORG_PER_HOUR, () =>
    cappedRowsInHour(tx, orgId, now),
  )

  return {
    zeroUnitRows: [...storedBlocked, ...storedCapped],
    billableRows: ceiling.billable,
    duplicates: rows.length - fresh.length,
    skippedBlocked: blockedRows.length - storedBlocked.length,
    skippedCapped: cappedRows.length - storedCapped.length,
  }
}

/**
 * Inserts the rows and returns how many were actually stored. A row whose (org_id, event_id) already exists is
 * skipped silently by the partial unique index; planIngest filters these first, so a skip here only happens when
 * a writer outside the organization lock stored the same event_id in between. Without any event_id no unique
 * index can fire and a plain insert is used.
 */
export async function insertUsageEvents(db: DbExecutor, rows: readonly NewUsageLedgerRow[]): Promise<number> {
  if (rows.length === 0) return 0
  if (!rows.some((row) => row.eventId)) {
    await db.insert(usageLedger).values([...rows])
    return rows.length
  }
  const stored = await db
    .insert(usageLedger)
    .values([...rows])
    .onConflictDoNothing({
      target: [usageLedger.orgId, usageLedger.eventId],
      where: sql`"event_id" is not null`,
    })
    .returning({ id: usageLedger.id })
  return stored.length
}
