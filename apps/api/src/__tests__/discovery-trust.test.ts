import { describe, it, expect } from 'vitest'
import { buildApp } from '../app.js'
import { config } from '../config.js'
import { authHeaders, testApiKeyResolver, ENABLED_FEATURES } from './helpers/test-auth.js'
import type { DbClient } from '@stealthmark/db'

describe('Discovery and Trust v0 Routes', () => {
  const sampleOrgId = '123e4567-e89b-12d3-a456-426614174000'
  const sampleCapId = '987fcdeb-51a2-43f7-9abc-def012345678'

  const sampleCapability = {
    id: sampleCapId,
    orgId: sampleOrgId,
    type: 'primitive',
    name: 'Web Vision',
    slug: 'web-vision',
    description: 'High-fidelity visual web understanding with Turnstile bypass and clean markdown',
    category: 'web_intelligence',
    protocols: ['REST', 'MCP'],
    endpoint: 'https://api.stealthmark.io/v1/web/vision',
    schemaJson: null,
    pricingUnit: 'request',
    pricingAmount: '0.05',
    version: '1.0.0',
    status: 'active',
    trustScore: 95,
    embedding: new Array(1536).fill(0.01),
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const sampleKey = {
    id: 'key-test-123',
    orgId: sampleOrgId,
    keyHash: 'dummyhash',
    keyPrefix: 'sm_live_test...1234',
    name: 'Admin Key',
    scopes: ['*'],
    rateLimitRpm: 300,
    rateLimitRpd: 10000,
    spendLimit: null,
    status: 'active',
    lastUsedAt: null,
    createdAt: new Date(),
  }

  function createMockDb() {
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [sampleCapability],
            offset: () => ({
              limit: async () => [sampleCapability],
            }),
            then: (resolve: any) => resolve([sampleCapability]),
          }),
          then: (resolve: any) => resolve([sampleCapability]),
        }),
      }),
      insert: () => ({
        values: (data: any) => ({
          returning: async () => [{ ...data, id: sampleCapId, createdAt: new Date() }],
          then: (resolve: any) => resolve([{ ...data, id: sampleCapId, createdAt: new Date() }]),
        }),
      }),
      update: () => ({
        set: (data: any) => ({
          where: () => ({
            returning: async () => [{ ...sampleCapability, ...data }],
            then: (resolve: any) => resolve([{ ...sampleCapability, ...data }]),
          }),
        }),
      }),
      execute: async () => [{ '?column?': 1 }],
    } as unknown as DbClient
  }

  it('GET /.well-known/ai-catalog.json returns valid ARD 1.0 specification', async () => {
    const app = await buildApp({ db: createMockDb(), apiKeyResolver: testApiKeyResolver(), features: ENABLED_FEATURES })
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/ai-catalog.json',
      headers: authHeaders,
    })

    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(json.version).toBe('1.0')
    expect(json.organization.name).toBe('StealthMark')
    expect(json.resources.length).toBeGreaterThanOrEqual(2)
  })

  it('POST /v1/discovery/search finds capabilities matching query', async () => {
    const app = await buildApp({ db: createMockDb(), apiKeyResolver: testApiKeyResolver(), features: ENABLED_FEATURES })
    const res = await app.inject({
      method: 'POST',
      url: '/v1/discovery/search',
      headers: authHeaders,
      payload: {
        query: 'web vision and anti-bot bypass',
        limit: 5,
      },
    })

    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(json.results).toBeDefined()
    expect(json.results.length).toBeGreaterThan(0)
    expect(json.results[0].slug).toBe('web-vision')
    expect(json.results[0].relevance_score).toBeGreaterThan(0)
  })

  it('POST /v1/discovery/resolve returns full capability with providers and trust', async () => {
    const app = await buildApp({ db: createMockDb(), apiKeyResolver: testApiKeyResolver(), features: ENABLED_FEATURES })
    const res = await app.inject({
      method: 'POST',
      url: '/v1/discovery/resolve',
      headers: authHeaders,
      payload: {
        capability_id: sampleCapId,
      },
    })

    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(json.capability).toBeDefined()
    expect(json.providers).toBeDefined()
    expect(json.trust).toBeDefined()
    expect(json.trust.dimensions.identity).toBeDefined()
  })

  it('GET /v1/capabilities/:id/trust calculates and returns Trust v0 metrics', async () => {
    const app = await buildApp({ db: createMockDb(), apiKeyResolver: testApiKeyResolver(), features: ENABLED_FEATURES })
    const res = await app.inject({
      method: 'GET',
      url: `/v1/capabilities/${sampleCapId}/trust`,
      headers: authHeaders,
    })

    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(json.capabilityId).toBe(sampleCapId)
    expect(json.dimensions).toBeDefined()
    expect(json.dimensions.identity.score).toBeGreaterThanOrEqual(0)
  })

  it('POST /v1/capabilities/:id/verify triggers capability verification', async () => {
    const app = await buildApp({ db: createMockDb(), apiKeyResolver: testApiKeyResolver(), features: ENABLED_FEATURES })
    const res = await app.inject({
      method: 'POST',
      url: `/v1/capabilities/${sampleCapId}/verify`,
      headers: authHeaders,
    })

    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(json.verification_id).toBeDefined()
    expect(json.status).toBeDefined()
  })

  it('POST /internal/trust/recalculate recalculates trust scores across active capabilities', async () => {
    const app = await buildApp({ db: createMockDb(), apiKeyResolver: testApiKeyResolver(), features: ENABLED_FEATURES })
    const res = await app.inject({
      method: 'POST',
      url: '/internal/trust/recalculate',
      headers: { 'x-internal-secret': config.INTERNAL_AUTH_SECRET },
    })

    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(json.status).toBe('completed')
    expect(json.updated_count).toBeGreaterThanOrEqual(1)
  })

  describe.each([
    { method: 'GET' as const, path: 'trust' },
    { method: 'POST' as const, path: 'verify' },
  ])('$method /v1/capabilities/:id/$path error mapping', ({ method, path }) => {
    function lookupDb(lookup: () => Promise<unknown[]>): DbClient {
      return {
        select: () => ({ from: () => ({ where: () => ({ limit: lookup }) }) }),
      } as unknown as DbClient
    }

    it('answers 404 when the capability does not exist', async () => {
      const app = await buildApp({ db: lookupDb(async () => []), apiKeyResolver: testApiKeyResolver(), features: ENABLED_FEATURES })

      const res = await app.inject({ method, url: `/v1/capabilities/${sampleCapId}/${path}`, headers: authHeaders })
      await app.close()

      expect(res.statusCode).toBe(404)
      expect(res.json().error).toBe('not_found')
    })

    it('answers 500 without leaking the database message when the lookup fails, even if it says "not found"', async () => {
      const failing = lookupDb(async () => {
        throw new Error('relation "capabilities" not found in schema cache')
      })
      const app = await buildApp({ db: failing, apiKeyResolver: testApiKeyResolver(), features: ENABLED_FEATURES })

      const res = await app.inject({ method, url: `/v1/capabilities/${sampleCapId}/${path}`, headers: authHeaders })
      await app.close()

      expect(res.statusCode).toBe(500)
      expect(res.json().error).toBe('internal_error')
      expect(res.body).not.toContain('schema cache')
    })
  })
})
