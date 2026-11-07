import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OTP_MAX_ATTEMPTS,
  OTP_SENDS_PER_EMAIL_PER_HOUR,
  OTP_SENDS_PER_IP_PER_HOUR,
  discardOtp,
  issueOtp,
  verifyOtp,
} from '../lib/otp'
import { MemoryOtpStore, SupabaseOtpStore, type OtpStore } from '../lib/otp-store'
import { FakeSupabase } from './helpers/fake-supabase'

const EMAIL = 'victim@example.com'
const IP = '203.0.113.7'
const START = Date.parse('2026-10-09T12:00:00.000Z')

function supabaseBacked(): { store: OtpStore; rows: Record<string, unknown>[] } {
  const fake = new FakeSupabase()
  const rows = fake.table('otp_challenges', {
    unique: [['email', 'window_start']],
    defaults: () => ({ id: crypto.randomUUID(), attempts: 0, consumed_at: null, created_at: new Date().toISOString() }),
  })
  // The fake implements the subset of the supabase-js builder that SupabaseOtpStore calls.
  const store = new SupabaseOtpStore(fake as unknown as ConstructorParameters<typeof SupabaseOtpStore>[0])
  return { store, rows }
}

const STORES: Array<[string, () => { store: OtpStore; rows?: Record<string, unknown>[] }]> = [
  ['in-memory store', () => ({ store: new MemoryOtpStore() })],
  ['Supabase store', supabaseBacked],
]

function wrongCode(code: string): string {
  return code === '000000' ? '111111' : '000000'
}

async function issue(store: OtpStore, email = EMAIL, ip: string | null = IP) {
  const issued = await issueOtp(store, email, ip, Date.now())
  if (!issued.ok) throw new Error(`issue refused: ${issued.reason}`)
  return issued.code
}

describe.each(STORES)('email OTP service on the %s', (_name, build) => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
    vi.stubEnv('AUTH_SECRET', 'test-auth-secret-for-vitest-only-0123456789')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('accepts the right code once and never again', async () => {
    const { store } = build()
    const code = await issue(store)
    expect(await verifyOtp(store, EMAIL, code)).toEqual({ ok: true })
    expect(await verifyOtp(store, EMAIL, code)).toMatchObject({ ok: false, reason: 'none' })
  })

  it('counts every wrong guess and locks the challenge after the allowed attempts, even for the right code', async () => {
    const { store } = build()
    const code = await issue(store)
    const bad = wrongCode(code)
    const lefts: number[] = []
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
      const result = await verifyOtp(store, EMAIL, bad)
      expect(result.ok).toBe(false)
      lefts.push(result.ok ? -1 : result.attemptsLeft)
    }
    expect(lefts).toEqual([4, 3, 2, 1, 0])
    expect(await verifyOtp(store, EMAIL, code)).toMatchObject({ ok: false, reason: 'locked' })
  })

  it('gives no extra guesses to a caller that replays requests: fifty tries still end in a lock', async () => {
    const { store } = build()
    const code = await issue(store)
    const bad = wrongCode(code)
    let locked = 0
    for (let i = 0; i < 50; i += 1) {
      const result = await verifyOtp(store, EMAIL, bad)
      if (!result.ok && result.reason === 'locked') locked += 1
    }
    expect(locked).toBeGreaterThanOrEqual(46)
    expect(await verifyOtp(store, EMAIL, code)).toMatchObject({ ok: false, reason: 'locked' })
  })

  it('spends at most the allowed attempts when guesses arrive in parallel', async () => {
    const { store } = build()
    const code = await issue(store)
    const bad = wrongCode(code)
    await Promise.all(Array.from({ length: 40 }, () => verifyOtp(store, EMAIL, bad)))
    const challenge = await store.latestActive(EMAIL, Date.now())
    expect(challenge).not.toBeNull()
    expect(challenge!.attempts).toBeGreaterThanOrEqual(1)
    expect(challenge!.attempts).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS)
  })

  it('lets only one of several parallel submissions of the right code in', async () => {
    const { store } = build()
    const code = await issue(store)
    const results = await Promise.all(Array.from({ length: 10 }, () => verifyOtp(store, EMAIL, code)))
    expect(results.filter((result) => result.ok)).toHaveLength(1)
  })

  it('invalidates the previous code when a new one is issued', async () => {
    const { store } = build()
    const first = await issue(store)
    vi.setSystemTime(START + 61_000)
    const second = await issue(store)
    if (first !== second) expect((await verifyOtp(store, EMAIL, first)).ok).toBe(false)
    expect(await verifyOtp(store, EMAIL, second)).toEqual({ ok: true })
  })

  it('refuses a second code within the same minute', async () => {
    const { store } = build()
    await issue(store)
    expect(await issueOtp(store, EMAIL, IP, Date.now())).toEqual({ ok: false, reason: 'cooldown' })
    vi.setSystemTime(START + 61_000)
    expect((await issueOtp(store, EMAIL, IP, Date.now())).ok).toBe(true)
  })

  it('refuses a burst of parallel sends for one email: one code is created', async () => {
    const { store } = build()
    const results = await Promise.all(Array.from({ length: 25 }, () => issueOtp(store, EMAIL, IP, Date.now())))
    expect(results.filter((result) => result.ok)).toHaveLength(1)
  })

  it('caps the codes sent to one email per hour', async () => {
    const { store } = build()
    for (let i = 0; i < OTP_SENDS_PER_EMAIL_PER_HOUR; i += 1) {
      await issue(store)
      vi.setSystemTime(Date.now() + 61_000)
    }
    expect(await issueOtp(store, EMAIL, IP, Date.now())).toEqual({ ok: false, reason: 'email_limit' })
    vi.setSystemTime(START + 61 * 60_000 + 61_000 * OTP_SENDS_PER_EMAIL_PER_HOUR)
    expect((await issueOtp(store, EMAIL, IP, Date.now())).ok).toBe(true)
  })

  it('caps the codes requested from one address per hour, across emails', async () => {
    const { store } = build()
    for (let i = 0; i < OTP_SENDS_PER_IP_PER_HOUR; i += 1) await issue(store, `user${i}@example.com`)
    expect(await issueOtp(store, 'one-more@example.com', IP, Date.now())).toEqual({ ok: false, reason: 'ip_limit' })
    expect((await issueOtp(store, 'one-more@example.com', '198.51.100.9', Date.now())).ok).toBe(true)
  })

  it('expires a code after five minutes', async () => {
    const { store } = build()
    const code = await issue(store)
    vi.setSystemTime(START + 5 * 60_000 + 1_000)
    expect(await verifyOtp(store, EMAIL, code)).toMatchObject({ ok: false, reason: 'none' })
  })

  it('does not let a code issued for one email open another account', async () => {
    const { store } = build()
    const code = await issue(store)
    expect(await verifyOtp(store, 'other@example.com', code)).toMatchObject({ ok: false, reason: 'none' })
    expect(await verifyOtp(store, EMAIL, code)).toEqual({ ok: true })
  })

  it('matches the email without regard to case or surrounding space', async () => {
    const { store } = build()
    const code = await issue(store, 'Victim@Example.com ')
    expect(await verifyOtp(store, ' VICTIM@example.com', code)).toEqual({ ok: true })
  })

  it('frees the minute slot of a code that could not be delivered', async () => {
    const { store } = build()
    const first = await issueOtp(store, EMAIL, IP, Date.now())
    expect(first.ok).toBe(true)
    if (first.ok) await discardOtp(store, first.challengeId)
    expect((await issueOtp(store, EMAIL, IP, Date.now())).ok).toBe(true)
  })

  it('reports unavailable instead of accepting anything when the store fails', async () => {
    const broken: OtpStore = {
      countSince: async () => { throw new Error('db down') },
      insert: async () => { throw new Error('db down') },
      invalidateOthers: async () => { throw new Error('db down') },
      remove: async () => { throw new Error('db down') },
      latestActive: async () => { throw new Error('db down') },
      claimAttempt: async () => { throw new Error('db down') },
      consume: async () => { throw new Error('db down') },
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await issueOtp(broken, EMAIL, IP, Date.now())).toEqual({ ok: false, reason: 'unavailable' })
    expect(await verifyOtp(broken, EMAIL, '123456', Date.now())).toMatchObject({ ok: false, reason: 'unavailable' })
  })
})

describe('what the store keeps', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_SECRET', 'test-auth-secret-for-vitest-only-0123456789')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('is only a hash of the code, never the code', async () => {
    const { store, rows } = supabaseBacked()
    const issued = await issueOtp(store, EMAIL, IP, Date.now())
    if (!issued.ok) throw new Error('issue refused')
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows[0])).not.toContain(issued.code)
    expect(rows[0].code_hash).toMatch(/^[A-Za-z0-9_-]{40,}$/)
  })
})
