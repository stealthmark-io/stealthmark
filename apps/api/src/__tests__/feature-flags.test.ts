import { describe, it, expect } from 'vitest'
import { buildApp } from '../app.js'
import { authHeaders, emptyResultDb, testApiKeyResolver } from './helpers/test-auth.js'
import { config } from '../config.js'

interface RouteProbe {
  method: 'GET' | 'POST'
  url: string
}

const ID = '123e4567-e89b-12d3-a456-426614174000'

const COMMERCE_ROUTES: RouteProbe[] = [
  { method: 'GET', url: '/v1/commerce/balance' },
  { method: 'POST', url: '/v1/commerce/negotiate' },
  { method: 'POST', url: '/v1/commerce/contracts' },
  { method: 'POST', url: '/v1/commerce/escrow' },
  { method: 'GET', url: '/v1/capabilities' },
  { method: 'POST', url: '/v1/discovery/search' },
  { method: 'POST', url: '/v1/tasks' },
  { method: 'GET', url: '/v1/publisher/capabilities' },
  { method: 'GET', url: `/v1/capabilities/${ID}/reviews` },
  { method: 'GET', url: `/v1/capabilities/${ID}/badges` },
  { method: 'GET', url: `/v1/capabilities/${ID}/evaluation` },
  { method: 'GET', url: '/v1/enterprise/finops/breakdown' },
  { method: 'GET', url: '/v1/enterprise/private-registries' },
  { method: 'GET', url: '/a2a/agent.json' },
  { method: 'POST', url: '/v1/web/vision' },
  { method: 'POST', url: '/v1/web/extract' },
  { method: 'POST', url: '/v1/web/screenshot' },
]

const PASSPORT_ROUTES: RouteProbe[] = [
  { method: 'GET', url: '/v1/enterprise/policies' },
  { method: 'GET', url: '/v1/enterprise/audit' },
  { method: 'GET', url: '/v1/enterprise/kill-switch' },
  { method: 'GET', url: `/v1/agents/${ID}/context` },
  { method: 'GET', url: '/v1/intelligence/network' },
  { method: 'POST', url: '/v1/gateway/passport' },
  { method: 'POST', url: '/v1/gateway/verify' },
  { method: 'GET', url: '/v1/gateway/passports' },
  { method: 'GET', url: '/v1/gateway/public-key' },
  { method: 'GET', url: '/v1/gateway/jwks' },
  { method: 'GET', url: '/.well-known/jwks.json' },
  { method: 'GET', url: '/.well-known/stealthmark-keys.json' },
]

const ALWAYS_ON_ROUTES: RouteProbe[] = [
  { method: 'GET', url: '/health' },
  { method: 'GET', url: '/' },
  { method: 'GET', url: '/.well-known/agent.json' },
  { method: 'GET', url: '/v1/api-keys' },
  { method: 'GET', url: '/v1/agents' },
  { method: 'GET', url: '/v1/usage' },
  { method: 'GET', url: '/v1/gateway/sites' },
]

/** True when the router never matched a route (as opposed to a handler answering 404 for a missing row). */
async function isRouteMissing(
  features: { commerce?: boolean; passports?: boolean } | undefined,
  probe: RouteProbe,
): Promise<boolean> {
  const app = await buildApp({ db: emptyResultDb(), apiKeyResolver: testApiKeyResolver(), features })
  try {
    const res = await app.inject({
      method: probe.method,
      url: probe.url,
      headers: authHeaders,
      ...(probe.method === 'POST' ? { payload: {} } : {}),
    })
    const { message } = res.json<{ message?: unknown }>()
    return res.statusCode === 404 && typeof message === 'string' && message.startsWith('Route ')
  } finally {
    await app.close()
  }
}

describe('Sprint 1 feature flags: frozen route groups', () => {
  it('ships with commerce and passports switched off by default', () => {
    expect(config.FEATURE_COMMERCE).toBe(false)
    expect(config.FEATURE_PASSPORTS).toBe(false)
  })

  describe('no features override', () => {
    it.each([...COMMERCE_ROUTES, ...PASSPORT_ROUTES])('$method $url answers 404', async (probe) => {
      expect(await isRouteMissing(undefined, probe)).toBe(true)
    })

    it('answers 404 on /internal/trust/recalculate even with the internal secret', async () => {
      const app = await buildApp({ db: emptyResultDb(), apiKeyResolver: testApiKeyResolver() })
      const res = await app.inject({
        method: 'POST',
        url: '/internal/trust/recalculate',
        headers: { 'x-internal-secret': config.INTERNAL_AUTH_SECRET },
      })
      expect(res.statusCode).toBe(404)
      await app.close()
    })

    it.each(ALWAYS_ON_ROUTES)('$method $url stays reachable', async (probe) => {
      expect(await isRouteMissing(undefined, probe)).toBe(false)
    })
  })

  describe('features: { commerce: true, passports: true }', () => {
    const all = { commerce: true, passports: true }

    it.each([...COMMERCE_ROUTES, ...PASSPORT_ROUTES])('$method $url is registered', async (probe) => {
      expect(await isRouteMissing(all, probe)).toBe(false)
    })

    it('registers /internal/trust/recalculate behind the internal secret', async () => {
      const app = await buildApp({ db: emptyResultDb(), apiKeyResolver: testApiKeyResolver(), features: all })
      const res = await app.inject({ method: 'POST', url: '/internal/trust/recalculate' })
      expect(res.statusCode).toBe(401)
      await app.close()
    })
  })

  describe('groups are independent', () => {
    it.each(COMMERCE_ROUTES)('commerce only: $method $url is registered', async (probe) => {
      expect(await isRouteMissing({ commerce: true }, probe)).toBe(false)
    })

    it.each(PASSPORT_ROUTES)('commerce only: $method $url stays 404', async (probe) => {
      expect(await isRouteMissing({ commerce: true }, probe)).toBe(true)
    })

    it.each(PASSPORT_ROUTES)('passports only: $method $url is registered', async (probe) => {
      expect(await isRouteMissing({ passports: true }, probe)).toBe(false)
    })

    it.each(COMMERCE_ROUTES)('passports only: $method $url stays 404', async (probe) => {
      expect(await isRouteMissing({ passports: true }, probe)).toBe(true)
    })
  })

  describe('API root does not advertise a frozen jwks route', () => {
    async function rootEndpoints(features: { commerce?: boolean; passports?: boolean } | undefined): Promise<Record<string, unknown>> {
      const app = await buildApp({ db: emptyResultDb(), apiKeyResolver: testApiKeyResolver(), features })
      try {
        const res = await app.inject({ method: 'GET', url: '/' })
        expect(res.statusCode).toBe(200)
        return res.json<{ endpoints: Record<string, unknown> }>().endpoints
      } finally {
        await app.close()
      }
    }

    it('has no jwks key with the default flags', async () => {
      expect(await rootEndpoints(undefined)).not.toHaveProperty('jwks')
    })

    it('has no jwks key when only commerce is on', async () => {
      expect(await rootEndpoints({ commerce: true })).not.toHaveProperty('jwks')
    })

    it('lists jwks when passports is on', async () => {
      expect(await rootEndpoints({ passports: true })).toHaveProperty('jwks', '/.well-known/jwks.json')
    })
  })

  describe('billing is removed', () => {
    it.each([
      { method: 'POST', url: '/v1/billing/checkout' },
      { method: 'POST', url: '/v1/billing/webhook' },
      { method: 'POST', url: '/v1/billing/deposit' },
    ] satisfies RouteProbe[])('$method $url answers 404 with every feature enabled', async (probe) => {
      expect(await isRouteMissing({ commerce: true, passports: true }, probe)).toBe(true)
    })
  })
})
