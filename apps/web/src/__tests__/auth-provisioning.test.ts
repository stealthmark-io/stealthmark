import { afterEach, describe, expect, it, vi } from 'vitest'

const cookieValue: { current: string | undefined } = { current: undefined }
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}))

import { LOCAL_FALLBACK_ORG_ID, PROVISIONING_TIMEOUT_MS, createSessionToken, upsertUserInBackend, type AuthUser } from '../lib/auth'
import { getOrgSession } from '../lib/session'

const params = { email: 'Founder@Example.com', name: 'Founder', provider: 'google' as const }

function stubProduction(): void {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('AUTH_SECRET', 'test-auth-secret-for-vitest-only-0123456789')
  vi.stubEnv('INTERNAL_AUTH_SECRET', 'test-internal-secret-for-vitest-only-0123456789')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  cookieValue.current = undefined
})

describe('upsertUserInBackend in production', () => {
  it('refuses the login when the API is unreachable instead of synthesizing an organization', async () => {
    stubProduction()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(upsertUserInBackend(params)).rejects.toThrow('account_provisioning_failed')
  })

  it('refuses the login when the API answers an error status', async () => {
    stubProduction()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"unauthorized"}', { status: 401 })))
    await expect(upsertUserInBackend(params)).rejects.toThrow('account_provisioning_failed')
  })

  it('returns the provisioned user and organization when the API answers 200', async () => {
    stubProduction()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      user: { id: 'usr-1', orgId: 'org-real', email: 'founder@example.com', name: 'Founder', avatarUrl: null, provider: 'google', role: 'owner' },
      organization: { id: 'org-real', name: 'Founder Org', plan: 'free' },
    })))
    const { user } = await upsertUserInBackend(params)
    expect(user.orgId).toBe('org-real')
  })
})

describe('upsertUserInBackend outside production', () => {
  it('keeps the local fallback organization for development without an API', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const { user } = await upsertUserInBackend(params)
    expect(user.orgId).toBe(LOCAL_FALLBACK_ORG_ID)
    expect(user.email).toBe('founder@example.com')
  })
})

describe('getOrgSession', () => {
  const baseUser: AuthUser = { id: 'usr-1', orgId: LOCAL_FALLBACK_ORG_ID, email: 'founder@example.com', name: 'Founder', avatarUrl: null, provider: 'google', role: 'owner' }

  it('rejects a production session bound to the synthesized fallback organization', async () => {
    stubProduction()
    cookieValue.current = await createSessionToken(baseUser)
    await expect(getOrgSession()).resolves.toBeNull()
  })

  it('accepts a production session bound to a real organization', async () => {
    stubProduction()
    cookieValue.current = await createSessionToken({ ...baseUser, orgId: 'ecf26102-eff1-4a45-8bb4-630cba346b4a' })
    const session = await getOrgSession()
    expect(session?.orgId).toBe('ecf26102-eff1-4a45-8bb4-630cba346b4a')
  })
})

describe('upsertUserInBackend against a cold API', () => {
  const okResponse = () => Response.json({
    user: { id: 'usr-1', orgId: 'org-real', email: 'founder@example.com', name: 'Founder', avatarUrl: null, provider: 'google', role: 'owner' },
    organization: { id: 'org-real', name: 'Founder Org', plan: 'free' },
  })

  it('waits long enough for a Cloud Run cold start', () => {
    expect(PROVISIONING_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000)
  })

  it('retries once when the first attempt never got an answer', async () => {
    stubProduction()
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
      .mockResolvedValueOnce(okResponse())
    vi.stubGlobal('fetch', fetchMock)
    const { user } = await upsertUserInBackend(params)
    expect(user.orgId).toBe('org-real')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry when the API answered with an error status', async () => {
    stubProduction()
    const fetchMock = vi.fn(async () => new Response('{"error":"unauthorized"}', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(upsertUserInBackend(params)).rejects.toThrow('account_provisioning_failed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses the login after two attempts without an answer', async () => {
    stubProduction()
    const fetchMock = vi.fn(async () => { throw new TypeError('fetch failed') })
    vi.stubGlobal('fetch', fetchMock)
    await expect(upsertUserInBackend(params)).rejects.toThrow('account_provisioning_failed')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
