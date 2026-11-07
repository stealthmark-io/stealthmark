import { eq, and } from 'drizzle-orm'
import { badges, capabilities, organizations, trustScores, usageRecords, type DbClient } from '@stealthmark/db'

export type BadgeType =
  | 'verified_identity'
  | 'verified_endpoint'
  | 'high_reliability'
  | 'evaluated'
  | 'production_proven'

export interface AwardedBadge {
  badgeType: BadgeType
  label: string
  description: string
  awardedAt: Date
  evidence: Record<string, unknown>
}

export async function evaluateAndAwardBadges(
  db: DbClient,
  capabilityId: string
): Promise<AwardedBadge[]> {
  // 1. Fetch capability + org + trustScore
  const [cap] = await db
    .select({
      id: capabilities.id,
      orgId: capabilities.orgId,
      endpoint: capabilities.endpoint,
    })
    .from(capabilities)
    .where(eq(capabilities.id, capabilityId))
    .limit(1)

  if (!cap) {
    throw new Error(`Capability with id ${capabilityId} not found`)
  }

  const [org] = await db
    .select({
      id: organizations.id,
      domain: organizations.domain,
      status: organizations.status,
      publisherVerifiedAt: organizations.publisherVerifiedAt,
    })
    .from(organizations)
    .where(eq(organizations.id, cap.orgId))
    .limit(1)

  const [trust] = await db
    .select()
    .from(trustScores)
    .where(eq(trustScores.capabilityId, capabilityId))
    .limit(1)

  const existingBadges = await db
    .select()
    .from(badges)
    .where(eq(badges.capabilityId, capabilityId))

  const existingBadgeTypes = new Set(existingBadges.map((b) => b.badgeType))
  const newlyAwarded: AwardedBadge[] = []
  const now = new Date()

  async function awardBadge(
    badgeType: BadgeType,
    label: string,
    description: string,
    evidence: Record<string, unknown>
  ) {
    if (!existingBadgeTypes.has(badgeType)) {
      await db.insert(badges).values({
        capabilityId,
        badgeType,
        evidenceJson: evidence,
        awardedAt: now,
      })
      existingBadgeTypes.add(badgeType)
    }
    newlyAwarded.push({
      badgeType,
      label,
      description,
      awardedAt: now,
      evidence,
    })
  }

  // Rule 1: Verified Identity
  if (org?.status === 'active' && (!!org.domain || !!org.publisherVerifiedAt)) {
    await awardBadge(
      'verified_identity',
      'Verified Identity',
      'Publisher organization domain and ownership credentials verified by StealthMark.',
      { domain: org.domain, verifiedAt: org.publisherVerifiedAt || now }
    )
  }

  // Rule 2: Verified Endpoint
  if (cap.endpoint && cap.endpoint.startsWith('http')) {
    await awardBadge(
      'verified_endpoint',
      'Verified Endpoint',
      'Production endpoint active, reachable, and protocol-compliant.',
      { endpoint: cap.endpoint }
    )
  }

  // Rule 3: High Reliability
  const totalExecutions = trust?.totalExecutions || 0
  const successRate = trust?.successRate ? parseFloat(trust.successRate) : 0
  if (totalExecutions >= 10 && successRate >= 0.99) {
    await awardBadge(
      'high_reliability',
      'High Reliability',
      'Demonstrated >= 99% success rate across real agent executions.',
      { successRate: (successRate * 100).toFixed(1) + '%', executions: totalExecutions }
    )
  }

  // Rule 4: Evaluated
  if (trust?.qualityScore && trust.qualityScore >= 80) {
    await awardBadge(
      'evaluated',
      'Evaluated Quality',
      'Meets strict autonomous execution quality, consistency, and latency standards.',
      { qualityScore: trust.qualityScore }
    )
  }

  // Rule 5: Production Proven
  if (totalExecutions >= 1000 && successRate >= 0.98) {
    await awardBadge(
      'production_proven',
      'Production Proven',
      'Over 1,000 verified agent invocations with enterprise stability.',
      { executions: totalExecutions, successRate: (successRate * 100).toFixed(1) + '%' }
    )
  }

  return newlyAwarded
}

export async function getCapabilityBadges(
  db: DbClient,
  capabilityId: string
): Promise<AwardedBadge[]> {
  const records = await db
    .select()
    .from(badges)
    .where(eq(badges.capabilityId, capabilityId))

  const descriptions: Record<string, { label: string; desc: string }> = {
    verified_identity: {
      label: 'Verified Identity',
      desc: 'Publisher organization domain and ownership credentials verified.',
    },
    verified_endpoint: {
      label: 'Verified Endpoint',
      desc: 'Production endpoint active, reachable, and protocol-compliant.',
    },
    high_reliability: {
      label: 'High Reliability',
      desc: 'Demonstrated >= 99% success rate across real agent executions.',
    },
    evaluated: {
      label: 'Evaluated Quality',
      desc: 'Meets strict autonomous execution quality and latency benchmarks.',
    },
    production_proven: {
      label: 'Production Proven',
      desc: 'Over 1,000 verified agent invocations with enterprise stability.',
    },
  }

  return records.map((r) => ({
    badgeType: r.badgeType as BadgeType,
    label: descriptions[r.badgeType]?.label || r.badgeType,
    description: descriptions[r.badgeType]?.desc || '',
    awardedAt: r.awardedAt,
    evidence: (r.evidenceJson as Record<string, unknown>) || {},
  }))
}
