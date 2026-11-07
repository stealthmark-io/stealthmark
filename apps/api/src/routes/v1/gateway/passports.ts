import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  issuePassport,
  revokePassport,
  getPassportById,
  getActivePassports,
  getAgentOrgId,
  verifyPassportOnline,
  getPublicKeyJwk,
  getJwks,
} from '../../../services/passport.js'
import { logGatewayAccessEvent } from '../../../services/gateway-audit.js'
import { recordAgentAccess } from '../../../services/behavioral-score.js'
import { isAuthorizedForOrg, isPlatformCaller, resolveOrgAccess } from '../../../lib/org-context.js'
import { idParams, parseParams } from '../../../lib/params.js'
import { replyWithDomainError } from './errors.js'
import type { GatewayDeps } from './shared.js'

// Trust inputs (behavioral score, trust level) are derived server-side and never accepted from clients.
const issuePassportSchema = z.object({
  agentId: z.string().uuid(),
  siteId: z.string().uuid().optional(),
  domain: z.string().optional(),
  scopes: z.array(z.string()).optional(),
})

const verifyTokenSchema = z.object({
  token: z.string().min(10),
})

export async function registerPassportRoutes(app: FastifyInstance, { db }: GatewayDeps) {
  // POST /v1/gateway/passport — Issue passport for agent -> site
  app.post('/passport', async (request, reply) => {
    const parse = issuePassportSchema.safeParse(request.body)
    if (!parse.success) {
      return reply.code(400).send({ error: 'validation_error', details: parse.error.flatten() })
    }

    if (!parse.data.siteId && !parse.data.domain) {
      return reply.code(400).send({
        error: 'bad_request',
        message: 'Either siteId or domain must be provided',
      })
    }

    const agentOrgId = await getAgentOrgId(db, parse.data.agentId)
    if (!agentOrgId || !isAuthorizedForOrg(request, agentOrgId)) {
      return reply.code(404).send({ error: 'not_found', message: 'Agent not found' })
    }

    try {
      const { agentId, siteId, domain, scopes } = parse.data
      const result = await issuePassport(db, { agentId, siteId, domain, scopes })
      return reply.code(201).send(result)
    } catch (err) {
      return replyWithDomainError(err, reply)
    }
  })

  // GET /v1/gateway/passport/:id — Get passport details (BOLA protected)
  app.get('/passport/:id', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    const passport = await getPassportById(db, id)
    if (!passport) {
      return reply.code(404).send({ error: 'not_found', message: `Passport ${id} not found` })
    }
    if (!isAuthorizedForOrg(request, passport.orgId)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Access denied: passport belongs to another organization' })
    }
    return reply.send(passport)
  })

  // POST /v1/gateway/passport/:id/revoke — Revoke a passport (BOLA protected)
  app.post('/passport/:id/revoke', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    const passport = await getPassportById(db, id)
    if (!passport) {
      return reply.code(404).send({ error: 'not_found', message: `Passport ${id} not found` })
    }
    if (!isAuthorizedForOrg(request, passport.orgId)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Access denied: cannot revoke passport of another organization' })
    }

    const body = (request.body as { reason?: string } | undefined) || {}

    try {
      const revoked = await revokePassport(db, id, body.reason)
      return reply.send(revoked)
    } catch (err) {
      return replyWithDomainError(err, reply)
    }
  })

  // GET /v1/gateway/passports — List active passports (own organization unless platform caller)
  app.get('/passports', async (request, reply) => {
    const access = resolveOrgAccess(request)
    if (!access.ok) {
      return reply.code(access.status).send(access.body)
    }

    const query = request.query as { agentId?: string; siteId?: string }
    const orgFilter = isPlatformCaller(request) ? undefined : access.orgId
    const passports = await getActivePassports(db, query.agentId, query.siteId, orgFilter)
    return reply.send({ passports })
  })

  // POST /v1/gateway/verify — Verify a passport JWT (online endpoint)
  app.post('/verify', async (request, reply) => {
    const parse = verifyTokenSchema.safeParse(request.body)
    if (!parse.success) {
      return reply.code(400).send({ error: 'validation_error', details: parse.error.flatten() })
    }

    const result = await verifyPassportOnline(db, parse.data.token)

    if (result.payload && result.site) {
      await logGatewayAccessEvent(db, {
        siteId: result.site.id,
        orgId: result.payload.org_id,
        agentId: result.payload.sub,
        action: result.valid ? 'allowed' : 'blocked',
        reason: result.error || null,
        ipAddress: request.ip,
      })

      recordAgentAccess(result.payload.sub, result.site.id, {
        success: result.valid,
        scopeViolation: false,
      })
    }

    if (!result.valid) {
      return reply.code(401).send(result)
    }

    return reply.send(result)
  })

  // GET /v1/gateway/public-key — Get Ed25519 public key (JWK format)
  app.get('/public-key', async (_request, reply) => {
    return reply.send(getPublicKeyJwk())
  })

  // GET /v1/gateway/jwks — Standard JWKS format
  app.get('/jwks', async (_request, reply) => {
    return reply.send(getJwks())
  })
}
