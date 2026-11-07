import { describe, it, expect, vi } from 'vitest'
import { computeQuota, getQuota, reserveEvents, periodMonthString } from '../services/quota.js'
import { alertLevelFor, checkQuotaAlerts } from '../services/quota-alerts.js'
import { sendEmail } from '../services/email.js'
import { createMeteringDb, createState, defaultOrg } from './helpers/metering-db.js'

const NOW = new Date('2026-10-15T12:00:00.000Z')
const ORG_ID = '123e4567-e89b-12d3-a456-426614174000'

async function reserve(state: ReturnType<typeof createState>, units: number[]) {
  const db = createMeteringDb(state)
  return reserveEvents(
    db,
    ORG_ID,
    async () => ({ unitsPerEvent: units, plan: null }),
    async (tx, accepted) => {
      await tx.insert({} as never).values(units.slice(0, accepted).map((u) => ({ units: u })) as never)
    },
    NOW,
  )
}

describe('computeQuota', () => {
  it('free: cap is monthly_event_cap and remaining never goes below zero', () => {
    const quota = computeQuota(defaultOrg({ monthlyEventCap: 100 }), 120, NOW)
    expect(quota).toMatchObject({ billingMode: 'free', cap: 100, used: 120, remaining: 0, percent: 120 })
  })

  it('credits: remaining is the balance and the reported cap is used + balance', () => {
    const quota = computeQuota(defaultOrg({ billingMode: 'credits', creditBalanceEvents: 30 }), 70, NOW)
    expect(quota).toMatchObject({ cap: 100, remaining: 30, percent: 70 })
  })

  it('enterprise: no cap, but monthly_event_cap still drives alerts', () => {
    const quota = computeQuota(defaultOrg({ billingMode: 'enterprise', monthlyEventCap: 1000 }), 900, NOW)
    expect(quota).toMatchObject({ cap: null, remaining: null, percent: null, alertCap: 1000 })
    expect(alertLevelFor(quota)).toBe(80)
  })

  it('reports the UTC period month', () => {
    expect(periodMonthString(new Date('2026-10-31T23:59:59.000Z'))).toBe('2026-10-01')
    expect(periodMonthString(new Date('2026-11-01T00:00:00.000Z'))).toBe('2026-11-01')
  })
})

describe('getQuota', () => {
  it('sums the period units against the effective cap', async () => {
    const state = createState({ org: defaultOrg({ monthlyEventCap: 50 }), usedBase: 20 })
    const quota = await getQuota(createMeteringDb(state), ORG_ID, NOW)
    expect(quota).toMatchObject({ used: 20, remaining: 30, percent: 40, periodMonth: '2026-10-01' })
  })

  it('returns null for an unknown organization', async () => {
    expect(await getQuota(createMeteringDb(createState({ org: null })), ORG_ID, NOW)).toBeNull()
  })
})

describe('reserveEvents', () => {
  it('accepts everything that fits in the cap', async () => {
    const state = createState({ org: defaultOrg({ monthlyEventCap: 10 }), usedBase: 2 })
    const result = await reserve(state, [1, 1, 1])
    expect(result).toMatchObject({ accepted: 3, rejected: 0 })
    expect(result?.quota).toMatchObject({ used: 5, remaining: 5 })
    expect(state.inserted).toHaveLength(3)
  })

  it('accepts only up to the remaining quota at the boundary', async () => {
    const state = createState({ org: defaultOrg({ monthlyEventCap: 10 }), usedBase: 8 })
    const result = await reserve(state, [1, 1, 1, 1, 1])
    expect(result).toMatchObject({ accepted: 2, rejected: 3 })
    expect(result?.quota).toMatchObject({ used: 10, remaining: 0 })
    expect(state.inserted).toHaveLength(2)
  })

  it('stops at the first event whose units do not fit', async () => {
    const state = createState({ org: defaultOrg({ monthlyEventCap: 10 }), usedBase: 6 })
    const result = await reserve(state, [1, 5, 1])
    expect(result).toMatchObject({ accepted: 1, rejected: 2 })
  })

  it('stores nothing when the organization is at the cap', async () => {
    const state = createState({ org: defaultOrg({ monthlyEventCap: 10 }), usedBase: 10 })
    const result = await reserve(state, [1, 1])
    expect(result).toMatchObject({ accepted: 0, rejected: 2 })
    expect(state.inserted).toHaveLength(0)
  })

  it('credits: decrements the balance and stops at zero without going negative', async () => {
    const state = createState({ org: defaultOrg({ billingMode: 'credits', creditBalanceEvents: 3 }) })
    const first = await reserve(state, [1, 1])
    expect(first).toMatchObject({ accepted: 2, rejected: 0 })
    expect(state.org?.creditBalanceEvents).toBe(1)

    const second = await reserve(state, [1, 1, 1])
    expect(second).toMatchObject({ accepted: 1, rejected: 2 })
    expect(state.org?.creditBalanceEvents).toBe(0)

    const third = await reserve(state, [1])
    expect(third).toMatchObject({ accepted: 0, rejected: 1 })
    expect(state.org?.creditBalanceEvents).toBe(0)
    expect(state.orgUpdates.every((update) => Number(update.creditBalanceEvents) >= 0)).toBe(true)
  })

  it('enterprise: never rejects, even far above monthly_event_cap', async () => {
    const state = createState({
      org: defaultOrg({ billingMode: 'enterprise', monthlyEventCap: 10 }),
      usedBase: 1_000_000,
    })
    const result = await reserve(state, [1, 1, 1])
    expect(result).toMatchObject({ accepted: 3, rejected: 0 })
    expect(result?.quota.remaining).toBeNull()
  })

  it('runs persist even when nothing was accepted so zero-unit rows can be stored in the same transaction', async () => {
    const state = createState({ org: defaultOrg({ monthlyEventCap: 10 }), usedBase: 10 })
    const persist = vi.fn(async () => undefined)
    const result = await reserveEvents(
      createMeteringDb(state),
      ORG_ID,
      async () => ({ unitsPerEvent: [], plan: null }),
      persist,
      NOW,
    )
    expect(result).toMatchObject({ accepted: 0, rejected: 0 })
    expect(persist).toHaveBeenCalledWith(expect.anything(), 0, null)
  })

  it('lets prepare decide the units and hands its plan to persist and to the caller', async () => {
    const state = createState({ org: defaultOrg({ monthlyEventCap: 10 }), usedBase: 8 })
    const plan = { dropped: 2 }
    const persist = vi.fn(async (_tx: unknown, accepted: number) => accepted * 10)
    const result = await reserveEvents(
      createMeteringDb(state),
      ORG_ID,
      async () => ({ unitsPerEvent: [1, 1, 1], plan }),
      persist,
      NOW,
    )
    expect(result).toMatchObject({ accepted: 2, rejected: 1, plan, stored: 20 })
    expect(persist).toHaveBeenCalledWith(expect.anything(), 2, plan)
  })

  it('runs prepare after the organization lock and skips it for an unknown organization', async () => {
    const prepare = vi.fn(async () => ({ unitsPerEvent: [1], plan: null }))
    const persist = vi.fn(async () => undefined)
    const result = await reserveEvents(createMeteringDb(createState({ org: null })), ORG_ID, prepare, persist, NOW)
    expect(result).toBeNull()
    expect(prepare).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })

  it('returns null when the organization does not exist', async () => {
    expect(await reserve(createState({ org: null }), [1])).toBeNull()
  })
})

describe('checkQuotaAlerts', () => {
  const owner = { email: 'owner@acme.test' }

  function setup(overrides: Parameters<typeof createState>[0] = {}) {
    const state = createState({ org: defaultOrg({ monthlyEventCap: 10 }), owners: [owner], ...overrides })
    const send = vi.fn(async () => ({ sent: true }))
    const deps = { send, apiKey: 're_test_key', from: 'StealthMark <alerts@stealthmark.io>' }
    return { state, db: createMeteringDb(state), send, deps }
  }

  async function quotaFor(state: ReturnType<typeof createState>, used: number) {
    const quota = await getQuota(createMeteringDb({ ...state, usedBase: used, inserted: [] }), ORG_ID, NOW)
    if (!quota) throw new Error('quota expected')
    return quota
  }

  it('sends the 80% alert once and stamps the organization', async () => {
    const { state, db, send, deps } = setup()
    expect(await checkQuotaAlerts(db, ORG_ID, await quotaFor(state, 8), deps, NOW)).toBe(80)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: owner.email, from: deps.from }))
    expect(state.org?.quotaAlert80SentAt).toEqual(NOW)

    expect(await checkQuotaAlerts(db, ORG_ID, await quotaFor(state, 9), deps, NOW)).toBeNull()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('sends the 100% alert once, after the 80% one, and marks both stamps', async () => {
    const { state, db, send, deps } = setup()
    await checkQuotaAlerts(db, ORG_ID, await quotaFor(state, 8), deps, NOW)
    expect(await checkQuotaAlerts(db, ORG_ID, await quotaFor(state, 10), deps, NOW)).toBe(100)
    expect(await checkQuotaAlerts(db, ORG_ID, await quotaFor(state, 12), deps, NOW)).toBeNull()
    expect(send).toHaveBeenCalledTimes(2)
    expect(state.org?.quotaAlert100SentAt).toEqual(NOW)
  })

  it('jumping straight past the cap sends only the 100% alert and never a late 80%', async () => {
    const { state, db, send, deps } = setup()
    expect(await checkQuotaAlerts(db, ORG_ID, await quotaFor(state, 11), deps, NOW)).toBe(100)
    expect(await checkQuotaAlerts(db, ORG_ID, await quotaFor(state, 11), deps, NOW)).toBeNull()
    expect(send).toHaveBeenCalledTimes(1)
    expect(state.org?.quotaAlert80SentAt).toEqual(NOW)
  })

  it('does not alert below 80%', async () => {
    const { state, db, send, deps } = setup()
    expect(await checkQuotaAlerts(db, ORG_ID, await quotaFor(state, 7), deps, NOW)).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })

  it('alerts again in a new period when the stamp belongs to the previous month', async () => {
    const { state, db, send, deps } = setup({
      org: defaultOrg({ monthlyEventCap: 10, quotaAlert80SentAt: new Date('2026-09-20T00:00:00.000Z') }),
    })
    expect(await checkQuotaAlerts(db, ORG_ID, await quotaFor(state, 8), deps, NOW)).toBe(80)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('logs and skips without RESEND_API_KEY, leaving the organization untouched', async () => {
    const { state, db, send } = setup()
    const logger = { info: vi.fn(), warn: vi.fn() }
    const result = await checkQuotaAlerts(db, ORG_ID, await quotaFor(state, 10), { send, apiKey: undefined, logger }, NOW)
    expect(result).toBeNull()
    expect(send).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(state.org?.quotaAlert100SentAt).toBeNull()
  })

  it('falls back to the oldest user when the organization has no owner', async () => {
    const { state, db, send, deps } = setup({ owners: [], members: [{ email: 'first@acme.test' }] })
    await checkQuotaAlerts(db, ORG_ID, await quotaFor(state, 9), deps, NOW)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'first@acme.test' }))
  })

  it('releases the claim when delivery fails so the next ingest retries', async () => {
    const { state, db, deps } = setup()
    const failing = vi.fn(async () => ({ sent: false, reason: 'http_500' }))
    const result = await checkQuotaAlerts(db, ORG_ID, await quotaFor(state, 9), { ...deps, send: failing }, NOW)
    expect(result).toBeNull()
    expect(state.org?.quotaAlert80SentAt).toBeNull()
  })

  it('never throws when the database fails', async () => {
    const { state, deps } = setup()
    const quota = await quotaFor(state, 9)
    const broken = { transaction: async () => { throw new Error('db down') } } as never
    await expect(checkQuotaAlerts(broken, ORG_ID, quota, deps, NOW)).resolves.toBeNull()
  })
})

describe('sendEmail', () => {
  const base = { apiKey: 're_secret', from: 'a@b.test', to: 'c@d.test', subject: 's', text: 't' }

  it('posts to the Resend API with a bearer key', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    const result = await sendEmail({ ...base, fetchImpl })
    expect(result).toEqual({ sent: true })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_secret')
  })

  it('reports an HTTP failure without leaking the key and never throws', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 422 }))
    const result = await sendEmail({ ...base, fetchImpl })
    expect(result).toEqual({ sent: false, reason: 'http_422' })
  })

  it('reports network errors and timeouts as results', async () => {
    const network = vi.fn(async () => { throw new TypeError('fetch failed') })
    expect(await sendEmail({ ...base, fetchImpl: network })).toEqual({ sent: false, reason: 'network_error' })
    const timeout = vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError') })
    expect(await sendEmail({ ...base, fetchImpl: timeout })).toEqual({ sent: false, reason: 'timeout' })
  })
})
