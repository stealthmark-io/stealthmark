import crypto from 'node:crypto'
import { eq, desc, asc, sql, and, lt } from 'drizzle-orm'
import {
  gatewayAccessEvents,
  type GatewayAccessEvent,
  type NewGatewayAccessEvent,
  type DbClient,
} from '@stealthmark/db'

export interface PaginatedEventsResult {
  events: GatewayAccessEvent[]
  nextCursor: string | null
  hasMore: boolean
}

export interface LogGatewayAccessEventParams {
  siteId: string
  orgId: string
  passportId?: string | null
  agentId?: string | null
  action: 'allowed' | 'blocked' | 'rate_limited' | 'revoked'
  reason?: string | null
  ipAddress?: string | null
  latencyMs?: number | null
}

export interface VerifyGatewayChainResult {
  valid: boolean
  totalEvents: number
  verifiedCount: number
  brokenAtId?: string
  message: string
}

export interface SiteGatewayAnalytics {
  siteId: string
  totalEvents: number
  allowedCount: number
  blockedCount: number
  rateLimitedCount: number
  blockRatePercent: number
  avgLatencyMs: number | null
  uniqueAgentsCount: number
}

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000'

/**
 * Computes the SHA-256 event hash for an access event link in the site's hash chain.
 */
export function computeEventHash(
  prevHash: string,
  siteId: string,
  agentId: string | null | undefined,
  action: string,
  reason: string | null | undefined,
  createdAt: Date
): string {
  const payload = [
    prevHash,
    siteId,
    agentId || '',
    action,
    reason || '',
    createdAt.toISOString(),
  ].join('|')

  return crypto.createHash('sha256').update(payload).digest('hex')
}

/**
 * Appends a new gateway access event into the per-site cryptographic audit chain.
 * Protected with PostgreSQL advisory transaction locking to prevent concurrent chain forks.
 */
export async function logGatewayAccessEvent(
  db: DbClient,
  params: LogGatewayAccessEventParams
): Promise<GatewayAccessEvent> {
  const { siteId, orgId, passportId, agentId, action, reason, ipAddress, latencyMs } = params

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'gateway-chain:' + siteId}))`)

    // 1. Fetch latest event hash for this site
    const [latest] = await tx
      .select({ eventHash: gatewayAccessEvents.eventHash })
      .from(gatewayAccessEvents)
      .where(eq(gatewayAccessEvents.siteId, siteId))
      .orderBy(desc(gatewayAccessEvents.createdAt))
      .limit(1)

    const prevHash = latest?.eventHash || GENESIS_HASH
    const createdAt = new Date()
    const eventHash = computeEventHash(prevHash, siteId, agentId, action, reason, createdAt)

    // 2. Insert into database
    const [event] = await tx
      .insert(gatewayAccessEvents)
      .values({
        siteId,
        orgId,
        passportId,
        agentId,
        action,
        reason,
        ipAddress,
        latencyMs,
        prevHash,
        eventHash,
        createdAt,
      })
      .returning()

    return event
  })
}

/**
 * Retrieves recent gateway access events for a site with optional cursor pagination.
 */
export async function getGatewayEvents(
  db: DbClient,
  siteId: string,
  limit = 50,
  cursor?: string
): Promise<GatewayAccessEvent[]> {
  const effectiveLimit = Math.min(100, Math.max(1, limit))
  const cursorDate = cursor ? new Date(cursor) : null
  const hasCursor = cursorDate !== null && !isNaN(cursorDate.getTime())

  return db
    .select()
    .from(gatewayAccessEvents)
    .where(
      hasCursor
        ? and(eq(gatewayAccessEvents.siteId, siteId), lt(gatewayAccessEvents.createdAt, cursorDate))
        : eq(gatewayAccessEvents.siteId, siteId)
    )
    .orderBy(desc(gatewayAccessEvents.createdAt))
    .limit(effectiveLimit)
}

/**
 * Retrieves paginated gateway access events along with nextCursor and hasMore indicators.
 */
export async function getPaginatedGatewayEvents(
  db: DbClient,
  siteId: string,
  limit = 50,
  cursor?: string
): Promise<PaginatedEventsResult> {
  const effectiveLimit = Math.min(100, Math.max(1, limit))
  const items = await getGatewayEvents(db, siteId, effectiveLimit + 1, cursor)
  const hasMore = items.length > effectiveLimit
  const events = hasMore ? items.slice(0, effectiveLimit) : items
  const nextCursor = hasMore && events.length > 0
    ? events[events.length - 1].createdAt.toISOString()
    : null

  return {
    events,
    nextCursor,
    hasMore,
  }
}

/**
 * Verifies the integrity of the per-site SHA-256 access event hash chain.
 */
export async function verifyGatewayChain(
  db: DbClient,
  siteId: string
): Promise<VerifyGatewayChainResult> {
  const events = await db
    .select()
    .from(gatewayAccessEvents)
    .where(eq(gatewayAccessEvents.siteId, siteId))
    .orderBy(asc(gatewayAccessEvents.createdAt))

  if (events.length === 0) {
    return {
      valid: true,
      totalEvents: 0,
      verifiedCount: 0,
      message: 'No gateway access events found for site',
    }
  }

  let expectedPrevHash = GENESIS_HASH

  for (let i = 0; i < events.length; i++) {
    const row = events[i]

    if (row.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        totalEvents: events.length,
        verifiedCount: i,
        brokenAtId: row.id,
        message: `Broken chain at event index ${i}: prevHash mismatch. Expected ${expectedPrevHash}, got ${row.prevHash}`,
      }
    }

    const computed = computeEventHash(
      row.prevHash || GENESIS_HASH,
      row.siteId,
      row.agentId,
      row.action,
      row.reason,
      row.createdAt
    )

    if (computed !== row.eventHash) {
      return {
        valid: false,
        totalEvents: events.length,
        verifiedCount: i,
        brokenAtId: row.id,
        message: `Corrupted hash at event index ${i}: data does not match hash ${row.eventHash}`,
      }
    }

    expectedPrevHash = row.eventHash
  }

  return {
    valid: true,
    totalEvents: events.length,
    verifiedCount: events.length,
    message: `All ${events.length} gateway access events verified successfully. Cryptographic chain is intact.`,
  }
}

/**
 * Computes aggregated access analytics for a site.
 */
export async function getSiteAnalytics(
  db: DbClient,
  siteId: string
): Promise<SiteGatewayAnalytics> {
  const [agg] = await db
    .select({
      totalEvents: sql<number>`count(*)::int`,
      allowedCount: sql<number>`count(*) filter (where ${gatewayAccessEvents.action} = 'allowed')::int`,
      blockedCount: sql<number>`count(*) filter (where ${gatewayAccessEvents.action} = 'blocked')::int`,
      rateLimitedCount: sql<number>`count(*) filter (where ${gatewayAccessEvents.action} = 'rate_limited')::int`,
      avgLatencyMs: sql<number | null>`round(avg(${gatewayAccessEvents.latencyMs}))::int`,
      uniqueAgentsCount: sql<number>`count(distinct ${gatewayAccessEvents.agentId})::int`,
    })
    .from(gatewayAccessEvents)
    .where(eq(gatewayAccessEvents.siteId, siteId))

  const total = Number(agg.totalEvents)
  const blocked = Number(agg.blockedCount)
  const rateLimited = Number(agg.rateLimitedCount)

  return {
    siteId,
    totalEvents: total,
    allowedCount: Number(agg.allowedCount),
    blockedCount: blocked,
    rateLimitedCount: rateLimited,
    blockRatePercent: total > 0 ? Math.round(((blocked + rateLimited) / total) * 100) : 0,
    avgLatencyMs: agg.avgLatencyMs === null ? null : Number(agg.avgLatencyMs),
    uniqueAgentsCount: Number(agg.uniqueAgentsCount),
  }
}
