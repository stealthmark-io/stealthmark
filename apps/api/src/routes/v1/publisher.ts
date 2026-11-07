import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, sql, desc } from 'drizzle-orm'
import { capabilities, organizations, trustScores, usageRecords, type DbClient } from '@stealthmark/db'
import '../../middleware/api-key-auth.js'
import { generateEmbedding } from '../../services/embeddings.js'
import { calculateTrustScore } from '../../services/trust.js'
import { calculateQualityScore } from '../../services/evaluation.js'
import { evaluateAndAwardBadges, getCapabilityBadges } from '../../services/badges.js'

const registerPublisherSchema = z.object({
  tier: z.enum(['standard', 'verified', 'enterprise']).default('standard'),
  domain: z.string().optional(),
})

const publishCapabilitySchema = z.object({
  type: z.enum(['primitive', 'tool', 'skill', 'agent']),
  name: z.string().min(1, 'Name is required').max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-_]+$/, 'Slug must only contain lowercase alphanumeric characters, dashes, or underscores'),
  description: z.string().optional(),
  category: z.string().optional(),
  protocols: z.array(z.string()).default(['REST', 'MCP']),
  endpoint: z.string().url('Endpoint must be a valid URL').optional(),
  schemaJson: z.record(z.string(), z.unknown()).optional(),
  pricingUnit: z.enum(['request', 'minute', 'task', 'token']).default('request'),
  pricingAmount: z.number().positive().optional(),
  visibility: z.enum(['public', 'private', 'unlisted']).default('public'),
  slaJson: z
    .object({
      uptimeTarget: z.number().min(90).max(100).default(99.9),
      maxLatencyMs: z.number().positive().default(2000),
      supportTier: z.enum(['community', 'standard', 'priority']).default('standard'),
    })
    .optional(),
  documentationUrl: z.string().url().optional(),
  version: z.string().default('1.0.0'),
})

const updatePublisherCapabilitySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  protocols: z.array(z.string()).optional(),
  endpoint: z.string().url().optional(),
  schemaJson: z.record(z.string(), z.unknown()).optional(),
  pricingUnit: z.enum(['request', 'minute', 'task', 'token']).optional(),
  pricingAmount: z.number().positive().optional(),
  visibility: z.enum(['public', 'private', 'unlisted']).optional(),
  slaJson: z.record(z.string(), z.unknown()).optional(),
  documentationUrl: z.string().url().optional(),
  status: z.enum(['active', 'deprecated', 'disabled']).optional(),
  version: z.string().optional(),
})

export async function publisherRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // POST /v1/publisher/register — Enable publisher status for caller organization
  app.post('/register', async (request, reply) => {
    const orgId = request.orgId
    if (!orgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const parseResult = registerPublisherSchema.safeParse(request.body || {})
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'validation_error', details: parseResult.error.flatten() })
    }

    const { tier, domain } = parseResult.data
    const now = new Date()

    const [updatedOrg] = await db
      .update(organizations)
      .set({
        publisherEnabled: true,
        publisherTier: tier,
        publisherVerifiedAt: now,
        ...(domain ? { domain } : {}),
        updatedAt: now,
      })
      .where(eq(organizations.id, orgId))
      .returning()

    return reply.code(200).send({
      message: 'Publisher status activated successfully',
      organization: {
        id: updatedOrg.id,
        name: updatedOrg.name,
        slug: updatedOrg.slug,
        publisherEnabled: updatedOrg.publisherEnabled,
        publisherTier: updatedOrg.publisherTier,
        publisherVerifiedAt: updatedOrg.publisherVerifiedAt,
      },
    })
  })

  // POST /v1/publisher/capabilities — Publish new capability to the network
  app.post('/capabilities', async (request, reply) => {
    const orgId = request.orgId
    if (!orgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    // Verify publisher is enabled
    const [org] = await db
      .select({ publisherEnabled: organizations.publisherEnabled })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1)

    if (!org?.publisherEnabled) {
      return reply.code(403).send({
        error: 'publisher_not_registered',
        message: 'Organization must be registered as a publisher before publishing capabilities. Call POST /v1/publisher/register first.',
      })
    }

    const parseResult = publishCapabilitySchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'validation_error', details: parseResult.error.flatten() })
    }

    const data = parseResult.data

    // Check slug collision within org
    const [existing] = await db
      .select({ id: capabilities.id })
      .from(capabilities)
      .where(and(eq(capabilities.orgId, orgId), eq(capabilities.slug, data.slug)))
      .limit(1)

    if (existing) {
      return reply.code(409).send({
        error: 'conflict',
        message: `A capability with slug '${data.slug}' already exists in your organization`,
      })
    }

    // Generate semantic embedding
    const textToEmbed = `${data.name} ${data.type} ${data.category || ''} ${data.description || ''} ${data.protocols.join(' ')}`
    const embedding = await generateEmbedding(textToEmbed)

    const now = new Date()
    const [cap] = await db
      .insert(capabilities)
      .values({
        orgId,
        type: data.type,
        name: data.name,
        slug: data.slug,
        description: data.description || null,
        category: data.category || null,
        protocols: data.protocols,
        endpoint: data.endpoint || null,
        schemaJson: data.schemaJson || null,
        pricingUnit: data.pricingUnit,
        pricingAmount: data.pricingAmount ? String(data.pricingAmount) : null,
        visibility: data.visibility,
        slaJson: data.slaJson || null,
        documentationUrl: data.documentationUrl || null,
        version: data.version,
        embedding: embedding ? embedding : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    // Initialize trust score and automated evaluation
    const trustResult = await calculateTrustScore(db, cap.id)
    const qualityResult = await calculateQualityScore(db, cap.id)
    const awardedBadges = await evaluateAndAwardBadges(db, cap.id)

    return reply.code(201).send({
      capability: {
        id: cap.id,
        orgId: cap.orgId,
        type: cap.type,
        name: cap.name,
        slug: cap.slug,
        description: cap.description,
        protocols: cap.protocols,
        endpoint: cap.endpoint,
        pricingUnit: cap.pricingUnit,
        pricingAmount: cap.pricingAmount,
        visibility: cap.visibility,
        sla: cap.slaJson,
        documentationUrl: cap.documentationUrl,
        version: cap.version,
        status: cap.status,
        trustScore: trustResult.score,
        trustLabel: trustResult.label,
        qualityScore: qualityResult.qualityScore,
        reputationScore: trustResult.reputationScore,
        badges: awardedBadges,
        createdAt: cap.createdAt,
      },
    })
  })

  // GET /v1/publisher/capabilities — List publisher's capabilities with aggregated metrics
  app.get('/capabilities', async (request, reply) => {
    const orgId = request.orgId
    if (!orgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const publisherCaps = await db
      .select()
      .from(capabilities)
      .where(eq(capabilities.orgId, orgId))
      .orderBy(desc(capabilities.createdAt))

    // Enrich each capability with execution metrics, trust, quality, reputation, and badges
    const enriched = await Promise.all(
      publisherCaps.map(async (c) => {
        const [trust] = await db
          .select()
          .from(trustScores)
          .where(eq(trustScores.capabilityId, c.id))
          .limit(1)

        const usageStats = await db
          .select({
            totalExecutions: sql<number>`count(*)::int`,
            successfulExecutions: sql<number>`count(case when ${usageRecords.success} = true then 1 end)::int`,
            totalRevenue: sql<number>`coalesce(sum(${usageRecords.cost}), 0)::float`,
          })
          .from(usageRecords)
          .where(eq(usageRecords.capabilityId, c.id))

        const totalExecs = usageStats[0]?.totalExecutions || 0
        const successExecs = usageStats[0]?.successfulExecutions || 0
        const revenue = usageStats[0]?.totalRevenue || 0
        const successRate = totalExecs > 0 ? ((successExecs / totalExecs) * 100).toFixed(1) + '%' : '100%'

        const capBadges = await getCapabilityBadges(db, c.id)

        return {
          id: c.id,
          name: c.name,
          slug: c.slug,
          type: c.type,
          protocols: c.protocols,
          status: c.status,
          visibility: c.visibility,
          endpoint: c.endpoint,
          pricingUnit: c.pricingUnit,
          pricingAmount: c.pricingAmount,
          sla: c.slaJson,
          documentationUrl: c.documentationUrl,
          metrics: {
            totalExecutions: totalExecs,
            successRate,
            revenueGeneratedUsd: revenue,
          },
          trustScore: trust?.score ?? null,
          trustLabel: trust?.scoreLabel ?? 'new',
          qualityScore: trust?.qualityScore ?? null,
          reputationScore: trust?.reputationScore ?? null,
          badges: capBadges,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        }
      })
    )

    return reply.code(200).send({
      capabilities: enriched,
      total: enriched.length,
    })
  })

  // PATCH /v1/publisher/capabilities/:id — Update published capability
  app.patch('/capabilities/:id', async (request, reply) => {
    const orgId = request.orgId
    if (!orgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const { id } = request.params as { id: string }
    const parseResult = updatePublisherCapabilitySchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'validation_error', details: parseResult.error.flatten() })
    }

    const data = parseResult.data

    // Check ownership
    const [existing] = await db
      .select({ id: capabilities.id })
      .from(capabilities)
      .where(and(eq(capabilities.id, id), eq(capabilities.orgId, orgId)))
      .limit(1)

    if (!existing) {
      return reply.code(404).send({ error: 'not_found', message: 'Capability not found or not owned by your organization' })
    }

    const now = new Date()
    const [updated] = await db
      .update(capabilities)
      .set({
        ...(data.name ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.protocols ? { protocols: data.protocols } : {}),
        ...(data.endpoint !== undefined ? { endpoint: data.endpoint } : {}),
        ...(data.schemaJson !== undefined ? { schemaJson: data.schemaJson } : {}),
        ...(data.pricingUnit ? { pricingUnit: data.pricingUnit } : {}),
        ...(data.pricingAmount ? { pricingAmount: String(data.pricingAmount) } : {}),
        ...(data.visibility ? { visibility: data.visibility } : {}),
        ...(data.slaJson !== undefined ? { slaJson: data.slaJson } : {}),
        ...(data.documentationUrl !== undefined ? { documentationUrl: data.documentationUrl } : {}),
        ...(data.status ? { status: data.status } : {}),
        ...(data.version ? { version: data.version } : {}),
        updatedAt: now,
      })
      .where(eq(capabilities.id, id))
      .returning()

    // Re-evaluate badges after updates (e.g. endpoint change)
    await evaluateAndAwardBadges(db, id)

    return reply.code(200).send({ capability: updated })
  })
}
