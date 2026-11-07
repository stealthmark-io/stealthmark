import { eq, sql, and } from 'drizzle-orm'
import { capabilities, organizations, reviews, trustScores, usageRecords, type DbClient } from '@stealthmark/db'

export interface TrustDimensions {
  identity: {
    ownerVerified: boolean
    domainVerified: boolean
    endpointVerified: boolean
    identityScore: number
    score?: number
  }
  reliability: {
    successRate: number
    medianLatencyMs: number
    availability: number
    totalExecutions: number
    reliabilityScore: number
  }
  evidence: {
    verificationEvents: number
    evidenceFactor: number
    usageVolume: number
  }
}

export interface TrustScoreResult {
  capabilityId: string
  score: number | null
  scoreFormatted: string
  label: 'new' | 'emerging' | 'established' | 'trusted'
  qualityScore: number | null
  reputationScore: number | null
  dimensions: TrustDimensions
  updatedAt: Date
}

function boolToNum(val: boolean): number {
  return val ? 1 : 0
}

export class CapabilityNotFoundError extends Error {
  constructor(readonly capabilityId: string) {
    super(`Capability with id ${capabilityId} not found`)
    this.name = 'CapabilityNotFoundError'
  }
}

export async function calculateTrustScore(db: DbClient, capabilityId: string): Promise<TrustScoreResult> {
  // 1. Fetch capability and organization info
  const [cap] = await db
    .select({
      id: capabilities.id,
      orgId: capabilities.orgId,
      endpoint: capabilities.endpoint,
      trustScore: capabilities.trustScore,
    })
    .from(capabilities)
    .where(eq(capabilities.id, capabilityId))
    .limit(1)

  if (!cap) {
    throw new CapabilityNotFoundError(capabilityId)
  }

  const [org] = await db
    .select({
      domain: organizations.domain,
      status: organizations.status,
    })
    .from(organizations)
    .where(eq(organizations.id, cap.orgId))
    .limit(1)

  // 2. Fetch existing trust score record if available
  const [existingRecord] = await db
    .select()
    .from(trustScores)
    .where(eq(trustScores.capabilityId, capabilityId))
    .limit(1)

  // Identity verification checks
  const ownerVerified = org?.status === 'active' || !!existingRecord?.ownerVerified
  const domainVerified = !!org?.domain || !!existingRecord?.domainVerified
  const endpointVerified = !!cap.endpoint || !!existingRecord?.endpointVerified

  const identityScore =
    ((boolToNum(ownerVerified) + boolToNum(domainVerified) + boolToNum(endpointVerified)) / 3) * 100

  // 3. Aggregate reliability from usage_records
  const usageStats = await db
    .select({
      total: sql<number>`count(*)::int`,
      successful: sql<number>`count(case when ${usageRecords.success} = true then 1 end)::int`,
      avgLatency: sql<number>`coalesce(avg(${usageRecords.latencyMs}), 0)::int`,
    })
    .from(usageRecords)
    .where(eq(usageRecords.capabilityId, capabilityId))

  const totalExecutions = usageStats[0]?.total || existingRecord?.totalExecutions || 0
  const successfulExecutions = usageStats[0]?.successful || 0
  const successRate = totalExecutions > 0 ? successfulExecutions / totalExecutions : 1.0
  const medianLatencyMs = usageStats[0]?.avgLatency || existingRecord?.medianLatencyMs || 1200
  const availability = totalExecutions > 0 ? successRate : 1.0

  // 4. Evidence factor: logarithmic scaling up to 100,000 executions
  const evidenceFactor = Math.min(1.0, Math.log10(totalExecutions + 1) / 5)

  // 5. Score calculation
  const latencyFactor = Math.max(0, 1 - medianLatencyMs / 10000)
  const reliabilityScore = successRate * 50 + availability * 30 + latencyFactor * 20

  const calculatedRawScore = Math.round(
    identityScore * 0.3 + reliabilityScore * 0.5 + evidenceFactor * 100 * 0.2
  )

  // 6. Label assignment
  const label: 'new' | 'emerging' | 'established' | 'trusted' =
    totalExecutions < 10
      ? 'new'
      : totalExecutions < 100
      ? 'emerging'
      : totalExecutions < 1000
      ? 'established'
      : 'trusted'

  // Rule: When label === 'new', do NOT expose numeric score to avoid false precision
  const finalScore = label === 'new' ? null : calculatedRawScore
  const scoreFormatted = label === 'new' ? 'New — Insufficient Data' : `${calculatedRawScore}/100`

  // 7. Dynamic Reputation (Trust v0 + Quality Score + Execution Volume + Verified Reviews)
  const reviewStats = await db
    .select({
      avgRating: sql<number>`coalesce(avg(${reviews.rating}), 0)::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(eq(reviews.capabilityId, capabilityId))

  const avgReviewRating = reviewStats[0]?.avgRating || 0
  const reviewCount = reviewStats[0]?.count || 0
  const reviewScore = reviewCount > 0 ? (avgReviewRating / 5) * 100 : (calculatedRawScore || 80)
  const currentQuality = existingRecord?.qualityScore ?? calculatedRawScore ?? 85

  const calculatedReputation = Math.min(
    100,
    Math.max(
      10,
      Math.round(
        (calculatedRawScore || 70) * 0.30 +
        currentQuality * 0.35 +
        (evidenceFactor * 100) * 0.15 +
        reviewScore * 0.20
      )
    )
  )

  const finalReputation = label === 'new' ? null : calculatedReputation

  // 8. Persist to trust_scores and capabilities tables
  const now = new Date()
  if (existingRecord) {
    await db
      .update(trustScores)
      .set({
        ownerVerified,
        domainVerified,
        endpointVerified,
        successRate: String(successRate),
        medianLatencyMs,
        availability: String(availability),
        totalExecutions,
        score: finalScore,
        scoreLabel: label,
        qualityScore: currentQuality,
        reputationScore: finalReputation,
        updatedAt: now,
      })
      .where(eq(trustScores.id, existingRecord.id))
  } else {
    await db.insert(trustScores).values({
      capabilityId,
      ownerVerified,
      domainVerified,
      endpointVerified,
      successRate: String(successRate),
      medianLatencyMs,
      availability: String(availability),
      totalExecutions,
      score: finalScore,
      scoreLabel: label,
      qualityScore: currentQuality,
      reputationScore: finalReputation,
      updatedAt: now,
    })
  }

  await db
    .update(capabilities)
    .set({
      trustScore: finalScore,
      updatedAt: now,
    })
    .where(eq(capabilities.id, capabilityId))

  return {
    capabilityId,
    score: finalScore,
    scoreFormatted,
    label,
    qualityScore: currentQuality,
    reputationScore: finalReputation,
    dimensions: {
      identity: {
        ownerVerified,
        domainVerified,
        endpointVerified,
        score: Math.round(identityScore),
        identityScore: Math.round(identityScore),
      },
      reliability: {
        successRate,
        medianLatencyMs,
        availability,
        totalExecutions,
        reliabilityScore: Math.round(reliabilityScore),
      },
      evidence: {
        verificationEvents: existingRecord?.verificationEvents || 1,
        evidenceFactor: Number(evidenceFactor.toFixed(3)),
        usageVolume: totalExecutions,
      },
    },
    updatedAt: now,
  }
}

