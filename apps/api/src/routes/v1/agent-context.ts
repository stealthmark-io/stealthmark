import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { agents, type DbClient } from '@stealthmark/db'
import { orgScope, resolveOrgAccess } from '../../lib/org-context.js'
import {
  getAgentContext,
  setAgentPreference,
  recordAgentExecution,
  getNetworkIntelligence,
} from '../../services/agent-context.js'

const agentIdParamSchema = z.object({
  id: z.string().uuid('Valid agent UUID required'),
})

const queryContextSchema = z.object({
  capabilityId: z.string().uuid().optional(),
})

const setPreferenceSchema = z.object({
  org_id: z.string().uuid('Organization ID is required'),
  capability_id: z.string().uuid('Capability ID is required'),
  provider_org_id: z.string().uuid().optional(),
  preference_score: z.number().min(-1.0).max(1.0, 'Preference score must be between -1.0 and 1.0'),
  preference_reason: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const recordExecutionSchema = z.object({
  org_id: z.string().uuid('Organization ID is required'),
  capability_id: z.string().uuid('Capability ID is required'),
  provider_org_id: z.string().uuid().optional(),
  success: z.boolean(),
  latency_ms: z.number().int().nonnegative().optional(),
  cost_usd: z.number().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const networkIntelligenceQuerySchema = z.object({
  capabilityId: z.string().uuid().optional(),
})

const agentNotFound = { error: 'not_found', message: 'Agent not found' }

export async function agentContextRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  async function agentExists(condition: ReturnType<typeof and>): Promise<boolean> {
    const [agent] = await db.select({ id: agents.id }).from(agents).where(condition).limit(1)
    return Boolean(agent)
  }

  // GET /v1/agents/:id/context
  app.get('/agents/:id/context', async (request, reply) => {
    const paramsResult = agentIdParamSchema.safeParse(request.params)
    if (!paramsResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: paramsResult.error.flatten(),
      })
    }

    const queryResult = queryContextSchema.safeParse(request.query)
    const capabilityId = queryResult.success ? queryResult.data.capabilityId : undefined

    const owned = await agentExists(and(eq(agents.id, paramsResult.data.id), orgScope(request, agents.orgId)))
    if (!owned) {
      return reply.code(404).send(agentNotFound)
    }

    const contexts = await getAgentContext(db, paramsResult.data.id, capabilityId)

    return reply.send({
      agent_id: paramsResult.data.id,
      total_records: contexts.length,
      context: contexts.map((c) => ({
        id: c.id,
        capability_id: c.capabilityId,
        provider_org_id: c.providerOrgId,
        total_executions: c.totalExecutions,
        successful_executions: c.successfulExecutions,
        reliability_percent:
          c.totalExecutions > 0 ? Math.round((c.successfulExecutions / c.totalExecutions) * 100) : null,
        avg_latency_ms: c.avgLatencyMs,
        avg_cost_usd: c.avgCostUsd ? parseFloat(c.avgCostUsd) : null,
        last_execution_at: c.lastExecutionAt,
        preference_score: parseFloat(c.preferenceScore),
        preference_reason: c.preferenceReason,
        context_type: c.contextType,
        metadata: c.metadata,
      })),
    })
  })

  // POST /v1/agents/:id/context
  app.post('/agents/:id/context', async (request, reply) => {
    const paramsResult = agentIdParamSchema.safeParse(request.params)
    if (!paramsResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: paramsResult.error.flatten(),
      })
    }

    const bodyResult = setPreferenceSchema.safeParse(request.body)
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: bodyResult.error.flatten(),
      })
    }

    const { org_id, capability_id, provider_org_id, preference_score, preference_reason, metadata } =
      bodyResult.data

    const orgAccess = resolveOrgAccess(request, org_id)
    if (!orgAccess.ok) {
      return reply.code(orgAccess.status).send(orgAccess.body)
    }
    if (!(await agentExists(and(eq(agents.id, paramsResult.data.id), eq(agents.orgId, orgAccess.orgId))))) {
      return reply.code(404).send(agentNotFound)
    }

    const updated = await setAgentPreference(db, {
      orgId: orgAccess.orgId,
      agentId: paramsResult.data.id,
      capabilityId: capability_id,
      providerOrgId: provider_org_id,
      preferenceScore: preference_score,
      preferenceReason: preference_reason,
      metadata,
    })

    return reply.code(200).send({
      message: 'Agent context preference updated successfully',
      context: updated,
    })
  })

  // POST /v1/agents/:id/context/record
  app.post('/agents/:id/context/record', async (request, reply) => {
    const paramsResult = agentIdParamSchema.safeParse(request.params)
    if (!paramsResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: paramsResult.error.flatten(),
      })
    }

    const bodyResult = recordExecutionSchema.safeParse(request.body)
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: bodyResult.error.flatten(),
      })
    }

    const { org_id, capability_id, provider_org_id, success, latency_ms, cost_usd, metadata } =
      bodyResult.data

    const orgAccess = resolveOrgAccess(request, org_id)
    if (!orgAccess.ok) {
      return reply.code(orgAccess.status).send(orgAccess.body)
    }
    if (!(await agentExists(and(eq(agents.id, paramsResult.data.id), eq(agents.orgId, orgAccess.orgId))))) {
      return reply.code(404).send(agentNotFound)
    }

    const record = await recordAgentExecution(db, {
      orgId: orgAccess.orgId,
      agentId: paramsResult.data.id,
      capabilityId: capability_id,
      providerOrgId: provider_org_id,
      success,
      latencyMs: latency_ms,
      costUsd: cost_usd,
      metadata,
    })

    return reply.code(201).send({
      message: 'Agent execution outcome recorded',
      context: record,
    })
  })

  // GET /v1/intelligence/network
  app.get('/intelligence/network', async (request, reply) => {
    const queryResult = networkIntelligenceQuerySchema.safeParse(request.query)
    const capabilityId = queryResult.success ? queryResult.data.capabilityId : undefined

    const intelligence = await getNetworkIntelligence(db, capabilityId)

    return reply.send({
      timestamp: new Date().toISOString(),
      network_intelligence: intelligence,
    })
  })
}
