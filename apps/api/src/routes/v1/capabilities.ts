import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { orgScope, resolveOrgAccess } from '../../lib/org-context.js'
import { idParams, parseParams } from '../../lib/params.js'
import { eq, and, sql } from 'drizzle-orm'
import { capabilities, type DbClient } from '@stealthmark/db'
import { generateEmbedding } from '../../services/embeddings.js'
import { calculateTrustScore, CapabilityNotFoundError } from '../../services/trust.js'

const createCapabilitySchema = z.object({
  orgId: z.string().uuid().optional(),
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
  endpoint: z.string().url().optional(),
  schemaJson: z.record(z.string(), z.unknown()).optional(),
  pricingUnit: z.enum(['request', 'minute', 'task', 'token']).default('request'),
  pricingAmount: z.number().positive().optional(),
  version: z.string().default('1.0.0'),
})

const updateCapabilitySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  protocols: z.array(z.string()).optional(),
  endpoint: z.string().url().optional(),
  schemaJson: z.record(z.string(), z.unknown()).optional(),
  pricingUnit: z.enum(['request', 'minute', 'task', 'token']).optional(),
  pricingAmount: z.number().positive().optional(),
  status: z.enum(['active', 'deprecated', 'disabled']).optional(),
  version: z.string().optional(),
})

export async function capabilitiesRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // POST /v1/capabilities
  app.post('/', async (request, reply) => {
    const parseResult = createCapabilitySchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: parseResult.error.flatten(),
      })
    }

    const {
      type,
      name,
      slug,
      description,
      category,
      protocols,
      endpoint,
      schemaJson,
      pricingUnit,
      pricingAmount,
      version,
    } = parseResult.data

    const orgAccess = resolveOrgAccess(request, parseResult.data.orgId)
    if (!orgAccess.ok) {
      return reply.code(orgAccess.status).send(orgAccess.body)
    }
    const orgId = orgAccess.orgId

    // Check unique (orgId, slug)
    const [existing] = await db
      .select({ id: capabilities.id })
      .from(capabilities)
      .where(and(eq(capabilities.orgId, orgId), eq(capabilities.slug, slug)))
      .limit(1)

    if (existing) {
      return reply.code(409).send({
        error: 'conflict',
        message: `Capability with slug '${slug}' already exists in this organization`,
      })
    }

    const embeddingText = `${name} ${description || ''} ${category || ''}`.trim()
    const embedding = await generateEmbedding(embeddingText)

    const [created] = await db
      .insert(capabilities)
      .values({
        orgId,
        type,
        name,
        slug,
        description: description || null,
        category: category || null,
        protocols,
        endpoint: endpoint || null,
        schemaJson: schemaJson || null,
        pricingUnit,
        pricingAmount: pricingAmount ? String(pricingAmount) : null,
        version,
        status: 'active',
        embedding,
      })
      .returning()

    return reply.code(201).send(created)
  })

  // GET /v1/capabilities
  app.get('/', async (request, reply) => {
    const query = request.query as {
      type?: string
      category?: string
      orgId?: string
      page?: string
      limit?: string
    }

    const page = Math.max(1, parseInt(query.page || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10)))
    const offset = (page - 1) * limit

    const conditions = []
    if (query.type) conditions.push(eq(capabilities.type, query.type))
    if (query.category) conditions.push(eq(capabilities.category, query.category))
    if (query.orgId) conditions.push(eq(capabilities.orgId, query.orgId))

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const items = await db
      .select()
      .from(capabilities)
      .where(whereClause)
      .limit(limit)
      .offset(offset)

    return reply.send({
      data: items,
      page,
      limit,
    })
  })

  // GET /v1/capabilities/:id
  app.get('/:id', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params

    const [item] = await db
      .select()
      .from(capabilities)
      .where(eq(capabilities.id, id))
      .limit(1)

    if (!item) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'Capability not found',
      })
    }

    return reply.send(item)
  })

  // PATCH /v1/capabilities/:id
  app.patch('/:id', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    const parseResult = updateCapabilitySchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: parseResult.error.flatten(),
      })
    }

    const { pricingAmount, ...fields } = parseResult.data
    const updateData: Partial<typeof capabilities.$inferInsert> = {
      ...fields,
      updatedAt: new Date(),
      ...(pricingAmount !== undefined ? { pricingAmount: String(pricingAmount) } : {}),
    }
    const ownership = orgScope(request, capabilities.orgId)

    if (updateData.name || updateData.description || updateData.category) {
      const [existing] = await db
        .select({ name: capabilities.name, description: capabilities.description, category: capabilities.category })
        .from(capabilities)
        .where(and(eq(capabilities.id, id), ownership))
        .limit(1)

      if (existing) {
        const text = `${updateData.name || existing.name} ${updateData.description !== undefined ? updateData.description : (existing.description || '')} ${updateData.category !== undefined ? updateData.category : (existing.category || '')}`.trim()
        updateData.embedding = await generateEmbedding(text)
      }
    }

    const [updated] = await db
      .update(capabilities)
      .set(updateData)
      .where(and(eq(capabilities.id, id), ownership))
      .returning()

    if (!updated) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'Capability not found',
      })
    }

    return reply.send(updated)
  })

  // GET /v1/capabilities/:id/trust
  app.get('/:id/trust', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    try {
      const trust = await calculateTrustScore(db, id)
      return reply.send(trust)
    } catch (err: unknown) {
      if (err instanceof CapabilityNotFoundError) {
        return reply.code(404).send({ error: 'not_found', message: err.message })
      }
      request.log.error(err, 'Failed to calculate trust score')
      return reply.code(500).send({ error: 'internal_error', message: 'Failed to calculate trust score' })
    }
  })

  // POST /v1/capabilities/:id/verify
  app.post('/:id/verify', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    try {
      const trust = await calculateTrustScore(db, id)
      return reply.send({
        verification_id: `ver_${Date.now()}`,
        status: trust.dimensions.identity.endpointVerified ? 'verified' : 'pending',
        trust,
      })
    } catch (err: unknown) {
      if (err instanceof CapabilityNotFoundError) {
        return reply.code(404).send({ error: 'not_found', message: err.message })
      }
      request.log.error(err, 'Capability verification check failed')
      return reply.code(500).send({ error: 'internal_error', message: 'Verification check failed' })
    }
  })
}
