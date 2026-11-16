import crypto from 'node:crypto'
import { eq, desc, asc, sql, and, lt } from 'drizzle-orm'
import {
  gatewayAccessEvents,
  type GatewayAccessEvent,
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
const MAX_AUDIT_REASON_CHARS = 500

export interface EventHashMetadata {
  ipAddress?: string | null
  passportId?: string | null
  version?: 'v1' | 'v2'
}

export function sanitizeAuditReason(reason: string | null | undefined): string | null {
  if (!reason) return null
  const cleaned = reason.replace(/[\x00-\x1f\x7f]/g, '').trim()
  return cleaned ? cleaned.slice(0, MAX_AUDIT_REASON_CHARS) : null
}

/**
 * Legacy v1 SHA-256 event hash (used only for verifying historical pre-v2 chain segments).
 */
export function computeLegacyEventHashV1(
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
 * Computes the SHA-256 event hash (v2) for an access event link in the site's hash chain.
 * Binds `passportId` and `ipAddress` into the digest so neither can be altered without breaking the chain.
 */
export function computeEventHash(
  prevHash: string,
  siteId: string,
  agentId: string | null | undefined,
  action: string,
  reason: string | null | undefined,
  createdAt: Date,
  metadataOrIp?: EventHashMetadata | string | null,
  passportIdArg?: string | null
): string {
  const meta: EventHashMetadata =
    typeof metadataOrIp === 'string' || metadataOrIp === null
      ? { ipAddress: metadataOrIp, passportId: passportIdArg }
      : metadataOrIp ?? {}

  if (meta.version === 'v1') {
    return computeLegacyEventHashV1(prevHash, siteId, agentId, action, reason, createdAt)
  }

  const sanitizedReason = sanitizeAuditReason(reason) ?? ''
  const payload = [
    'v2',
    prevHash,
    siteId,
    agentId || '',
    meta.passportId || '',
    action,
    sanitizedReason,
    meta.ipAddress || '',
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
  const { siteId, orgId, passportId, agentId, action, ipAddress, latencyMs } = params
  const sanitizedReason = sanitizeAuditReason(params.reason)

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
    const eventHash = computeEventHash(prevHash, siteId, agentId, action, sanitizedReason, createdAt, {
      ipAddress,
      passportId,
    })

    // 2. Insert into database
    const [event] = await tx
      .insert(gatewayAccessEvents)
      .values({
        siteId,
        orgId,
        passportId,
        agentId,
        action,
        reason: sanitizedReason,
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

  let seenV2 = false

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

    const computedV2 = computeEventHash(
      row.prevHash || GENESIS_HASH,
      row.siteId,
      row.agentId,
      row.action,
      row.reason,
      row.createdAt,
      {
        ipAddress: row.ipAddress,
        passportId: row.passportId,
      }
    )

    if (computedV2 === row.eventHash) {
      seenV2 = true
    } else {
      const computedV1 = computeLegacyEventHashV1(
        row.prevHash || GENESIS_HASH,
        row.siteId,
        row.agentId,
        row.action,
        row.reason,
        row.createdAt
      )
      if (seenV2 || computedV1 !== row.eventHash) {
        return {
          valid: false,
          totalEvents: events.length,
          verifiedCount: i,
          brokenAtId: row.id,
          message: `Corrupted hash at event index ${i}: data does not match hash ${row.eventHash}`,
        }
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
