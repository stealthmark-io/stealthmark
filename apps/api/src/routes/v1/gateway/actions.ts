import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  createActionSchema,
  getActionSchemaById,
  getActionSchemaBySlug,
  listActionSchemas,
  updateActionSchema,
  deleteActionSchema,
  generateAgentManifest,
} from '../../../services/action-schema.js'
import { getSiteById, getSiteByDomain } from '../../../services/site-registration.js'
import { idParams, parseParams } from '../../../lib/params.js'
import { replyWithDomainError } from './errors.js'
import { loadOwnedSite, type GatewayDeps } from './shared.js'

const createActionSchemaBody = z.object({
  actionSlug: z.string().min(1).max(100),
  displayName: z.string().min(1).max(200),
  description: z.string().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('POST'),
  endpointPath: z.string().min(1),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  requiredScopes: z.array(z.string()).default([]),
  rateLimit: z.number().int().min(1).default(60),
  enabled: z.boolean().default(true),
})

const updateActionSchemaBody = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
  endpointPath: z.string().min(1).optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  requiredScopes: z.array(z.string()).optional(),
  rateLimit: z.number().int().min(1).optional(),
  enabled: z.boolean().optional(),
})

const actionLookupParams = z.object({
  id: z.string().uuid('Valid site UUID required'),
  slugOrId: z.string(),
})

const siteActionParams = z.object({
  id: z.string().uuid('Valid site UUID required'),
  actionId: z.string().uuid('Valid action UUID required'),
})

const uuidString = z.string().uuid()

function baseUrlOf(request: { headers: { host?: string }; protocol?: string }): string {
  const host = request.headers.host || 'api.stealthmark.io'
  const protocol = request.protocol || 'https'
  return `${protocol}://${host}`
}

export async function registerActionRoutes(app: FastifyInstance, { db }: GatewayDeps) {
  // POST /v1/gateway/sites/:id/actions — Register a new Action Schema
  app.post('/sites/:id/actions', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    const site = await loadOwnedSite(db, request, reply, id)
    if (!site) return reply

    const parseResult = createActionSchemaBody.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'validation_error', details: parseResult.error.flatten() })
    }

    const duplicate = await getActionSchemaBySlug(db, site.id, parseResult.data.actionSlug)
    if (duplicate) {
      return reply.code(409).send({ error: 'conflict', message: 'Action slug already exists for this site' })
    }

    const action = await createActionSchema(db, { siteId: site.id, ...parseResult.data })
    return reply.code(201).send(action)
  })

  // GET /v1/gateway/sites/:id/actions — List Action Schemas for a site (owner only: disabled schemas are included)
  app.get('/sites/:id/actions', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    const site = await loadOwnedSite(db, request, reply, id)
    if (!site) return reply

    const query = request.query as { enabled?: string }
    const actions = await listActionSchemas(db, id, query.enabled === 'true')
    return reply.send({ siteId: id, domain: site.domain, actions })
  })

  // GET /v1/gateway/sites/:id/actions/:slugOrId — Get Action Schema by slug or ID (owner only)
  app.get('/sites/:id/actions/:slugOrId', async (request, reply) => {
    const params = parseParams(actionLookupParams, request, reply)
    if (!params) return reply
    const { id, slugOrId } = params
    const site = await loadOwnedSite(db, request, reply, id)
    if (!site) return reply

    let action = await getActionSchemaBySlug(db, id, slugOrId)
    if (!action && uuidString.safeParse(slugOrId).success) {
      action = await getActionSchemaById(db, slugOrId)
    }

    if (!action || action.siteId !== id) {
      return reply.code(404).send({ error: 'not_found', message: `Action "${slugOrId}" not found for site ${site.domain}` })
    }

    return reply.send(action)
  })

  // PUT /v1/gateway/sites/:id/actions/:actionId — Update an Action Schema
  app.put('/sites/:id/actions/:actionId', async (request, reply) => {
    const params = parseParams(siteActionParams, request, reply)
    if (!params) return reply
    const { id, actionId } = params
    const site = await loadOwnedSite(db, request, reply, id)
    if (!site) return reply

    const parseResult = updateActionSchemaBody.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'validation_error', details: parseResult.error.flatten() })
    }

    const existing = await getActionSchemaById(db, actionId)
    if (!existing || existing.siteId !== site.id) {
      return reply.code(404).send({ error: 'not_found', message: `Action ${actionId} not found` })
    }

    const updated = await updateActionSchema(db, actionId, parseResult.data)
    return reply.send(updated)
  })

  // DELETE /v1/gateway/sites/:id/actions/:actionId — Delete an Action Schema
  app.delete('/sites/:id/actions/:actionId', async (request, reply) => {
    const params = parseParams(siteActionParams, request, reply)
    if (!params) return reply
    const { id, actionId } = params
    const site = await loadOwnedSite(db, request, reply, id)
    if (!site) return reply

    const existing = await getActionSchemaById(db, actionId)
    if (!existing || existing.siteId !== site.id) {
      return reply.code(404).send({ error: 'not_found', message: `Action ${actionId} not found` })
    }

    const deleted = await deleteActionSchema(db, actionId)
    if (!deleted) {
      return reply.code(404).send({ error: 'not_found', message: `Action ${actionId} not found` })
    }

    return reply.send({ success: true, message: 'Action schema deleted' })
  })

  // GET /v1/gateway/sites/:id/agent-manifest — Standardized Agent Manifest (agent.json)
  app.get('/sites/:id/agent-manifest', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    const site = await getSiteById(db, id)
    if (!site) {
      return reply.code(404).send({ error: 'not_found', message: `Site ${id} not found` })
    }

    return reply.send(await generateAgentManifest(db, id, baseUrlOf(request)))
  })

  // GET /v1/gateway/manifest/:domain — Agent Manifest by domain
  app.get('/manifest/:domain', async (request, reply) => {
    const { domain } = request.params as { domain: string }
    try {
      const site = await getSiteByDomain(db, domain)
      if (!site) {
        return reply.code(404).send({ error: 'not_found', message: `No registered gateway site found for domain "${domain}"` })
      }

      return reply.send(await generateAgentManifest(db, site.id, baseUrlOf(request)))
    } catch (err) {
      return replyWithDomainError(err, reply)
    }
  })
}
