import { describe, it, expect, afterAll } from 'vitest'
import { buildApp } from '../app.js'

describe('Health endpoints', () => {
  it('GET /health returns ok', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/health',
    })

    expect(res.statusCode).toBe(200)

    const body = res.json()
    expect(body.status).toBe('ok')
    expect(body.version).toBe('0.1.0')
    expect(body.timestamp).toBeDefined()

    await app.close()
  })

  it('GET /ready returns ready when database is connected', async () => {
    const mockDb = {
      execute: async () => [{ '?column?': 1 }],
    } as any
    const app = await buildApp({ db: mockDb })

    const res = await app.inject({
      method: 'GET',
      url: '/ready',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('ready')
    expect(res.json().database).toBe('connected')

    await app.close()
  })

  it('GET /ready returns 503 when database fails', async () => {
    const mockDb = {
      execute: async () => {
        throw new Error('Connection refused')
      },
    } as any
    const app = await buildApp({ db: mockDb })

    const res = await app.inject({
      method: 'GET',
      url: '/ready',
    })

    expect(res.statusCode).toBe(503)
    expect(res.json().status).toBe('not_ready')

    await app.close()
  })

  it('GET /v1 returns API info', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/v1',
    })

    expect(res.statusCode).toBe(200)

    const body = res.json()
    expect(body.name).toBe('StealthMark API')
    expect(body.version).toBe('v1')

    await app.close()
  })
})
