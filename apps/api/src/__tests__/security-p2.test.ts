import { describe, it, expect } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { hashApiKey } from '../lib/crypto.js'
import type { DbClient, ApiKey } from '@stealthmark/db'
import {
  registeredSites,
  agentPassports,
  gatewayAccessEvents,
  capabilities,
  tasks,
  apiKeys,
} from '@stealthmark/db'
import {
  getGatewayEvents,
  getPaginatedGatewayEvents,
} from '../services/gateway-audit.js'
import {
  listSitesByOrg,
  listAllSites,
} from '../services/site-registration.js'

describe('Security & Performance Audit — Phase C (P2) Tests', () => {
  const sampleOrgId = '777e4567-e89b-12d3-a456-426614174777'
  const sampleSiteId = '555e4567-e89b-12d3-a456-426614174555'
  const testApiKeyStr = 'sk_live_testvalidkey12345678901234567890'

  const mockApiKeyRecord: ApiKey = {
    id: 'key-1111-1111-1111',
    orgId: sampleOrgId,
    keyHash: hashApiKey(testApiKeyStr),
    keyPrefix: 'sk_live_test...7890',
    name: 'Gateway Test Key',
    scopes: ['*'],
    rateLimitRpm: 120,
    rateLimitRpd: 10000,
    spendLimit: null,
    status: 'active',
    lastUsedAt: null,
    createdAt: new Date(),
  }

  const mockSite = {
    id: sampleSiteId,
    orgId: sampleOrgId,
    domain: 'api.p2-test.io',
    displayName: 'P2 Test Site',
    status: 'active',
    dnsVerified: true,
    allowedScopes: ['read', 'write'],
    passportTtlSeconds: 3600,
    createdAt: new Date('2026-09-16T12:00:00.000Z'),
    updatedAt: new Date('2026-09-16T12:00:00.000Z'),
  }

  // ═══════════════════════════════════════════
  // 1. Database Index Metadata Verification
  // ═══════════════════════════════════════════
  describe('Database Schema Index Integrity', () => {
    it('verifies primary tables have indexes defined', () => {
      // Drizzle table symbols contain config with indexes
      const sitesConfig = (registeredSites as any)[Symbol.for('drizzle:ExtraConfigBuilder')]
      const passportsConfig = (agentPassports as any)[Symbol.for('drizzle:ExtraConfigBuilder')]
      const eventsConfig = (gatewayAccessEvents as any)[Symbol.for('drizzle:ExtraConfigBuilder')]
      const capabilitiesConfig = (capabilities as any)[Symbol.for('drizzle:ExtraConfigBuilder')]
      const tasksConfig = (tasks as any)[Symbol.for('drizzle:ExtraConfigBuilder')]
      const apiKeysConfig = (apiKeys as any)[Symbol.for('drizzle:ExtraConfigBuilder')]

      expect(sitesConfig).toBeDefined()
      expect(passportsConfig).toBeDefined()
      expect(eventsConfig).toBeDefined()
      expect(capabilitiesConfig).toBeDefined()
      expect(tasksConfig).toBeDefined()
      expect(apiKeysConfig).toBeDefined()
    })
  })

  // ═══════════════════════════════════════════
  // 2. Cursor Pagination on Gateway Events
  // ═══════════════════════════════════════════
  describe('Cursor Pagination for Access Events', () => {
    it('getPaginatedGatewayEvents calculates nextCursor and hasMore flag', async () => {
      const now = Date.now()
      const mockEvents = [
        {
          id: 'ev-1',
          siteId: sampleSiteId,
          orgId: sampleOrgId,
          passportId: null,
          agentId: 'agent-1',
          action: 'allowed' as const,
          reason: null,
          ipAddress: '127.0.0.1',
          latencyMs: 15,
          prevHash: '00000000',
          eventHash: 'hash-1',
          createdAt: new Date(now),
        },
        {
          id: 'ev-2',
          siteId: sampleSiteId,
          orgId: sampleOrgId,
          passportId: null,
          agentId: 'agent-2',
          action: 'allowed' as const,
          reason: null,
          ipAddress: '127.0.0.1',
          latencyMs: 25,
          prevHash: 'hash-1',
          eventHash: 'hash-2',
          createdAt: new Date(now - 1000),
        },
        {
          id: 'ev-3',
          siteId: sampleSiteId,
          orgId: sampleOrgId,
          passportId: null,
          agentId: 'agent-3',
          action: 'blocked' as const,
          reason: 'unauthorized',
          ipAddress: '127.0.0.1',
          latencyMs: 5,
          prevHash: 'hash-2',
          eventHash: 'hash-3',
          createdAt: new Date(now - 2000),
        },
      ]

      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: async (lim: number) => mockEvents.slice(0, lim),
              }),
            }),
          }),
        }),
      } as unknown as DbClient

      // Request limit of 2 items
      const result = await getPaginatedGatewayEvents(mockDb, sampleSiteId, 2)

      expect(result.events.length).toBe(2)
      expect(result.hasMore).toBe(true)
      expect(result.nextCursor).toBe(mockEvents[1].createdAt.toISOString())
    })

    it('GET /v1/gateway/sites/:id/events returns pagination envelope', async () => {
      const mockDb = {
        select: () => ({
          from: (tbl: any) => ({
            where: () => ({
              orderBy: () => ({
                limit: async () => [],
              }),
              limit: async () => {
                const name = (tbl as any)?.[Symbol.for('drizzle:Name')] || tbl?._?.name
                if (name === 'api_keys') return [mockApiKeyRecord]
                if (name === 'registered_sites') return [mockSite]
                return []
              },
            }),
          }),
        }),
      } as unknown as DbClient

      const app = await buildApp({ db: mockDb })

      const res = await app.inject({
        method: 'GET',
        url: `/v1/gateway/sites/${sampleSiteId}/events?limit=25`,
        headers: { 'x-api-key': testApiKeyStr },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.events).toBeDefined()
      expect(Array.isArray(body.events)).toBe(true)
      expect(body).toHaveProperty('nextCursor')
      expect(body).toHaveProperty('hasMore')
    })
  })

  // ═══════════════════════════════════════════
  // 3. Cursor Pagination on Sites Listing
  // ═══════════════════════════════════════════
  describe('Cursor Pagination for Registered Sites', () => {
    it('GET /v1/gateway/sites returns sites and nextCursor envelope', async () => {
      const mockDb = {
        select: () => ({
          from: (tbl: any) => ({
            where: () => ({
              orderBy: () => ({
                limit: async () => [mockSite],
              }),
              limit: async () => {
                const name = (tbl as any)?.[Symbol.for('drizzle:Name')] || tbl?._?.name
                if (name === 'api_keys') return [mockApiKeyRecord]
                return [mockSite]
              },
            }),
            orderBy: () => ({
              limit: async () => [mockSite],
            }),
          }),
        }),
      } as unknown as DbClient

      const app = await buildApp({ db: mockDb })

      const res = await app.inject({
        method: 'GET',
        url: `/v1/gateway/sites?orgId=${sampleOrgId}&limit=10`,
        headers: { 'x-api-key': testApiKeyStr },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.sites).toBeDefined()
      expect(Array.isArray(body.sites)).toBe(true)
      expect(body).toHaveProperty('nextCursor')
    })
  })

  // ═══════════════════════════════════════════
  // 4. Listing queries run exactly as written
  // ═══════════════════════════════════════════
  describe('Listing queries surface database errors and never drop their filters', () => {
    const dialect = new PgDialect()
    const cursor = '2026-09-16T12:00:00.000Z'

    function recordingDb(rows: unknown[], failWith?: Error) {
      const wheres: Array<{ sql: string; params: unknown[] }> = []
      const db = {
        select: () => ({
          from: () => ({
            where: (condition: SQL | undefined) => {
              wheres.push(condition ? dialect.sqlToQuery(condition) : { sql: '', params: [] })
              return {
                orderBy: () => ({
                  limit: async () => {
                    if (failWith) throw failWith
                    return rows
                  },
                }),
              }
            },
          }),
        }),
      } as unknown as DbClient
      return { db, wheres }
    }

    it('getGatewayEvents filters by site and cursor in a single query', async () => {
      const { db, wheres } = recordingDb([])

      await getGatewayEvents(db, sampleSiteId, 10, cursor)

      expect(wheres).toHaveLength(1)
      expect(wheres[0].sql).toContain('"site_id" = $1')
      expect(wheres[0].sql).toContain('"created_at" < $2')
      expect(wheres[0].params[0]).toBe(sampleSiteId)
    })

    it('getGatewayEvents ignores an unparseable cursor but still filters by site', async () => {
      const { db, wheres } = recordingDb([])

      await getGatewayEvents(db, sampleSiteId, 10, 'not-a-date')

      expect(wheres[0].sql).toContain('"site_id" = $1')
      expect(wheres[0].sql).not.toContain('"created_at"')
    })

    it('getGatewayEvents propagates a failing cursor query instead of retrying without it', async () => {
      const { db, wheres } = recordingDb([], new Error('statement timeout'))

      await expect(getGatewayEvents(db, sampleSiteId, 10, cursor)).rejects.toThrow('statement timeout')
      expect(wheres).toHaveLength(1)
    })

    it('listSitesByOrg keeps the organization filter together with the cursor', async () => {
      const { db, wheres } = recordingDb([mockSite])

      const sites = await listSitesByOrg(db, sampleOrgId, { limit: 10, cursor })

      expect(sites).toEqual([mockSite])
      expect(wheres[0].sql).toContain('"org_id" = $1')
      expect(wheres[0].sql).toContain('"created_at" < $2')
    })

    it('listAllSites applies the status filter and cursor together', async () => {
      const { db, wheres } = recordingDb([mockSite])

      await listAllSites(db, { status: 'suspended', cursor })

      expect(wheres).toHaveLength(1)
      expect(wheres[0].sql).toContain('"status" = $1')
      expect(wheres[0].sql).toContain('"created_at" < $2')
      expect(wheres[0].params[0]).toBe('suspended')
    })

    it('listAllSites never falls back to an unfiltered listing when the filtered query fails', async () => {
      const { db, wheres } = recordingDb([mockSite], new Error('connection terminated'))

      await expect(listAllSites(db, { status: 'suspended' })).rejects.toThrow('connection terminated')
      expect(wheres).toHaveLength(1)
    })
  })
})
