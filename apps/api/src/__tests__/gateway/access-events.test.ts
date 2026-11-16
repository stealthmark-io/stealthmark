import { beforeEach, describe, expect, it } from 'vitest'
import {
  computeEventHash,
  computeLegacyEventHashV1,
  logGatewayAccessEvent,
  verifyGatewayChain,
} from '../../services/gateway-audit.js'
import { withTransactions } from '../helpers/fake-db.js'
import { authHeaders } from '../helpers/test-auth.js'
import {
  asDb,
  buildGatewayApp,
  chainedEventsDb,
  GENESIS_HASH,
  resetGatewayState,
  type Row,
  SAMPLE_AGENT_ID,
  SAMPLE_ORG_ID,
  SAMPLE_SITE_ID,
  storedEventsDb,
  SUITE_NAME,
} from './fixtures.js'

describe(SUITE_NAME, () => {
  beforeEach(resetGatewayState)

  describe('Gateway Access Events & Cryptographic Chain', () => {
    it('creates SHA-256 chained access events per site', async () => {
      const db = chainedEventsDb()

      const ev1 = await logGatewayAccessEvent(db, {
        siteId: SAMPLE_SITE_ID,
        orgId: SAMPLE_ORG_ID,
        action: 'allowed',
      })

      const ev2 = await logGatewayAccessEvent(db, {
        siteId: SAMPLE_SITE_ID,
        orgId: SAMPLE_ORG_ID,
        action: 'blocked',
        reason: 'Rate limit exceeded',
      })

      expect(ev1.prevHash).toBe(GENESIS_HASH)
      expect(ev2.prevHash).toBe(ev1.eventHash)
      expect(ev2.eventHash).not.toBe(ev1.eventHash)
    })

    it('verifies valid hash chain and detects tampered block', async () => {
      const now = new Date()
      const noMetadata = { ipAddress: null, passportId: null }
      const hash1 = computeEventHash(GENESIS_HASH, SAMPLE_SITE_ID, SAMPLE_AGENT_ID, 'allowed', null, now, noMetadata)
      const hash2 = computeEventHash(hash1, SAMPLE_SITE_ID, SAMPLE_AGENT_ID, 'allowed', null, now, noMetadata)

      const validEvents = [
        {
          id: '1',
          siteId: SAMPLE_SITE_ID,
          agentId: SAMPLE_AGENT_ID,
          action: 'allowed',
          reason: null,
          prevHash: GENESIS_HASH,
          eventHash: hash1,
          createdAt: now,
        },
        {
          id: '2',
          siteId: SAMPLE_SITE_ID,
          agentId: SAMPLE_AGENT_ID,
          action: 'allowed',
          reason: null,
          prevHash: hash1,
          eventHash: hash2,
          createdAt: now,
        },
      ]

      const resultValid = await verifyGatewayChain(storedEventsDb(validEvents), SAMPLE_SITE_ID)
      expect(resultValid.valid).toBe(true)
      expect(resultValid.verifiedCount).toBe(2)

      // The first block's action changes, so its stored hash no longer matches
      const tamperedEvents = [{ ...validEvents[0], action: 'blocked' }, validEvents[1]]

      const resultTampered = await verifyGatewayChain(storedEventsDb(tamperedEvents), SAMPLE_SITE_ID)
      expect(resultTampered.valid).toBe(false)
      expect(resultTampered.message).toContain('Corrupted hash at event index 0')
    })

    it('binds ipAddress and passportId into the v2 event hash and preserves backward compatibility with legacy v1 rows', async () => {
      const t1 = new Date('2026-10-01T00:00:00.000Z')
      const t2 = new Date('2026-10-01T00:01:00.000Z')
      const passportId = '111e4567-e89b-12d3-a456-426614174111'

      const legacyV1Hash = computeLegacyEventHashV1(
        GENESIS_HASH,
        SAMPLE_SITE_ID,
        SAMPLE_AGENT_ID,
        'allowed',
        'legacy event',
        t1
      )
      const v2Hash = computeEventHash(
        legacyV1Hash,
        SAMPLE_SITE_ID,
        SAMPLE_AGENT_ID,
        'allowed',
        'v2 event',
        t2,
        { ipAddress: '203.0.113.19', passportId }
      )

      const mixedChain = [
        {
          id: 'evt-v1',
          siteId: SAMPLE_SITE_ID,
          agentId: SAMPLE_AGENT_ID,
          passportId: null,
          ipAddress: '198.51.100.10',
          action: 'allowed',
          reason: 'legacy event',
          prevHash: GENESIS_HASH,
          eventHash: legacyV1Hash,
          createdAt: t1,
        },
        {
          id: 'evt-v2',
          siteId: SAMPLE_SITE_ID,
          agentId: SAMPLE_AGENT_ID,
          passportId,
          ipAddress: '203.0.113.19',
          action: 'allowed',
          reason: 'v2 event',
          prevHash: legacyV1Hash,
          eventHash: v2Hash,
          createdAt: t2,
        },
      ]

      const validMixed = await verifyGatewayChain(storedEventsDb(mixedChain), SAMPLE_SITE_ID)
      expect(validMixed.valid).toBe(true)
      expect(validMixed.verifiedCount).toBe(2)

      // Tampering with ipAddress on the v2 event must break the hash chain
      const tamperedIp = [mixedChain[0], { ...mixedChain[1], ipAddress: '198.51.100.250' }]
      const verifyTamperedIp = await verifyGatewayChain(storedEventsDb(tamperedIp), SAMPLE_SITE_ID)
      expect(verifyTamperedIp.valid).toBe(false)
      expect(verifyTamperedIp.brokenAtId).toBe('evt-v2')

      // Tampering with passportId on the v2 event must also break the hash chain
      const tamperedPassport = [mixedChain[0], { ...mixedChain[1], passportId: null }]
      const verifyTamperedPassport = await verifyGatewayChain(storedEventsDb(tamperedPassport), SAMPLE_SITE_ID)
      expect(verifyTamperedPassport.valid).toBe(false)
      expect(verifyTamperedPassport.brokenAtId).toBe('evt-v2')
    })

    it('rejects a row that only matches the legacy v1 hash once a v2 row has been seen', async () => {
      const t1 = new Date('2026-10-01T00:00:00.000Z')
      const t2 = new Date('2026-10-01T00:01:00.000Z')
      const v2Hash = computeEventHash(GENESIS_HASH, SAMPLE_SITE_ID, SAMPLE_AGENT_ID, 'allowed', 'v2 event', t1, {
        ipAddress: '203.0.113.19',
        passportId: null,
      })
      const v1OnlyHash = computeLegacyEventHashV1(v2Hash, SAMPLE_SITE_ID, SAMPLE_AGENT_ID, 'blocked', 'downgraded', t2)

      const chain = [
        {
          id: 'evt-v2',
          siteId: SAMPLE_SITE_ID,
          agentId: SAMPLE_AGENT_ID,
          passportId: null,
          ipAddress: '203.0.113.19',
          action: 'allowed',
          reason: 'v2 event',
          prevHash: GENESIS_HASH,
          eventHash: v2Hash,
          createdAt: t1,
        },
        {
          id: 'evt-v1-after-v2',
          siteId: SAMPLE_SITE_ID,
          agentId: SAMPLE_AGENT_ID,
          passportId: null,
          ipAddress: '198.51.100.10',
          action: 'blocked',
          reason: 'downgraded',
          prevHash: v2Hash,
          eventHash: v1OnlyHash,
          createdAt: t2,
        },
      ]

      const result = await verifyGatewayChain(storedEventsDb(chain), SAMPLE_SITE_ID)
      expect(result.valid).toBe(false)
      expect(result.verifiedCount).toBe(1)
      expect(result.brokenAtId).toBe('evt-v1-after-v2')
      expect(result.message).toContain('Corrupted hash at event index 1')
    })

    it('keeps the v2 hash of a given event unchanged, so rows already stored keep verifying', () => {
      const createdAt = new Date('2026-10-01T00:01:00.000Z')

      const withEveryField = computeEventHash(
        GENESIS_HASH,
        SAMPLE_SITE_ID,
        SAMPLE_AGENT_ID,
        'blocked',
        'scope violation',
        createdAt,
        { ipAddress: '203.0.113.19', passportId: '111e4567-e89b-12d3-a456-426614174111' }
      )
      const withoutOptionalFields = computeEventHash(GENESIS_HASH, SAMPLE_SITE_ID, null, 'allowed', null, createdAt, {
        ipAddress: null,
        passportId: null,
      })

      expect(withEveryField).toBe('98a66be1316b1de6eb8e1e6aff22a4b3ddf42d57b2398d75a045efd9eac5cafd')
      expect(withoutOptionalFields).toBe('c50c87a93bef5e366176b3d2c2dc9be90b5c2392274676462e6b82db50df9cbb')
    })

    it('validates ipAddress syntax and reason length on POST /v1/gateway/sites/:id/access and falls back to request.ip when empty', async () => {
      const site = { id: SAMPLE_SITE_ID, orgId: SAMPLE_ORG_ID, domain: 'audit.example.org', status: 'active' }
      const inserted: Record<string, unknown>[] = []
      const db = asDb({
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [site],
              orderBy: () => ({ limit: async () => [] }),
            }),
          }),
        }),
        transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            execute: async () => [],
            select: () => ({
              from: () => ({
                where: () => ({
                  orderBy: () => ({ limit: async () => [] }),
                }),
              }),
            }),
            insert: () => ({
              values: (val: Record<string, unknown>) => ({
                returning: async () => {
                  const row = { id: 'evt-access-1', ...val }
                  inserted.push(row)
                  return [row]
                },
              }),
            }),
          }),
      })

      const app = await buildGatewayApp(db)

      const invalidIpRes = await app.inject({
        method: 'POST',
        url: `/v1/gateway/sites/${SAMPLE_SITE_ID}/access`,
        headers: authHeaders,
        payload: { action: 'blocked', ipAddress: '1.2.3.4, 5.6.7.8', reason: 'spoofed header' },
      })
      expect(invalidIpRes.statusCode).toBe(400)

      const longReasonRes = await app.inject({
        method: 'POST',
        url: `/v1/gateway/sites/${SAMPLE_SITE_ID}/access`,
        headers: authHeaders,
        payload: { action: 'blocked', ipAddress: '203.0.113.5', reason: 'x'.repeat(501) },
      })
      expect(longReasonRes.statusCode).toBe(400)

      const fallbackIpRes = await app.inject({
        method: 'POST',
        url: `/v1/gateway/sites/${SAMPLE_SITE_ID}/access`,
        remoteAddress: '35.191.0.1',
        headers: { ...authHeaders, 'x-forwarded-for': '203.0.113.77' },
        payload: { action: 'allowed', ipAddress: '', reason: 'clean request' },
      })
      await app.close()

      expect(fallbackIpRes.statusCode).toBe(201)
      expect(inserted[0]?.ipAddress).toBe('203.0.113.77')
    })

    it('stores agentId and passportId sent in uppercase so the event still verifies against the row Postgres returns', async () => {
      const passportId = '111e4567-e89b-12d3-a456-426614174111'
      const site = { id: SAMPLE_SITE_ID, orgId: SAMPLE_ORG_ID, domain: 'audit.example.org', status: 'active' }
      const inserted: Row[] = []
      const db = withTransactions({
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [site],
              orderBy: () => ({ limit: async () => [] }),
            }),
          }),
        }),
        insert: () => ({
          values: (val: Row) => ({
            returning: async () => {
              const row = { id: 'evt-uppercase-ids', ...val }
              inserted.push(row)
              return [row]
            },
          }),
        }),
      })

      const app = await buildGatewayApp(db)
      const res = await app.inject({
        method: 'POST',
        url: `/v1/gateway/sites/${SAMPLE_SITE_ID}/access`,
        headers: authHeaders,
        payload: { action: 'allowed', agentId: SAMPLE_AGENT_ID.toUpperCase(), passportId: passportId.toUpperCase() },
      })
      await app.close()

      expect(res.statusCode).toBe(201)

      // uuid columns come back from Postgres in lowercase, whatever case they were written in.
      const storedRow = {
        ...inserted[0],
        agentId: String(inserted[0]?.agentId).toLowerCase(),
        passportId: String(inserted[0]?.passportId).toLowerCase(),
      }
      const result = await verifyGatewayChain(storedEventsDb([storedRow]), SAMPLE_SITE_ID)
      expect(result.valid).toBe(true)
      expect(inserted[0]).toMatchObject({ agentId: SAMPLE_AGENT_ID, passportId })
    })

    it('answers GET /sites/:id/analytics with a 500 and a request id when the aggregate query fails', async () => {
      const site = { id: SAMPLE_SITE_ID, orgId: SAMPLE_ORG_ID, domain: 'analytics.example.org', status: 'active' }
      const db = asDb({
        select: (fields?: object) =>
          fields
            ? {
                from: () => ({
                  where: async () => {
                    throw new Error('canceling statement due to statement timeout')
                  },
                }),
              }
            : { from: () => ({ where: () => ({ limit: async () => [site] }) }) },
      })
      const app = await buildGatewayApp(db)

      const res = await app.inject({
        method: 'GET',
        url: `/v1/gateway/sites/${SAMPLE_SITE_ID}/analytics`,
        headers: authHeaders,
      })
      await app.close()

      expect(res.statusCode).toBe(500)
      expect(res.json().error).toBe('internal_error')
      expect(res.json().requestId).toEqual(expect.any(String))
      expect(res.body).not.toContain('statement timeout')
    })
  })
})
