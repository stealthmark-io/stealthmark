import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildApp } from '../app.js'
import { hashApiKey } from '../lib/crypto.js'
import type { DbClient, ApiKey } from '@stealthmark/db'
import { generateKeyPairSync } from 'node:crypto'
import {
  getKeyPair,
  resetKeyPairForTesting,
  issuePassport,
  signPassportJwt,
  verifyPassportLocally,
} from '../services/passport.js'
import { getSiteAnalytics } from '../services/gateway-audit.js'

describe('Security Audit — Phase B (P1) Remediation Tests', () => {
  const victimOrgId = '11111111-1111-1111-1111-111111111111'
  const attackerOrgId = '22222222-2222-2222-2222-222222222222'
  const adminOrgId = '33333333-3333-3333-3333-333333333333'

  const siteId = '00000000-0000-4000-8000-00000000a001'
  const passportId = '00000000-0000-4000-8000-00000000b001'
  const agentId = 'agent-victim-001'

  const attackerKeyStr = 'sk_live_attacker_key_123456789012'
  const victimKeyStr = 'sk_live_victim_key_1234567890123'
  const adminKeyStr = 'sk_live_admin_key_12345678901234'

  const mockAttackerKey: ApiKey = {
    id: 'key-attacker',
    orgId: attackerOrgId,
    keyHash: hashApiKey(attackerKeyStr),
    keyPrefix: 'sk_live_atta...9012',
    name: 'Attacker Key',
    scopes: ['read', 'write'],
    rateLimitRpm: 60,
    rateLimitRpd: 10000,
    spendLimit: null,
    status: 'active',
    lastUsedAt: null,
    createdAt: new Date(),
  }

  const mockVictimKey: ApiKey = {
    id: 'key-victim',
    orgId: victimOrgId,
    keyHash: hashApiKey(victimKeyStr),
    keyPrefix: 'sk_live_vict...0123',
    name: 'Victim Key',
    scopes: ['read', 'write'],
    rateLimitRpm: 60,
    rateLimitRpd: 10000,
    spendLimit: null,
    status: 'active',
    lastUsedAt: null,
    createdAt: new Date(),
  }

  const mockAdminKey: ApiKey = {
    id: 'key-admin',
    orgId: adminOrgId,
    keyHash: hashApiKey(adminKeyStr),
    keyPrefix: 'sk_live_admi...0123',
    name: 'Platform Admin Key',
    scopes: ['admin'],
    rateLimitRpm: 120,
    rateLimitRpd: 100000,
    spendLimit: null,
    status: 'active',
    lastUsedAt: null,
    createdAt: new Date(),
  }

  const mockVictimSite = {
    id: siteId,
    orgId: victimOrgId,
    domain: 'victim-bank.internal',
    displayName: 'Victim Core Banking',
    description: 'Internal API',
    endpointUrl: 'https://victim-bank.internal/api',
    status: 'active',
    dnsVerified: true,
    dnsVerificationToken: 'sm-verify-victim123',
    accessPolicy: 'open',
    allowedScopes: ['read', 'write'],
    allowedAgentIds: [],
    passportTtlSeconds: 3600,
    maxRpm: 100,
    enforceProofOfWork: false,
    powDifficulty: 16,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const mockVictimPassport = {
    id: passportId,
    agentId,
    orgId: victimOrgId,
    siteId,
    passportJti: 'sm_pass_victim_123',
    scopesGranted: ['read'],
    trustLevel: 'established',
    trustScore: 90,
    behavioralScore: 85,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 3600000),
    revoked: false,
    revokedAt: null,
    revokedReason: null,
  }

  function createMockDb(apiKeyRecord: ApiKey) {
    return {
      select: (fields?: any) => ({
        from: (tbl: any) => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => [],
            }),
            limit: async () => {
              const name = (tbl as any)?.[Symbol.for('drizzle:Name')] || tbl?._?.name
              if (name === 'api_keys') {
                return [apiKeyRecord]
              }
              if (name === 'registered_sites') {
                return [mockVictimSite]
              }
              if (name === 'agent_passports') {
                return [mockVictimPassport]
              }
              return []
            },
          }),
        }),
      }),
      insert: () => ({
        values: (val: any) => ({
          returning: async () => [{ id: 'new-id', ...val }],
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [{ ...mockVictimSite, ...mockVictimPassport }],
          }),
        }),
      }),
    } as unknown as DbClient
  }

  beforeEach(() => {
    resetKeyPairForTesting()
  })

  afterEach(() => {
    resetKeyPairForTesting()
    process.env.NODE_ENV = 'test'
  })

  // ═══════════════════════════════════════════
  // 1. BOLA (Broken Object Level Authorization) Checks
  // ═══════════════════════════════════════════
  describe('BOLA Authorization Enforcement across Gateway Routes', () => {
    it('GET /v1/gateway/sites/:id blocks cross-org access with 403 Forbidden', async () => {
      const db = createMockDb(mockAttackerKey)
      const app = await buildApp({ db })

      const res = await app.inject({
        method: 'GET',
        url: `/v1/gateway/sites/${siteId}`,
        headers: { 'x-api-key': attackerKeyStr },
      })

      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe('forbidden')
      expect(res.json().message).toContain('Access denied')
    })

    it('GET /v1/gateway/sites/:id allows owner org access with 200 OK', async () => {
      const db = createMockDb(mockVictimKey)
      const app = await buildApp({ db })

      const res = await app.inject({
        method: 'GET',
        url: `/v1/gateway/sites/${siteId}`,
        headers: { 'x-api-key': victimKeyStr },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().id).toBe(siteId)
      expect(res.json().orgId).toBe(victimOrgId)
    })

    it('GET /v1/gateway/sites/:id allows platform admin scope bypass with 200 OK', async () => {
      const db = createMockDb(mockAdminKey)
      const app = await buildApp({ db })

      const res = await app.inject({
        method: 'GET',
        url: `/v1/gateway/sites/${siteId}`,
        headers: { 'x-api-key': adminKeyStr },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().id).toBe(siteId)
    })

    it('PATCH /v1/gateway/sites/:id blocks cross-org update with 403 Forbidden', async () => {
      const db = createMockDb(mockAttackerKey)
      const app = await buildApp({ db })

      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/gateway/sites/${siteId}`,
        headers: { 'x-api-key': attackerKeyStr },
        payload: { maxRpm: 9999 },
      })

      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe('forbidden')
    })

    it('POST /v1/gateway/sites/:id/verify blocks cross-org DNS verification with 403 Forbidden', async () => {
      const db = createMockDb(mockAttackerKey)
      const app = await buildApp({ db })

      const res = await app.inject({
        method: 'POST',
        url: `/v1/gateway/sites/${siteId}/verify`,
        headers: { 'x-api-key': attackerKeyStr },
      })

      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe('forbidden')
    })

    it('POST /v1/gateway/sites/:id/access blocks recording access to foreign sites with 403 Forbidden', async () => {
      const db = createMockDb(mockAttackerKey)
      const app = await buildApp({ db })

      const res = await app.inject({
        method: 'POST',
        url: `/v1/gateway/sites/${siteId}/access`,
        headers: { 'x-api-key': attackerKeyStr },
        payload: {
          action: 'allowed',
          ipAddress: '127.0.0.1',
        },
      })

      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe('forbidden')
    })

    it('GET /v1/gateway/sites/:id/events blocks cross-org access log inspection with 403 Forbidden', async () => {
      const db = createMockDb(mockAttackerKey)
      const app = await buildApp({ db })

      const res = await app.inject({
        method: 'GET',
        url: `/v1/gateway/sites/${siteId}/events`,
        headers: { 'x-api-key': attackerKeyStr },
      })

      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe('forbidden')
    })

    it('GET /v1/gateway/sites/:id/events/verify blocks cross-org chain verification with 403 Forbidden', async () => {
      const db = createMockDb(mockAttackerKey)
      const app = await buildApp({ db })

      const res = await app.inject({
        method: 'GET',
        url: `/v1/gateway/sites/${siteId}/events/verify`,
        headers: { 'x-api-key': attackerKeyStr },
      })

      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe('forbidden')
    })

    it('GET /v1/gateway/sites/:id/analytics blocks cross-org analytics inspection with 403 Forbidden', async () => {
      const db = createMockDb(mockAttackerKey)
      const app = await buildApp({ db })

      const res = await app.inject({
        method: 'GET',
        url: `/v1/gateway/sites/${siteId}/analytics`,
        headers: { 'x-api-key': attackerKeyStr },
      })

      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe('forbidden')
    })

    it('GET /v1/gateway/passport/:id blocks cross-org passport inspection with 403 Forbidden', async () => {
      const db = createMockDb(mockAttackerKey)
      const app = await buildApp({ db, features: { passports: true } })

      const res = await app.inject({
        method: 'GET',
        url: `/v1/gateway/passport/${passportId}`,
        headers: { 'x-api-key': attackerKeyStr },
      })

      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe('forbidden')
    })

    it('POST /v1/gateway/passport/:id/revoke blocks cross-org passport revocation with 403 Forbidden', async () => {
      const db = createMockDb(mockAttackerKey)
      const app = await buildApp({ db, features: { passports: true } })

      const res = await app.inject({
        method: 'POST',
        url: `/v1/gateway/passport/${passportId}/revoke`,
        headers: { 'x-api-key': attackerKeyStr },
        payload: { reason: 'malicious revocation attempt' },
      })

      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe('forbidden')
    })
  })

  // ═══════════════════════════════════════════
  // 2. Cryptographic Key Management in Production
  // ═══════════════════════════════════════════
  describe('Cryptographic Key Management Lockdown', () => {
    it('throws descriptive error if in-memory Ed25519 key generation is attempted in production', () => {
      process.env.NODE_ENV = 'production'
      delete process.env.PASSPORT_PRIVATE_KEY
      delete process.env.PASSPORT_PUBLIC_KEY
      resetKeyPairForTesting()

      expect(() => getKeyPair()).toThrowError(
        /PASSPORT_PRIVATE_KEY and PASSPORT_PUBLIC_KEY environment variables are strictly required in production mode/
      )
    })

    it('names the unparseable key variables instead of reporting them as missing', () => {
      process.env.NODE_ENV = 'production'
      process.env.PASSPORT_PRIVATE_KEY = 'not-a-pem'
      process.env.PASSPORT_PUBLIC_KEY = 'not-a-pem'
      resetKeyPairForTesting()

      try {
        expect(() => getKeyPair()).toThrowError(/set but could not be parsed as PEM keys/)
      } finally {
        delete process.env.PASSPORT_PRIVATE_KEY
        delete process.env.PASSPORT_PUBLIC_KEY
        resetKeyPairForTesting()
      }
    })

    it('refuses unparseable keys outside production instead of silently generating ephemeral ones', () => {
      process.env.NODE_ENV = 'development'
      process.env.PASSPORT_PRIVATE_KEY = 'not-a-pem'
      process.env.PASSPORT_PUBLIC_KEY = 'not-a-pem'
      resetKeyPairForTesting()

      try {
        expect(() => getKeyPair()).toThrowError(/could not be parsed/)
      } finally {
        delete process.env.PASSPORT_PRIVATE_KEY
        delete process.env.PASSPORT_PUBLIC_KEY
        resetKeyPairForTesting()
      }
    })

    it('loads configured PEM keys and publishes a typed Ed25519 signing JWK', () => {
      const { privateKey, publicKey } = generateKeyPairSync('ed25519')
      process.env.NODE_ENV = 'production'
      process.env.PASSPORT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
      process.env.PASSPORT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString()
      resetKeyPairForTesting()

      try {
        const pair = getKeyPair()
        expect(pair.jwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519', use: 'sig', alg: 'EdDSA', kid: 'stealthmark-passport-v1' })
        expect(pair.jwk.x).toBe(publicKey.export({ format: 'jwk' }).x)
      } finally {
        delete process.env.PASSPORT_PRIVATE_KEY
        delete process.env.PASSPORT_PUBLIC_KEY
        resetKeyPairForTesting()
      }
    })

    it('verifyPassportLocally rejects JSON null header or payload instead of throwing', () => {
      process.env.NODE_ENV = 'test'
      resetKeyPairForTesting()
      const nullB64 = Buffer.from('null').toString('base64url')

      const result = verifyPassportLocally(`${nullB64}.${nullB64}.${nullB64}`)

      expect(result).toEqual({ valid: false, error: 'Malformed JWT JSON header or payload' })
    })

    it('verifyPassportLocally accepts a public key given as a JWK', () => {
      process.env.NODE_ENV = 'test'
      resetKeyPairForTesting()
      const now = Math.floor(Date.now() / 1000)
      const token = signPassportJwt({
        iss: 'stealthmark.io', sub: agentId, aud: 'api.example.com', jti: 'sm_pass_jwk', iat: now, exp: now + 600,
        site_id: siteId, org_id: victimOrgId, agent_name: 'Agent', scopes: [], trust_level: 'new', trust_score: null, behavioral_score: null,
      })

      expect(verifyPassportLocally(token, getKeyPair().jwk).valid).toBe(true)
      expect(verifyPassportLocally(token, generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' })).valid).toBe(false)
    })

    it('allows ephemeral keys when NODE_ENV is test or development', () => {
      process.env.NODE_ENV = 'test'
      delete process.env.PASSPORT_PRIVATE_KEY
      delete process.env.PASSPORT_PUBLIC_KEY
      resetKeyPairForTesting()

      const pair = getKeyPair()
      expect(pair).toBeDefined()
      expect(pair.jwk.kty).toBe('OKP')
      expect(pair.jwk.crv).toBe('Ed25519')
    })
  })

  // ═══════════════════════════════════════════
  // 3. Dynamic Trust Score Lookup in Issue Passport
  // ═══════════════════════════════════════════
  describe('Dynamic Trust Score Resolution', () => {
    it('calculates trust score dynamically from capabilities and trust_scores table', async () => {
      const mockAgent = {
        id: agentId,
        orgId: victimOrgId,
        name: 'Enterprise Trading Agent',
        status: 'active',
      }

      const mockDb = {
        select: (fields: any) => ({
          from: (tbl: any) => ({
            where: () => ({
              limit: async () => {
                const name = (tbl as any)?.[Symbol.for('drizzle:Name')] || tbl?._?.name
                if (name === 'agents') {
                  return [mockAgent]
                }
                if (name === 'registered_sites') {
                  return [mockVictimSite]
                }
                if (name === 'capabilities') {
                  return [{ id: 'cap-trading-1' }, { id: 'cap-trading-2' }]
                }
                if (name === 'trust_scores') {
                  return [
                    { score: 94, scoreLabel: 'verified' },
                    { score: 90, scoreLabel: 'verified' },
                  ]
                }
                return []
              },
            }),
          }),
        }),
        insert: () => ({
          values: (val: any) => ({
            returning: async () => [{ id: 'pass-dynamic-1', ...val }],
          }),
        }),
      } as unknown as DbClient

      const result = await issuePassport(mockDb, {
        agentId,
        siteId,
      })

      expect(result.passport.trustScore).toBe(92)
      expect(result.passport.trustLevel).toBe('established')
      expect(result.claims.trust_score).toBe(92)
      expect(result.claims.trust_level).toBe('established')
    })

    it('assigns new trust level when dynamic trust scores average under 50', async () => {
      const mockAgent = {
        id: agentId,
        orgId: victimOrgId,
        name: 'Untrusted Agent',
        status: 'pending',
      }

      const mockDb = {
        select: (fields: any) => ({
          from: (tbl: any) => ({
            where: () => ({
              limit: async () => {
                const name = (tbl as any)?.[Symbol.for('drizzle:Name')] || tbl?._?.name
                if (name === 'agents') {
                  return [mockAgent]
                }
                if (name === 'registered_sites') {
                  return [mockVictimSite]
                }
                if (name === 'capabilities') {
                  return [{ id: 'cap-untrusted-1' }]
                }
                if (name === 'trust_scores') {
                  return [{ score: 35, scoreLabel: 'unverified' }]
                }
                return []
              },
            }),
          }),
        }),
        insert: () => ({
          values: (val: any) => ({
            returning: async () => [{ id: 'pass-dynamic-2', ...val }],
          }),
        }),
      } as unknown as DbClient

      const result = await issuePassport(mockDb, {
        agentId,
        siteId,
      })

      expect(result.passport.trustScore).toBe(35)
      expect(result.passport.trustLevel).toBe('new')
      expect(result.claims.trust_score).toBe(35)
    })

    it('does not issue a baseline-trust passport when the trust lookup fails', async () => {
      const mockAgent = { id: agentId, orgId: victimOrgId, name: 'Active Agent', status: 'active' }
      let insertedPassports = 0

      const mockDb = {
        select: () => ({
          from: (tbl: any) => ({
            where: () => ({
              limit: async () => {
                const name = (tbl as any)?.[Symbol.for('drizzle:Name')]
                if (name === 'agents') return [mockAgent]
                if (name === 'registered_sites') return [mockVictimSite]
                if (name === 'capabilities') throw new Error('relation "capabilities" does not exist')
                return []
              },
            }),
          }),
        }),
        insert: () => ({
          values: () => {
            insertedPassports++
            return { returning: async () => [] }
          },
        }),
      } as unknown as DbClient

      await expect(issuePassport(mockDb, { agentId, siteId })).rejects.toThrow('relation "capabilities" does not exist')
      expect(insertedPassports).toBe(0)
    })
  })

  // ═══════════════════════════════════════════
  // 4. Native SQL Analytics Aggregation
  // ═══════════════════════════════════════════
  describe('Site Gateway Analytics Aggregation', () => {
    it('uses native SQL aggregation counts without loading rows into memory', async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: async () => [
              {
                totalEvents: 1000,
                allowedCount: 950,
                blockedCount: 40,
                rateLimitedCount: 10,
                avgLatencyMs: 42,
                uniqueAgentsCount: 15,
              },
            ],
          }),
        }),
      } as unknown as DbClient

      const analytics = await getSiteAnalytics(mockDb, siteId)

      expect(analytics.totalEvents).toBe(1000)
      expect(analytics.allowedCount).toBe(950)
      expect(analytics.blockedCount).toBe(40)
      expect(analytics.rateLimitedCount).toBe(10)
      expect(analytics.blockRatePercent).toBe(5) // (40 + 10) / 1000 = 5%
      expect(analytics.avgLatencyMs).toBe(42)
      expect(analytics.uniqueAgentsCount).toBe(15)
    })

    it('reports zero rates and a null latency for a site without events', async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: async () => [
              { totalEvents: 0, allowedCount: 0, blockedCount: 0, rateLimitedCount: 0, avgLatencyMs: null, uniqueAgentsCount: 0 },
            ],
          }),
        }),
      } as unknown as DbClient

      const analytics = await getSiteAnalytics(mockDb, siteId)

      expect(analytics.totalEvents).toBe(0)
      expect(analytics.blockRatePercent).toBe(0)
      expect(analytics.avgLatencyMs).toBeNull()
      expect(analytics.uniqueAgentsCount).toBe(0)
    })

    it('lets a failing aggregate query surface instead of recomputing from unbounded rows', async () => {
      let rowScans = 0
      const mockDb = {
        select: (fields?: object) => {
          if (fields) {
            return {
              from: () => ({
                where: async () => {
                  throw new Error('connection terminated')
                },
              }),
            }
          }
          rowScans++
          return { from: () => ({ where: async () => [] }) }
        },
      } as unknown as DbClient

      await expect(getSiteAnalytics(mockDb, siteId)).rejects.toThrow('connection terminated')
      expect(rowScans).toBe(0)
    })
  })
})
