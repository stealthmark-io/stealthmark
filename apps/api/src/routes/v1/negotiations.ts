import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type DbClient } from '@stealthmark/db'
import '../../middleware/api-key-auth.js'
import {
  createNegotiation,
  counterNegotiation,
  acceptNegotiation,
  rejectNegotiation,
  getNegotiation,
  listNegotiations,
} from '../../services/negotiation.js'
import { idParams, parseParams } from '../../lib/params.js'

const offerSchema = z.object({
  price: z.number().positive('Price must be positive'),
  unit: z.string().min(1, 'Unit is required (e.g., request, task, minute)'),
  volume: z.number().int().positive().optional(),
  slaMs: z.number().int().positive().optional(),
  customTerms: z.string().max(1000).optional(),
})

const createNegotiationSchema = z.object({
  capabilityId: z.string().uuid('Valid capability UUID required'),
  agentId: z.string().uuid().optional(),
  offer: offerSchema,
  expiresInHours: z.number().int().positive().max(720).optional(),
})

const counterNegotiationSchema = z.object({
  offer: offerSchema,
  note: z.string().max(500).optional(),
})

const decisionSchema = z.object({
  note: z.string().max(500).optional(),
})

export async function negotiationsRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // POST /v1/commerce/negotiate — Propose new negotiation offer
  app.post('/commerce/negotiate', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const parseResult = createNegotiationSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'validation_error', details: parseResult.error.flatten() })
    }

    try {
      const negotiation = await createNegotiation(db, {
        capabilityId: parseResult.data.capabilityId,
        consumerOrgId: callerOrgId,
        agentId: parseResult.data.agentId,
        offer: parseResult.data.offer,
        expiresInHours: parseResult.data.expiresInHours,
      })

      return reply.code(201).send({
        message: 'Negotiation proposal created',
        negotiation,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create negotiation'
      return reply.code(400).send({ error: 'bad_request', message: msg })
    }
  })

  // POST /v1/commerce/negotiate/:id/counter — Counter an active offer
  app.post('/commerce/negotiate/:id/counter', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    const parseResult = counterNegotiationSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'validation_error', details: parseResult.error.flatten() })
    }

    try {
      const updated = await counterNegotiation(db, {
        negotiationId: id,
        orgId: callerOrgId,
        offer: parseResult.data.offer,
        note: parseResult.data.note,
      })

      return reply.code(200).send({
        message: 'Counter-offer sent successfully',
        negotiation: updated,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to counter negotiation'
      return reply.code(400).send({ error: 'bad_request', message: msg })
    }
  })

  // POST /v1/commerce/negotiate/:id/accept — Accept offer and auto-draft contract
  app.post('/commerce/negotiate/:id/accept', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    const parseResult = decisionSchema.safeParse(request.body || {})
    const note = parseResult.success ? parseResult.data.note : undefined

    try {
      const result = await acceptNegotiation(db, {
        negotiationId: id,
        orgId: callerOrgId,
        note,
      })

      return reply.code(200).send({
        message: 'Negotiation accepted and Machine Contract drafted',
        negotiation: result.negotiation,
        contractId: result.contractId,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to accept negotiation'
      return reply.code(400).send({ error: 'bad_request', message: msg })
    }
  })

  // POST /v1/commerce/negotiate/:id/reject — Reject offer
  app.post('/commerce/negotiate/:id/reject', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    const parseResult = decisionSchema.safeParse(request.body || {})
    const note = parseResult.success ? parseResult.data.note : undefined

    try {
      const rejected = await rejectNegotiation(db, {
        negotiationId: id,
        orgId: callerOrgId,
        note,
      })

      return reply.code(200).send({
        message: 'Negotiation declined',
        negotiation: rejected,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reject negotiation'
      return reply.code(400).send({ error: 'bad_request', message: msg })
    }
  })

  // GET /v1/commerce/negotiate/:id — View single negotiation
  app.get('/commerce/negotiate/:id', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    const neg = await getNegotiation(db, id)
    if (!neg) {
      return reply.code(404).send({ error: 'not_found', message: 'Negotiation not found' })
    }
    return reply.code(200).send({ negotiation: neg })
  })

  // GET /v1/commerce/negotiations — List all negotiations for caller organization
  app.get('/commerce/negotiations', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const items = await listNegotiations(db, callerOrgId)
    return reply.code(200).send({
      total: items.length,
      negotiations: items,
    })
  })
}
