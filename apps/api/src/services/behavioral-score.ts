import { eq } from 'drizzle-orm'
import { agentContext, type DbClient } from '@stealthmark/db'

export interface BehavioralScoreBreakdown {
  score: number // 0 - 100
  velocityScore: number // 0 - 100 (30% weight)
  errorRateScore: number // 0 - 100 (30% weight)
  consistencyScore: number // 0 - 100 (20% weight)
  historyScore: number // 0 - 100 (20% weight)
  requestsLastMinute: number
  requestsLastHour: number
  errorsLastHour: number
  scopeViolations: number
  isAnomalous: boolean
}

export interface AgentBehavioralProfile extends BehavioralScoreBreakdown {
  agentId: string
  lastRequestAt: Date | null
}

interface AgentRollingCounters {
  agentId: string
  requestTimestamps: number[] // timestamps in ms (last 60 min, circular window)
  errorTimestamps: number[]   // error timestamps in ms
  scopeViolations: number
  lastRequestAt: Date | null
}

// In-memory rolling counters registry per agent
const agentCountersMap = new Map<string, AgentRollingCounters>()

const WINDOW_ONE_HOUR_MS = 60 * 60 * 1000
const WINDOW_ONE_MINUTE_MS = 60 * 1000

function getOrCreateCounters(agentId: string): AgentRollingCounters {
  let entry = agentCountersMap.get(agentId)
  if (!entry) {
    entry = {
      agentId,
      requestTimestamps: [],
      errorTimestamps: [],
      scopeViolations: 0,
      lastRequestAt: null,
    }
    agentCountersMap.set(agentId, entry)
  }
  return entry
}

function pruneOldTimestamps(timestamps: number[], windowMs: number, now: number): number[] {
  const threshold = now - windowMs
  return timestamps.filter((t) => t >= threshold)
}

/**
 * Records an access event for an agent to update rolling window counters.
 */
export function recordAgentAccess(
  agentId: string,
  siteId: string,
  outcome: { success: boolean; scopeViolation?: boolean }
): void {
  const now = Date.now()
  const counters = getOrCreateCounters(agentId)

  counters.lastRequestAt = new Date(now)
  counters.requestTimestamps.push(now)

  if (!outcome.success) {
    counters.errorTimestamps.push(now)
  }

  if (outcome.scopeViolation) {
    counters.scopeViolations += 1
  }

  // Prune entries older than 1 hour to prevent memory bloat
  counters.requestTimestamps = pruneOldTimestamps(counters.requestTimestamps, WINDOW_ONE_HOUR_MS, now)
  counters.errorTimestamps = pruneOldTimestamps(counters.errorTimestamps, WINDOW_ONE_HOUR_MS, now)
}

/**
 * Computes a 0-100 behavioral score for an agent based on rolling metrics and historical experience.
 */
export async function calculateBehavioralScore(
  db: DbClient | null,
  agentId: string
): Promise<BehavioralScoreBreakdown> {
  const now = Date.now()
  const counters = getOrCreateCounters(agentId)

  // 1. Calculate Velocity Score (30% weight)
  // Prune to 1 minute and 1 hour
  const recentMinute = pruneOldTimestamps(counters.requestTimestamps, WINDOW_ONE_MINUTE_MS, now)
  const recentHour = pruneOldTimestamps(counters.requestTimestamps, WINDOW_ONE_HOUR_MS, now)
  const recentErrors = pruneOldTimestamps(counters.errorTimestamps, WINDOW_ONE_HOUR_MS, now)

  const requestsLastMinute = recentMinute.length
  const requestsLastHour = recentHour.length
  const errorsLastHour = recentErrors.length

  let velocityScore = 100
  if (requestsLastMinute > 120) {
    // Severe velocity spike
    velocityScore = Math.max(10, 100 - (requestsLastMinute - 120) * 2)
  } else if (requestsLastMinute > 60) {
    // Moderate velocity
    velocityScore = Math.max(50, 100 - (requestsLastMinute - 60))
  } else if (requestsLastMinute > 30) {
    velocityScore = 90
  }

  // 2. Calculate Error Rate Score (30% weight)
  let errorRateScore = 100
  if (requestsLastHour > 0) {
    const errorRate = errorsLastHour / requestsLastHour
    if (errorRate > 0.5) {
      errorRateScore = Math.max(10, Math.round(100 - errorRate * 120))
    } else if (errorRate > 0.2) {
      errorRateScore = Math.round(100 - errorRate * 80)
    } else if (errorRate > 0.05) {
      errorRateScore = 90
    }
  }

  // 3. Consistency & Scope Compliance (20% weight)
  let consistencyScore = 100
  if (counters.scopeViolations > 0) {
    // Scope violations heavily dock consistency score
    consistencyScore = Math.max(0, 100 - counters.scopeViolations * 30)
  }

  // 4. Historical Experience Score (20% weight)
  let historyScore = 80 // Default reasonable baseline when the agent has fewer than 5 recorded executions
  if (db) {
    const records = await db
      .select()
      .from(agentContext)
      .where(eq(agentContext.agentId, agentId))

    if (records.length > 0) {
      let totalExecs = 0
      let totalSuccess = 0
      for (const r of records) {
        totalExecs += r.totalExecutions
        totalSuccess += r.successfulExecutions
      }
      if (totalExecs >= 5) {
        const successRatio = totalSuccess / totalExecs
        historyScore = Math.round(successRatio * 100)
      }
    }
  }

  // Final Composite Score
  const rawScore =
    velocityScore * 0.3 +
    errorRateScore * 0.3 +
    consistencyScore * 0.2 +
    historyScore * 0.2

  const finalScore = Math.max(0, Math.min(100, Math.round(rawScore)))

  const isAnomalous =
    requestsLastMinute > 100 ||
    (requestsLastHour >= 10 && errorsLastHour / requestsLastHour > 0.5) ||
    counters.scopeViolations >= 3

  return {
    score: finalScore,
    velocityScore,
    errorRateScore,
    consistencyScore,
    historyScore,
    requestsLastMinute,
    requestsLastHour,
    errorsLastHour,
    scopeViolations: counters.scopeViolations,
    isAnomalous,
  }
}

/**
 * Returns full behavioral profile of an agent.
 */
export async function getAgentBehavioralProfile(
  db: DbClient | null,
  agentId: string
): Promise<AgentBehavioralProfile> {
  const counters = getOrCreateCounters(agentId)
  const breakdown = await calculateBehavioralScore(db, agentId)

  return {
    ...breakdown,
    agentId,
    lastRequestAt: counters.lastRequestAt,
  }
}

/**
 * Fast synchronous check if an agent is currently exhibiting anomalous behavior.
 */
export function isAnomalous(agentId: string): boolean {
  const counters = agentCountersMap.get(agentId)
  if (!counters) return false

  const now = Date.now()
  const recentMinute = pruneOldTimestamps(counters.requestTimestamps, WINDOW_ONE_MINUTE_MS, now)
  const recentHour = pruneOldTimestamps(counters.requestTimestamps, WINDOW_ONE_HOUR_MS, now)
  const recentErrors = pruneOldTimestamps(counters.errorTimestamps, WINDOW_ONE_HOUR_MS, now)

  const requestsLastMinute = recentMinute.length
  const requestsLastHour = recentHour.length
  const errorsLastHour = recentErrors.length

  return (
    requestsLastMinute > 100 ||
    (requestsLastHour >= 10 && errorsLastHour / requestsLastHour > 0.5) ||
    counters.scopeViolations >= 3
  )
}

/**
 * Resets rolling counters for a given agent.
 */
export function resetAgentCounters(agentId: string): void {
  agentCountersMap.delete(agentId)
}

/**
 * Clears all rolling counters (useful for test isolation).
 */
export function clearAllCounters(): void {
  agentCountersMap.clear()
}
