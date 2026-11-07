import { describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { emptyResultDb, testApiKeyResolver } from './helpers/test-auth.js'

const FRONT_END_ADDRESS = '35.191.0.1'
const REAL_CLIENT = '203.0.113.7'

async function remainingAfterTwoRequests(firstForwardedFor: string, secondForwardedFor: string): Promise<number[]> {
  const app = await buildApp({ db: emptyResultDb(), apiKeyResolver: testApiKeyResolver() })
  const remaining: number[] = []
  for (const forwardedFor of [firstForwardedFor, secondForwardedFor]) {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: FRONT_END_ADDRESS,
      headers: { 'x-forwarded-for': forwardedFor },
    })
    remaining.push(Number(res.headers['x-ratelimit-remaining']))
  }
  await app.close()
  return remaining
}

describe('the client address comes from the proxy, not from the caller', () => {
  it('keeps one rate-limit bucket per real client however many addresses the caller prepends', async () => {
    const [first, second] = await remainingAfterTwoRequests(`9.9.9.9, ${REAL_CLIENT}`, `8.8.8.8, 7.7.7.7, ${REAL_CLIENT}`)
    expect(second).toBe(first - 1)
  })

  it('still separates two different real clients', async () => {
    const [first, second] = await remainingAfterTwoRequests(REAL_CLIENT, '198.51.100.93')
    expect(second).toBe(first)
  })
})
