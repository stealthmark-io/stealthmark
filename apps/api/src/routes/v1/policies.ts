import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type DbClient } from '@stealthmark/db'
import '../../middleware/api-key-auth.js'
import {
  createPolicy,
  listPolicies,
  evaluateExecutionPolicies,
  type PolicyRules,
} from '../../services/policy-engine.js'

const policyRulesSchema = z.object({
  maxCostPerTask: z.number().positive().optional(),
  dailySpendCap: z.number().positive().optional(),
  allowedCapabilities: z.array(z.string()).optional(),
  blockedCapabilities: z.array(z.string()).optional(),
  allowedIps: z.array(z.string()).optional(),
  requireApprovalOverCost: z.number().positive().optional(),
})

const createPolicySchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  type: z.enum(['spend_limit', 'rate_limit', 'capability_restriction', 'approval_required']),
  rules: policyRulesSchema,
  enforcementAction: z.enum(['block', 'flag', 'require_approval']).default('block'),
})

const evaluatePolicySchema = z.object({
  capabilityId: z.string().uuid(),
  cost: z.number().optional(),
  ipAddress: z.string().optional(),
})

export async function policiesRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // POST /v1/enterprise/policies — Define an enterprise governance policy
  app.post('/enterprise/policies', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const parseResult = createPolicySchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'validation_error', details: parseResult.error.flatten() })
    }

    try {
      const policy = await createPolicy(db, {
        orgId: callerOrgId,
        name: parseResult.data.name,
        description: parseResult.data.description,
        type: parseResult.data.type,
        rules: parseResult.data.rules as PolicyRules,
        enforcementAction: parseResult.data.enforcementAction,
      })

      return reply.code(201).send({
        message: 'Enterprise policy configured',
        policy,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create policy'
      return reply.code(400).send({ error: 'bad_request', message: msg })
    }
  })

  // GET /v1/enterprise/policies — List active enterprise policies
  app.get('/enterprise/policies', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const items = await listPolicies(db, callerOrgId)
    return reply.code(200).send({
      total: items.length,
      policies: items,
    })
  })

  // POST /v1/enterprise/policies/evaluate — Dry-run or evaluate policy constraints
  app.post('/enterprise/policies/evaluate', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const parseResult = evaluatePolicySchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'validation_error', details: parseResult.error.flatten() })
    }

    const evalResult = await evaluateExecutionPolicies(db, {
      orgId: callerOrgId,
      capabilityId: parseResult.data.capabilityId,
      cost: parseResult.data.cost,
      ipAddress: parseResult.data.ipAddress || request.ip,
    })

    return reply.code(200).send(evalResult)
  })
}
