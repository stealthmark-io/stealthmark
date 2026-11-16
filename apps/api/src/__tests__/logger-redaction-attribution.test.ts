import { Writable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.js'
import { emptyResultDb, testApiKeyResolver } from './helpers/test-auth.js'

describe('Pino logger attribution enrichment and secret redaction', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('logs clientIp, cfRay, cfCountry, and userAgent while redacting authorization, cookie, x-api-key, x-internal-secret, and query tokens', async () => {
    const lines: string[] = []
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk))
        callback()
      },
    })

    const app = await buildApp({
      db: emptyResultDb(),
      apiKeyResolver: testApiKeyResolver(),
      loggerStream: stream,
      logLevel: 'info',
    })

    const res = await app.inject({
      method: 'GET',
      url: '/health?token=query_secret_999&api_key=query_api_key_888',
      remoteAddress: '35.191.0.1',
      headers: {
        'cf-connecting-ip': '203.0.113.50',
        'cf-ray': '8e11223344556677-EZE',
        'cf-ipcountry': 'AR',
        'user-agent': 'StealthMark-Probe/1.0',
        authorization: 'Bearer sk_live_top_secret_bearer_token',
        cookie: 'sm_session=top_secret_cookie',
        'x-api-key': 'sk_live_header_api_key_secret',
        'x-internal-secret': 'internal_shared_secret_value_do_not_log',
      },
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    expect(lines.length).toBeGreaterThan(0)

    const joined = lines.join('\n')
    expect(joined).not.toContain('sk_live_top_secret_bearer_token')
    expect(joined).not.toContain('top_secret_cookie')
    expect(joined).not.toContain('sk_live_header_api_key_secret')
    expect(joined).not.toContain('internal_shared_secret_value_do_not_log')
    expect(joined).not.toContain('query_secret_999')
    expect(joined).not.toContain('query_api_key_888')

    const parsed = lines
      .flatMap((chunk) => chunk.trim().split('\n'))
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    const requestLog = parsed.find((entry) => entry.req !== undefined)
    expect(requestLog).toBeDefined()
    const reqObj = requestLog?.req as Record<string, unknown>
    expect(reqObj.clientIp).toBe('203.0.113.50')
    expect(reqObj.cfRay).toBe('8e11223344556677-EZE')
    expect(reqObj.cfCountry).toBe('AR')
    expect(reqObj.userAgent).toBe('StealthMark-Probe/1.0')
    const headersObj = reqObj.headers as Record<string, unknown>
    expect(headersObj.authorization).toBe('[REDACTED]')
    expect(headersObj.cookie).toBe('[REDACTED]')
    expect(headersObj['x-api-key']).toBe('[REDACTED]')
    expect(headersObj['x-internal-secret']).toBe('[REDACTED]')

    const responseLog = parsed.find((entry) => entry.msg === 'request completed')
    expect(responseLog).toMatchObject({
      clientIp: '203.0.113.50',
      cfRay: '8e11223344556677-EZE',
      cfCountry: 'AR',
      userAgent: 'StealthMark-Probe/1.0',
    })
  })

  it('reads TRUST_CLOUDFLARE_EDGE once, when the app is built, for the request line and the request logger', async () => {
    const lines: string[] = []
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk))
        callback()
      },
    })

    vi.stubEnv('TRUST_CLOUDFLARE_EDGE', 'false')
    const app = await buildApp({
      db: emptyResultDb(),
      apiKeyResolver: testApiKeyResolver(),
      loggerStream: stream,
      logLevel: 'info',
    })
    vi.unstubAllEnvs()

    await app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: '35.191.0.1',
      headers: { 'cf-connecting-ip': '203.0.113.50', 'cf-ray': '8e11223344556677-EZE' },
    })
    await app.close()

    const parsed = lines
      .flatMap((chunk) => chunk.trim().split('\n'))
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    const requestLog = parsed.find((entry) => entry.req !== undefined)
    const responseLog = parsed.find((entry) => entry.msg === 'request completed')
    expect((requestLog?.req as Record<string, unknown>).clientIp).toBe('35.191.0.1')
    expect(responseLog?.clientIp).toBe('35.191.0.1')
  })
})
