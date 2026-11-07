import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.js'
import { config, INSECURE_INTERNAL_AUTH_SECRET_DEFAULT } from '../config.js'
import { emptyResultDb, testApiKeyResolver } from './helpers/test-auth.js'

const STRONG_SECRET = 'prod-internal-secret-0123456789abcdefghijklmnop'

type SecretValidator = (provided: unknown) => boolean

interface MockedConfig {
  NODE_ENV: 'development' | 'production' | 'test'
  INTERNAL_AUTH_SECRET: string
}

async function loadValidator(mocked: MockedConfig): Promise<SecretValidator> {
  vi.resetModules()
  vi.doMock('../config.js', () => ({ config: mocked, INSECURE_INTERNAL_AUTH_SECRET_DEFAULT }))
  const module = await import('../lib/internal-secret.js')
  return module.isInternalSecretValid
}

describe('Sprint 0 — isInternalSecretValid', () => {
  afterEach(() => {
    vi.doUnmock('../config.js')
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('rejects the shipped default secret in production', async () => {
    const isValid = await loadValidator({
      NODE_ENV: 'production',
      INTERNAL_AUTH_SECRET: INSECURE_INTERNAL_AUTH_SECRET_DEFAULT,
    })
    expect(isValid(INSECURE_INTERNAL_AUTH_SECRET_DEFAULT)).toBe(false)
  })

  it('accepts the default secret outside production so local development keeps working', async () => {
    const isValid = await loadValidator({
      NODE_ENV: 'development',
      INTERNAL_AUTH_SECRET: INSECURE_INTERNAL_AUTH_SECRET_DEFAULT,
    })
    expect(isValid(INSECURE_INTERNAL_AUTH_SECRET_DEFAULT)).toBe(true)
  })

  it('accepts only the exact configured secret in production', async () => {
    const isValid = await loadValidator({ NODE_ENV: 'production', INTERNAL_AUTH_SECRET: STRONG_SECRET })
    expect(isValid(STRONG_SECRET)).toBe(true)
    expect(isValid(`${STRONG_SECRET}x`)).toBe(false)
    expect(isValid(STRONG_SECRET.slice(0, -1))).toBe(false)
    expect(isValid(STRONG_SECRET.replace('prod', 'prox'))).toBe(false)
    expect(isValid(INSECURE_INTERNAL_AUTH_SECRET_DEFAULT)).toBe(false)
  })

  it.each([undefined, null, '', 42, ['secret'], { secret: true }])('rejects the non-secret value %j', async (provided) => {
    const isValid = await loadValidator({ NODE_ENV: 'production', INTERNAL_AUTH_SECRET: STRONG_SECRET })
    expect(isValid(provided)).toBe(false)
  })

  it('rejects every input when the configured secret is empty', async () => {
    const isValid = await loadValidator({ NODE_ENV: 'development', INTERNAL_AUTH_SECRET: '' })
    expect(isValid('')).toBe(false)
    expect(isValid('anything')).toBe(false)
  })

  it('refuses to load the real config in production with the default secret', async () => {
    vi.resetModules()
    vi.doUnmock('../config.js')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PASSPORT_PRIVATE_KEY', 'test-private-key')
    vi.stubEnv('PASSPORT_PUBLIC_KEY', 'test-public-key')
    vi.stubEnv('INTERNAL_AUTH_SECRET', INSECURE_INTERNAL_AUTH_SECRET_DEFAULT)
    await expect(import('../config.js')).rejects.toThrow(/INTERNAL_AUTH_SECRET/)
  })
})

describe('Sprint 0 — internal secret on HTTP routes', () => {
  async function build() {
    return buildApp({
      db: emptyResultDb(),
      apiKeyResolver: testApiKeyResolver(),
      features: { commerce: true, passports: true },
    })
  }

  it('POST /internal/trust/recalculate answers 401 without the secret', async () => {
    const app = await build()
    const res = await app.inject({ method: 'POST', url: '/internal/trust/recalculate' })
    await app.close()
    expect(res.statusCode).toBe(401)
  })

  it.each([
    { label: 'a different secret of the same length', secret: 'x'.repeat(config.INTERNAL_AUTH_SECRET.length) },
    { label: 'a shorter secret', secret: 'wrong' },
    { label: 'a longer secret', secret: `${config.INTERNAL_AUTH_SECRET}-extra` },
    { label: 'an empty secret', secret: '' },
  ])('POST /internal/trust/recalculate answers 401 with $label', async ({ secret }) => {
    const app = await build()
    const res = await app.inject({
      method: 'POST',
      url: '/internal/trust/recalculate',
      headers: { 'x-internal-secret': secret },
    })
    await app.close()
    expect(res.statusCode).toBe(401)
  })

  it('does not accept an API key in place of the internal secret on /internal/trust/recalculate', async () => {
    const app = await build()
    const res = await app.inject({
      method: 'POST',
      url: '/internal/trust/recalculate',
      headers: { authorization: 'Bearer sk_test_stealthmark_0123456789abcdef' },
    })
    await app.close()
    expect(res.statusCode).toBe(401)
  })

  it('POST /v1/organizations answers 401 with a wrong x-internal-secret and no API key', async () => {
    const app = await build()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: { 'x-internal-secret': 'definitely-not-the-secret' },
      payload: { name: 'Sneaky Org', slug: 'sneaky-org' },
    })
    await app.close()
    expect(res.statusCode).toBe(401)
  })

  it('POST /v1/api-keys answers 401 with a wrong x-internal-secret and no API key', async () => {
    const app = await build()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: { 'x-internal-secret': 'definitely-not-the-secret' },
      payload: { name: 'Sneaky Key' },
    })
    await app.close()
    expect(res.statusCode).toBe(401)
  })
})
