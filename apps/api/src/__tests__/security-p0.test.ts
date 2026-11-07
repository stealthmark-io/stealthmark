import dns from 'node:dns/promises'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildApp } from '../app.js'
import { hashApiKey } from '../lib/crypto.js'
import type { DbClient, ApiKey } from '@stealthmark/db'
import { createEscrow, validateAndRelease, refundEscrow } from '../services/escrow.js'
import { logGatewayAccessEvent } from '../services/gateway-audit.js'
import { logAuditEvent } from '../services/audit.js'
import { verifySiteDns } from '../services/site-registration.js'
import { fakeTxtResolver } from './helpers/fake-dns.js'
import { authHeaders } from './helpers/test-auth.js'
import { buildGatewayApp, SAMPLE_SITE_ID, SAMPLE_ORG_ID, siteVerificationDb } from './gateway/fixtures.js'

describe('Security Audit — P0 Critical Remediation Tests', () => {
  const orgId = '11111111-2222-3333-4444-555555555555'
  const agentId = '66666666-7777-8888-9999-000000000000'
  const siteId = 'site-1111-2222-3333-444444444444'

  const readApiKeyStr = 'sk_live_regular_user_key_123456789012'
  const adminApiKeyStr = 'sk_live_admin_superuser_key_12345678'

  const mockRegularKey: ApiKey = {
    id: 'key-reg-1',
    orgId,
    keyHash: hashApiKey(readApiKeyStr),
    keyPrefix: 'sk_live_regu...9012',
    name: 'Regular Key',
    scopes: ['extract', 'capabilities:read'],
    rateLimitRpm: 60,
    rateLimitRpd: 10000,
    spendLimit: null,
    status: 'active',
    lastUsedAt: null,
    createdAt: new Date(),
  }

  const mockAdminKey: ApiKey = {
    id: 'key-admin-1',
    orgId,
    keyHash: hashApiKey(adminApiKeyStr),
    keyPrefix: 'sk_live_admi...5678',
    name: 'Admin Key',
    scopes: ['admin'],
    rateLimitRpm: 200,
    rateLimitRpd: 100000,
    spendLimit: null,
    status: 'active',
    lastUsedAt: null,
    createdAt: new Date(),
  }

  function createMockDb(apiKeyRecord?: ApiKey) {
    return {
      select: () => ({
        from: (tbl: any) => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => [],
            }),
            limit: async () => {
              const name = (tbl as any)?.[Symbol.for('drizzle:Name')] || tbl?._?.name
              if (name === 'api_keys' && apiKeyRecord) {
                return [apiKeyRecord]
              }
              if (name === 'registered_sites') {
                return [
                  {
                    id: siteId,
                    orgId,
                    domain: 'platform.test.io',
                    displayName: 'Platform',
                    status: 'active',
                    dnsVerified: true,
                    allowedScopes: ['read'],
                    passportTtlSeconds: 3600,
                  },
                ]
              }
              if (name === 'agents') {
                return [{ id: agentId, orgId, status: 'active', name: 'Agent 007' }]
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
        set: (val: any) => ({
          where: () => ({
            returning: async () => [{ id: 'updated-id', ...val }],
            then: (res: any) => res([]),
          }),
        }),
      }),
      delete: () => ({
        where: () => Promise.resolve([]),
      }),
    } as unknown as DbClient
  }

  // ══════════════════════════════════════════════════════
  // 1. Gateway Authentication & Public Exemptions
  // ══════════════════════════════════════════════════════
  describe('P0.1: Gateway Route Authentication Enforcement', () => {
    it('blocks unauthenticated site registration with 401', async () => {
      const app = await buildApp({ db: createMockDb() })
      const res = await app.inject({
        method: 'POST',
        url: '/v1/gateway/sites',
        payload: { domain: 'evil.com', displayName: 'Evil' },
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().error).toBe('unauthorized')
    })

    it('blocks unauthenticated passport issuance with 401', async () => {
      const app = await buildApp({ db: createMockDb(), features: { passports: true } })
      const res = await app.inject({
        method: 'POST',
        url: '/v1/gateway/passport',
        payload: { agentId, siteId },
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().error).toBe('unauthorized')
    })

    it('blocks unauthenticated site listing with 401', async () => {
      const app = await buildApp({ db: createMockDb() })
      const res = await app.inject({
        method: 'GET',
        url: '/v1/gateway/sites',
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().error).toBe('unauthorized')
    })

    it('allows public access to /v1/gateway/public-key without credentials', async () => {
      const app = await buildApp({ db: createMockDb(), features: { passports: true } })
      const res = await app.inject({
        method: 'GET',
        url: '/v1/gateway/public-key',
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().kty).toBe('OKP')
      expect(res.json().crv).toBe('Ed25519')
    })

    it('allows public access to /v1/gateway/jwks without credentials', async () => {
      const app = await buildApp({ db: createMockDb(), features: { passports: true } })
      const res = await app.inject({
        method: 'GET',
        url: '/v1/gateway/jwks',
      })
      expect(res.statusCode).toBe(200)
      expect(Array.isArray(res.json().keys)).toBe(true)
    })
  })

  // ══════════════════════════════════════════════════════
  // 2. Destructive Operations Scope Protection
  // ══════════════════════════════════════════════════════
  describe('P0.2: Destructive Gateway Operations Require Admin Scope', () => {
    it('rejects DELETE /v1/gateway/sites/:id when key lacks admin scope (403)', async () => {
      const app = await buildApp({ db: createMockDb(mockRegularKey) })
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/gateway/sites/${siteId}`,
        headers: { 'x-api-key': readApiKeyStr },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe('insufficient_scope')
    })

    it('rejects POST /v1/gateway/agents/:id/behavioral/reset without admin scope (403)', async () => {
      const app = await buildApp({ db: createMockDb(mockRegularKey) })
      const res = await app.inject({
        method: 'POST',
        url: `/v1/gateway/agents/${agentId}/behavioral/reset`,
        headers: { 'x-api-key': readApiKeyStr },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe('insufficient_scope')
    })
  })

  // ══════════════════════════════════════════════════════
  // 3. DNS Verification never trusts the caller
  // ══════════════════════════════════════════════════════
  describe('P0.3: DNS Verification never trusts the caller', () => {
    const unverifiedSite = {
      id: SAMPLE_SITE_ID,
      orgId: SAMPLE_ORG_ID,
      domain: 'unverified-domain-12345.org',
      dnsVerificationToken: 'sm-verify-secrettoken',
      dnsVerified: false,
      status: 'pending',
    }
    const noTxtRecords = fakeTxtResolver({})

    afterEach(() => {
      vi.unstubAllEnvs()
      vi.restoreAllMocks()
    })

    it.each(['production', 'development'])(
      'POST /v1/gateway/sites/:id/verify ignores a mockSuccess body flag when NODE_ENV=%s',
      async (nodeEnv) => {
        vi.stubEnv('NODE_ENV', nodeEnv)
        const lookup = vi
          .spyOn(dns, 'resolveTxt')
          .mockRejectedValue(Object.assign(new Error('queryTxt ENOTFOUND'), { code: 'ENOTFOUND' }))
        const app = await buildGatewayApp(siteVerificationDb(unverifiedSite))

        const res = await app.inject({
          method: 'POST',
          url: `/v1/gateway/sites/${SAMPLE_SITE_ID}/verify`,
          headers: authHeaders,
          payload: { mockSuccess: true },
        })
        await app.close()

        expect(res.statusCode).toBe(400)
        expect(res.json().verified).toBe(false)
        expect(lookup).toHaveBeenCalledWith('_stealthmark-verify.unverified-domain-12345.org')
      }
    )

    it('verifySiteDns refuses SKIP_DNS_VERIFICATION when NODE_ENV=production', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('SKIP_DNS_VERIFICATION', 'true')

      const result = await verifySiteDns(siteVerificationDb(unverifiedSite), SAMPLE_SITE_ID, {
        resolveTxt: noTxtRecords,
      })

      expect(result.verified).toBe(false)
      expect(result.error).toContain('ENOTFOUND')
    })

    it('verifySiteDns honors SKIP_DNS_VERIFICATION only outside production and never queries DNS then', async () => {
      vi.stubEnv('NODE_ENV', 'development')
      vi.stubEnv('SKIP_DNS_VERIFICATION', 'true')
      const resolveTxt = vi.fn(noTxtRecords)

      const result = await verifySiteDns(siteVerificationDb(unverifiedSite), SAMPLE_SITE_ID, { resolveTxt })

      expect(result.verified).toBe(true)
      expect(resolveTxt).not.toHaveBeenCalled()
    })
  })

  // ══════════════════════════════════════════════════════
  // 4. Financial Operations Atomicity (Escrow Transactions)
  // ══════════════════════════════════════════════════════
  describe('P0.4: Escrow Operations Atomicity via Transactions', () => {
    it('executes createEscrow within a transaction and propagates rollback', async () => {
      let transactionCalled = false

      const mockDb = {
        transaction: async (cb: any) => {
          transactionCalled = true
          const txClient = {
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: async () => [
                    {
                      id: 'contract-1',
                      consumerOrgId: orgId,
                      providerOrgId: 'provider-org-1',
                      status: 'active',
                    },
                  ],
                }),
              }),
            }),
            insert: () => ({
              values: (val: any) => ({
                returning: async () => [{ id: 'escrow-1', ...val }],
              }),
            }),
            update: () => ({
              set: () => ({
                where: async () => {
                  throw new Error('Database disk error during balance update!')
                },
              }),
            }),
          }
          return cb(txClient)
        },
      } as unknown as DbClient

      await expect(
        createEscrow(mockDb, {
          contractId: 'contract-1',
          consumerOrgId: orgId,
          amount: 50,
        })
      ).rejects.toThrow('Database disk error during balance update!')

      expect(transactionCalled).toBe(true)
    })

    it('executes validateAndRelease within a transaction and handles failures atomically', async () => {
      let transactionCalled = false

      const mockDb = {
        transaction: async (cb: any) => {
          transactionCalled = true
          const txClient = {
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: async () => [
                    {
                      id: 'escrow-1',
                      consumerOrgId: orgId,
                      providerOrgId: 'provider-org-1',
                      status: 'work_submitted',
                      amount: '100',
                      netAmount: '95',
                    },
                  ],
                }),
              }),
            }),
            update: () => ({
              set: () => ({
                where: () => ({
                  returning: async () => {
                    throw new Error('Ledger settlement transaction failure')
                  },
                }),
              }),
            }),
          }
          return cb(txClient)
        },
      } as unknown as DbClient

      await expect(
        validateAndRelease(mockDb, {
          escrowId: 'escrow-1',
          consumerOrgId: orgId,
        })
      ).rejects.toThrow('Ledger settlement transaction failure')

      expect(transactionCalled).toBe(true)
    })

    it('executes refundEscrow within a transaction', async () => {
      let transactionCalled = false

      const mockDb = {
        transaction: async (cb: any) => {
          transactionCalled = true
          const txClient = {
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: async () => [
                    {
                      id: 'escrow-1',
                      consumerOrgId: orgId,
                      providerOrgId: 'provider-org-1',
                      status: 'held',
                      amount: '100',
                    },
                  ],
                }),
              }),
            }),
            update: () => ({
              set: () => ({
                where: () => ({
                  returning: async () => [{ id: 'escrow-1', status: 'refunded' }],
                  then: (res: any) => res([]),
                }),
              }),
            }),
          }
          return cb(txClient)
        },
      } as unknown as DbClient

      const result = await refundEscrow(mockDb, {
        escrowId: 'escrow-1',
        orgId,
      })

      expect(transactionCalled).toBe(true)
      expect(result.status).toBe('refunded')
    })
  })

  // ══════════════════════════════════════════════════════
  // 5. Cryptographic Hash Chain Advisory Locking
  // ══════════════════════════════════════════════════════
  describe('P0.5: Cryptographic Hash Chain Advisory Locking', () => {
    const GENESIS = '0'.repeat(64)
    const pgDialect = new PgDialect()

    function emptyChainStub(insertedId: string, locks: string[] = []) {
      return {
        execute: async (query: SQL) => {
          locks.push(pgDialect.sqlToQuery(query).sql)
          return []
        },
        select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }),
        insert: () => ({
          values: (val: Record<string, unknown>) => ({
            returning: async () => [{ id: insertedId, ...val }],
          }),
        }),
      }
    }

    function transactionOver(stub: object): { db: DbClient; opened: () => number } {
      let opened = 0
      const db = {
        transaction: async (cb: (tx: object) => Promise<unknown>) => {
          opened++
          return cb(stub)
        },
      } as unknown as DbClient
      return { db, opened: () => opened }
    }

    it('logGatewayAccessEvent takes the per-site advisory lock inside a transaction before chaining', async () => {
      const locks: string[] = []
      const { db, opened } = transactionOver(emptyChainStub('event-1', locks))

      const event = await logGatewayAccessEvent(db, { siteId, orgId, action: 'allowed' })

      expect(opened()).toBe(1)
      expect(locks).toEqual(['SELECT pg_advisory_xact_lock(hashtext($1))'])
      expect(event.prevHash).toBe(GENESIS)
      expect(event.eventHash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('logAuditEvent takes the per-org advisory lock inside a transaction before chaining', async () => {
      const locks: string[] = []
      const { db, opened } = transactionOver(emptyChainStub('audit-1', locks))

      const log = await logAuditEvent(db, {
        orgId,
        actorId: 'admin-user',
        action: 'org.config_updated',
        entityType: 'organization',
        entityId: orgId,
      })

      expect(opened()).toBe(1)
      expect(locks).toEqual(['SELECT pg_advisory_xact_lock(hashtext($1))'])
      expect(log.prevHash).toBe(GENESIS)
      expect(log.logHash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('does not append to either chain when the advisory lock cannot be taken', async () => {
      const inserts: unknown[] = []
      const stub = {
        ...emptyChainStub('never'),
        execute: async () => {
          throw new Error('lock timeout')
        },
        insert: () => ({
          values: (val: unknown) => {
            inserts.push(val)
            return { returning: async () => [val] }
          },
        }),
      }
      const { db } = transactionOver(stub)

      await expect(logGatewayAccessEvent(db, { siteId, orgId, action: 'allowed' })).rejects.toThrow('lock timeout')
      await expect(
        logAuditEvent(db, { orgId, actorId: 'a', action: 'x', entityType: 'organization', entityId: orgId })
      ).rejects.toThrow('lock timeout')
      expect(inserts).toEqual([])
    })
  })
})
