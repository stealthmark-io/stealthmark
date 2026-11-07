import { eq, sql } from 'drizzle-orm'
import { capabilities, evaluations, tasks, trustScores, usageRecords, type DbClient } from '@stealthmark/db'

export interface QualityEvaluationResult {
  capabilityId: string
  qualityScore: number
  taskCompletionRate: number
  accuracy: number
  latencyP50: number
  latencyP99: number
  consistencyScore: number
  evaluatedAt: Date
}

export async function calculateQualityScore(
  db: DbClient,
  capabilityId: string
): Promise<QualityEvaluationResult> {
  // 1. Fetch capability
  const [cap] = await db
    .select({ id: capabilities.id })
    .from(capabilities)
    .where(eq(capabilities.id, capabilityId))
    .limit(1)

  if (!cap) {
    throw new Error(`Capability with id ${capabilityId} not found`)
  }

  // 2. Aggregate tasks execution metrics
  const taskStats = await db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(case when ${tasks.status} = 'completed' then 1 end)::int`,
    })
    .from(tasks)
    .where(eq(tasks.capabilityId, capabilityId))

  const totalTasks = taskStats[0]?.total || 0
  const completedTasks = taskStats[0]?.completed || 0
  const taskCompletionRate = totalTasks > 0 ? completedTasks / totalTasks : 1.0

  // 3. Aggregate usage_records for accuracy and latency distribution
  const usageStats = await db
    .select({
      total: sql<number>`count(*)::int`,
      successful: sql<number>`count(case when ${usageRecords.success} = true then 1 end)::int`,
      avgLatency: sql<number>`coalesce(avg(${usageRecords.latencyMs}), 0)::int`,
      maxLatency: sql<number>`coalesce(max(${usageRecords.latencyMs}), 0)::int`,
    })
    .from(usageRecords)
    .where(eq(usageRecords.capabilityId, capabilityId))

  const totalUsage = usageStats[0]?.total || 0
  const successfulUsage = usageStats[0]?.successful || 0
  const accuracy = totalUsage > 0 ? successfulUsage / totalUsage : 1.0
  const latencyP50 = usageStats[0]?.avgLatency || 1200
  const latencyP99 = usageStats[0]?.maxLatency || Math.max(latencyP50 * 2, 2500)

  // 4. Consistency score: variance between p50 and p99
  const consistencyScore = latencyP99 > 0
    ? Math.max(0.5, Math.min(1.0, 1 - (latencyP99 - latencyP50) / (latencyP99 + 1000)))
    : 0.95

  // 5. Composite Quality Score (0 - 100)
  // Accuracy (40%), Task completion (30%), Latency factor (20%), Consistency (10%)
  const latencyFactor = Math.max(0, 1 - latencyP50 / 8000)
  const qualityScore = Math.min(
    100,
    Math.max(
      10,
      Math.round(
        accuracy * 40 +
        taskCompletionRate * 30 +
        latencyFactor * 20 +
        consistencyScore * 10
      )
    )
  )

  const now = new Date()

  // 6. Record in evaluations table
  await db.insert(evaluations).values({
    capabilityId,
    qualityScore,
    taskCompletionRate: String(taskCompletionRate),
    accuracy: String(accuracy),
    latencyP50,
    latencyP99,
    consistencyScore: String(consistencyScore),
    evaluatedAt: now,
  })

  // 7. Update trustScores table with qualityScore
  await db
    .update(trustScores)
    .set({
      qualityScore,
      updatedAt: now,
    })
    .where(eq(trustScores.capabilityId, capabilityId))

  return {
    capabilityId,
    qualityScore,
    taskCompletionRate,
    accuracy,
    latencyP50,
    latencyP99,
    consistencyScore,
    evaluatedAt: now,
  }
}
