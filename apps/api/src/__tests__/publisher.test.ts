import { describe, it, expect } from 'vitest'
import { buildApp } from '../app.js'
import { authHeaders, testApiKeyResolver, ENABLED_FEATURES } from './helpers/test-auth.js'
import type { DbClient } from '@stealthmark/db'
import '../middleware/api-key-auth.js'

describe('Phase 4 — Trusted Public Network & Publisher System', () => {
  const sampleOrgId = '123e4567-e89b-12d3-a456-426614174000'
  const reviewerOrgId = '555e4567-e89b-12d3-a456-426614174555'
  const sampleCapId = '987fcdeb-51a2-43f7-9abc-def012345678'
  const sampleTaskId = '456e4567-e89b-12d3-a456-426614174456'

  const mockOrg = {
    id: sampleOrgId,
    name: 'Acme AI Labs',
    slug: 'acme-ai',
    domain: 'acme.ai',
    plan: 'enterprise',
    status: 'active',
    publisherEnabled: true,
    publisherVerifiedAt: new Date(),
    publisherTier: 'standard',
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const mockReviewerOrg = {
    id: reviewerOrgId,
    name: 'Buyer Agent Org',
    slug: 'buyer-agent',
    domain: 'buyer.io',
    plan: 'starter',
    status: 'active',
    publisherEnabled: false,
    publisherVerifiedAt: null,
    publisherTier: 'standard',
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const mockCapability = {
    id: sampleCapId,
    orgId: sampleOrgId,
    type: 'agent',
    name: 'Code Refactor Agent',
    slug: 'code-refactor-agent',
    description: 'Autonomous AST-based code refactoring and dead code elimination',
    category: 'development',
    protocols: ['A2A', 'MCP'],
    endpoint: 'https://agent.acme.ai/a2a',
    schemaJson: null,
    pricingUnit: 'task',
    pricingAmount: '0.25',
    visibility: 'public',
    slaJson: { uptimeTarget: 99.9, maxLatencyMs: 1500, supportTier: 'standard' },
    documentationUrl: 'https://docs.acme.ai/refactor',
    status: 'active',
    version: '1.0.0',
    trustScore: 92,
    embedding: new Array(1536).fill(0.01),
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const mockTask = {
    id: sampleTaskId,
    orgId: reviewerOrgId,
    capabilityId: sampleCapId,
    status: 'completed',
    cost: '0.25',
    latencyMs: 1400,
    traceId: 'trace-test-1',
    createdAt: new Date(),
    completedAt: new Date(),
  }

  const mockTrustScore = {
    id: 'trust-1',
    capabilityId: sampleCapId,
    ownerVerified: true,
    domainVerified: true,
    endpointVerified: true,
    successRate: '0.99',
    medianLatencyMs: 1200,
    availability: '0.99',
    totalExecutions: 450,
    verificationEvents: 5,
    score: 92,
    scoreLabel: 'established',
    qualityScore: 95,
    reputationScore: 94,
    updatedAt: new Date(),
  }

  const mockBadge = {
    id: 'badge-1',
    capabilityId: sampleCapId,
    badgeType: 'verified_identity',
    evidenceJson: { domain: 'acme.ai' },
    awardedAt: new Date(),
  }

  function createMockDb() {
    return {
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              orderBy: async () => [
                {
                  id: 'rev-1',
                  taskId: sampleTaskId,
                  rating: 5,
                  comment: 'Outstanding execution and deterministic results.',
                  verifiedExecution: true,
                  createdAt: new Date(),
                  reviewerOrgName: 'Buyer Agent Org',
                },
              ],
            }),
          }),
          where: () => ({
            limit: async () => [mockCapability],
            orderBy: () => ({
              limit: async () => [
                {
                  id: 'eval-1',
                  capabilityId: sampleCapId,
                  qualityScore: 95,
                  taskCompletionRate: '0.99',
                  accuracy: '0.98',
                  latencyP50: 1200,
                  latencyP99: 2400,
                  consistencyScore: '0.95',
                  evaluatedAt: new Date(),
                },
              ],
              then: (resolve: any) => resolve([mockCapability]),
            }),
            then: (resolve: any) => resolve([mockCapability]),
          }),
          orderBy: async () => [mockCapability],
          then: (resolve: any) => resolve([mockCapability]),
        }),
      }),
      insert: () => ({
        values: (data: any) => ({
          returning: async () => [{ ...data, id: 'gen-id-1', createdAt: new Date() }],
          then: (resolve: any) => resolve([{ ...data, id: 'gen-id-1', createdAt: new Date() }]),
        }),
      }),
      update: () => ({
        set: (data: any) => ({
          where: () => ({
            returning: async () => [{ ...mockCapability, ...data }],
            then: (resolve: any) => resolve([{ ...mockCapability, ...data }]),
          }),
        }),
      }),
      execute: async () => [{ '?column?': 1 }],
    } as unknown as DbClient
  }

  it('POST /v1/publisher/register activates publisher capability for organization', async () => {
    const app = await buildApp({ db: createMockDb(), apiKeyResolver: testApiKeyResolver({ orgId: sampleOrgId }), features: ENABLED_FEATURES })

    const res = await app.inject({
      method: 'POST',
      url: '/v1/publisher/register',
      headers: authHeaders,
      payload: {
        tier: 'verified',
        domain: 'acme.ai',
      },
    })

    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(json.message).toContain('Publisher status activated')
    expect(json.organization.publisherEnabled).toBe(true)
  })

  it('GET /v1/publisher/capabilities returns owned capabilities with execution & trust metrics', async () => {
    const app = await buildApp({ db: createMockDb(), apiKeyResolver: testApiKeyResolver({ orgId: sampleOrgId }), features: ENABLED_FEATURES })

    const res = await app.inject({
      method: 'GET',
      url: '/v1/publisher/capabilities',
      headers: authHeaders,
    })

    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(json.capabilities).toBeDefined()
    expect(Array.isArray(json.capabilities)).toBe(true)
    expect(json.capabilities.length).toBeGreaterThan(0)
    expect(json.capabilities[0].name).toBe('Code Refactor Agent')
    expect(json.capabilities[0].metrics).toBeDefined()
  })

  it('GET /v1/capabilities/:id/evaluation returns quality scores & latency profile', async () => {
    const app = await buildApp({ db: createMockDb(), apiKeyResolver: testApiKeyResolver(), features: ENABLED_FEATURES })

    const res = await app.inject({
      method: 'GET',
      url: `/v1/capabilities/${sampleCapId}/evaluation`,
      headers: authHeaders,
    })

    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(json.evaluation).toBeDefined()
    expect(json.evaluation.qualityScore).toBe(95)
    expect(json.evaluation.latencyP50Ms).toBe(1200)
  })

  it('GET /v1/capabilities/:id/reviews lists authentic reviews marked with verifiedExecution', async () => {
    const app = await buildApp({ db: createMockDb(), apiKeyResolver: testApiKeyResolver(), features: ENABLED_FEATURES })

    const res = await app.inject({
      method: 'GET',
      url: `/v1/capabilities/${sampleCapId}/reviews`,
      headers: authHeaders,
    })

    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(json.reviews).toBeDefined()
    expect(json.reviews[0].verifiedExecution).toBe(true)
    expect(json.reviews[0].rating).toBe(5)
  })

  it('GET /v1/capabilities/:id/badges returns verification and performance badges', async () => {
    const app = await buildApp({ db: createMockDb(), apiKeyResolver: testApiKeyResolver(), features: ENABLED_FEATURES })

    const res = await app.inject({
      method: 'GET',
      url: `/v1/capabilities/${sampleCapId}/badges`,
      headers: authHeaders,
    })

    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(json.badges).toBeDefined()
  })
})
