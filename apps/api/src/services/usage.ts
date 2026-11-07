import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { usageRecords, type DbClient } from '@stealthmark/db'
import {
  MAX_BLOCKED_EVENTS_PER_ORG_PER_HOUR,
  ZERO_UNIT_EVENT_TYPE,
  defaultUnitsFor,
  type AgentEventType,
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
 * event. agent_blocked is free for every source.
 */
export function resolveEventUnits(
  eventType: AgentEventType,
  requestedUnits: number | undefined,
  source: UsageEventSource,
): number {
  if (eventType === ZERO_UNIT_EVENT_TYPE) return 0
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

export function buildUsageEventRow(event: UsageEventInput, context: UsageEventRowContext): NewUsageLedgerRow {
  const siteId = event.site_id && context.ownedSiteIds.has(event.site_id) ? event.site_id : null
  const eventType = event.event_type ?? 'agent_request'
  const hasMetadata = event.metadata !== undefined && Object.keys(event.metadata).length > 0
  return {
    orgId: context.orgId,
    apiKeyId: context.apiKeyId,
    siteId,
    eventType,
    units: resolveEventUnits(eventType, event.units, context.source),
    source: context.source,
    agentIdentifier: event.agent_identifier ?? null,
    metadata: hasMetadata ? event.metadata : null,
    eventId: event.event_id ?? null,
    // Free rows are rate limited by counting rows in the last hour, so a client must not be able to backdate them.
    createdAt: eventType === ZERO_UNIT_EVENT_TYPE ? context.now : resolveEventTimestamp(event.occurred_at, context.now),
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
  /** Rows that cost no units and passed the dedupe and hourly cap. */
  zeroUnitRows: NewUsageLedgerRow[]
  /** Counted rows that were not seen before, in request order. The quota decides how many of them fit. */
  billableRows: NewUsageLedgerRow[]
  /** Rows dropped because their event_id is already stored for the organization. */
  duplicates: number
  /** agent_blocked rows dropped by the hourly cap. */
  skippedBlocked: number
}

const HOUR_MS = 60 * 60 * 1000

/**
 * Must run inside the transaction that holds the organization row lock (see reserveEvents): the event_id
 * lookup and the blocked-row count are only race free because concurrent ingests for one org are serialized.
 * Duplicates are removed before quota is reserved so a retried batch never debits quota or credits twice.
 */
export async function planIngest(
  tx: DbExecutor,
  orgId: string,
  rows: readonly NewUsageLedgerRow[],
  now: Date,
): Promise<IngestPlan> {
  const eventIds = rows.flatMap((row) => (row.eventId ? [row.eventId] : []))
  let fresh = [...rows]
  let duplicates = 0

  if (eventIds.length > 0) {
    const existing = await tx
      .select({ eventId: usageLedger.eventId })
      .from(usageLedger)
      .where(and(eq(usageLedger.orgId, orgId), inArray(usageLedger.eventId, eventIds)))
    const known = new Set(existing.flatMap((row) => (row.eventId ? [row.eventId] : [])))
    fresh = fresh.filter((row) => !row.eventId || !known.has(row.eventId))
    duplicates = rows.length - fresh.length
  }

  const blockedRows = fresh.filter((row) => row.eventType === ZERO_UNIT_EVENT_TYPE)
  const billableRows = fresh.filter((row) => row.eventType !== ZERO_UNIT_EVENT_TYPE)

  let zeroUnitRows = blockedRows
  if (blockedRows.length > 0) {
    const [row] = await tx
      .select({ blocked: sql<number>`count(*)::int` })
      .from(usageLedger)
      .where(
        and(
          eq(usageLedger.orgId, orgId),
          eq(usageLedger.eventType, ZERO_UNIT_EVENT_TYPE),
          gte(usageLedger.createdAt, new Date(now.getTime() - HOUR_MS)),
        ),
      )
    const allowance = Math.max(0, MAX_BLOCKED_EVENTS_PER_ORG_PER_HOUR - Number(row?.blocked ?? 0))
    zeroUnitRows = blockedRows.slice(0, allowance)
  }

  return { zeroUnitRows, billableRows, duplicates, skippedBlocked: blockedRows.length - zeroUnitRows.length }
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
