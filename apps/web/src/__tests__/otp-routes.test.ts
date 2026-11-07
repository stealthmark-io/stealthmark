import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cookieStoreOf, newCookieJar, type CookieJar } from './helpers/cookie-store'
import { endlessBodyRequest } from './helpers/chunked-body'
import { MemoryOtpStore, type OtpStore } from '../lib/otp-store'

const state = vi.hoisted(() => ({ store: null as unknown, jar: null as unknown }))

vi.mock('next/headers', () => ({ cookies: async () => state.jar }))
vi.mock('@/lib/otp-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/otp-store')>()),
  getOtpStore: () => state.store,
}))

import { POST as send } from '../app/api/auth/otp/send/route'
import { POST as verify } from '../app/api/auth/otp/verify/route'
import { SESSION_COOKIE_NAME } from '../lib/auth'
import { OTP_MAX_ATTEMPTS } from '../lib/otp'

const EMAIL = 'founder@example.com'
const START = Date.parse('2026-10-09T12:00:00.000Z')

interface Sent {
  from: string
  to: string[]
  subject: string
  html: string
}

let emails: Sent[]
let resendStatus: number
let jar: CookieJar

function post(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://stealthmark.io${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers },
    body: JSON.stringify(body),
  })
}

function codeFromEmail(): string {
  const match = emails.at(-1)?.html.match(/>(\d{6})</)
  if (!match) throw new Error('no code in the last email')
  return match[1]
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
  state.store = new MemoryOtpStore()
  jar = newCookieJar()
  state.jar = cookieStoreOf(jar)
  emails = []
  resendStatus = 200
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('AUTH_SECRET', 'test-auth-secret-for-vitest-only-0123456789')
  vi.stubEnv('INTERNAL_AUTH_SECRET', 'test-internal-secret-for-vitest-only-0123456789')
  vi.stubEnv('RESEND_API_KEY', 're_test_key')
  vi.stubEnv('STEALTHMARK_OWNER_EMAILS', EMAIL)
  vi.stubEnv('NEXT_PUBLIC_AUTH_SANDBOX', 'true')
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url)
    if (target.startsWith('https://api.resend.com')) {
      if (resendStatus === 200) emails.push(JSON.parse(String(init?.body)))
      return new Response('{}', { status: resendStatus })
    }
    if (target.includes('/internal/auth/upsert-user')) {
      return Response.json({
        user: { id: 'usr-1', orgId: 'org-real', email: EMAIL, name: null, avatarUrl: null, provider: 'email', role: 'owner' },
        organization: { id: 'org-real', name: 'Org', plan: 'free' },
      })
    }
    throw new Error(`unexpected fetch ${target}`)
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('POST /api/auth/otp/send', () => {
  it('emails the code and never returns it, even when NEXT_PUBLIC_AUTH_SANDBOX is true in production', async () => {
    const res = await send(post('/api/auth/otp/send', { email: EMAIL }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(JSON.stringify(body)).not.toContain(codeFromEmail())
    expect(body).not.toHaveProperty('demoCode')
    expect(emails).toHaveLength(1)
    expect(emails[0].to).toEqual([EMAIL])
  })

  it('never writes the code to the logs', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await send(post('/api/auth/otp/send', { email: EMAIL }))
    const code = codeFromEmail()
    for (const spy of [info, warn, log]) expect(JSON.stringify(spy.mock.calls)).not.toContain(code)
  })

  it('sends from the StealthMark domain by default, not the Resend sandbox sender', async () => {
    await send(post('/api/auth/otp/send', { email: EMAIL }))
    expect(emails[0].from).toBe('StealthMark <auth@stealthmark.io>')
    expect(emails[0].from).not.toContain('resend.dev')
  })

  it('does not hold a challenge in a cookie', async () => {
    await send(post('/api/auth/otp/send', { email: EMAIL }))
    expect(jar.set).toEqual([])
  })

  it('reports a delivery failure instead of claiming the code was sent, and frees the slot for a retry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    resendStatus = 403
    const failed = await send(post('/api/auth/otp/send', { email: EMAIL }))
    expect(failed.status).toBe(502)
    expect((await failed.json()).error).toMatch(/could not send/i)
    resendStatus = 200
    expect((await send(post('/api/auth/otp/send', { email: EMAIL }))).status).toBe(200)
  })

  it('refuses to pretend when no email provider is configured in production', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const res = await send(post('/api/auth/otp/send', { email: EMAIL }))
    expect(res.status).toBe(502)
    expect(emails).toHaveLength(0)
  })

  it('answers 429 with Retry-After inside the same minute', async () => {
    expect((await send(post('/api/auth/otp/send', { email: EMAIL }))).status).toBe(200)
    const second = await send(post('/api/auth/otp/send', { email: EMAIL }))
    expect(second.status).toBe(429)
    expect(second.headers.get('retry-after')).toBe('60')
    expect(emails).toHaveLength(1)
  })

  it('does not email a victim more than the hourly cap, however often an attacker asks', async () => {
    for (let i = 0; i < 12; i += 1) {
      await send(post('/api/auth/otp/send', { email: EMAIL }))
      vi.setSystemTime(Date.now() + 61_000)
    }
    expect(emails.length).toBeLessThanOrEqual(5)
  })

  it('rejects malformed addresses and bodies', async () => {
    expect((await send(post('/api/auth/otp/send', { email: 'nope' }))).status).toBe(400)
    expect((await send(post('/api/auth/otp/send', { email: 42 }))).status).toBe(400)
    expect((await send(post('/api/auth/otp/send', { email: `${'a'.repeat(250)}@example.com` }))).status).toBe(400)
    expect((await send(new Request('https://stealthmark.io/api/auth/otp/send', { method: 'POST', body: 'x' }))).status).toBe(400)
  })

  it('refuses an address outside the owner allowlist with 403 and emails nobody', async () => {
    const res = await send(post('/api/auth/otp/send', { email: 'stranger@example.net' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/restricted to authorized/i)
    expect(emails).toHaveLength(0)
  })

  it('stops reading a chunked body once it passes 4 KB, without emailing anyone', async () => {
    const endless = endlessBodyRequest('https://stealthmark.io/api/auth/otp/send', { 'x-forwarded-for': '203.0.113.7' })
    expect((await send(endless.request)).status).toBe(413)
    expect(endless.pulls()).toBeLessThan(16)
    expect(emails).toHaveLength(0)
  })

  it('answers 503 when the server-side store is not available', async () => {
    state.store = null
    expect((await send(post('/api/auth/otp/send', { email: EMAIL }))).status).toBe(503)
  })

  it('mentions nobody when it pings Discord', async () => {
    vi.stubEnv('DISCORD_WEBHOOK_URL', 'https://discord.example/webhook')
    const calls: string[] = []
    const base = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith('https://discord.example')) {
        calls.push(String(init?.body))
        return new Response(null, { status: 204 })
      }
      return base(url, init)
    }))
    await send(post('/api/auth/otp/send', { email: EMAIL }))
    expect(JSON.parse(calls[0]).allowed_mentions).toEqual({ parse: [] })
  })

  it('ignores the NEXT_PUBLIC webhook fallback', async () => {
    vi.stubEnv('NEXT_PUBLIC_DISCORD_WEBHOOK_URL', 'https://discord.example/public')
    const urls: string[] = []
    const base = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url))
      return base(url, init)
    }))
    await send(post('/api/auth/otp/send', { email: EMAIL }))
    expect(urls.some((url) => url.includes('discord.example'))).toBe(false)
  })
})

describe('POST /api/auth/otp/verify', () => {
  async function requestCode(): Promise<string> {
    await send(post('/api/auth/otp/send', { email: EMAIL }))
    return codeFromEmail()
  }
  const wrong = (code: string) => (code === '000000' ? '111111' : '000000')

  it('signs in with the right code, sets the session cookie, and refuses the same code afterwards', async () => {
    const code = await requestCode()
    const ok = await verify(post('/api/auth/otp/verify', { email: EMAIL, code }))
    expect(ok.status).toBe(200)
    expect(jar.set.some((entry) => entry.name === SESSION_COOKIE_NAME)).toBe(true)

    const replay = await verify(post('/api/auth/otp/verify', { email: EMAIL, code }))
    expect(replay.status).toBe(400)
  })

  it('locks after the allowed attempts even if the attacker never adopts any cookie and replays the same request', async () => {
    const code = await requestCode()
    const statuses: number[] = []
    for (let i = 0; i < OTP_MAX_ATTEMPTS + 3; i += 1) {
      statuses.push((await verify(post('/api/auth/otp/verify', { email: EMAIL, code: wrong(code) }))).status)
    }
    expect(statuses.slice(0, OTP_MAX_ATTEMPTS - 1)).toEqual(Array(OTP_MAX_ATTEMPTS - 1).fill(400))
    expect(statuses.slice(OTP_MAX_ATTEMPTS - 1).every((status) => status === 429)).toBe(true)

    const late = await verify(post('/api/auth/otp/verify', { email: EMAIL, code }))
    expect(late.status).toBe(429)
    expect(jar.set.some((entry) => entry.name === SESSION_COOKIE_NAME)).toBe(false)
  })

  it('tells the user how many attempts remain', async () => {
    const code = await requestCode()
    const res = await verify(post('/api/auth/otp/verify', { email: EMAIL, code: wrong(code) }))
    expect((await res.json()).error).toContain('4 attempts remaining')
  })

  it('does not sign in another address with this address code', async () => {
    const code = await requestCode()
    const res = await verify(post('/api/auth/otp/verify', { email: 'someone-else@example.com', code }))
    expect(res.status).toBe(400)
    expect(jar.set.some((entry) => entry.name === SESSION_COOKIE_NAME)).toBe(false)
  })

  it('rejects anything that is not six digits before touching the store', async () => {
    const getSpy = vi.spyOn(state.store as OtpStore, 'latestActive')
    for (const code of ['12345', '1234567', 'abcdef', '12 456', '']) {
      expect((await verify(post('/api/auth/otp/verify', { email: EMAIL, code }))).status).toBe(400)
    }
    expect(getSpy).not.toHaveBeenCalled()
  })

  it('answers 503 when the server-side store is not available', async () => {
    state.store = null
    expect((await verify(post('/api/auth/otp/verify', { email: EMAIL, code: '123456' }))).status).toBe(503)
  })

  it('stops reading a chunked body once it passes 4 KB, without signing in', async () => {
    const endless = endlessBodyRequest('https://stealthmark.io/api/auth/otp/verify', { 'x-forwarded-for': '203.0.113.7' })
    expect((await verify(endless.request)).status).toBe(413)
    expect(endless.pulls()).toBeLessThan(16)
    expect(jar.set.some((entry) => entry.name === SESSION_COOKIE_NAME)).toBe(false)
  })
})
