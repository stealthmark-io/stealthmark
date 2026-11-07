import { isPlatformCaller, resolveOrgAccess } from '../../lib/org-context.js'
import { FastifyInstance } from 'fastify'
import { eq, and, gte, lte, inArray } from 'drizzle-orm'
import { usageRecords, registeredSites, type DbClient } from '@stealthmark/db'
import {
  QUOTA_RETRY_AFTER_SECONDS,
  ZERO_UNIT_EVENT_TYPE,
  usageIngestRequestSchema,
  type UsageIngestResponse,
  type UsageQuotaExceeded,
  type UsageQuotaResponse,
} from '@stealthmark/shared'
import { getQuota, reserveEvents, type QuotaSnapshot } from '../../services/quota.js'
import { checkQuotaAlerts } from '../../services/quota-alerts.js'
import { buildUsageEventRow, dedupeBatchByEventId, insertUsageEvents, planIngest } from '../../services/usage.js'

interface IngestCounters {
  accepted: number
  rejected: number
  duplicates: number
  skippedBlocked: number
}

function toIngestResponse(counters: IngestCounters, quota: QuotaSnapshot): UsageIngestResponse {
  return {
    accepted: counters.accepted,
    rejected: counters.rejected,
    duplicates: counters.duplicates,
    skipped_blocked: counters.skippedBlocked,
    cap: quota.cap,
    used: quota.used,
    remaining: quota.remaining,
    billing_mode: quota.billingMode,
  }
}

export async function usageRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // GET /v1/usage
  app.get('/', async (request, reply) => {
    const query = request.query as {
      orgId?: string
      from?: string
      to?: string
    }

    const orgAccess = resolveOrgAccess(request, query.orgId)
    if (!orgAccess.ok) {
      return reply.code(orgAccess.status).send(orgAccess.body)
    }
    const orgId = orgAccess.orgId

    const conditions = [eq(usageRecords.orgId, orgId)]
    if (query.from) {
      conditions.push(gte(usageRecords.createdAt, new Date(query.from)))
    }
    if (query.to) {
      conditions.push(lte(usageRecords.createdAt, new Date(query.to)))
    }

    const records = await db
      .select({
        id: usageRecords.id,
        capabilityId: usageRecords.capabilityId,
        requestCount: usageRecords.requestCount,
        cost: usageRecords.cost,
        latencyMs: usageRecords.latencyMs,
        success: usageRecords.success,
        createdAt: usageRecords.createdAt,
      })
      .from(usageRecords)
      .where(and(...conditions))

    let totalRequests = 0
    let totalCost = 0
    const capabilityMap = new Map<string, { requests: number; cost: number }>()
    const dayMap = new Map<string, { requests: number; cost: number }>()

    for (const rec of records) {
      const count = rec.requestCount || 1
      const cost = parseFloat(rec.cost || '0') || 0

      totalRequests += count
      totalCost += cost

      // By capability
      const capId = rec.capabilityId || 'unknown'
      const capEntry = capabilityMap.get(capId) || { requests: 0, cost: 0 }
      capEntry.requests += count
      capEntry.cost += cost
      capabilityMap.set(capId, capEntry)

      // By day
      const day = rec.createdAt.toISOString().slice(0, 10)
      const dayEntry = dayMap.get(day) || { requests: 0, cost: 0 }
      dayEntry.requests += count
      dayEntry.cost += cost
      dayMap.set(day, dayEntry)
    }

    return reply.send({
      total_requests: totalRequests,
      total_cost: Math.round(totalCost * 10000) / 10000,
      by_capability: Array.from(capabilityMap.entries()).map(([id, stats]) => ({
        capability_id: id,
        requests: stats.requests,
        cost: Math.round(stats.cost * 10000) / 10000,
      })),
      by_day: Array.from(dayMap.entries()).map(([date, stats]) => ({
        date,
        requests: stats.requests,
        cost: Math.round(stats.cost * 10000) / 10000,
      })),
    })
  })

  // GET /v1/usage/costs
  app.get('/costs', async (request, reply) => {
    const query = request.query as { orgId?: string }
    const orgAccess = resolveOrgAccess(request, query.orgId)
    if (!orgAccess.ok) {
      return reply.code(orgAccess.status).send(orgAccess.body)
    }
    const orgId = orgAccess.orgId

    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const records = await db
      .select({
        requestCount: usageRecords.requestCount,
        cost: usageRecords.cost,
      })
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.orgId, orgId),
          gte(usageRecords.createdAt, startOfMonth),
        ),
      )

    let totalRequests = 0
    let totalCost = 0
    for (const rec of records) {
      totalRequests += rec.requestCount || 1
      totalCost += parseFloat(rec.cost || '0') || 0
    }

    const daysPassed = Math.max(1, now.getDate())
    const dailyAverage = totalCost / daysPassed

    return reply.send({
      current_period: {
        requests: totalRequests,
        cost: Math.round(totalCost * 10000) / 10000,
        start: startOfMonth.toISOString(),
        end: now.toISOString(),
      },
      daily_average: Math.round(dailyAverage * 10000) / 10000,
    })
  })

  // GET /v1/usage/quota
  app.get('/quota', async (request, reply) => {
    const query = request.query as { orgId?: string }
    const orgAccess = resolveOrgAccess(request, query.orgId)
    if (!orgAccess.ok) {
      return reply.code(orgAccess.status).send(orgAccess.body)
    }

    const quota = await getQuota(db, orgAccess.orgId)
    if (!quota) {
      return reply.code(404).send({ error: 'not_found', message: 'Organization not found' })
    }

    const body: UsageQuotaResponse = {
      billing_mode: quota.billingMode,
      cap: quota.cap,
      used: quota.used,
      remaining: quota.remaining,
      percent: quota.percent,
      period_month: quota.periodMonth,
      alerts: {
        eighty_percent_sent_at: quota.alert80SentAt?.toISOString() ?? null,
        hundred_percent_sent_at: quota.alert100SentAt?.toISOString() ?? null,
      },
    }
    return reply.send(body)
  })

  // POST /v1/usage/ingest
  app.post('/ingest', async (request, reply) => {
    // The web app forwards Canary hits with the internal secret and names the organization in ?orgId=.
    const query = request.query as { orgId?: string }
    const orgAccess = resolveOrgAccess(request, request.internalCaller ? query.orgId : undefined)
    if (!orgAccess.ok) {
      return reply.code(orgAccess.status).send(orgAccess.body)
    }
    const orgId = orgAccess.orgId

    const parsed = usageIngestRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: parsed.error.flatten(),
      })
    }
    const { events, source } = parsed.data
    if (request.internalCaller && events.some((event) => event.event_type !== ZERO_UNIT_EVENT_TYPE)) {
      return reply.code(403).send({
        error: 'forbidden',
        message: `The internal secret may only ingest ${ZERO_UNIT_EVENT_TYPE} events`,
      })
    }

    const requestedSiteIds = [...new Set(events.flatMap((event) => (event.site_id ? [event.site_id] : [])))]
    const ownedSiteIds = new Set<string>()
    if (requestedSiteIds.length > 0) {
      const owned = await db
        .select({ id: registeredSites.id })
        .from(registeredSites)
        .where(and(eq(registeredSites.orgId, orgId), inArray(registeredSites.id, requestedSiteIds)))
      for (const site of owned) ownedSiteIds.add(site.id)
    }

    const now = new Date()
    const trustedSource = source === 'api' && isPlatformCaller(request)
    const built = events.map((event) =>
      buildUsageEventRow(event, {
        orgId,
        apiKeyId: request.apiKey?.id ?? null,
        source: trustedSource ? 'api' : 'middleware',
        ownedSiteIds,
        now,
      }),
    )
    const batch = dedupeBatchByEventId(built)

    const result = await reserveEvents(
      db,
      orgId,
      async (tx) => {
        const plan = await planIngest(tx, orgId, batch.rows, now)
        return { unitsPerEvent: plan.billableRows.map((row) => row.units), plan }
      },
      (tx, acceptedBillable, plan) =>
        insertUsageEvents(tx, [...plan.zeroUnitRows, ...plan.billableRows.slice(0, acceptedBillable)]),
      now,
    )
    if (!result) {
      return reply.code(404).send({ error: 'not_found', message: 'Organization not found' })
    }

    const { quota, plan } = result
    const attempted = plan.zeroUnitRows.length + result.accepted
    const counters: IngestCounters = {
      accepted: result.stored,
      rejected: result.rejected,
      duplicates: batch.duplicates + plan.duplicates + (attempted - result.stored),
      skippedBlocked: plan.skippedBlocked,
    }

    if (plan.billableRows.length === 0) {
      return reply.send(toIngestResponse(counters, quota))
    }

    await checkQuotaAlerts(db, orgId, quota, { logger: request.log }, now)

    const atCap = quota.remaining !== null && quota.remaining <= 0
    if (result.accepted === 0 || atCap) {
      const body: UsageQuotaExceeded = {
        error: 'quota_exceeded',
        accepted: counters.accepted,
        rejected: counters.rejected,
        duplicates: counters.duplicates,
        skipped_blocked: counters.skippedBlocked,
        cap: quota.cap,
        used: quota.used,
        remaining: 0,
        billing_mode: quota.billingMode,
        retry_after_seconds: QUOTA_RETRY_AFTER_SECONDS,
      }
      return reply.code(429).header('retry-after', String(QUOTA_RETRY_AFTER_SECONDS)).send(body)
    }

    return reply.send(toIngestResponse(counters, quota))
  })
}
