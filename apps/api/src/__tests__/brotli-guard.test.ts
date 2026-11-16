import { describe, it, expect, afterAll } from 'vitest'
import { buildApp } from '../app.js'
import type { FastifyInstance } from 'fastify'

describe('Inbound Brotli guard (CVE-2026-111497)', () => {
  let app: FastifyInstance

  afterAll(async () => {
    if (app) await app.close()
  })

  it('rejects br content-encoding with HTTP 415 and mitigation headers before body parsing', async () => {
    app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/v1/usage/ingest',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'br',
      },
      body: 'any-payload',
    })

    expect(res.statusCode).toBe(415)
    expect(res.headers['accept-encoding']).toBe('gzip, deflate')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['content-type']).toContain('application/json')

    const body = res.json()
    expect(body).toEqual({
      error: 'unsupported_media_type',
      code: 'INBOUND_BROTLI_BLOCKED_CVE_2026_111497',
      message: 'Brotli-encoded request payloads are rejected to mitigate CVE-2026-111497.',
    })
  })

  it.each(['gzip, br', 'x-brotli', 'brotli', 'gzip, x-brotli', 'br;q=1.0'])(
    'rejects brotli variant content-encoding (%s) with HTTP 415',
    async (encoding) => {
      app = await buildApp()

      const res = await app.inject({
        method: 'POST',
        url: '/v1/usage/ingest',
        headers: {
          'content-type': 'application/json',
          'content-encoding': encoding,
        },
        body: 'any-payload',
      })

      expect(res.statusCode).toBe(415)
      expect(res.headers['accept-encoding']).toBe('gzip, deflate')
      expect(res.headers['cache-control']).toBe('no-store')
      expect(res.json().code).toBe('INBOUND_BROTLI_BLOCKED_CVE_2026_111497')
    }
  )

  it('allows gzip content-encoding to pass through the onRequest hook', async () => {
    app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'content-encoding': 'gzip',
      },
    })

    // /health returns 200, proving gzip was not blocked with 415
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('ok')
  })

  it('does not false-positive on substring match like brace', async () => {
    app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'content-encoding': 'brace',
      },
    })

    expect(res.statusCode).toBe(200)
  })
})
