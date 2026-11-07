import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cookieStoreOf, newCookieJar, type CookieJar } from './helpers/cookie-store'

const state = vi.hoisted(() => ({ jar: null as unknown }))
vi.mock('next/headers', () => ({ cookies: async () => state.jar }))

import { GET as githubStart } from '../app/api/auth/github/route'
import { GET as googleStart } from '../app/api/auth/google/route'
import { GET as githubCallback } from '../app/api/auth/callback/github/route'
import { GET as googleCallback } from '../app/api/auth/callback/google/route'
import { OAUTH_STATE_COOKIE_NAME, SESSION_COOKIE_NAME } from '../lib/auth'
import { pickVerifiedGithubEmail, verifiedSupabaseEmail } from '../lib/verified-email'

let jar: CookieJar
let upsertCalls: Array<Record<string, unknown>>

const redirectOf = (res: Response) => new URL(res.headers.get('location') ?? 'about:blank')
const sessionCookies = () => jar.set.filter((entry) => entry.name === SESSION_COOKIE_NAME)

function provisioned(email: string): Response {
  return Response.json({
    user: { id: 'usr-1', orgId: 'org-real', email, name: 'N', avatarUrl: null, provider: 'google', role: 'owner' },
    organization: { id: 'org-real', name: 'Org', plan: 'free' },
  })
}

beforeEach(() => {
  jar = newCookieJar()
  state.jar = cookieStoreOf(jar)
  upsertCalls = []
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('AUTH_SECRET', 'test-auth-secret-for-vitest-only-0123456789')
  vi.stubEnv('INTERNAL_AUTH_SECRET', 'test-internal-secret-for-vitest-only-0123456789')
  for (const name of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) vi.stubEnv(name, '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe.each([
  ['github', githubStart, 'GITHUB', 'https://github.com/login/oauth/authorize'],
  ['google', googleStart, 'GOOGLE', 'https://accounts.google.com/o/oauth2/v2/auth'],
] as const)('GET /api/auth/%s', (_provider, start, envPrefix, authorizeUrl) => {
  const call = (query = '') => start(new Request(`https://stealthmark.io/api/auth/${_provider}${query}`))

  it.each(['', '?sandbox=true', '?sandbox=1&x=y'])('never mints a session when the provider is not configured (%s)', async (query) => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const res = await call(query)
    expect(res.status).toBe(307)
    expect(redirectOf(res).pathname).toBe('/login')
    expect(redirectOf(res).searchParams.get('error')).toBe('oauth_not_configured')
    expect(sessionCookies()).toHaveLength(0)
    expect(res.headers.get('set-cookie') ?? '').not.toContain(SESSION_COOKIE_NAME)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('ignores ?sandbox=true even when the provider is configured and goes through the real consent screen', async () => {
    vi.stubEnv(`${envPrefix}_CLIENT_ID`, 'client-id')
    vi.stubEnv(`${envPrefix}_CLIENT_SECRET`, 'client-secret')
    const res = await call('?sandbox=true')
    expect(res.headers.get('location')).toContain(authorizeUrl)
    expect(sessionCookies()).toHaveLength(0)
    expect(jar.set.some((entry) => entry.name === OAUTH_STATE_COOKIE_NAME)).toBe(true)
  })
})

describe('GET /api/auth/callback/google', () => {
  function callback(profile: Record<string, unknown>): Promise<Response> {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret')
    jar.values.set(OAUTH_STATE_COOKIE_NAME, 'state-1')
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url)
      if (target.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'token' })
      if (target.includes('openidconnect.googleapis.com')) return Response.json(profile)
      if (target.includes('/internal/auth/upsert-user')) {
        upsertCalls.push(JSON.parse(String(init?.body)))
        return provisioned(String(profile.email))
      }
      throw new Error(`unexpected fetch ${target}`)
    }))
    return googleCallback(new Request('https://stealthmark.io/api/auth/callback/google?code=abc&state=state-1'))
  }

  it('signs in an address Google verified', async () => {
    const res = await callback({ email: 'a@example.com', email_verified: true, sub: '1', name: 'A' })
    expect(redirectOf(res).pathname).toBe('/console')
    expect(sessionCookies()).toHaveLength(1)
    expect(upsertCalls).toHaveLength(1)
  })

  it.each([{ email_verified: false }, {}, { email_verified: 'true' }])('refuses an address Google did not verify (%o)', async (extra) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await callback({ email: 'victim@example.com', sub: '1', ...extra })
    expect(redirectOf(res).pathname).toBe('/login')
    expect(redirectOf(res).searchParams.get('error')).toBe('email_not_verified')
    expect(sessionCookies()).toHaveLength(0)
    expect(upsertCalls).toHaveLength(0)
  })

  it('never puts an internal error message in the redirect', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret')
    jar.values.set(OAUTH_STATE_COOKIE_NAME, 'state-1')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432 secret-host') }))
    const res = await googleCallback(new Request('https://stealthmark.io/api/auth/callback/google?code=abc&state=state-1'))
    expect(res.headers.get('location')).not.toContain('ECONNREFUSED')
    expect(redirectOf(res).searchParams.get('error')).toBe('auth_failed')
  })
})

describe('GET /api/auth/callback/github', () => {
  function callback(emails: unknown, profile: Record<string, unknown> = { id: 9, login: 'octo', name: 'Octo', email: 'public@example.com' }): Promise<Response> {
    vi.stubEnv('GITHUB_CLIENT_ID', 'client-id')
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'client-secret')
    jar.values.set(OAUTH_STATE_COOKIE_NAME, 'state-1')
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url)
      if (target.includes('login/oauth/access_token')) return Response.json({ access_token: 'token' })
      if (target.endsWith('/user/emails')) return Response.json(emails)
      if (target.endsWith('/user')) return Response.json(profile)
      if (target.includes('/internal/auth/upsert-user')) {
        const body = JSON.parse(String(init?.body))
        upsertCalls.push(body)
        return provisioned(body.email)
      }
      throw new Error(`unexpected fetch ${target}`)
    }))
    return githubCallback(new Request('https://stealthmark.io/api/auth/callback/github?code=abc&state=state-1'))
  }

  it('uses the primary verified address, not the public profile email', async () => {
    const res = await callback([
      { email: 'other@example.com', primary: false, verified: true },
      { email: 'real@example.com', primary: true, verified: true },
    ])
    expect(redirectOf(res).pathname).toBe('/console')
    expect(upsertCalls[0].email).toBe('real@example.com')
  })

  it.each([
    [[{ email: 'victim@example.com', primary: true, verified: false }]],
    [[{ email: 'victim@example.com', primary: false, verified: true }]],
    [[]],
    [{ message: 'Bad credentials' }],
  ])('refuses a login without a primary verified address (%j)', async (emails) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await callback(emails, { id: 9, login: 'octo', email: 'victim@example.com' })
    expect(redirectOf(res).searchParams.get('error')).toBe('email_not_verified')
    expect(sessionCookies()).toHaveLength(0)
    expect(upsertCalls).toHaveLength(0)
  })
})

describe('verified address helpers', () => {
  it('picks only a primary verified GitHub address', () => {
    expect(pickVerifiedGithubEmail([{ email: 'a@x.io', primary: true, verified: true }])).toBe('a@x.io')
    expect(pickVerifiedGithubEmail([{ email: 'a@x.io', primary: true, verified: false }])).toBeNull()
    expect(pickVerifiedGithubEmail([{ email: 'a@x.io', primary: false, verified: true }])).toBeNull()
    expect(pickVerifiedGithubEmail('nope')).toBeNull()
    expect(pickVerifiedGithubEmail([null, 1, { email: 5 }])).toBeNull()
  })

  it('accepts a Supabase address only when Supabase confirmed it', () => {
    expect(verifiedSupabaseEmail({ email: 'a@x.io', email_confirmed_at: '2026-10-01T00:00:00Z' })).toBe('a@x.io')
    expect(verifiedSupabaseEmail({ email: 'a@x.io', email_confirmed_at: null })).toBeNull()
    expect(verifiedSupabaseEmail({ email: 'a@x.io' })).toBeNull()
    expect(verifiedSupabaseEmail({ email_confirmed_at: '2026-10-01T00:00:00Z' })).toBeNull()
  })
})
