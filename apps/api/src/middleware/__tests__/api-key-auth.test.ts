import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { createApiKeyAuth, requireScopes } from '../api-key-auth.js'
import { hashApiKey } from '../../lib/crypto.js'
import type { DbClient, ApiKey } from '@stealthmark/db'

describe('API Key Auth Middleware', () => {
  const mockApiKey: ApiKey = {
    id: '11111111-1111-1111-1111-111111111111',
    orgId: '22222222-2222-2222-2222-222222222222',
    keyHash: hashApiKey('sk_live_validkey1234567890123456789012'),
    keyPrefix: 'sk_live_vali...9012',
    name: 'Production Key',
    scopes: ['extract', 'capabilities:read'],
    rateLimitRpm: 60,
    rateLimitRpd: 10000,
    spendLimit: null,
    status: 'active',
    lastUsedAt: null,
    createdAt: new Date(),
  }

  function setupTestApp(dbMock?: any) {
    const app = Fastify()
    const auth = createApiKeyAuth(() => dbMock)

    app.get('/protected', { preHandler: [auth] }, async (req) => {
      return {
        orgId: req.orgId,
        keyId: req.apiKey?.id,
      }
    })

    app.get(
      '/admin-only',
      { preHandler: [auth, requireScopes('admin')] },
      async () => ({ ok: true }),
    )

    app.get(
      '/extract-only',
      { preHandler: [auth, requireScopes('extract')] },
      async () => ({ ok: true }),
    )

    return app
  }

  it('rejects requests with missing API key (401)', async () => {
    const app = setupTestApp()
    const res = await app.inject({ method: 'GET', url: '/protected' })

    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('unauthorized')
  })

  it('rejects keys that do not start with sk_ (401)', async () => {
    const app = setupTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer invalid_prefix_key' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('invalid_api_key')
  })

  it('authenticates valid API key via Authorization Bearer', async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [mockApiKey],
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      }),
    } as unknown as DbClient

    const app = setupTestApp(mockDb)
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer sk_live_validkey1234567890123456789012' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().orgId).toBe(mockApiKey.orgId)
    expect(res.json().keyId).toBe(mockApiKey.id)
  })

  it('authenticates valid API key via x-api-key header', async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [mockApiKey],
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      }),
    } as unknown as DbClient

    const app = setupTestApp(mockDb)
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { 'x-api-key': 'sk_live_validkey1234567890123456789012' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().orgId).toBe(mockApiKey.orgId)
  })

  it('rejects revoked keys (403)', async () => {
    const revokedKey: ApiKey = { ...mockApiKey, status: 'revoked' }
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [revokedKey],
          }),
        }),
      }),
    } as unknown as DbClient

    const app = setupTestApp(mockDb)
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { 'x-api-key': 'sk_live_validkey1234567890123456789012' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('api_key_revoked')
  })

  it('enforces scopes correctly', async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [mockApiKey], // scopes: ['extract', 'capabilities:read']
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      }),
    } as unknown as DbClient

    const app = setupTestApp(mockDb)

    // Has 'extract' scope -> allowed
    const resExtract = await app.inject({
      method: 'GET',
      url: '/extract-only',
      headers: { 'x-api-key': 'sk_live_validkey1234567890123456789012' },
    })
    expect(resExtract.statusCode).toBe(200)

    // Lacks 'admin' scope -> 403
    const resAdmin = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { 'x-api-key': 'sk_live_validkey1234567890123456789012' },
    })
    expect(resAdmin.statusCode).toBe(403)
    expect(resAdmin.json().error).toBe('insufficient_scope')
  })

  describe('last_used_at bookkeeping', () => {
    const rawKey = 'sk_live_validkey1234567890123456789012'

    function dbReturningKey(onUpdate: (values: object) => Promise<void>): DbClient {
      return {
        select: () => ({ from: () => ({ where: () => ({ limit: async () => [mockApiKey] }) }) }),
        update: () => ({
          set: (values: object) => ({ where: () => onUpdate(values) }),
        }),
      } as unknown as DbClient
    }

    it('stamps last_used_at for a key loaded from the database', async () => {
      const updates: object[] = []
      const app = setupTestApp(dbReturningKey(async (values) => void updates.push(values)))

      const res = await app.inject({ method: 'GET', url: '/protected', headers: { 'x-api-key': rawKey } })

      expect(res.statusCode).toBe(200)
      expect(updates).toHaveLength(1)
      expect(updates[0]).toEqual({ lastUsedAt: expect.any(Date) })
    })

    it('does not touch the database for a key supplied by an injected resolver', async () => {
      let updates = 0
      const db = dbReturningKey(async () => void (updates += 1))
      const app = Fastify()
      app.get('/protected', { preHandler: [createApiKeyAuth(() => db, async () => mockApiKey)] }, async (req) => ({
        keyId: req.apiKey?.id,
      }))

      const res = await app.inject({ method: 'GET', url: '/protected', headers: { 'x-api-key': rawKey } })

      expect(res.statusCode).toBe(200)
      expect(updates).toBe(0)
    })

    it('still authenticates when the last_used_at write fails and logs a warning', async () => {
      const app = setupTestApp(
        dbReturningKey(async () => {
          throw new Error('deadlock detected')
        })
      )
      const warn = vi.spyOn(app.log, 'warn')

      const res = await app.inject({ method: 'GET', url: '/protected', headers: { 'x-api-key': rawKey } })
      await new Promise((resolve) => setImmediate(resolve))

      expect(res.statusCode).toBe(200)
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ keyId: mockApiKey.id, err: expect.objectContaining({ message: 'deadlock detected' }) }),
        'Failed to update API key last_used_at'
      )
    })
  })
})
