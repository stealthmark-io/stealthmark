import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, sql } from 'drizzle-orm'
import { capabilities, capabilityProviders, trustScores, type DbClient } from '@stealthmark/db'
import { generateEmbedding, cosineSimilarity } from '../../services/embeddings.js'
import { calculateTrustScore } from '../../services/trust.js'
import { getCapabilityBadges } from '../../services/badges.js'
import { getAgentContext, calculateExperienceSignal } from '../../services/agent-context.js'

const discoverySearchSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  agent_id: z.string().uuid().optional(),
  type: z.enum(['primitive', 'tool', 'skill', 'agent']).optional(),
  protocols: z.array(z.string()).optional(),
  max_price: z.number().positive().optional(),
  min_trust: z.number().min(0).max(100).optional(),
  min_quality: z.number().min(0).max(100).optional(),
  limit: z.number().min(1).max(50).default(10),
})


const discoveryResolveSchema = z.object({
  capability_id: z.string().uuid('Valid capability ID required'),
})

export async function discoveryRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // POST /v1/discovery/search
  app.post('/search', async (request, reply) => {
    const parseResult = discoverySearchSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: parseResult.error.flatten(),
      })
    }

    const { query, agent_id, type, protocols, max_price, min_trust, min_quality, limit } = parseResult.data

    // 1. Generate embedding for query
    const queryEmbedding = await generateEmbedding(query)
    const lowerQuery = query.toLowerCase()

    // 2. Fetch agent context if agent_id provided
    const agentContexts = agent_id ? await getAgentContext(db, agent_id) : []
    const contextByCapId = new Map(agentContexts.map((ctx) => [ctx.capabilityId, ctx]))

    // 3. Fetch all candidate active capabilities with public visibility
    const candidates = await db
      .select()
      .from(capabilities)
      .where(and(eq(capabilities.status, 'active'), eq(capabilities.visibility, 'public')))

    // 4. Filter and score candidates
    const scoredResults = []

    for (const cap of candidates) {
      // Type filter
      if (type && cap.type !== type) continue

      // Protocol filter
      if (protocols && protocols.length > 0) {
        const hasProtocol = protocols.some((p) => cap.protocols.includes(p))
        if (!hasProtocol) continue
      }

      // Max price filter
      if (max_price !== undefined && cap.pricingAmount) {
        if (parseFloat(cap.pricingAmount) > max_price) continue
      }

      // Min trust filter
      if (min_trust !== undefined && (cap.trustScore === null || cap.trustScore < min_trust)) {
        continue
      }

      // Experience signal check (Discovery v2)
      const agentCtx = contextByCapId.get(cap.id)
      const expSignal = agent_id ? calculateExperienceSignal(agentCtx) : undefined

      // If blocked by agent policy, skip candidate
      if (expSignal?.isBlocked) {
        continue
      }

      // Fetch trust & quality metrics
      const [trustRecord] = await db
        .select()
        .from(trustScores)
        .where(eq(trustScores.capabilityId, cap.id))
        .limit(1)

      const qualityScore = trustRecord?.qualityScore ?? 80
      if (min_quality !== undefined && qualityScore < min_quality) {
        continue
      }

      const reputationScore = trustRecord?.reputationScore ?? cap.trustScore ?? 70

      // Calculate Semantic Similarity
      let relevanceScore = 0.5
      if (cap.embedding && Array.isArray(cap.embedding)) {
        relevanceScore = Math.max(0, cosineSimilarity(queryEmbedding, cap.embedding))
      } else {
        // Keyword fallback
        const text = `${cap.name} ${cap.description || ''} ${cap.category || ''}`.toLowerCase()
        const queryWords = lowerQuery.split(/\s+/).filter((w) => w.length > 2)
        if (queryWords.length > 0) {
          const matchCount = queryWords.filter((w) => text.includes(w)).length
          relevanceScore = matchCount > 0 ? (matchCount / queryWords.length) * 0.7 : 0.2
        }
      }

      // Exact keyword boost
      if (cap.name.toLowerCase().includes(lowerQuery) || (cap.description && cap.description.toLowerCase().includes(lowerQuery))) {
        relevanceScore = Math.min(1.0, relevanceScore + 0.2)
      }

      // Combined ranking: Relevance (50%), Dynamic Reputation (30%), Quality Score (20%)
      let combinedRank =
        relevanceScore * 0.5 +
        (reputationScore / 100) * 0.3 +
        (qualityScore / 100) * 0.2

      // Experience Signal Boost
      if (expSignal) {
        combinedRank = Math.max(0, Math.min(1.0, combinedRank + expSignal.scoreBoost))
      }

      const badges = await getCapabilityBadges(db, cap.id)

      scoredResults.push({
        capability_id: cap.id,
        type: cap.type,
        name: cap.name,
        slug: cap.slug,
        description: cap.description,
        category: cap.category,
        protocols: cap.protocols,
        trust_score: cap.trustScore,
        trust_label: cap.trustScore === null ? 'new' : cap.trustScore >= 80 ? 'trusted' : 'established',
        quality_score: qualityScore,
        reputation_score: reputationScore,
        badges,
        experience_signal: expSignal
          ? {
              score_boost: expSignal.scoreBoost,
              reliability_percent: expSignal.reliabilityPercent,
              total_executions: expSignal.totalExecutions,
              preference_score: expSignal.preferenceScore,
              reason: expSignal.reason,
            }
          : undefined,
        pricing: {
          unit: cap.pricingUnit || 'request',
          amount: cap.pricingAmount ? parseFloat(cap.pricingAmount) : 0,
        },
        relevance_score: Number(relevanceScore.toFixed(3)),
        combined_rank: Number(combinedRank.toFixed(3)),
      })
    }


    // Sort by combined rank descending
    scoredResults.sort((a, b) => b.combined_rank - a.combined_rank)
    const limitedResults = scoredResults.slice(0, limit)

    return reply.send({
      results: limitedResults,
      total: scoredResults.length,
    })
  })

  // POST /v1/discovery/resolve
  app.post('/resolve', async (request, reply) => {
    const parseResult = discoveryResolveSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: parseResult.error.flatten(),
      })
    }

    const { capability_id } = parseResult.data

    const [cap] = await db
      .select()
      .from(capabilities)
      .where(eq(capabilities.id, capability_id))
      .limit(1)

    if (!cap) {
      return reply.code(404).send({
        error: 'not_found',
        message: `Capability ${capability_id} not found`,
      })
    }

    // Fetch providers
    const providers = await db
      .select({
        protocol: capabilityProviders.protocol,
        endpoint: capabilityProviders.endpoint,
        priority: capabilityProviders.priority,
      })
      .from(capabilityProviders)
      .where(eq(capabilityProviders.capabilityId, capability_id))

    // If no explicit providers in capabilityProviders table, use cap.endpoint & cap.protocols
    const resolvedProviders =
      providers.length > 0
        ? providers
        : cap.protocols.map((proto, idx) => ({
            protocol: proto,
            endpoint: cap.endpoint || `https://api.stealthmark.io/v1/capabilities/${cap.slug}`,
            priority: idx,
          }))

    // Calculate/fetch Trust Score
    const trust = await calculateTrustScore(db, capability_id)

    return reply.send({
      capability: cap,
      providers: resolvedProviders,
      trust: {
        score: trust.score,
        scoreFormatted: trust.scoreFormatted,
        label: trust.label,
        dimensions: trust.dimensions,
      },
    })
  })
}
