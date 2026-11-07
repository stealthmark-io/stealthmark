import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  registerSite,
  verifySiteDns,
  updateSitePolicy,
  listSitesByOrg,
  listAllSites,
  deleteSite,
} from '../../../services/site-registration.js'
import { requireScopes } from '../../../middleware/api-key-auth.js'
import { isPlatformCaller, resolveOrgAccess } from '../../../lib/org-context.js'
import { replyWithDomainError } from './errors.js'
import { loadOwnedSite, parseLimit, type GatewayDeps } from './shared.js'

const registerSiteSchema = z.object({
  orgId: z.string().uuid().optional(),
  domain: z.string().min(3),
  displayName: z.string().min(1),
  description: z.string().optional(),
  endpointUrl: z.string().url().optional().or(z.string().length(0)),
  accessPolicy: z.enum(['open', 'approved', 'invite_only']).default('open'),
  allowedScopes: z.array(z.string()).default([]),
  allowedAgentIds: z.array(z.string()).default([]),
  maxRpm: z.number().int().min(1).default(100),
  passportTtlSeconds: z.number().int().min(300).max(86400).default(3600),
})

const updateSiteSchema = z.object({
  displayName: z.string().min(1).optional(),
  description: z.string().optional(),
  endpointUrl: z.string().url().optional().or(z.string().length(0)),
  accessPolicy: z.enum(['open', 'approved', 'invite_only']).optional(),
  allowedScopes: z.array(z.string()).optional(),
  allowedAgentIds: z.array(z.string()).optional(),
  maxRpm: z.number().int().min(1).optional(),
  passportTtlSeconds: z.number().int().min(300).max(86400).optional(),
  status: z.enum(['pending', 'active', 'suspended']).optional(),
})

function nextCursorOf(sites: Array<{ createdAt: Date }>, limit: number): string | null {
  const last = sites[sites.length - 1]
  return sites.length >= limit && last?.createdAt ? last.createdAt.toISOString() : null
}

export async function registerSiteRoutes(app: FastifyInstance, { db }: GatewayDeps) {
  // POST /v1/gateway/sites — Register a new site
  app.post('/sites', async (request, reply) => {
    const parse = registerSiteSchema.safeParse(request.body)
    if (!parse.success) {
      return reply.code(400).send({ error: 'validation_error', details: parse.error.flatten() })
    }

    const access = resolveOrgAccess(request, parse.data.orgId)
    if (!access.ok) {
      return reply.code(access.status).send(access.body)
    }

    try {
      const result = await registerSite(db, { ...parse.data, orgId: access.orgId })
      return reply.code(201).send(result)
    } catch (err) {
      return replyWithDomainError(err, reply)
    }
  })

  // GET /v1/gateway/sites — List registered sites (BOLA protected, cursor paginated)
  app.get('/sites', async (request, reply) => {
    const query = request.query as { orgId?: string; status?: string; limit?: string; cursor?: string }
    const limit = parseLimit(query.limit)

    if (!query.orgId && !request.orgId && isPlatformCaller(request)) {
      const sites = await listAllSites(db, { status: query.status, limit, cursor: query.cursor })
      return reply.send({ sites, nextCursor: nextCursorOf(sites, limit) })
    }

    const access = resolveOrgAccess(request, query.orgId)
    if (!access.ok) {
      return reply.code(access.status).send(access.body)
    }

    const sites = await listSitesByOrg(db, access.orgId, { limit, cursor: query.cursor })
    return reply.send({ sites, nextCursor: nextCursorOf(sites, limit) })
  })

  // GET /v1/gateway/sites/:id — Get site by ID (BOLA protected)
  app.get('/sites/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const site = await loadOwnedSite(db, request, reply, id)
    if (!site) return reply
    return reply.send(site)
  })

  // PATCH /v1/gateway/sites/:id — Update site settings/policy (BOLA protected)
  app.patch('/sites/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const site = await loadOwnedSite(db, request, reply, id)
    if (!site) return reply

    const parse = updateSiteSchema.safeParse(request.body)
    if (!parse.success) {
      return reply.code(400).send({ error: 'validation_error', details: parse.error.flatten() })
    }

    if (parse.data.status === 'active' && !site.dnsVerified && !isPlatformCaller(request)) {
      return reply.code(409).send({
        error: 'dns_not_verified',
        message: 'A site becomes active only after its DNS TXT record is verified. Use POST /v1/gateway/sites/:id/verify.',
      })
    }

    try {
      const updated = await updateSitePolicy(db, id, parse.data)
      return reply.send(updated)
    } catch (err) {
      return replyWithDomainError(err, reply)
    }
  })

  // POST /v1/gateway/sites/:id/verify — Verify DNS TXT record (BOLA protected)
  app.post('/sites/:id/verify', async (request, reply) => {
    const { id } = request.params as { id: string }
    const site = await loadOwnedSite(db, request, reply, id)
    if (!site) return reply

    try {
      const result = await verifySiteDns(db, id)
      if (!result.verified) {
        return reply.code(400).send(result)
      }
      return reply.send(result)
    } catch (err) {
      return replyWithDomainError(err, reply)
    }
  })

  // DELETE /v1/gateway/sites/:id — Deregister a site (requires admin scope + BOLA check)
  app.delete('/sites/:id', { preHandler: [requireScopes('admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const site = await loadOwnedSite(db, request, reply, id)
    if (!site) return reply

    const deleted = await deleteSite(db, id)
    if (!deleted) {
      return reply.code(404).send({ error: 'not_found', message: `Site ${id} not found` })
    }
    return reply.send({ success: true, siteId: id })
  })
}
