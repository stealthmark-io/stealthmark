import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildApp } from '../app.js'
import { config } from '../config.js'
import { ENABLED_FEATURES } from './helpers/test-auth.js'
import { hashApiKey } from '../lib/crypto.js'
import { organizations, usageRecords, type DbClient, type ApiKey } from '@stealthmark/db'

const SCRAPLING_EXTRACT_URL = `${config.SCRAPLING_SERVICE_URL}/extract`
const UPSTREAM_URL = 'https://vision-upstream.test'
const UPSTREAM_EXTRACT_URL = `${UPSTREAM_URL}/v1/extract`

const ORG_BALANCE = '5.0000'
const ORG_SPENT = '1.0000'

type FetchStub = () => Promise<Response>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const scraplingOk: FetchStub = async () =>
  jsonResponse({ title: 'Example Domain', markdown: '# Example Domain\n\nScrapling body', status_code: 200 })
const scraplingDown: FetchStub = async () => {
  throw new TypeError('fetch failed')
}

const upstreamOk: FetchStub = async () =>
  jsonResponse({ markdown: '# Upstream page', title: 'Upstream title', bypassed_antibot: true })
const failingUpstreams: Array<[string, FetchStub]> = [
  ['answers with a non-2xx status', async () => new Response('not found', { status: 404 })],
  [
    'is unreachable',
    async () => {
      throw new TypeError('fetch failed')
    },
  ],
  ['answers with a body that is not JSON', async () => new Response('<html>oops</html>', { status: 200 })],
  ['answers with a body that breaks the contract', async () => jsonResponse({ content: 42, markdown: 42 })],
  ['answers 2xx with no content', async () => jsonResponse({})],
  ['answers 2xx with its own error body', async () => jsonResponse({ error: 'not found' })],
]

function stubFetch(scrapling: FetchStub, upstream?: FetchStub) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const target = String(input)
    if (target === SCRAPLING_EXTRACT_URL) return scrapling()
    if (upstream && target === UPSTREAM_EXTRACT_URL) return upstream()
    throw new Error(`Unexpected fetch to ${target}`)
  })
}

describe('Web Vision Proxy Routes', () => {
  const validKey = 'sk_live_1234567890abcdef1234567890abcdef'
  const mockApiKey: ApiKey = {
    id: 'key-123',
    orgId: 'org-456',
    keyHash: hashApiKey(validKey),
    keyPrefix: 'sk_live_1234...cdef',
    name: 'Test Key',
    scopes: ['extract', 'capabilities:read'],
    rateLimitRpm: 60,
    rateLimitRpd: 10000,
    spendLimit: null,
    status: 'active',
    lastUsedAt: null,
    createdAt: new Date(),
  }

  /** Every write the routes make to the balance (organizations) and to the usage ledger (usageRecords). */
  let balanceWrites: Array<Record<string, unknown>> = []
  let usageWrites: Array<Record<string, unknown>> = []
  const originalUpstream = config.WEB_VISION_UPSTREAM_URL

  beforeEach(() => {
    balanceWrites = []
    usageWrites = []
    config.WEB_VISION_UPSTREAM_URL = undefined
  })

  afterEach(() => {
    config.WEB_VISION_UPSTREAM_URL = originalUpstream
    vi.restoreAllMocks()
  })

  function createMockDb(spendLimitExceeded = false, freeTierUsed = 1) {
    return {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () =>
              table === organizations
                ? [{ availableBalance: ORG_BALANCE, totalSpent: ORG_SPENT }]
                : [mockApiKey],
            then: (resolve: (rows: unknown[]) => unknown) =>
              resolve(
                spendLimitExceeded
                  ? [{ cost: '100.00' }]
                  : [{ cost: '0.00', requestCount: freeTierUsed }],
              ),
          }),
        }),
      }),
      insert: (table: unknown) => ({
        values: (row: Record<string, unknown>) => {
          if (table === usageRecords) usageWrites.push(row)
          return {
            returning: async () => [],
            catch: () => Promise.resolve(),
          }
        },
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          if (table === organizations) balanceWrites.push(values)
          return { where: () => Promise.resolve() }
        },
      }),
    } as unknown as DbClient
  }

  it('rejects unauthenticated requests (401)', async () => {
    const mockDb = createMockDb()
    const app = await buildApp({ db: mockDb, features: ENABLED_FEATURES })

    const res = await app.inject({
      method: 'POST',
      url: '/v1/web/vision',
      payload: { url: 'https://example.com' },
    })

    expect(res.statusCode).toBe(401)
    await app.close()
  })

  describe('POST /v1/web/vision', () => {
    async function callVision() {
      const app = await buildApp({ db: createMockDb(), features: ENABLED_FEATURES })
      const res = await app.inject({
        method: 'POST',
        url: '/v1/web/vision',
        headers: { authorization: `Bearer ${validKey}` },
        payload: { url: 'https://example.com', mode: 'vision' },
      })
      await app.close()
      return res
    }

    it('returns Scrapling content and charges the anti-bot price', async () => {
      const fetchSpy = stubFetch(scraplingOk)

      const res = await callVision()

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.markdown).toBe('# Example Domain\n\nScrapling body')
      expect(body.title).toBe('Example Domain')
      expect(body.cost_usd).toBe(0.03)
      expect(body.latency_ms).toBeGreaterThanOrEqual(0)
      expect(body.bypassed_antibot).toBe(true)
      expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([SCRAPLING_EXTRACT_URL])
      expect(balanceWrites).toEqual([{ availableBalance: '4.9700', totalSpent: '1.0300' }])
      expect(usageWrites).toHaveLength(1)
      expect(usageWrites[0]).toMatchObject({ orgId: 'org-456', cost: '0.03', success: true })
    })

    it('returns upstream content and charges when Scrapling fails and the upstream answers', async () => {
      config.WEB_VISION_UPSTREAM_URL = UPSTREAM_URL
      stubFetch(scraplingDown, upstreamOk)

      const res = await callVision()

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.markdown).toBe('# Upstream page')
      expect(body.title).toBe('Upstream title')
      expect(body.cost_usd).toBe(0.03)
      expect(balanceWrites).toEqual([{ availableBalance: '4.9700', totalSpent: '1.0300' }])
      expect(usageWrites).toHaveLength(1)
    })

    it('fails with 502 and charges nothing when Scrapling fails and no upstream is configured', async () => {
      const fetchSpy = stubFetch(scraplingDown)

      const res = await callVision()

      expect(res.statusCode).toBe(502)
      const body = res.json()
      expect(body.error).toBe('extraction_failed')
      expect(body.markdown).toBeUndefined()
      expect(body.images).toBeUndefined()
      expect(body.bypassed_antibot).toBeUndefined()
      expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([SCRAPLING_EXTRACT_URL])
      expect(balanceWrites).toEqual([])
      expect(usageWrites).toEqual([])
    })

    it.each(failingUpstreams)(
      'fails with 502 and charges nothing when Scrapling fails and the upstream %s',
      async (_label, upstream) => {
        config.WEB_VISION_UPSTREAM_URL = UPSTREAM_URL
        const fetchSpy = stubFetch(scraplingDown, upstream)

        const res = await callVision()

        expect(res.statusCode).toBe(502)
        const body = res.json()
        expect(body.error).toBe('extraction_failed')
        expect(body.markdown).toBeUndefined()
        expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([
          SCRAPLING_EXTRACT_URL,
          UPSTREAM_EXTRACT_URL,
        ])
        expect(balanceWrites).toEqual([])
        expect(usageWrites).toEqual([])
      },
    )
  })

  describe('POST /v1/web/extract', () => {
    async function callExtract(freeTierUsed: number) {
      const app = await buildApp({ db: createMockDb(false, freeTierUsed), features: ENABLED_FEATURES })
      const res = await app.inject({
        method: 'POST',
        url: '/v1/web/extract',
        headers: { authorization: `Bearer ${validKey}` },
        payload: { url: 'https://example.com', output_format: 'markdown' },
      })
      await app.close()
      return res
    }

    const FREE_TIER_EXHAUSTED = 100

    it('returns Scrapling content at no charge while the free tier lasts', async () => {
      const fetchSpy = stubFetch(scraplingOk)

      const res = await callExtract(1)

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.content).toBe('# Example Domain\n\nScrapling body')
      expect(body.format).toBe('markdown')
      expect(body.cost_usd).toBe(0.01)
      expect(body.charged_usd).toBe(0)
      expect(body.free_tier_applied).toBe(true)
      expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([SCRAPLING_EXTRACT_URL])
      expect(balanceWrites).toEqual([])
      expect(usageWrites).toHaveLength(1)
      expect(usageWrites[0]).toMatchObject({ cost: '0', success: true })
    })

    it('returns Scrapling content and charges the extract price once the free tier is exhausted', async () => {
      stubFetch(scraplingOk)

      const res = await callExtract(FREE_TIER_EXHAUSTED)

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.content).toBe('# Example Domain\n\nScrapling body')
      expect(body.cost_usd).toBe(0.01)
      expect(body.charged_usd).toBe(0.01)
      expect(body.free_tier_applied).toBe(false)
      expect(balanceWrites).toEqual([{ availableBalance: '4.9900', totalSpent: '1.0100' }])
      expect(usageWrites).toHaveLength(1)
      expect(usageWrites[0]).toMatchObject({ orgId: 'org-456', cost: '0.01', success: true })
    })

    it('returns upstream content and charges when Scrapling fails and the upstream answers', async () => {
      config.WEB_VISION_UPSTREAM_URL = UPSTREAM_URL
      stubFetch(scraplingDown, async () => jsonResponse({ content: 'Upstream text' }))

      const res = await callExtract(FREE_TIER_EXHAUSTED)

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.content).toBe('Upstream text')
      expect(body.charged_usd).toBe(0.01)
      expect(balanceWrites).toEqual([{ availableBalance: '4.9900', totalSpent: '1.0100' }])
      expect(usageWrites).toHaveLength(1)
    })

    it.each([
      ['the free tier is exhausted', FREE_TIER_EXHAUSTED],
      ['the free tier still has room', 1],
    ])(
      'fails with 502 and charges nothing when Scrapling fails and no upstream is configured (%s)',
      async (_label, freeTierUsed) => {
        const fetchSpy = stubFetch(scraplingDown)

        const res = await callExtract(freeTierUsed)

        expect(res.statusCode).toBe(502)
        const body = res.json()
        expect(body.error).toBe('extraction_failed')
        expect(body.content).toBeUndefined()
        expect(body.charged_usd).toBeUndefined()
        expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([SCRAPLING_EXTRACT_URL])
        expect(balanceWrites).toEqual([])
        expect(usageWrites).toEqual([])
      },
    )

    it.each(failingUpstreams)(
      'fails with 502 and charges nothing when Scrapling fails and the upstream %s',
      async (_label, upstream) => {
        config.WEB_VISION_UPSTREAM_URL = UPSTREAM_URL
        const fetchSpy = stubFetch(scraplingDown, upstream)

        const res = await callExtract(FREE_TIER_EXHAUSTED)

        expect(res.statusCode).toBe(502)
        const body = res.json()
        expect(body.error).toBe('extraction_failed')
        expect(body.content).toBeUndefined()
        expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([
          SCRAPLING_EXTRACT_URL,
          UPSTREAM_EXTRACT_URL,
        ])
        expect(balanceWrites).toEqual([])
        expect(usageWrites).toEqual([])
      },
    )
  })

  it('POST /v1/web/screenshot returns screenshot URL', async () => {
    const mockDb = createMockDb()
    const app = await buildApp({ db: mockDb, features: ENABLED_FEATURES })

    const res = await app.inject({
      method: 'POST',
      url: '/v1/web/screenshot',
      headers: { authorization: `Bearer ${validKey}` },
      payload: { url: 'https://example.com', full_page: true },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.image_url).toContain('https://storage.googleapis.com')
    expect(body.format).toBe('png')
    expect(body.cost_usd).toBe(0.02)

    await app.close()
  })
})
