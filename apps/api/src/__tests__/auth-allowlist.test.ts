import { describe, it, expect } from 'vitest'
import { buildApp } from '../app.js'
import { authHeaders, emptyResultDb, testApiKeyResolver } from './helpers/test-auth.js'

async function build(features?: { passports?: boolean }) {
  return buildApp({ db: emptyResultDb(), apiKeyResolver: testApiKeyResolver(), features })
}

describe('Sprint 0 — public path allowlist is exact', () => {
  it.each([
    '/v1/users/public-key',
    '/v1/users/jwks',
    '/v1/agents/public-key',
    '/v1/agents/jwks',
    '/v1/organizations/public-key',
    '/v1/organizations/jwks',
  ])('GET %s without credentials answers 401', async (url) => {
    const app = await build()
    const res = await app.inject({ method: 'GET', url })
    await app.close()

    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('unauthorized')
  })

  it('GET /v1/users/public-key with a valid key is handled as an ordinary :id lookup', async () => {
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/v1/users/public-key', headers: authHeaders })
    await app.close()

    expect(res.statusCode).toBe(404)
  })

  it.each(['/v1/gateway/public-key', '/v1/gateway/jwks', '/v1/gateway/public-key?format=jwk'])(
    'GET %s is public once passports are enabled',
    async (url) => {
      const app = await build({ passports: true })
      const res = await app.inject({ method: 'GET', url })
      await app.close()

      expect(res.statusCode).toBe(200)
    },
  )

  it.each(['/v1/gateway/public-key', '/v1/gateway/jwks'])(
    'GET %s does not exist while passports are switched off',
    async (url) => {
      const app = await build()
      const res = await app.inject({ method: 'GET', url })
      await app.close()

      expect(res.statusCode).toBe(404)
    },
  )

  it.each(['/v1', '/v1/openapi.json'])('GET %s stays public', async (url) => {
    const app = await build()
    const res = await app.inject({ method: 'GET', url })
    await app.close()

    expect(res.statusCode).toBe(200)
  })

  it('keeps every other gateway route behind authentication', async () => {
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/v1/gateway/sites' })
    await app.close()

    expect(res.statusCode).toBe(401)
  })
})
