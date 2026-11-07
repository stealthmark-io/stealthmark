import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { orgScope, resolveOrgAccess } from '../../lib/org-context.js'
import { idParams, parseParams } from '../../lib/params.js'
import { and, eq } from 'drizzle-orm'
import { agents, type DbClient } from '@stealthmark/db'

const createAgentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  orgId: z.string().uuid().optional(),
  description: z.string().optional(),
  protocols: z.array(z.string()).default(['REST', 'MCP']),
  agentCard: z.record(z.string(), z.unknown()).optional(),
})

const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  protocols: z.array(z.string()).optional(),
  agentCard: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['active', 'suspended', 'inactive']).optional(),
})

export async function agentsRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // POST /v1/agents
  app.post('/', async (request, reply) => {
    const parseResult = createAgentSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: parseResult.error.flatten(),
      })
    }

    const { name, description, protocols, agentCard } = parseResult.data
    const orgAccess = resolveOrgAccess(request, parseResult.data.orgId)
    if (!orgAccess.ok) {
      return reply.code(orgAccess.status).send(orgAccess.body)
    }
    const orgId = orgAccess.orgId

    const [created] = await db
      .insert(agents)
      .values({
        orgId,
        name,
        description: description || null,
        protocols,
        agentCard: agentCard || null,
        status: 'active',
      })
      .returning()

    return reply.code(201).send(created)
  })

  // GET /v1/agents
  app.get('/', async (request, reply) => {
    const query = request.query as { orgId?: string }
    const orgAccess = resolveOrgAccess(request, query.orgId)
    if (!orgAccess.ok) {
      return reply.code(orgAccess.status).send(orgAccess.body)
    }
    const orgId = orgAccess.orgId

    const agentList = await db
      .select()
      .from(agents)
      .where(eq(agents.orgId, orgId))

    return reply.send({ data: agentList })
  })

  // GET /v1/agents/:id
  app.get('/:id', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params

    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), orgScope(request, agents.orgId)))
      .limit(1)

    if (!agent) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'Agent not found',
      })
    }

    return reply.send(agent)
  })

  // PATCH /v1/agents/:id
  app.patch('/:id', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    const parseResult = updateAgentSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: parseResult.error.flatten(),
      })
    }

    const [updated] = await db
      .update(agents)
      .set({
        ...parseResult.data,
        updatedAt: new Date(),
      })
      .where(and(eq(agents.id, id), orgScope(request, agents.orgId)))
      .returning()

    if (!updated) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'Agent not found',
      })
    }

    return reply.send(updated)
  })

  // POST /v1/agents/:id/suspend
  app.post('/:id/suspend', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params

    const [suspended] = await db
      .update(agents)
      .set({
        status: 'suspended',
        updatedAt: new Date(),
      })
      .where(and(eq(agents.id, id), orgScope(request, agents.orgId)))
      .returning()

    if (!suspended) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'Agent not found',
      })
    }

    return reply.send({
      id: suspended.id,
      status: suspended.status,
    })
  })
}
