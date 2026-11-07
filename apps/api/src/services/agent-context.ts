import { eq, and, sql } from 'drizzle-orm'
import { agentContext, type AgentContext, type DbClient } from '@stealthmark/db'

export interface RecordExecutionParams {
  orgId: string
  agentId: string
  capabilityId: string
  providerOrgId?: string | null
  success: boolean
  latencyMs?: number
  costUsd?: number
  metadata?: Record<string, unknown>
}

export interface SetPreferenceParams {
  orgId: string
  agentId: string
  capabilityId: string
  providerOrgId?: string | null
  preferenceScore: number // -1.0 (blocked) to 1.0 (preferred)
  preferenceReason?: string
  metadata?: Record<string, unknown>
}

export interface ExperienceSignal {
  scoreBoost: number
  reliabilityPercent: number | null
  totalExecutions: number
  preferenceScore: number
  isBlocked: boolean
  reason: string
}

export interface NetworkCapabilityIntelligence {
  capabilityId: string
  totalExecutions: number
  successfulExecutions: number
  reliabilityPercent: number
  avgLatencyMs: number | null
  participatingAgentsCount: number
}

/**
 * Record an execution outcome for an agent using a specific capability/provider.
 * Updates rolling statistics (total runs, success rate, average latency and cost).
 */
export async function recordAgentExecution(
  db: DbClient,
  params: RecordExecutionParams
): Promise<AgentContext> {
  const { orgId, agentId, capabilityId, providerOrgId = null, success, latencyMs, costUsd, metadata } = params

  const conditions = [
    eq(agentContext.agentId, agentId),
    eq(agentContext.capabilityId, capabilityId),
  ]

  if (providerOrgId) {
    conditions.push(eq(agentContext.providerOrgId, providerOrgId))
  }

  const existing = await db
    .select()
    .from(agentContext)
    .where(and(...conditions))
    .limit(1)

  const now = new Date()

  if (existing.length > 0) {
    const record = existing[0]
    const newTotal = record.totalExecutions + 1
    const newSuccess = record.successfulExecutions + (success ? 1 : 0)

    let updatedLatency: number | null = record.avgLatencyMs
    if (latencyMs !== undefined) {
      updatedLatency = record.avgLatencyMs
        ? Math.round((record.avgLatencyMs * record.totalExecutions + latencyMs) / newTotal)
        : latencyMs
    }

    let updatedCost: string | null = record.avgCostUsd
    if (costUsd !== undefined) {
      const prevCost = record.avgCostUsd ? parseFloat(record.avgCostUsd) : 0
      const newCostAvg = (prevCost * record.totalExecutions + costUsd) / newTotal
      updatedCost = newCostAvg.toFixed(4)
    }

    const [updated] = await db
      .update(agentContext)
      .set({
        totalExecutions: newTotal,
        successfulExecutions: newSuccess,
        avgLatencyMs: updatedLatency,
        avgCostUsd: updatedCost,
        lastExecutionAt: now,
        updatedAt: now,
        metadata: metadata ? { ...((record.metadata as object) || {}), ...metadata } : record.metadata,
      })
      .where(eq(agentContext.id, record.id))
      .returning()

    return updated
  }

  // Insert new context record
  const [created] = await db
    .insert(agentContext)
    .values({
      orgId,
      agentId,
      capabilityId,
      providerOrgId,
      totalExecutions: 1,
      successfulExecutions: success ? 1 : 0,
      avgLatencyMs: latencyMs ?? null,
      avgCostUsd: costUsd ? String(costUsd) : null,
      lastExecutionAt: now,
      preferenceScore: '0.0',
      contextType: 'execution_outcome',
      metadata: metadata || null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  return created
}

/**
 * Retrieve execution context and learned memory for an agent.
 */
export async function getAgentContext(
  db: DbClient,
  agentId: string,
  capabilityId?: string
): Promise<AgentContext[]> {
  const conditions = [eq(agentContext.agentId, agentId)]
  if (capabilityId) {
    conditions.push(eq(agentContext.capabilityId, capabilityId))
  }

  return db
    .select()
    .from(agentContext)
    .where(and(...conditions))
    .orderBy(sql`${agentContext.lastExecutionAt} DESC NULLS LAST`)
}

/**
 * Set an explicit preference or policy constraint for an agent toward a capability/provider.
 */
export async function setAgentPreference(
  db: DbClient,
  params: SetPreferenceParams
): Promise<AgentContext> {
  const { orgId, agentId, capabilityId, providerOrgId = null, preferenceScore, preferenceReason, metadata } = params

  if (preferenceScore < -1.0 || preferenceScore > 1.0) {
    throw new Error('preferenceScore must be between -1.0 and 1.0')
  }

  const conditions = [
    eq(agentContext.agentId, agentId),
    eq(agentContext.capabilityId, capabilityId),
  ]
  if (providerOrgId) {
    conditions.push(eq(agentContext.providerOrgId, providerOrgId))
  }

  const existing = await db
    .select()
    .from(agentContext)
    .where(and(...conditions))
    .limit(1)

  const now = new Date()
  const scoreStr = preferenceScore.toFixed(2)

  if (existing.length > 0) {
    const [updated] = await db
      .update(agentContext)
      .set({
        preferenceScore: scoreStr,
        preferenceReason: preferenceReason || null,
        contextType: preferenceScore <= -0.8 ? 'policy_constraint' : 'provider_preference',
        updatedAt: now,
        metadata: metadata ? { ...((existing[0].metadata as object) || {}), ...metadata } : existing[0].metadata,
      })
      .where(eq(agentContext.id, existing[0].id))
      .returning()

    return updated
  }

  const [created] = await db
    .insert(agentContext)
    .values({
      orgId,
      agentId,
      capabilityId,
      providerOrgId,
      totalExecutions: 0,
      successfulExecutions: 0,
      preferenceScore: scoreStr,
      preferenceReason: preferenceReason || null,
      contextType: preferenceScore <= -0.8 ? 'policy_constraint' : 'provider_preference',
      metadata: metadata || null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  return created
}

/**
 * Calculate the experience signal from an agent context record.
 * Used by Discovery v2 and Capability Routing to personalize rankings.
 */
export function calculateExperienceSignal(contextRecord?: AgentContext | null): ExperienceSignal {
  if (!contextRecord) {
    return {
      scoreBoost: 0,
      reliabilityPercent: null,
      totalExecutions: 0,
      preferenceScore: 0,
      isBlocked: false,
      reason: 'No prior agent execution history',
    }
  }

  const prefScore = parseFloat(contextRecord.preferenceScore || '0.0')

  // Blocked constraint: negative threshold
  if (prefScore <= -0.8) {
    return {
      scoreBoost: -1.0,
      reliabilityPercent: contextRecord.totalExecutions > 0
        ? Math.round((contextRecord.successfulExecutions / contextRecord.totalExecutions) * 100)
        : null,
      totalExecutions: contextRecord.totalExecutions,
      preferenceScore: prefScore,
      isBlocked: true,
      reason: `Blocked by agent preference: ${contextRecord.preferenceReason || 'Explicit block'}`,
    }
  }

  if (contextRecord.totalExecutions === 0) {
    const boost = Number((prefScore * 0.25).toFixed(3))
    return {
      scoreBoost: boost,
      reliabilityPercent: null,
      totalExecutions: 0,
      preferenceScore: prefScore,
      isBlocked: false,
      reason: `Agent preference score: ${prefScore > 0 ? '+' : ''}${prefScore}`,
    }
  }

  const reliability = (contextRecord.successfulExecutions / contextRecord.totalExecutions) * 100
  let reliabilityBoost = 0

  if (reliability >= 95) {
    reliabilityBoost = 0.15
  } else if (reliability >= 80) {
    reliabilityBoost = 0.05
  } else if (reliability < 50) {
    reliabilityBoost = -0.20
  }

  const prefBoost = prefScore * 0.20
  const combinedBoost = Number(Math.max(-1.0, Math.min(0.35, reliabilityBoost + prefBoost)).toFixed(3))

  const formattedReason = `★ Used ${contextRecord.totalExecutions}x by this agent (${Math.round(reliability)}% success${
    prefScore !== 0 ? `, pref: ${prefScore > 0 ? '+' : ''}${prefScore}` : ''
  })`

  return {
    scoreBoost: combinedBoost,
    reliabilityPercent: Math.round(reliability),
    totalExecutions: contextRecord.totalExecutions,
    preferenceScore: prefScore,
    isBlocked: false,
    reason: formattedReason,
  }
}

/**
 * Retrieve anonymous aggregated network intelligence across all agent executions.
 */
export async function getNetworkIntelligence(
  db: DbClient,
  capabilityId?: string
): Promise<NetworkCapabilityIntelligence[]> {
  const query = db
    .select({
      capabilityId: agentContext.capabilityId,
      totalExecutions: sql<number>`coalesce(sum(${agentContext.totalExecutions}), 0)::int`,
      successfulExecutions: sql<number>`coalesce(sum(${agentContext.successfulExecutions}), 0)::int`,
      avgLatencyMs: sql<number>`coalesce(avg(${agentContext.avgLatencyMs}), 0)::int`,
      participatingAgentsCount: sql<number>`count(distinct ${agentContext.agentId})::int`,
    })
    .from(agentContext)

  if (capabilityId) {
    query.where(eq(agentContext.capabilityId, capabilityId))
  }

  const rows = await query.groupBy(agentContext.capabilityId)

  return rows.map((r) => {
    const total = r.totalExecutions || 0
    const successful = r.successfulExecutions || 0
    const reliability = total > 0 ? Math.round((successful / total) * 100) : 100
    return {
      capabilityId: r.capabilityId,
      totalExecutions: total,
      successfulExecutions: successful,
      reliabilityPercent: reliability,
      avgLatencyMs: r.avgLatencyMs || null,
      participatingAgentsCount: r.participatingAgentsCount || 0,
    }
  })
}
