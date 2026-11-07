import { describe, it, expect } from 'vitest'
import { buildApp } from '../app.js'
import { authHeaders, testApiKeyResolver, ENABLED_FEATURES } from './helpers/test-auth.js'
import type { DbClient } from '@stealthmark/db'

describe('API v1 Routes', () => {
  const sampleOrg = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Acme Corp',
    slug: 'acme-corp',
    domain: 'acme.com',
    plan: 'free',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const sampleKey = {
    id: '987fcdeb-51a2-43f7-9abc-def012345678',
    orgId: sampleOrg.id,
    keyHash: 'dummyhash',
    keyPrefix: 'sk_live_test...1234',
    name: 'Default Key',
    scopes: ['extract'],
    rateLimitRpm: 60,
    rateLimitRpd: 10000,
    spendLimit: null,
    status: 'active',
    lastUsedAt: null,
    createdAt: new Date(),
  }

  function createMockDb() {
    return {
      select: (fields?: any) => ({
        from: (table: any) => ({
          where: () => ({
            limit: async () => [],
            then: (resolve: any) => resolve([sampleKey]),
          }),
        }),
      }),
      insert: (table: any) => ({
        values: (data: any) => ({
          returning: async () => [{ ...data, id: sampleOrg.id, createdAt: new Date() }],
        }),
      }),
      update: (table: any) => ({
        set: (data: any) => ({
          where: () => ({
            returning: async () => [{ id: sampleKey.id, status: 'revoked' }],
          }),
        }),
      }),
      delete: (table: any) => ({
        where: () => ({
          returning: async () => [{ id: 'user-123' }],
        }),
      }),
      execute: async () => [{ '?column?': 1 }],
    } as unknown as DbClient
  }

  it('POST /v1/organizations creates a new organization', async () => {
    const mockDb = createMockDb()
    const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver() })

    const res = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: authHeaders,
      payload: {
        name: 'Acme Corp',
        slug: 'acme-corp',
        domain: 'acme.com',
      },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.name).toBe('Acme Corp')
    expect(body.slug).toBe('acme-corp')

    await app.close()
  })

  it('POST /v1/organizations validates slug format', async () => {
    const mockDb = createMockDb()
    const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver() })

    const res = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: authHeaders,
      payload: {
        name: 'Invalid Org',
        slug: 'Invalid Slug With Spaces!',
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('validation_error')

    await app.close()
  })

  it('POST /v1/api-keys creates an API key and returns plaintext key once', async () => {
    const mockDb = createMockDb()
    const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver() })

    const res = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: authHeaders,
      payload: {
        name: 'Production Key',
        orgId: sampleOrg.id,
        scopes: ['extract', 'capabilities:read'],
      },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.key).toBeDefined()
    expect(body.key.startsWith('sk_live_')).toBe(true)
    expect(body.name).toBe('Production Key')
    expect(body.scopes).toContain('extract')

    await app.close()
  })

  it('DELETE /v1/api-keys/:id revokes key', async () => {
    const mockDb = createMockDb()
    const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver() })

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/api-keys/${sampleKey.id}`,
      headers: authHeaders,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('revoked')

    await app.close()
  })

  it('POST /v1/agents creates a new agent', async () => {
    const mockDb = createMockDb()
    const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver() })

    const res = await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: authHeaders,
      payload: {
        name: 'Browser Navigator',
        orgId: sampleOrg.id,
        protocols: ['MCP', 'A2A'],
        agentCard: { version: '1.0.0', capabilities: ['web_extraction'] },
      },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.name).toBe('Browser Navigator')
    expect(body.protocols).toContain('MCP')

    await app.close()
  })

  it('POST /v1/agents/:id/suspend suspends an agent', async () => {
    const mockDb = {
      ...createMockDb(),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [{ id: 'agent-123', status: 'suspended' }],
          }),
        }),
      }),
    } as any
    const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver() })

    const res = await app.inject({
      method: 'POST',
      url: '/v1/agents/agent-123/suspend',
      headers: authHeaders,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('suspended')

    await app.close()
  })

  it('POST /v1/capabilities creates a capability with schema', async () => {
    const mockDb = createMockDb()
    const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver(), features: ENABLED_FEATURES })

    const res = await app.inject({
      method: 'POST',
      url: '/v1/capabilities',
      headers: authHeaders,
      payload: {
        type: 'primitive',
        name: 'Web Vision Extraction',
        slug: 'web-vision-extraction',
        orgId: sampleOrg.id,
        category: 'web_intelligence',
        pricingUnit: 'request',
        pricingAmount: 0.005,
      },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.name).toBe('Web Vision Extraction')
    expect(body.slug).toBe('web-vision-extraction')

    await app.close()
  })

  it('GET /v1/usage returns aggregated usage statistics', async () => {
    const mockDb = {
      ...createMockDb(),
      select: () => ({
        from: () => ({
          where: async () => [
            {
              id: 'rec-1',
              capabilityId: 'cap-web-vision',
              requestCount: 10,
              cost: '0.05',
              latencyMs: 120,
              success: true,
              createdAt: new Date('2026-09-14T10:00:00Z'),
            },
          ],
        }),
      }),
    } as any
    const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver() })

    const res = await app.inject({
      method: 'GET',
      url: `/v1/usage?orgId=${sampleOrg.id}`,
      headers: authHeaders,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total_requests).toBe(10)
    expect(body.total_cost).toBe(0.05)
    expect(body.by_capability).toHaveLength(1)
    expect(body.by_day).toHaveLength(1)

    await app.close()
  })

  it('GET /v1/usage/costs returns period totals and daily average', async () => {
    const mockDb = {
      ...createMockDb(),
      select: () => ({
        from: () => ({
          where: async () => [
            {
              requestCount: 100,
              cost: '1.50',
            },
          ],
        }),
      }),
    } as any
    const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver() })

    const res = await app.inject({
      method: 'GET',
      url: `/v1/usage/costs?orgId=${sampleOrg.id}`,
      headers: authHeaders,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.current_period.requests).toBe(100)
    expect(body.current_period.cost).toBe(1.5)
    expect(body.daily_average).toBeDefined()

    await app.close()
  })

  it('GET /v1/openapi.json returns valid OpenAPI 3.1 specification', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/v1/openapi.json',
      headers: authHeaders,
    })

    expect(res.statusCode).toBe(200)
    const spec = res.json()
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.paths['/v1/usage/ingest']).toBeDefined()
    expect(spec.paths['/v1/web/vision']).toBeUndefined()

    await app.close()
  })

  it('billing routes no longer exist (404 even with every feature enabled)', async () => {
    const app = await buildApp({
      db: createMockDb(),
      apiKeyResolver: testApiKeyResolver(),
      features: ENABLED_FEATURES,
    })

    const checkout = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      headers: authHeaders,
      payload: { return_url: 'http://localhost:3000/dashboard/billing' },
    })
    const webhook = await app.inject({ method: 'POST', url: '/v1/billing/webhook', headers: authHeaders, payload: {} })
    const deposit = await app.inject({
      method: 'POST',
      url: '/v1/billing/deposit',
      headers: authHeaders,
      payload: { amount_usd: 100 },
    })

    expect(checkout.statusCode).toBe(404)
    expect(webhook.statusCode).toBe(404)
    expect(deposit.statusCode).toBe(404)

    await app.close()
  })
})
