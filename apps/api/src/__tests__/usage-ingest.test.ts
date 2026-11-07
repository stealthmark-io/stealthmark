import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from '../app.js'
import { MAX_BLOCKED_EVENTS_PER_ORG_PER_HOUR, MAX_INGEST_BATCH } from '@stealthmark/shared'
import type { DbClient } from '@stealthmark/db'
import { checkQuotaAlerts } from '../services/quota-alerts.js'
import { config } from '../config.js'
import { authHeaders, nonAdminKeyResolver, testApiKeyResolver } from './helpers/test-auth.js'
import { createMeteringDb, createState, defaultOrg, type FakeMeteringState } from './helpers/metering-db.js'

vi.mock('../services/quota-alerts.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/quota-alerts.js')>()),
  checkQuotaAlerts: vi.fn(async () => null),
}))

const SITE_ID = '00000000-0000-4000-8000-0000000000aa'
const FOREIGN_SITE_ID = '00000000-0000-4000-8000-0000000000bb'

async function appFor(state: FakeMeteringState) {
  return buildApp({ db: createMeteringDb(state), apiKeyResolver: nonAdminKeyResolver() })
}

function events(count: number, extra: Record<string, unknown> = {}) {
  return Array.from({ length: count }, () => ({ agent_identifier: 'GPTBot', ...extra }))
}

async function ingest(state: FakeMeteringState, payload: unknown, headers: Record<string, string> = authHeaders) {
  const app = await appFor(state)
  const res = await app.inject({ method: 'POST', url: '/v1/usage/ingest', headers, payload: payload as object })
  await app.close()
  return res
}

/** What the usage_records ledger already holds that the plain metering fake cannot answer. */
interface LedgerScript {
  /** agent_blocked rows already stored for the organization in the last hour. */
  blockedInHour: number
  /** event_ids already stored; filled by inserts so a second request sees the first one. */
  storedEventIds: Set<string>
  /** event_ids that only the unique index knows about: the pre-check misses them, the insert conflicts. */
  racedEventIds: Set<string>
}

function createLedger(overrides: Partial<LedgerScript> = {}): LedgerScript {
  return { blockedInHour: 0, storedEventIds: new Set(), racedEventIds: new Set(), ...overrides }
}

type Row = Record<string, unknown>

/**
 * Wraps the metering fake with the two ledger reads (event_id lookup, blocked-row count) and an
 * INSERT ... ON CONFLICT DO NOTHING ... RETURNING that honors the partial unique index on (org_id, event_id).
 */
function createLedgerDb(state: FakeMeteringState, ledger: LedgerScript): DbClient {
  const base = createMeteringDb(state) as unknown as {
    select: (fields?: Record<string, unknown>) => { from: (table: unknown) => unknown }
    update: (table: unknown) => unknown
  }
  const answer = (rows: Row[]) => {
    const node: Record<string, unknown> = {}
    for (const method of ['where', 'for', 'limit', 'orderBy']) node[method] = () => node
    node.then = (resolve: (value: Row[]) => unknown) => resolve(rows)
    return node
  }
  const wrapped = {
    select: (fields?: Record<string, unknown>) => {
      if (fields && 'blocked' in fields) return { from: () => answer([{ blocked: ledger.blockedInHour }]) }
      if (fields && 'eventId' in fields) {
        return { from: () => answer([...ledger.storedEventIds].map((eventId) => ({ eventId }))) }
      }
      return base.select(fields)
    },
    update: base.update,
    insert: () => ({
      values: (input: Row | Row[]) => {
        const rows = Array.isArray(input) ? input : [input]
        const store = (stored: Row[]) => {
          state.inserted.push(...stored)
          for (const row of stored) if (typeof row.eventId === 'string') ledger.storedEventIds.add(row.eventId)
        }
        return {
          then: (resolve: (value: undefined) => unknown) => {
            store(rows)
            return resolve(undefined)
          },
          onConflictDoNothing: () => ({
            returning: async () => {
              const fresh = rows.filter(
                (row) =>
                  typeof row.eventId !== 'string' ||
                  !(ledger.storedEventIds.has(row.eventId) || ledger.racedEventIds.has(row.eventId)),
              )
              store(fresh)
              return fresh.map((_row, index) => ({ id: `row-${index}` }))
            },
          }),
        }
      },
    }),
    transaction: async <T>(callback: (tx: unknown) => Promise<T>) => callback(wrapped),
  }
  return wrapped as unknown as DbClient
}

async function ingestWithLedger(
  state: FakeMeteringState,
  ledger: LedgerScript,
  payload: unknown,
  options: { admin?: boolean } = {},
) {
  const app = await buildApp({
    db: createLedgerDb(state, ledger),
    apiKeyResolver: options.admin ? testApiKeyResolver() : nonAdminKeyResolver(),
  })
  const res = await app.inject({ method: 'POST', url: '/v1/usage/ingest', headers: authHeaders, payload: payload as object })
  await app.close()
  return res
}

const EVENT_A = '11111111-1111-4111-8111-111111111111'
const EVENT_B = '22222222-2222-4222-8222-222222222222'
const EVENT_C = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  vi.mocked(checkQuotaAlerts).mockClear()
})

describe('POST /v1/usage/ingest', () => {
  it('rejects a request without an API key', async () => {
    const res = await ingest(createState(), { events: events(1) }, {})
    expect(res.statusCode).toBe(401)
  })

  it('rejects a batch above 500 events with 400 and stores nothing', async () => {
    const state = createState({ org: defaultOrg({ monthlyEventCap: 100000 }) })
    const res = await ingest(state, { events: events(MAX_INGEST_BATCH + 1) })
    expect(res.statusCode).toBe(400)
    expect(state.inserted).toHaveLength(0)
  })

  it('rejects an empty batch, unknown event types and invalid units', async () => {
    const state = createState()
    expect((await ingest(state, { events: [] })).statusCode).toBe(400)
    expect((await ingest(state, { events: [{ event_type: 'page_view' }] })).statusCode).toBe(400)
    expect((await ingest(state, { events: [{ units: 0 }] })).statusCode).toBe(400)
    expect((await ingest(state, { events: [{ event_type: 'agent_request', units: 0 }] })).statusCode).toBe(400)
    expect((await ingest(state, { events: [{ event_type: 'agent_manifest', units: 0 }] })).statusCode).toBe(400)
    expect((await ingest(state, { events: [{ event_type: 'agent_blocked', units: -1 }] })).statusCode).toBe(400)
    expect((await ingest(state, { events: [{ units: 1.5 }] })).statusCode).toBe(400)
    expect((await ingest(state, { events: [{ site_id: 'not-a-uuid' }] })).statusCode).toBe(400)
    expect(state.inserted).toHaveLength(0)
  })

  it('accepts events within the cap and answers the contract shape', async () => {
    const state = createState({ org: defaultOrg({ monthlyEventCap: 10 }), usedBase: 2 })
    const res = await ingest(state, { events: events(3) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      accepted: 3,
      rejected: 0,
      duplicates: 0,
      skipped_blocked: 0,
      cap: 10,
      used: 5,
      remaining: 5,
      billing_mode: 'free',
    })
    expect(state.inserted).toHaveLength(3)
    expect(state.inserted[0]).toMatchObject({
      source: 'middleware',
      eventType: 'agent_request',
      units: 1,
      agentIdentifier: 'GPTBot',
    })
  })

  it('stores blocked events with units 0 by default and manifest events with units 1', async () => {
    const state = createState()
    const res = await ingest(state, {
      events: [{ event_type: 'agent_blocked' }, { event_type: 'agent_blocked', units: 0 }, { event_type: 'agent_manifest' }],
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ accepted: 3, rejected: 0, used: 1, remaining: 9 })
    expect(state.inserted.map((row) => [row.eventType, row.units])).toEqual([
      ['agent_blocked', 0],
      ['agent_blocked', 0],
      ['agent_manifest', 1],
    ])
  })

  it('accepts blocked events when the organization is over its cap and never answers 429', async () => {
    const state = createState({ org: defaultOrg({ monthlyEventCap: 10 }), usedBase: 25 })
    const res = await ingest(state, { events: [{ event_type: 'agent_blocked' }, { event_type: 'agent_blocked' }] })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      accepted: 2,
      rejected: 0,
      duplicates: 0,
      skipped_blocked: 0,
      cap: 10,
      used: 25,
      remaining: 0,
      billing_mode: 'free',
    })
    expect(state.inserted).toHaveLength(2)
    expect(checkQuotaAlerts).not.toHaveBeenCalled()
  })

  it('does not debit credits for blocked events', async () => {
    const state = createState({ org: defaultOrg({ billingMode: 'credits', creditBalanceEvents: 0 }) })
    const res = await ingest(state, { events: [{ event_type: 'agent_blocked' }] })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ accepted: 1, rejected: 0, remaining: 0, billing_mode: 'credits' })
    expect(state.org?.creditBalanceEvents).toBe(0)
    expect(state.orgUpdates).toHaveLength(0)
    expect(state.inserted).toHaveLength(1)
  })

  it('stores blocked events of a mixed batch at the cap boundary while billable ones are cut', async () => {
    const state = createState({ org: defaultOrg({ monthlyEventCap: 10 }), usedBase: 9 })
    const res = await ingest(state, {
      events: [
        { event_type: 'agent_request' },
        { event_type: 'agent_blocked' },
        { event_type: 'agent_request' },
        { event_type: 'agent_blocked' },
      ],
    })
    expect(res.statusCode).toBe(429)
    expect(res.json()).toMatchObject({ error: 'quota_exceeded', accepted: 3, rejected: 1, used: 10, remaining: 0 })
    expect(state.inserted.map((row) => row.eventType).sort()).toEqual(['agent_blocked', 'agent_blocked', 'agent_request'])
  })

  it('answers 429 for a mixed batch whose billable events are all rejected, still storing the blocked ones', async () => {
    const state = createState({ org: defaultOrg({ monthlyEventCap: 10 }), usedBase: 10 })
    const res = await ingest(state, { events: [{ event_type: 'agent_request' }, { event_type: 'agent_blocked' }] })
    expect(res.statusCode).toBe(429)
    expect(res.json()).toMatchObject({ accepted: 1, rejected: 1, used: 10 })
    expect(state.inserted.map((row) => row.eventType)).toEqual(['agent_blocked'])
  })

  it('accepts the part that fits at the boundary and reports the cap reached with 429', async () => {
    const state = createState({ org: defaultOrg({ monthlyEventCap: 10 }), usedBase: 8 })
    const res = await ingest(state, { events: events(5) })
    expect(res.statusCode).toBe(429)
    expect(res.json()).toMatchObject({
      error: 'quota_exceeded',
      accepted: 2,
      rejected: 3,
      cap: 10,
      used: 10,
      remaining: 0,
      billing_mode: 'free',
      retry_after_seconds: 300,
    })
    expect(res.headers['retry-after']).toBe('300')
    expect(state.inserted).toHaveLength(2)
  })

  it('answers 429 at the cap without inserting anything', async () => {
    const state = createState({ org: defaultOrg({ monthlyEventCap: 10 }), usedBase: 10 })
    const res = await ingest(state, { events: events(4) })
    expect(res.statusCode).toBe(429)
    expect(res.json()).toMatchObject({ error: 'quota_exceeded', accepted: 0, rejected: 4, used: 10, remaining: 0 })
    expect(state.inserted).toHaveLength(0)
  })

  it('credits mode decrements the balance and stops at zero', async () => {
    const state = createState({ org: defaultOrg({ billingMode: 'credits', creditBalanceEvents: 5 }) })

    const first = await ingest(state, { events: events(3) })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ accepted: 3, remaining: 2, billing_mode: 'credits' })
    expect(state.org?.creditBalanceEvents).toBe(2)

    const second = await ingest(state, { events: events(4) })
    expect(second.statusCode).toBe(429)
    expect(second.json()).toMatchObject({ accepted: 2, rejected: 2, remaining: 0 })
    expect(state.org?.creditBalanceEvents).toBe(0)

    const third = await ingest(state, { events: events(1) })
    expect(third.statusCode).toBe(429)
    expect(third.json()).toMatchObject({ accepted: 0, rejected: 1 })
    expect(state.org?.creditBalanceEvents).toBe(0)
    expect(state.inserted).toHaveLength(5)
  })

  it('enterprise never answers 429', async () => {
    const state = createState({
      org: defaultOrg({ billingMode: 'enterprise', monthlyEventCap: 10 }),
      usedBase: 5_000_000,
    })
    const res = await ingest(state, { events: events(50) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ accepted: 50, rejected: 0, cap: null, remaining: null, billing_mode: 'enterprise' })
    expect(state.inserted).toHaveLength(50)
  })

  it('keeps only site ids that belong to the caller organization', async () => {
    const state = createState({ ownedSiteIds: [SITE_ID] })
    const res = await ingest(state, { events: [{ site_id: SITE_ID }, { site_id: FOREIGN_SITE_ID }, {}] })
    expect(res.statusCode).toBe(200)
    expect(state.inserted.map((row) => row.siteId)).toEqual([SITE_ID, null, null])
  })

  it('accepts any hex UUID shape for site_id and event_id, as the published SDK guard does', async () => {
    const state = createState({ ownedSiteIds: [SITE_ID] })
    const nonRfcId = '11111111-1111-1111-1111-111111111111'
    const res = await ingestWithLedger(state, createLedger(), {
      events: [{ site_id: nonRfcId, event_id: nonRfcId }, { site_id: SITE_ID }],
    })
    expect(res.statusCode).toBe(200)
    expect(state.inserted.map((row) => [row.siteId, row.eventId])).toEqual([[null, nonRfcId], [SITE_ID, null]])
  })

  it('stores source api only for platform keys and ignores any other source', async () => {
    const apiState = createState()
    await ingestWithLedger(apiState, createLedger(), { events: events(1), source: 'api' }, { admin: true })
    expect(apiState.inserted[0]).toMatchObject({ source: 'api' })

    const tenantState = createState()
    await ingest(tenantState, { events: events(1), source: 'api' })
    expect(tenantState.inserted[0]).toMatchObject({ source: 'middleware' })

    const gatewayState = createState()
    const res = await ingest(gatewayState, { events: events(1), source: 'gateway' })
    expect(res.statusCode).toBe(400)
    expect(gatewayState.inserted).toHaveLength(0)
  })

  it('re-stamps events far in the past so batches cannot be backdated into closed periods', async () => {
    const state = createState()
    const stale = '2020-01-01T00:00:00.000Z'
    const recent = new Date(Date.now() - 60_000).toISOString()
    await ingest(state, { events: [{ occurred_at: stale }, { occurred_at: recent }] })
    const [staleRow, recentRow] = state.inserted
    expect((staleRow.createdAt as Date).getTime()).toBeGreaterThan(Date.now() - 60_000)
    expect((recentRow.createdAt as Date).toISOString()).toBe(recent)
  })

  it('checks quota alerts after storing events', async () => {
    const state = createState({ org: defaultOrg({ monthlyEventCap: 10 }), usedBase: 7 })
    await ingest(state, { events: events(1) })
    expect(checkQuotaAlerts).toHaveBeenCalledTimes(1)
    const quota = vi.mocked(checkQuotaAlerts).mock.calls[0][2]
    expect(quota).toMatchObject({ used: 8, cap: 10 })
  })

  it('answers 404 for an unknown organization', async () => {
    const res = await ingest(createState({ org: null }), { events: events(1) })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /v1/usage/quota', () => {
  it('returns the quota shape for the key organization', async () => {
    const state = createState({
      org: defaultOrg({ monthlyEventCap: 200, quotaAlert80SentAt: new Date('2026-10-10T08:00:00.000Z') }),
      usedBase: 170,
    })
    const app = await appFor(state)
    const res = await app.inject({ method: 'GET', url: '/v1/usage/quota', headers: authHeaders })
    await app.close()

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      billing_mode: 'free',
      cap: 200,
      used: 170,
      remaining: 30,
      percent: 85,
      period_month: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      alerts: { eighty_percent_sent_at: '2026-10-10T08:00:00.000Z', hundred_percent_sent_at: null },
    })
  })

  it('enterprise reports null cap, remaining and percent', async () => {
    const app = await appFor(createState({ org: defaultOrg({ billingMode: 'enterprise' }), usedBase: 42 }))
    const res = await app.inject({ method: 'GET', url: '/v1/usage/quota', headers: authHeaders })
    await app.close()
    expect(res.json()).toMatchObject({ billing_mode: 'enterprise', cap: null, used: 42, remaining: null, percent: null })
  })

  it('requires an API key', async () => {
    const app = await appFor(createState())
    const res = await app.inject({ method: 'GET', url: '/v1/usage/quota' })
    await app.close()
    expect(res.statusCode).toBe(401)
  })

  it('refuses another organization for a non-admin key', async () => {
    const app = await appFor(createState())
    const res = await app.inject({
      method: 'GET',
      url: '/v1/usage/quota?orgId=00000000-0000-4000-8000-000000000999',
      headers: authHeaders,
    })
    await app.close()
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /v1/usage/ingest hardening', () => {
  describe('units are decided by the server', () => {
    it('forces 1 for counted events and 0 for blocked events whatever the body says', async () => {
      const state = createState({ org: defaultOrg({ monthlyEventCap: 1000 }) })
      const res = await ingest(state, {
        events: [
          { event_type: 'agent_request', units: 100 },
          { event_type: 'agent_manifest', units: 50 },
          { units: 7 },
          { event_type: 'agent_blocked', units: 9 },
        ],
      })
      expect(res.statusCode).toBe(200)
      expect(state.inserted.map((row) => [row.eventType, row.units])).toEqual([
        ['agent_blocked', 0],
        ['agent_request', 1],
        ['agent_manifest', 1],
        ['agent_request', 1],
      ])
      expect(res.json()).toMatchObject({ accepted: 4, used: 3 })
    })

    it('cannot be bypassed by claiming source api with an ordinary tenant key', async () => {
      const state = createState({ org: defaultOrg({ monthlyEventCap: 1000 }) })
      const res = await ingest(state, { source: 'api', events: [{ units: 100 }] })
      expect(res.statusCode).toBe(200)
      expect(state.inserted[0]).toMatchObject({ source: 'middleware', units: 1 })
      expect(res.json()).toMatchObject({ used: 1 })
    })

    it('honors units up to 100 for source api with a platform key, and still forces blocked to 0', async () => {
      const state = createState({ org: defaultOrg({ monthlyEventCap: 1000 }) })
      const res = await ingestWithLedger(
        state,
        createLedger(),
        { source: 'api', events: [{ units: 40 }, { event_type: 'agent_manifest' }, { event_type: 'agent_blocked', units: 5 }] },
        { admin: true },
      )
      expect(res.statusCode).toBe(200)
      expect(state.inserted.map((row) => [row.eventType, row.units, row.source])).toEqual([
        ['agent_blocked', 0, 'api'],
        ['agent_request', 40, 'api'],
        ['agent_manifest', 1, 'api'],
      ])
      expect(res.json()).toMatchObject({ used: 41 })
    })

    it('rejects units above 100 for every source', async () => {
      const state = createState({ org: defaultOrg({ monthlyEventCap: 100000 }) })
      expect((await ingest(state, { events: [{ units: 101 }] })).statusCode).toBe(400)
      const platform = await ingestWithLedger(state, createLedger(), { source: 'api', events: [{ units: 101 }] }, { admin: true })
      expect(platform.statusCode).toBe(400)
      expect(state.inserted).toHaveLength(0)
    })
  })

  describe('blocked (zero-unit) rows are capped per organization per hour', () => {
    it('stores only what is left of the hourly allowance and reports skipped_blocked', async () => {
      const state = createState()
      const ledger = createLedger({ blockedInHour: MAX_BLOCKED_EVENTS_PER_ORG_PER_HOUR - 2 })
      const res = await ingestWithLedger(state, ledger, { events: Array.from({ length: 5 }, () => ({ event_type: 'agent_blocked' })) })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ accepted: 2, rejected: 0, duplicates: 0, skipped_blocked: 3, used: 0 })
      expect(state.inserted).toHaveLength(2)
    })

    it('accepts the batch with 200 and stores nothing once the allowance is used up', async () => {
      const state = createState()
      const ledger = createLedger({ blockedInHour: MAX_BLOCKED_EVENTS_PER_ORG_PER_HOUR })
      const res = await ingestWithLedger(state, ledger, { events: [{ event_type: 'agent_blocked' }, { event_type: 'agent_blocked' }] })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ accepted: 0, skipped_blocked: 2 })
      expect(state.inserted).toHaveLength(0)
    })

    it('does not apply to counted events in the same batch', async () => {
      const state = createState({ org: defaultOrg({ monthlyEventCap: 100 }) })
      const ledger = createLedger({ blockedInHour: MAX_BLOCKED_EVENTS_PER_ORG_PER_HOUR })
      const res = await ingestWithLedger(state, ledger, { events: [{ event_type: 'agent_blocked' }, {}, { event_type: 'agent_manifest' }] })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ accepted: 2, skipped_blocked: 1, used: 2 })
      expect(state.inserted.map((row) => row.eventType)).toEqual(['agent_request', 'agent_manifest'])
    })

    it('does not let duplicates consume the allowance', async () => {
      const state = createState()
      const ledger = createLedger({ blockedInHour: MAX_BLOCKED_EVENTS_PER_ORG_PER_HOUR - 1 })
      const res = await ingestWithLedger(state, ledger, {
        events: [
          { event_type: 'agent_blocked', event_id: EVENT_A },
          { event_type: 'agent_blocked', event_id: EVENT_A },
          { event_type: 'agent_blocked', event_id: EVENT_B },
        ],
      })
      expect(res.json()).toMatchObject({ accepted: 1, duplicates: 1, skipped_blocked: 1 })
      expect(state.inserted.map((row) => row.eventId)).toEqual([EVENT_A])
    })

    it('stamps blocked rows with server time so a client cannot backdate them out of the hourly window', async () => {
      const state = createState()
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
      await ingest(state, { events: [{ event_type: 'agent_blocked', occurred_at: threeHoursAgo }] })
      expect((state.inserted[0].createdAt as Date).getTime()).toBeGreaterThan(Date.now() - 60_000)
    })
  })

  describe('metadata', () => {
    it('keeps only the whitelisted keys and drops raw IPs and headers', async () => {
      const state = createState()
      await ingest(state, {
        events: [
          {
            metadata: {
              path: '/docs',
              method: 'GET',
              status: 403,
              reason: 'defcon',
              ip: '203.0.113.9',
              headers: { authorization: 'secret' },
              nested: { a: 1 },
            },
          },
        ],
      })
      expect(state.inserted[0].metadata).toEqual({ path: '/docs', method: 'GET', status: 403, reason: 'defcon' })
    })

    it('stores metadata.host in the row and still drops unknown keys', async () => {
      const state = createState()
      const res = await ingest(state, {
        events: [
          {
            metadata: {
              path: '/pricing',
              method: 'GET',
              host: 'shop.example.com',
              site: 'shop',
              hostname: 'shop.internal',
              ip: '203.0.113.9',
            },
          },
          { metadata: { host: 'blog.example.com', cookie: 'session=secret' } },
        ],
      })
      expect(res.statusCode).toBe(200)
      expect(state.inserted.map((row) => row.metadata)).toEqual([
        { path: '/pricing', method: 'GET', host: 'shop.example.com' },
        { host: 'blog.example.com' },
      ])
    })

    it('drops non-primitive values of whitelisted keys and stores null when nothing is left', async () => {
      const state = createState()
      await ingest(state, { events: [{ metadata: { path: { deep: true }, status: null, other: 'x' } }, { metadata: {} }] })
      expect(state.inserted.map((row) => row.metadata)).toEqual([null, null])
    })

    it('truncates long strings to 200 characters', async () => {
      const state = createState()
      await ingest(state, { events: [{ metadata: { path: `/${'a'.repeat(500)}` } }] })
      expect((state.inserted[0].metadata as { path: string }).path).toHaveLength(200)
    })

    it('rejects metadata that serializes to more than 1024 bytes and stores nothing', async () => {
      const state = createState()
      const wide = '\u20ac'.repeat(200)
      const res = await ingest(state, { events: [{ metadata: { path: wide, method: wide, status: wide, reason: wide } }] })
      expect(res.statusCode).toBe(400)
      expect(state.inserted).toHaveLength(0)
    })
  })

  describe('event_id idempotency', () => {
    it('rejects an event_id that is not a uuid', async () => {
      const res = await ingest(createState(), { events: [{ event_id: 'abc' }] })
      expect(res.statusCode).toBe(400)
    })

    it('keeps the first of a repeated event_id inside one batch and counts the rest as duplicates', async () => {
      const state = createState({ org: defaultOrg({ monthlyEventCap: 100 }) })
      const res = await ingestWithLedger(state, createLedger(), {
        events: [{ event_id: EVENT_A }, { event_id: EVENT_A }, { event_id: EVENT_B }, {}, {}],
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ accepted: 4, rejected: 0, duplicates: 1, skipped_blocked: 0, used: 4 })
      expect(state.inserted.map((row) => row.eventId)).toEqual([EVENT_A, EVENT_B, null, null])
    })

    it('skips events stored by an earlier batch without consuming quota again', async () => {
      const state = createState({ org: defaultOrg({ monthlyEventCap: 100 }) })
      const ledger = createLedger()
      const first = await ingestWithLedger(state, ledger, { events: [{ event_id: EVENT_A }, { event_id: EVENT_B }] })
      expect(first.json()).toMatchObject({ accepted: 2, duplicates: 0, used: 2 })

      const retry = await ingestWithLedger(state, ledger, { events: [{ event_id: EVENT_B }, { event_id: EVENT_C }] })
      expect(retry.statusCode).toBe(200)
      expect(retry.json()).toMatchObject({ accepted: 1, duplicates: 1, used: 3 })
      expect(state.inserted.map((row) => row.eventId)).toEqual([EVENT_A, EVENT_B, EVENT_C])
    })

    it('answers 200 for a fully duplicated batch even when the organization is at its cap', async () => {
      const state = createState({ org: defaultOrg({ monthlyEventCap: 2 }) })
      const ledger = createLedger()
      const first = await ingestWithLedger(state, ledger, { events: [{ event_id: EVENT_A }, { event_id: EVENT_B }] })
      expect(first.statusCode).toBe(429)
      expect(first.json()).toMatchObject({ accepted: 2, remaining: 0 })

      const retry = await ingestWithLedger(state, ledger, { events: [{ event_id: EVENT_A }, { event_id: EVENT_B }] })
      expect(retry.statusCode).toBe(200)
      expect(retry.json()).toMatchObject({ accepted: 0, rejected: 0, duplicates: 2, used: 2, remaining: 0 })
      expect(state.inserted).toHaveLength(2)
    })

    it('does not debit credits for a retried batch', async () => {
      const state = createState({ org: defaultOrg({ billingMode: 'credits', creditBalanceEvents: 5 }) })
      const ledger = createLedger()
      await ingestWithLedger(state, ledger, { events: [{ event_id: EVENT_A }, { event_id: EVENT_B }] })
      expect(state.org?.creditBalanceEvents).toBe(3)

      const retry = await ingestWithLedger(state, ledger, { events: [{ event_id: EVENT_A }, { event_id: EVENT_B }] })
      expect(retry.json()).toMatchObject({ accepted: 0, duplicates: 2, remaining: 3 })
      expect(state.org?.creditBalanceEvents).toBe(3)
    })

    it('skips a row that hits the unique index at insert time and reports it as a duplicate', async () => {
      const state = createState({ org: defaultOrg({ monthlyEventCap: 100 }) })
      const ledger = createLedger({ racedEventIds: new Set([EVENT_A]) })
      const res = await ingestWithLedger(state, ledger, { events: [{ event_id: EVENT_A }, { event_id: EVENT_B }, {}] })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ accepted: 2, rejected: 0, duplicates: 1, skipped_blocked: 0 })
      expect(state.inserted.map((row) => row.eventId)).toEqual([EVENT_B, null])
    })
  })

  describe('internal secret (Canary forward)', () => {
    const CANARY_ORG_ID = '44444444-4444-4444-8444-444444444444'
    const secret = { 'x-internal-secret': config.INTERNAL_AUTH_SECRET }

    async function forward(state: FakeMeteringState, url: string, headers: Record<string, string>, payload: unknown) {
      const app = await appFor(state)
      const res = await app.inject({ method: 'POST', url, headers, payload: payload as object })
      await app.close()
      return res
    }

    it('stores an agent_blocked event for the organization named in ?orgId= at no cost', async () => {
      const state = createState()
      const res = await forward(state, `/v1/usage/ingest?orgId=${CANARY_ORG_ID}`, secret, {
        source: 'api',
        events: [{ event_type: 'agent_blocked', metadata: { reason: 'canary_triggered', ip_hash: 'ab12', served_at: 1 } }],
      })
      expect(res.statusCode).toBe(200)
      expect(state.inserted).toHaveLength(1)
      expect(state.inserted[0]).toMatchObject({ orgId: CANARY_ORG_ID, units: 0, source: 'api', eventType: 'agent_blocked' })
      expect(state.inserted[0].metadata).toEqual({ reason: 'canary_triggered', ip_hash: 'ab12', served_at: 1 })
    })

    it('refuses billable events and stores nothing', async () => {
      const state = createState()
      const res = await forward(state, `/v1/usage/ingest?orgId=${CANARY_ORG_ID}`, secret, {
        events: [{ event_type: 'agent_blocked' }, { event_type: 'agent_request' }],
      })
      expect(res.statusCode).toBe(403)
      expect(state.inserted).toHaveLength(0)
    })

    it('needs ?orgId= and the right secret', async () => {
      const payload = { events: [{ event_type: 'agent_blocked' }] }
      expect((await forward(createState(), '/v1/usage/ingest', secret, payload)).statusCode).toBe(400)
      const wrong = { 'x-internal-secret': 'x'.repeat(config.INTERNAL_AUTH_SECRET.length) }
      expect((await forward(createState(), `/v1/usage/ingest?orgId=${CANARY_ORG_ID}`, wrong, payload)).statusCode).toBe(401)
    })

    it('ignores ?orgId= for an API key caller', async () => {
      const state = createState()
      const res = await forward(state, `/v1/usage/ingest?orgId=${CANARY_ORG_ID}`, authHeaders, {
        events: [{ event_type: 'agent_blocked' }],
      })
      expect(res.statusCode).toBe(200)
      expect(state.inserted[0].orgId).not.toBe(CANARY_ORG_ID)
    })
  })

  describe('response fields', () => {
    it('reports every counter in the 429 body, and accepted + rejected + duplicates + skipped_blocked covers the batch', async () => {
      const state = createState({ org: defaultOrg({ monthlyEventCap: 10 }), usedBase: 9 })
      const ledger = createLedger({ blockedInHour: MAX_BLOCKED_EVENTS_PER_ORG_PER_HOUR })
      const res = await ingestWithLedger(state, ledger, {
        events: [
          { event_id: EVENT_A },
          { event_id: EVENT_A },
          { event_id: EVENT_B },
          { event_type: 'agent_blocked' },
          {},
        ],
      })
      expect(res.statusCode).toBe(429)
      const body = res.json()
      expect(body).toMatchObject({ error: 'quota_exceeded', accepted: 1, rejected: 2, duplicates: 1, skipped_blocked: 1 })
      expect(body.accepted + body.rejected + body.duplicates + body.skipped_blocked).toBe(5)
    })
  })
})
