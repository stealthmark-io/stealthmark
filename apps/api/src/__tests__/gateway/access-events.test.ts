import { beforeEach, describe, expect, it } from 'vitest'
import {
  computeEventHash,
  logGatewayAccessEvent,
  verifyGatewayChain,
} from '../../services/gateway-audit.js'
import { authHeaders } from '../helpers/test-auth.js'
import {
  asDb,
  buildGatewayApp,
  chainedEventsDb,
  GENESIS_HASH,
  resetGatewayState,
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
      const hash1 = computeEventHash(GENESIS_HASH, SAMPLE_SITE_ID, SAMPLE_AGENT_ID, 'allowed', null, now)
      const hash2 = computeEventHash(hash1, SAMPLE_SITE_ID, SAMPLE_AGENT_ID, 'allowed', null, now)

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
