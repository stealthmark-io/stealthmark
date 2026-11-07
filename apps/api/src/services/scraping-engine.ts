import { z } from 'zod'
import { config } from '../config.js'

const extractResponseSchema = z.object({
  url: z.string().optional(),
  status_code: z.number().optional(),
  title: z.string().nullish(),
  markdown: z.string().optional(),
  html: z.string().nullish(),
  engine: z.string().optional(),
  latency_ms: z.number().optional(),
  tokens_estimate: z.number().optional(),
})

const healthResponseSchema = z.object({
  service: z.string().optional(),
  scrapling_native: z.boolean().optional(),
})

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

export interface ScraplingExtractParams {
  url: string
  stealth?: boolean
  waitForSelector?: string
  timeout?: number
  includeHtml?: boolean
}

export interface ScraplingExtractResult {
  success: boolean
  url: string
  statusCode: number
  title?: string | null
  markdown?: string
  html?: string | null
  engine: string
  latencyMs: number
  tokensEstimate?: number
  bypassedAntibot: boolean
  error?: string
}

/**
 * Executes a clean web extraction or anti-bot bypass via the dedicated
 * Python Scrapling microservice (apps/scraping-engine).
 *
 * Scrapling operates on self-hosted compute with 0 external API costs,
 * leveraging curl_cffi for TLS fingerprint impersonation and Camoufox for JS rendering.
 */
export async function extractWithScrapling(
  params: ScraplingExtractParams
): Promise<ScraplingExtractResult> {
  const startTime = Date.now()
  const timeoutMs = (params.timeout ?? 30) * 1000

  try {
    const res = await fetch(`${config.SCRAPLING_SERVICE_URL}/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: params.url,
        stealth: params.stealth ?? true,
        wait_selector: params.waitForSelector,
        timeout: params.timeout ?? 30,
        include_html: params.includeHtml ?? false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return {
        success: false,
        url: params.url,
        statusCode: res.status,
        engine: 'scrapling-http-error',
        latencyMs: Date.now() - startTime,
        bypassedAntibot: false,
        error: `Scrapling service returned status ${res.status}: ${errText}`,
      }
    }

    const parsed = extractResponseSchema.safeParse(await res.json())
    if (!parsed.success) {
      return {
        success: false,
        url: params.url,
        statusCode: 502,
        engine: 'scrapling-invalid-response',
        latencyMs: Date.now() - startTime,
        bypassedAntibot: false,
        error: 'Scrapling service returned a response that does not match the extract contract',
      }
    }
    const data = parsed.data
    return {
      success: true,
      url: data.url || params.url,
      statusCode: data.status_code || 200,
      title: data.title || null,
      markdown: data.markdown || '',
      html: data.html || null,
      engine: data.engine || 'scrapling-stealth',
      latencyMs: data.latency_ms || (Date.now() - startTime),
      tokensEstimate: data.tokens_estimate,
      bypassedAntibot: true,
    }
  } catch (err: unknown) {
    return {
      success: false,
      url: params.url,
      statusCode: 502,
      engine: 'scrapling-unreachable',
      latencyMs: Date.now() - startTime,
      bypassedAntibot: false,
      error: messageOf(err, 'Failed to connect to Scrapling microservice'),
    }
  }
}

/**
 * Quick liveness check for Scrapling microservice.
 */
export async function checkScraplingHealth(): Promise<{
  available: boolean
  service?: string
  scraplingNative?: boolean
  error?: string
}> {
  try {
    const res = await fetch(`${config.SCRAPLING_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    if (res.ok) {
      const parsed = healthResponseSchema.safeParse(await res.json())
      if (!parsed.success) {
        return { available: false, error: 'Health response does not match the expected contract' }
      }
      return {
        available: true,
        service: parsed.data.service,
        scraplingNative: parsed.data.scrapling_native,
      }
    }
    return { available: false, error: `Health returned status ${res.status}` }
  } catch (err: unknown) {
    return { available: false, error: messageOf(err, 'Unreachable') }
  }
}
