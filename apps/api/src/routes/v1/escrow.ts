import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type DbClient } from '@stealthmark/db'
import '../../middleware/api-key-auth.js'
import {
  createEscrow,
  submitWork,
  validateAndRelease,
  disputeEscrow,
  refundEscrow,
  getEscrow,
  listEscrows,
} from '../../services/escrow.js'

const createEscrowSchema = z.object({
  contractId: z.string().uuid('Valid contract UUID required'),
  taskId: z.string().uuid().optional(),
  amount: z.number().positive('Escrow amount must be positive'),
  currency: z.string().default('usd'),
})

const submitWorkSchema = z.object({
  deliverableJson: z.unknown(),
})

const disputeSchema = z.object({
  reason: z.string().min(5, 'Dispute reason must be at least 5 characters').max(1000),
})

export async function escrowRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // POST /v1/commerce/escrow — Fund an escrow
  app.post('/commerce/escrow', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const parseResult = createEscrowSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'validation_error', details: parseResult.error.flatten() })
    }

    try {
      const escrow = await createEscrow(db, {
        contractId: parseResult.data.contractId,
        taskId: parseResult.data.taskId,
        consumerOrgId: callerOrgId,
        amount: parseResult.data.amount,
        currency: parseResult.data.currency,
      })

      return reply.code(201).send({
        message: 'Escrow funded successfully and held in trustless custody',
        escrow,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fund escrow'
      return reply.code(400).send({ error: 'bad_request', message: msg })
    }
  })

  // POST /v1/commerce/escrow/:id/submit — Provider submits deliverable
  app.post('/commerce/escrow/:id/submit', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const { id } = request.params as { id: string }
    const parseResult = submitWorkSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'validation_error', details: parseResult.error.flatten() })
    }

    try {
      const updated = await submitWork(db, {
        escrowId: id,
        providerOrgId: callerOrgId,
        deliverableJson: parseResult.data.deliverableJson,
      })

      return reply.code(200).send({
        message: 'Deliverable submitted for review and validation',
        escrow: updated,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to submit deliverable'
      return reply.code(400).send({ error: 'bad_request', message: msg })
    }
  })

  // POST /v1/commerce/escrow/:id/release — Consumer validates and releases payment
  app.post('/commerce/escrow/:id/release', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const { id } = request.params as { id: string }

    try {
      const released = await validateAndRelease(db, {
        escrowId: id,
        consumerOrgId: callerOrgId,
      })

      return reply.code(200).send({
        message: 'Escrow released. Funds transferred to provider balance with 5% platform fee deducted.',
        escrow: released,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to release escrow'
      return reply.code(400).send({ error: 'bad_request', message: msg })
    }
  })

  // POST /v1/commerce/escrow/:id/dispute — Raise dispute
  app.post('/commerce/escrow/:id/dispute', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const { id } = request.params as { id: string }
    const parseResult = disputeSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'validation_error', details: parseResult.error.flatten() })
    }

    try {
      const disputed = await disputeEscrow(db, {
        escrowId: id,
        orgId: callerOrgId,
        reason: parseResult.data.reason,
      })

      return reply.code(200).send({
        message: 'Escrow dispute opened',
        escrow: disputed,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to dispute escrow'
      return reply.code(400).send({ error: 'bad_request', message: msg })
    }
  })

  // POST /v1/commerce/escrow/:id/refund — Refund escrow to consumer
  app.post('/commerce/escrow/:id/refund', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const { id } = request.params as { id: string }

    try {
      const refunded = await refundEscrow(db, {
        escrowId: id,
        orgId: callerOrgId,
      })

      return reply.code(200).send({
        message: 'Escrow refunded. Funds returned to consumer available balance.',
        escrow: refunded,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to refund escrow'
      return reply.code(400).send({ error: 'bad_request', message: msg })
    }
  })

  // GET /v1/commerce/escrow/:id — Get escrow detail
  app.get('/commerce/escrow/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const escrow = await getEscrow(db, id)
    if (!escrow) {
      return reply.code(404).send({ error: 'not_found', message: 'Escrow not found' })
    }
    return reply.code(200).send({ escrow })
  })

  // GET /v1/commerce/escrows — List escrows for caller org
  app.get('/commerce/escrows', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const items = await listEscrows(db, callerOrgId)
    return reply.code(200).send({
      total: items.length,
      escrows: items,
    })
  })
}
