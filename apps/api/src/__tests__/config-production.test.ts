import { afterEach, describe, expect, it, vi } from 'vitest'

const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  INTERNAL_AUTH_SECRET: 'a'.repeat(64),
  PASSPORT_PRIVATE_KEY: 'test-private-key',
  PASSPORT_PUBLIC_KEY: 'test-public-key',
}

describe('production configuration guards', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it.each([
    ['empty', ''],
    ['the development default', 'postgresql://stealthmark:dev_password@localhost:5432/stealthmark'],
  ])('refuses to start in production when DATABASE_URL is %s', async (_label, value) => {
    for (const [key, envValue] of Object.entries(PRODUCTION_ENV)) vi.stubEnv(key, envValue)
    vi.stubEnv('DATABASE_URL', value)
    vi.resetModules()
    await expect(import('../config.js')).rejects.toThrow(/DATABASE_URL/)
  })

  it('starts in production when DATABASE_URL is explicit', async () => {
    for (const [key, value] of Object.entries(PRODUCTION_ENV)) vi.stubEnv(key, value)
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres')
    vi.resetModules()
    const { config } = await import('../config.js')
    expect(config.DATABASE_URL).toContain('pooler.supabase.com')
  })
})

describe('listen address', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('binds every interface by default, as containers need', async () => {
    vi.stubEnv('HOST', undefined)
    vi.resetModules()
    const { config } = await import('../config.js')
    expect(config.HOST).toBe('0.0.0.0')
  })

  it('honours HOST so a host behind a local proxy can bind loopback only', async () => {
    vi.stubEnv('HOST', '127.0.0.1')
    vi.resetModules()
    const { config } = await import('../config.js')
    expect(config.HOST).toBe('127.0.0.1')
  })
})

describe('web vision upstream', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('has no default, so the API never calls itself as its own upstream', async () => {
    vi.stubEnv('WEB_VISION_UPSTREAM_URL', undefined)
    vi.resetModules()
    const { config } = await import('../config.js')
    expect(config.WEB_VISION_UPSTREAM_URL).toBeUndefined()
  })

  it('honours an explicit upstream', async () => {
    vi.stubEnv('WEB_VISION_UPSTREAM_URL', 'https://vision-upstream.test')
    vi.resetModules()
    const { config } = await import('../config.js')
    expect(config.WEB_VISION_UPSTREAM_URL).toBe('https://vision-upstream.test')
  })
})
