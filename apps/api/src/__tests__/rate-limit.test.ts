import { describe, it, expect } from 'vitest'
import { buildApp } from '../app.js'
import { hashApiKey } from '../lib/crypto.js'
import type { ApiKeyResolver } from '../middleware/api-key-auth.js'
import { emptyResultDb, testApiKeyRecord, TEST_API_KEY } from './helpers/test-auth.js'

const OTHER_API_KEY = 'sk_test_stealthmark_other_fedcba9876543210'

function twoKeyResolver(limitedRpm: number, relaxedRpm: number): ApiKeyResolver {
  const limited = testApiKeyRecord({ rateLimitRpm: limitedRpm })
  const relaxed = testApiKeyRecord({
    id: '11111111-2222-4333-8444-555555555555',
    keyHash: hashApiKey(OTHER_API_KEY),
    rateLimitRpm: relaxedRpm,
  })
  return async (keyHash) => [limited, relaxed].find((record) => record.keyHash === keyHash)
}

const bearer = (key: string) => ({ authorization: `Bearer ${key}` })

describe('Sprint 0 — rate limiting', () => {
  it('answers 429 with a structured body once the per-key limit is exhausted, never 500', async () => {
    const app = await buildApp({ db: emptyResultDb(), apiKeyResolver: twoKeyResolver(1, 1000) })

    const first = await app.inject({ method: 'GET', url: '/v1/agents', headers: bearer(TEST_API_KEY) })
    const second = await app.inject({ method: 'GET', url: '/v1/agents', headers: bearer(TEST_API_KEY) })
    await app.close()

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(429)
    const body = second.json()
    expect(body.error).toBe('rate_limit_exceeded')
    expect(typeof body.retry_after).toBe('number')
    expect(body.retry_after).toBeGreaterThan(0)
  })

  it('counts each API key separately instead of sharing one bucket per client IP', async () => {
    const app = await buildApp({ db: emptyResultDb(), apiKeyResolver: twoKeyResolver(1, 1000) })

    await app.inject({ method: 'GET', url: '/v1/agents', headers: bearer(TEST_API_KEY) })
    const limited = await app.inject({ method: 'GET', url: '/v1/agents', headers: bearer(TEST_API_KEY) })
    const relaxed = await app.inject({ method: 'GET', url: '/v1/agents', headers: bearer(OTHER_API_KEY) })
    await app.close()

    expect(limited.statusCode).toBe(429)
    expect(relaxed.statusCode).toBe(200)
  })

  it('reports remaining quota to well-behaved clients', async () => {
    const app = await buildApp({ db: emptyResultDb(), apiKeyResolver: twoKeyResolver(5, 1000) })

    const res = await app.inject({ method: 'GET', url: '/v1/agents', headers: bearer(TEST_API_KEY) })
    await app.close()

    expect(res.statusCode).toBe(200)
    expect(res.headers['x-ratelimit-limit']).toBe('5')
  })
})
