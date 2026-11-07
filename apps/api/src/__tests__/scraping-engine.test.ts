import { describe, it, expect, vi, afterEach } from 'vitest'
import { extractWithScrapling, checkScraplingHealth } from '../services/scraping-engine.js'

describe('Scrapling Scraping Engine Service', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('handles unreachable microservice gracefully without crashing', async () => {
    // When port 8001 is offline or unreachable
    const result = await extractWithScrapling({
      url: 'https://example.com',
      stealth: true,
      timeout: 1,
    })

    expect(result.success).toBe(false)
    expect(result.engine).toBe('scrapling-unreachable')
    expect(result.bypassedAntibot).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('parses successful microservice responses accurately', async () => {
    const mockResponse = {
      url: 'https://protected-portal.com',
      status_code: 200,
      title: 'Protected Portal - Bypassed',
      markdown: '# Protected Portal\n\nSecret data extracted successfully.',
      html: null,
      engine: 'scrapling-stealth',
      latency_ms: 142,
      tokens_estimate: 24,
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const result = await extractWithScrapling({
      url: 'https://protected-portal.com',
      stealth: true,
    })

    expect(result.success).toBe(true)
    expect(result.title).toBe('Protected Portal - Bypassed')
    expect(result.markdown).toContain('Secret data extracted successfully.')
    expect(result.engine).toBe('scrapling-stealth')
    expect(result.tokensEstimate).toBe(24)
    expect(result.bypassedAntibot).toBe(true)
  })

  it('handles upstream microservice HTTP errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Anti-bot challenge could not be resolved', {
        status: 502,
        headers: { 'Content-Type': 'text/plain' },
      })
    )

    const result = await extractWithScrapling({
      url: 'https://unreachable-bot.com',
      stealth: true,
    })

    expect(result.success).toBe(false)
    expect(result.statusCode).toBe(502)
    expect(result.engine).toBe('scrapling-http-error')
    expect(result.bypassedAntibot).toBe(false)
  })

  it('checkScraplingHealth reports status correctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'ok',
          service: 'stealthmark-scraping-engine',
          scrapling_native: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    const health = await checkScraplingHealth()
    expect(health.available).toBe(true)
    expect(health.service).toBe('stealthmark-scraping-engine')
    expect(health.scraplingNative).toBe(true)
  })

  it('rejects a microservice payload whose fields have the wrong types instead of passing them through', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ status_code: '200', markdown: { nested: true }, tokens_estimate: 'many' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const result = await extractWithScrapling({ url: 'https://example.com' })

    expect(result.success).toBe(false)
    expect(result.statusCode).toBe(502)
    expect(result.engine).toBe('scrapling-invalid-response')
    expect(result.bypassedAntibot).toBe(false)
    expect(result.markdown).toBeUndefined()
  })

  it('reports a non-JSON microservice body as a failed extraction with the parser message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<html>gateway timeout</html>', { status: 200 }))

    const result = await extractWithScrapling({ url: 'https://example.com' })

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('checkScraplingHealth treats a malformed health body as unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ service: 42 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    const health = await checkScraplingHealth()

    expect(health.available).toBe(false)
    expect(health.error).toContain('expected contract')
  })
})
