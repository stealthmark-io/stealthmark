import { describe, it, expect } from 'vitest'
import { buildApp } from '../app.js'
import { authHeaders, testApiKeyResolver, ENABLED_FEATURES } from './helpers/test-auth.js'
import type { DbClient } from '@stealthmark/db'
import '../middleware/api-key-auth.js'
import { withTransactions } from './helpers/fake-db.js'

describe('Phase 5 — Agent Commerce (Negotiations, Machine Contracts, Escrow & Settlement)', () => {
  const consumerOrgId = '111e4567-e89b-12d3-a456-426614174111'
  const providerOrgId = '222e4567-e89b-12d3-a456-426614174222'
  const capabilityId = '333e4567-e89b-12d3-a456-426614174333'
  const contractId = '444e4567-e89b-12d3-a456-426614174444'
  const escrowId = '555e4567-e89b-12d3-a456-426614174555'
  const negotiationId = '666e4567-e89b-12d3-a456-426614174666'

  const mockConsumerOrg = {
    id: consumerOrgId,
    name: 'Consumer Agent Org',
    slug: 'consumer-agent',
    plan: 'enterprise',
    status: 'active',
    availableBalance: '500.00',
    escrowBalance: '100.00',
    totalEarned: '0.00',
    totalSpent: '250.00',
  }

  const mockProviderOrg = {
    id: providerOrgId,
    name: 'Provider Agent Org',
    slug: 'provider-agent',
    plan: 'enterprise',
    status: 'active',
    availableBalance: '200.00',
    escrowBalance: '0.00',
    totalEarned: '800.00',
    totalSpent: '50.00',
  }

  const mockCapability = {
    id: capabilityId,
    orgId: providerOrgId,
    name: 'Data Extraction Skill',
    slug: 'data-extraction-skill',
    pricingAmount: '0.05',
    pricingUnit: 'request',
    status: 'active',
    visibility: 'public',
  }

  const mockNegotiation = {
    id: negotiationId,
    capabilityId,
    consumerOrgId,
    providerOrgId,
    status: 'proposed',
    currentOffer: {
      price: 0.04,
      unit: 'request',
      volume: 1000,
      slaMs: 800,
      customTerms: 'Volume discount pricing',
    },
    history: [
      {
        role: 'consumer',
        action: 'offer',
        offer: { price: 0.04, unit: 'request', volume: 1000, slaMs: 800 },
        timestamp: new Date().toISOString(),
      },
    ],
    expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const mockContract = {
    id: contractId,
    negotiationId,
    capabilityId,
    consumerOrgId,
    providerOrgId,
    termsJson: {
      pricing: { amount: 0.04, unit: 'request', volume: 1000 },
      sla: { maxLatencyMs: 800, uptimeGuarantee: 99.9 },
    },
    termsHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    consumerSignedAt: new Date(),
    providerSignedAt: null,
    status: 'draft',
    validFrom: new Date(),
    validUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    createdAt: new Date(),
  }

  const mockEscrow = {
    id: escrowId,
    contractId,
    consumerOrgId,
    providerOrgId,
    amount: '40.00',
    feeAmount: '2.00', // 5% fee
    netAmount: '38.00',
    currency: 'usd',
    status: 'held',
    deliverableJson: null,
    heldAt: new Date(),
    releasedAt: null,
    refundedAt: null,
    createdAt: new Date(),
  }

  function createMockDb() {
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [mockCapability],
            orderBy: async () => [mockNegotiation],
            then: (resolve: any) => resolve([mockConsumerOrg]),
          }),
          orderBy: async () => [mockNegotiation],
          then: (resolve: any) => resolve([mockConsumerOrg]),
        }),
      }),
      insert: () => ({
        values: (data: any) => ({
          returning: async () => [{ ...data, id: data.id || 'new-item-uuid', createdAt: new Date() }],
          then: (resolve: any) => resolve([{ ...data, id: data.id || 'new-item-uuid', createdAt: new Date() }]),
        }),
      }),
      update: () => ({
        set: (data: any) => ({
          where: () => ({
            returning: async () => [{ ...mockNegotiation, ...data }],
            then: (resolve: any) => resolve([{ ...mockNegotiation, ...data }]),
          }),
        }),
      }),
    } as unknown as DbClient
  }

  // 1. Negotiation Protocol Tests
  describe('Autonomous Negotiation Protocol', () => {
    it('POST /v1/commerce/negotiate proposes a new offer between agents', async () => {
      const mockDb = {
        ...createMockDb(),
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [mockCapability],
            }),
          }),
        }),
        insert: () => ({
          values: (data: any) => ({
            returning: async () => [{ ...mockNegotiation, ...data, id: 'neg-1' }],
          }),
        }),
      } as unknown as DbClient

      const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver({ orgId: mockConsumerOrg.id }), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'POST',
        url: '/v1/commerce/negotiate',
        headers: authHeaders,
        payload: {
          capabilityId,
          offer: {
            price: 0.04,
            unit: 'request',
            volume: 1000,
            slaMs: 800,
            customTerms: 'Volume deal',
          },
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.negotiation.status).toBe('proposed')
      expect(body.negotiation.consumerOrgId).toBe(consumerOrgId)
    })

    it('POST /v1/commerce/negotiate/:id/counter records counter-offer in negotiation history', async () => {
      const mockDb = {
        ...createMockDb(),
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [mockNegotiation],
            }),
          }),
        }),
        update: () => ({
          set: (data: any) => ({
            where: () => ({
              returning: async () => [{ ...mockNegotiation, ...data }],
            }),
          }),
        }),
      } as unknown as DbClient

      const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver({ orgId: mockProviderOrg.id }), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'POST',
        url: `/v1/commerce/negotiate/${negotiationId}/counter`,
        headers: authHeaders,
        payload: {
          offer: {
            price: 0.045,
            unit: 'request',
            volume: 1000,
            slaMs: 700,
          },
          note: 'Can do $0.045 with guaranteed 700ms p95 latency',
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.negotiation.status).toBe('countered')
      expect(body.negotiation.currentOffer.price).toBe(0.045)
    })

    it('POST /v1/commerce/negotiate/:id/accept transitions to accepted and auto-generates contract', async () => {
      const mockDb = {
        ...createMockDb(),
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [mockNegotiation],
            }),
          }),
        }),
        update: () => ({
          set: (data: any) => ({
            where: () => ({
              returning: async () => [{ ...mockNegotiation, status: 'accepted' }],
            }),
          }),
        }),
        insert: () => ({
          values: (data: any) => ({
            returning: async () => [{ ...mockContract, id: 'auto-contract-id' }],
          }),
        }),
      } as unknown as DbClient

      const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver({ orgId: mockConsumerOrg.id }), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'POST',
        url: `/v1/commerce/negotiate/${negotiationId}/accept`,
        headers: authHeaders,
        payload: { note: 'Terms agreed' },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.negotiation.status).toBe('accepted')
      expect(body.contractId).toBe('auto-contract-id')
    })
  })

  // 2. Machine Contracts Tests
  describe('Machine Contracts Engine', () => {
    it('POST /v1/commerce/contracts creates a contract with deterministic termsHash', async () => {
      const mockDb = {
        ...createMockDb(),
        insert: () => ({
          values: (data: any) => ({
            returning: async () => [{ ...mockContract, ...data, id: 'contract-direct-1' }],
          }),
        }),
      } as unknown as DbClient

      const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver({ orgId: mockConsumerOrg.id }), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'POST',
        url: '/v1/commerce/contracts',
        headers: authHeaders,
        payload: {
          capabilityId,
          providerOrgId,
          terms: {
            pricing: { amount: 0.05, unit: 'request' },
            sla: { maxLatencyMs: 1000, uptimeGuarantee: 99.9 },
            customTerms: 'Production contract SLA',
          },
          autoSign: true,
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.contract.termsHash).toBeDefined()
      expect(typeof body.contract.termsHash).toBe('string')
      expect(body.contract.consumerSignedAt).toBeDefined()
    })

    it('POST /v1/commerce/contracts/:id/sign activates contract when both parties have signed', async () => {
      const mockDb = {
        ...createMockDb(),
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [mockContract], // consumer has signed, provider signing now
            }),
          }),
        }),
        update: () => ({
          set: (data: any) => ({
            where: () => ({
              returning: async () => [{ ...mockContract, ...data, status: 'active' }],
            }),
          }),
        }),
      } as unknown as DbClient

      const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver({ orgId: mockProviderOrg.id }), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'POST',
        url: `/v1/commerce/contracts/${contractId}/sign`,
        headers: authHeaders,
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.contract.status).toBe('active')
      expect(body.message).toContain('Contract fully signed and activated')
    })
  })

  // 3. Trustless Escrow Tests
  describe('Trustless Escrow State Machine & Platform Fee Settlement', () => {
    it('POST /v1/commerce/escrow funds escrow with 5% take-rate calculated', async () => {
      const activeContract = { ...mockContract, status: 'active' }
      const mockDb = withTransactions({
        ...createMockDb(),
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [activeContract],
            }),
          }),
        }),
        insert: () => ({
          values: (data: any) => ({
            returning: async () => [{ ...mockEscrow, ...data, id: 'escrow-1' }],
          }),
        }),
        update: () => ({
          set: () => ({
            where: async () => [],
          }),
        }),
      })

      const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver({ orgId: mockConsumerOrg.id }), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'POST',
        url: '/v1/commerce/escrow',
        headers: authHeaders,
        payload: {
          contractId,
          amount: 100,
          currency: 'usd',
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.escrow.status).toBe('held')
      expect(Number(body.escrow.amount)).toBe(100)
      expect(Number(body.escrow.feeAmount)).toBe(5) // 5% fee
      expect(Number(body.escrow.netAmount)).toBe(95)
    })

    it('POST /v1/commerce/escrow/:id/submit allows provider to submit deliverables', async () => {
      const mockDb = {
        ...createMockDb(),
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [mockEscrow],
            }),
          }),
        }),
        update: () => ({
          set: (data: any) => ({
            where: () => ({
              returning: async () => [{ ...mockEscrow, ...data }],
            }),
          }),
        }),
      } as unknown as DbClient

      const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver({ orgId: mockProviderOrg.id }), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'POST',
        url: `/v1/commerce/escrow/${escrowId}/submit`,
        headers: authHeaders,
        payload: {
          deliverableJson: {
            extractedRecords: 1500,
            datasetUrl: 'https://storage.stealthmark.io/deliverables/dataset-123.json',
            checksum: 'sha256-abc123456',
          },
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.escrow.status).toBe('work_submitted')
      expect(body.escrow.deliverableJson).toBeDefined()
    })

    it('POST /v1/commerce/escrow/:id/release validates and settles funds to provider', async () => {
      const submittedEscrow = { ...mockEscrow, status: 'work_submitted' }
      const mockDb = withTransactions({
        ...createMockDb(),
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [submittedEscrow],
            }),
          }),
        }),
        update: () => ({
          set: (data: any) => ({
            where: () => ({
              returning: async () => [{ ...submittedEscrow, ...data, status: 'released' }],
              then: (resolve: any) => resolve([]),
            }),
          }),
        }),
      })

      const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver({ orgId: mockConsumerOrg.id }), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'POST',
        url: `/v1/commerce/escrow/${escrowId}/release`,
        headers: authHeaders,
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.escrow.status).toBe('released')
      expect(body.message).toContain('5% platform fee deducted')
    })
  })

  // 4. Financial Balances and Payouts
  describe('Balances & Ledger Settlement', () => {
    it('GET /v1/commerce/balance returns organization financial ledger', async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [mockConsumerOrg],
              then: (resolve: any) => resolve([{ totalFees: 12.5 }]),
            }),
          }),
        }),
      } as unknown as DbClient

      const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver({ orgId: mockConsumerOrg.id }), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'GET',
        url: '/v1/commerce/balance',
        headers: authHeaders,
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.balances.available).toBe(500)
      expect(body.balances.inEscrow).toBe(100)
      expect(body.balances.totalSpent).toBe(250)
      expect(body.balances.currency).toBe('usd')
    })

    it('POST /v1/commerce/payout initiates withdrawal of available funds', async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [mockProviderOrg],
            }),
          }),
        }),
        update: () => ({
          set: () => ({
            where: async () => [],
          }),
        }),
      } as unknown as DbClient

      const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver({ orgId: mockProviderOrg.id }), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'POST',
        url: '/v1/commerce/payout',
        headers: authHeaders,
        payload: {
          amount: 50,
          destination: 'acct_987654',
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.payout.amount).toBe(50)
      expect(body.payout.status).toBe('completed')
    })
  })
})
