import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  logGatewayAccessEvent,
  getPaginatedGatewayEvents,
  verifyGatewayChain,
  getSiteAnalytics,
} from '../../../services/gateway-audit.js'
import {
  getAgentBehavioralProfile,
  recordAgentAccess,
  resetAgentCounters,
} from '../../../services/behavioral-score.js'
import { getAgentOrgId, getPassportById } from '../../../services/passport.js'
import { requireScopes } from '../../../middleware/api-key-auth.js'
import { isAuthorizedForOrg } from '../../../lib/org-context.js'
import { idParams, parseParams } from '../../../lib/params.js'
import { loadOwnedSite, parseLimit, type GatewayDeps } from './shared.js'

// The organization is always taken from the site; a client-supplied orgId is ignored.
const recordAccessSchema = z.object({
  agentId: z.string().uuid().optional(),
  passportId: z.string().uuid().optional(),
  action: z.enum(['allowed', 'blocked', 'rate_limited', 'revoked']),
  reason: z.string().optional(),
  ipAddress: z.string().optional(),
  latencyMs: z.number().int().optional(),
})

export async function registerEventRoutes(app: FastifyInstance, { db }: GatewayDeps) {
  // POST /v1/gateway/sites/:id/access — Record an access event (e.g., from SDK reporter)
  app.post('/sites/:id/access', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    const site = await loadOwnedSite(db, request, reply, id)
    if (!site) return reply

    const parse = recordAccessSchema.safeParse(request.body)
    if (!parse.success) {
      return reply.code(400).send({ error: 'validation_error', details: parse.error.flatten() })
    }

    const { action, reason, ipAddress, latencyMs, agentId, passportId } = parse.data

    if (agentId && (await getAgentOrgId(db, agentId)) !== site.orgId) {
      return reply.code(400).send({ error: 'bad_request', message: 'agentId does not belong to the site organization' })
    }
    if (passportId) {
      const passport = await getPassportById(db, passportId)
      if (!passport || passport.orgId !== site.orgId) {
        return reply.code(400).send({ error: 'bad_request', message: 'passportId does not belong to the site organization' })
      }
    }

    const event = await logGatewayAccessEvent(db, {
      siteId: site.id,
      orgId: site.orgId,
      passportId: passportId || null,
      agentId: agentId || null,
      action,
      reason: reason || null,
      ipAddress: ipAddress || request.ip,
      latencyMs: latencyMs || null,
    })

    if (agentId) {
      recordAgentAccess(agentId, site.id, {
        success: action === 'allowed',
        scopeViolation: action === 'blocked' && (reason?.includes('scope') || false),
      })
    }

    return reply.code(201).send(event)
  })

  // GET /v1/gateway/sites/:id/events — List access events for a site
  app.get('/sites/:id/events', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    const site = await loadOwnedSite(db, request, reply, id)
    if (!site) return reply

    const query = request.query as { limit?: string; cursor?: string }
    const { events, nextCursor, hasMore } = await getPaginatedGatewayEvents(db, id, parseLimit(query.limit), query.cursor)
    return reply.send({ events, nextCursor, hasMore })
  })

  // GET /v1/gateway/sites/:id/events/verify — Verify SHA-256 hash chain
  app.get('/sites/:id/events/verify', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    const site = await loadOwnedSite(db, request, reply, id)
    if (!site) return reply

    return reply.send(await verifyGatewayChain(db, id))
  })

  // GET /v1/gateway/sites/:id/analytics — Aggregated site gateway analytics
  app.get('/sites/:id/analytics', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    const site = await loadOwnedSite(db, request, reply, id)
    if (!site) return reply

    return reply.send(await getSiteAnalytics(db, id))
  })

  // GET /v1/gateway/agents/:id/behavioral — Get agent behavioral profile (own organization only)
  app.get('/agents/:id/behavioral', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    const agentOrgId = await getAgentOrgId(db, id)
    if (!agentOrgId || !isAuthorizedForOrg(request, agentOrgId)) {
      return reply.code(404).send({ error: 'not_found', message: 'Agent not found' })
    }

    return reply.send(await getAgentBehavioralProfile(db, id))
  })

  // POST /v1/gateway/agents/:id/behavioral/reset — Reset agent behavioral counters (requires admin scope and ownership of the agent)
  app.post('/agents/:id/behavioral/reset', { preHandler: [requireScopes('admin')] }, async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    const agentOrgId = await getAgentOrgId(db, id)
    if (!agentOrgId || !isAuthorizedForOrg(request, agentOrgId)) {
      return reply.code(404).send({ error: 'not_found', message: 'Agent not found' })
    }
    resetAgentCounters(id)
    return reply.send({ success: true, agentId: id, message: 'Behavioral counters reset' })
  })
}
