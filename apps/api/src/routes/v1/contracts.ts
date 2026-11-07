import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type DbClient } from '@stealthmark/db'
import '../../middleware/api-key-auth.js'
import {
  createContract,
  signContract,
  getContract,
  listContracts,
  type ContractTerms,
} from '../../services/contracts.js'
import { idParams, parseParams } from '../../lib/params.js'

const contractTermsSchema = z.object({
  pricing: z.object({
    amount: z.number().positive('Pricing amount must be positive'),
    unit: z.string().min(1),
    volume: z.number().int().positive().optional(),
  }),
  sla: z.object({
    maxLatencyMs: z.number().int().positive(),
    uptimeGuarantee: z.number().min(90).max(100),
  }),
  deliverablesSchema: z.record(z.string(), z.unknown()).optional(),
  customTerms: z.string().max(2000).optional(),
})

const createContractSchema = z.object({
  negotiationId: z.string().uuid().optional(),
  capabilityId: z.string().uuid('Valid capability UUID required'),
  providerOrgId: z.string().uuid('Valid provider organization UUID required'),
  terms: contractTermsSchema,
  validDays: z.number().int().positive().max(365).optional(),
  autoSign: z.boolean().optional(),
})

export async function contractsRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // POST /v1/commerce/contracts — Create a Machine Contract
  app.post('/commerce/contracts', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const parseResult = createContractSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'validation_error', details: parseResult.error.flatten() })
    }

    const { negotiationId, capabilityId, providerOrgId, terms, validDays, autoSign } = parseResult.data

    if (providerOrgId === callerOrgId) {
      return reply.code(400).send({
        error: 'invalid_party',
        message: 'Consumer and provider cannot be the same organization',
      })
    }

    try {
      const contract = await createContract(db, {
        negotiationId,
        capabilityId,
        consumerOrgId: callerOrgId,
        providerOrgId,
        terms: terms as ContractTerms,
        validDays,
        autoSignByCreator: autoSign ? 'consumer' : undefined,
      })

      return reply.code(201).send({
        message: 'Machine Contract created',
        contract,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create contract'
      return reply.code(400).send({ error: 'bad_request', message: msg })
    }
  })

  // POST /v1/commerce/contracts/:id/sign — Sign contract
  app.post('/commerce/contracts/:id/sign', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params

    try {
      const updated = await signContract(db, {
        contractId: id,
        orgId: callerOrgId,
      })

      return reply.code(200).send({
        message: updated.status === 'active' ? 'Contract fully signed and activated' : 'Contract signed by organization',
        contract: updated,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to sign contract'
      return reply.code(400).send({ error: 'bad_request', message: msg })
    }
  })

  // GET /v1/commerce/contracts/:id — Get contract and verify terms hash
  app.get('/commerce/contracts/:id', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    const contract = await getContract(db, id)
    if (!contract) {
      return reply.code(404).send({ error: 'not_found', message: 'Contract not found' })
    }
    return reply.code(200).send({ contract })
  })

  // GET /v1/commerce/contracts — List contracts for caller org
  app.get('/commerce/contracts', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const items = await listContracts(db, callerOrgId)
    return reply.code(200).send({
      total: items.length,
      contracts: items,
    })
  })
}
