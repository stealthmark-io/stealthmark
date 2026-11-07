import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { canGrantScopes, orgScope, resolveOrgAccess } from '../../lib/org-context.js'
import { idParams, parseParams } from '../../lib/params.js'
import { eq, and } from 'drizzle-orm'
import { apiKeys, type DbClient } from '@stealthmark/db'
import { generateApiKey } from '../../lib/crypto.js'

const DEFAULT_SCOPES = ['extract', 'capabilities:read']

const createKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  orgId: z.string().uuid().optional(),
  scopes: z.array(z.string()).optional(),
  rateLimitRpm: z.number().int().positive().default(60),
  rateLimitRpd: z.number().int().positive().default(10000),
  spendLimit: z.string().optional(),
})

export async function apiKeysRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // POST /v1/api-keys
  app.post('/', async (request, reply) => {
    const parseResult = createKeySchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: parseResult.error.flatten(),
      })
    }

    const { name, rateLimitRpm, rateLimitRpd, spendLimit } = parseResult.data
    const orgAccess = resolveOrgAccess(request, parseResult.data.orgId)
    if (!orgAccess.ok) {
      return reply.code(orgAccess.status).send(orgAccess.body)
    }
    const orgId = orgAccess.orgId

    const scopes = parseResult.data.scopes
      ?? DEFAULT_SCOPES.filter((scope) => canGrantScopes(request, [scope]))

    if (!canGrantScopes(request, scopes)) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Cannot grant scopes beyond your own',
      })
    }

    const { key, keyHash, keyPrefix } = generateApiKey()

    const [created] = await db
      .insert(apiKeys)
      .values({
        orgId,
        keyHash,
        keyPrefix,
        name,
        scopes,
        rateLimitRpm,
        rateLimitRpd,
        spendLimit: spendLimit ? String(spendLimit) : null,
        status: 'active',
      })
      .returning()

    return reply.code(201).send({
      id: created.id,
      key, // Returned ONCE to client
      keyPrefix: created.keyPrefix,
      name: created.name,
      scopes: created.scopes,
      rateLimitRpm: created.rateLimitRpm,
      rateLimitRpd: created.rateLimitRpd,
      createdAt: created.createdAt,
    })
  })

  // GET /v1/api-keys
  app.get('/', async (request, reply) => {
    const query = request.query as { orgId?: string }
    const orgAccess = resolveOrgAccess(request, query.orgId)
    if (!orgAccess.ok) {
      return reply.code(orgAccess.status).send(orgAccess.body)
    }
    const orgId = orgAccess.orgId

    const keys = await db
      .select({
        id: apiKeys.id,
        keyPrefix: apiKeys.keyPrefix,
        name: apiKeys.name,
        scopes: apiKeys.scopes,
        rateLimitRpm: apiKeys.rateLimitRpm,
        rateLimitRpd: apiKeys.rateLimitRpd,
        status: apiKeys.status,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.orgId, orgId))

    return reply.send({ data: keys })
  })

  // DELETE /v1/api-keys/:id
  app.delete('/:id', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params

    const [updated] = await db
      .update(apiKeys)
      .set({ status: 'revoked' })
      .where(and(eq(apiKeys.id, id), orgScope(request, apiKeys.orgId)))
      .returning({ id: apiKeys.id, status: apiKeys.status })

    if (!updated) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'API key not found',
      })
    }

    return reply.send({
      success: true,
      id: updated.id,
      status: updated.status,
    })
  })
}
