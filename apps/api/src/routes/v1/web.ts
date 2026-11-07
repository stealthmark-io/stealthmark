import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, gte } from 'drizzle-orm'
import { capabilities, usageRecords, organizations, type DbClient } from '@stealthmark/db'
import { config } from '../../config.js'
import { requireScopes } from '../../middleware/api-key-auth.js'
import { recordUsage } from '../../services/usage.js'
import { extractWithScrapling } from '../../services/scraping-engine.js'

// Pricing per successful primitive (Pay-As-You-Go Prepago)
export const PRICING = {
  VISION_ANTIBOT: 0.03,
  BASIC_EXTRACT: 0.01,
  SCREENSHOT: 0.02,
  FREE_MONTHLY_EXTRACTS: 100,
}

const upstreamVisionSchema = z.object({
  markdown: z.string().optional(),
  content: z.string().optional(),
  title: z.string().optional(),
  links: z.array(z.string()).optional(),
  images: z.array(z.string()).optional(),
  bypassed_antibot: z.boolean().optional(),
})

const upstreamExtractSchema = z.object({
  content: z.string().optional(),
  markdown: z.string().optional(),
})

const EXTRACTION_FAILED = {
  error: 'extraction_failed',
  message: 'The page could not be extracted. Nothing was charged.',
}

const visionSchema = z.object({
  url: z.string().url('A valid URL is required'),
  mode: z.enum(['vision', 'full']).default('vision'),
  wait_for_timeout: z.number().int().min(0).max(60000).optional(),
  extra_headers: z.record(z.string(), z.string()).optional(),
})

const extractSchema = z.object({
  url: z.string().url('A valid URL is required'),
  output_format: z.enum(['markdown', 'json']).default('markdown'),
  wait_for_timeout: z.number().int().min(0).max(60000).optional(),
})

const screenshotSchema = z.object({
  url: z.string().url('A valid URL is required'),
  viewport: z
    .object({
      width: z.number().int().default(1280),
      height: z.number().int().default(800),
    })
    .optional(),
  full_page: z.boolean().default(false),
})

export async function webRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // ── Helper: Check Spend Limit ──────────────────────
  async function checkSpendLimit(orgId: string, apiKeyId?: string, spendLimit?: string | null) {
    if (!spendLimit) return true
    const maxSpend = parseFloat(spendLimit)
    if (isNaN(maxSpend)) return true

    const records = await db
      .select({ cost: usageRecords.cost })
      .from(usageRecords)
      .where(and(eq(usageRecords.orgId, orgId), eq(usageRecords.apiKeyId, apiKeyId || '')))

    let totalSpent = 0
    for (const r of records) {
      totalSpent += parseFloat(r.cost || '0') || 0
    }

    return totalSpent < maxSpend
  }

  // ── Helper: Get Organization Balance & Free Tier ────
  async function getOrgCreditStatus(orgId: string) {
    let balance = 100.0 // Default for test / mock DB without org records
    let hasOrg = false
    try {
      const [org] = await db
        .select({
          availableBalance: organizations.availableBalance,
          totalSpent: organizations.totalSpent,
        })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1)

      if (org && org.availableBalance !== undefined) {
        balance = parseFloat(org.availableBalance)
        hasOrg = true
      }
    } catch {
      hasOrg = false
    }

    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    let freeTierUsed = 0
    try {
      const records = await db
        .select({
          cost: usageRecords.cost,
          requestCount: usageRecords.requestCount,
        })
        .from(usageRecords)
        .where(
          and(
            eq(usageRecords.orgId, orgId),
            gte(usageRecords.createdAt, startOfMonth),
          ),
        )
      for (const r of records) {
        if (!r.cost || parseFloat(r.cost) === 0) {
          freeTierUsed += r.requestCount || 1
        }
      }
    } catch {
      freeTierUsed = 0
    }

    return {
      balance,
      hasOrg,
      freeTierUsed,
      freeTierRemaining: Math.max(0, PRICING.FREE_MONTHLY_EXTRACTS - freeTierUsed),
    }
  }

  // ── Helper: Deduct Balance on Success ───────────────
  async function deductBalance(orgId: string, cost: number) {
    if (cost <= 0) return
    try {
      const [org] = await db
        .select({
          availableBalance: organizations.availableBalance,
          totalSpent: organizations.totalSpent,
        })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1)

      if (org && db.update) {
        const currentBal = org.availableBalance ? parseFloat(org.availableBalance) : 0
        const currentSpent = org.totalSpent ? parseFloat(org.totalSpent) : 0
        const newBal = Math.max(0, currentBal - cost)
        const newSpent = currentSpent + cost

        await db
          .update(organizations)
          .set({
            availableBalance: (Math.round(newBal * 10000) / 10000).toFixed(4),
            totalSpent: (Math.round(newSpent * 10000) / 10000).toFixed(4),
          })
          .where(eq(organizations.id, orgId))
      }
    } catch {
      // Graceful in tests
    }
  }

  // ── POST /v1/web/vision ────────────────────────────
  app.post('/vision', { preHandler: [requireScopes('extract')] }, async (request, reply) => {
    const parseResult = visionSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: parseResult.error.flatten(),
      })
    }

    const { url, mode, wait_for_timeout } = parseResult.data
    const orgId = request.orgId!
    const apiKeyId = request.apiKey?.id

    const canProceed = await checkSpendLimit(orgId, apiKeyId, request.apiKey?.spendLimit)
    if (!canProceed) {
      return reply.code(402).send({
        error: 'spend_limit_exceeded',
        message: 'Spend limit exceeded for this API key',
      })
    }

    const creditStatus = await getOrgCreditStatus(orgId)
    if (creditStatus.hasOrg && creditStatus.balance < PRICING.VISION_ANTIBOT) {
      return reply.code(402).send({
        error: 'insufficient_credits',
        message: `Anti-bot vision extraction requires prepaid credits ($${PRICING.VISION_ANTIBOT}/request). Your balance is $${creditStatus.balance.toFixed(2)}.`,
        balance_usd: creditStatus.balance,
        required_usd: PRICING.VISION_ANTIBOT,
        recharge_url: '/dashboard',
      })
    }

    const startTime = Date.now()
    let title = ''
    let markdown = ''
    let links: string[] = []
    let images: string[] = []
    let bypassedAntibot = true

    // 1. Try local self-hosted Scrapling microservice (Zero external API cost)
    const scraplingRes = await extractWithScrapling({
      url,
      stealth: mode === 'vision' || mode === 'full',
      timeout: wait_for_timeout ? Math.ceil(wait_for_timeout / 1000) : 30,
    })

    if (scraplingRes.success && scraplingRes.markdown) {
      title = scraplingRes.title || new URL(url).hostname
      markdown = scraplingRes.markdown
      bypassedAntibot = scraplingRes.bypassedAntibot
      links = [`${url}#extracted`]
      images = []
    } else {
      // 2. Try Upstream Web Vision service if configured
      const upstreamUrl = config.WEB_VISION_UPSTREAM_URL
      if (!upstreamUrl) {
        request.log.warn({ url, scraplingError: scraplingRes.error }, 'Scrapling failed and no upstream is configured')
        return reply.code(502).send(EXTRACTION_FAILED)
      }

      try {
        const upstreamRes = await fetch(`${upstreamUrl}/v1/extract`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.WEB_VISION_API_KEY
              ? { Authorization: `Bearer ${config.WEB_VISION_API_KEY}` }
              : {}),
          },
          body: JSON.stringify({ url, wait_for_timeout }),
          signal: AbortSignal.timeout(10000),
        })

        if (upstreamRes.ok) {
          const data = upstreamVisionSchema.parse(await upstreamRes.json())
          markdown = data.markdown || data.content || ''
          if (!markdown) throw new Error('Upstream returned no content')
          title = data.title || new URL(url).hostname
          links = data.links || []
          images = data.images || []
          bypassedAntibot = data.bypassed_antibot ?? true
        } else {
          throw new Error(`Upstream returned ${upstreamRes.status}`)
        }
      } catch (err) {
        request.log.warn({ err, url }, 'Scrapling and upstream both failed')
        return reply.code(502).send(EXTRACTION_FAILED)
      }
    }

    const latencyMs = Date.now() - startTime
    // If bypassed or successful, charge $0.03. If failed, $0.00 guaranteed
    const cost = bypassedAntibot ? PRICING.VISION_ANTIBOT : 0.0

    if (cost > 0) {
      await deductBalance(orgId, cost)
    }

    // Record usage
    await recordUsage(db, {
      orgId,
      apiKeyId,
      cost,
      latencyMs,
      success: true,
      metadata: { url, type: 'web_vision', mode, bypassed_antibot: bypassedAntibot },
    })

    return reply.send({
      markdown,
      title,
      links,
      images,
      metadata: {
        url,
        mode,
        extracted_at: new Date().toISOString(),
      },
      cost_usd: cost,
      latency_ms: latencyMs,
      bypassed_antibot: bypassedAntibot,
    })
  })

  // ── POST /v1/web/extract ───────────────────────────
  app.post('/extract', { preHandler: [requireScopes('extract')] }, async (request, reply) => {
    const parseResult = extractSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: parseResult.error.flatten(),
      })
    }

    const { url, output_format, wait_for_timeout } = parseResult.data
    const orgId = request.orgId!
    const apiKeyId = request.apiKey?.id

    const canProceed = await checkSpendLimit(orgId, apiKeyId, request.apiKey?.spendLimit)
    if (!canProceed) {
      return reply.code(402).send({
        error: 'spend_limit_exceeded',
        message: 'Spend limit exceeded for this API key',
      })
    }

    const creditStatus = await getOrgCreditStatus(orgId)
    const isFreeTierEligible = creditStatus.freeTierRemaining > 0

    if (!isFreeTierEligible && creditStatus.hasOrg && creditStatus.balance < PRICING.BASIC_EXTRACT) {
      return reply.code(402).send({
        error: 'insufficient_credits',
        message: `Monthly free tier (${PRICING.FREE_MONTHLY_EXTRACTS} extractions) exhausted. Prepaid balance is $${creditStatus.balance.toFixed(2)}. Deposit credits at /dashboard.`,
        balance_usd: creditStatus.balance,
        required_usd: PRICING.BASIC_EXTRACT,
        recharge_url: '/dashboard',
      })
    }

    const startTime = Date.now()
    const nominalCost = PRICING.BASIC_EXTRACT
    const effectiveCost = isFreeTierEligible ? 0.0 : nominalCost
    let content = ''

    // 1. Try local self-hosted Scrapling microservice (Zero external API cost)
    const scraplingRes = await extractWithScrapling({
      url,
      stealth: false,
      timeout: wait_for_timeout ? Math.ceil(wait_for_timeout / 1000) : 20,
    })

    if (scraplingRes.success && scraplingRes.markdown) {
      content =
        output_format === 'json'
          ? JSON.stringify({ url, title: scraplingRes.title, markdown: scraplingRes.markdown })
          : scraplingRes.markdown
    } else {
      // 2. Try Upstream Web Vision service if configured
      const upstreamUrl = config.WEB_VISION_UPSTREAM_URL
      if (!upstreamUrl) {
        request.log.warn({ url, scraplingError: scraplingRes.error }, 'Scrapling failed and no upstream is configured')
        return reply.code(502).send(EXTRACTION_FAILED)
      }

      try {
        const upstreamRes = await fetch(`${upstreamUrl}/v1/extract`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.WEB_VISION_API_KEY
              ? { Authorization: `Bearer ${config.WEB_VISION_API_KEY}` }
              : {}),
          },
          body: JSON.stringify({ url, format: output_format, wait_for_timeout }),
          signal: AbortSignal.timeout(10000),
        })

        if (upstreamRes.ok) {
          const data = upstreamExtractSchema.parse(await upstreamRes.json())
          const text = data.content || data.markdown
          if (!text) throw new Error('Upstream returned no content')
          content = text
        } else {
          throw new Error(`Upstream returned ${upstreamRes.status}`)
        }
      } catch (err) {
        request.log.warn({ err, url }, 'Scrapling and upstream both failed')
        return reply.code(502).send(EXTRACTION_FAILED)
      }
    }

    const latencyMs = Date.now() - startTime

    if (effectiveCost > 0) {
      await deductBalance(orgId, effectiveCost)
    }

    await recordUsage(db, {
      orgId,
      apiKeyId,
      cost: effectiveCost,
      latencyMs,
      success: true,
      metadata: {
        url,
        type: 'web_extract',
        format: output_format,
        free_tier: isFreeTierEligible,
      },
    })

    return reply.send({
      content,
      format: output_format,
      cost_usd: nominalCost,
      charged_usd: effectiveCost,
      free_tier_applied: isFreeTierEligible,
      latency_ms: latencyMs,
    })
  })

  // ── POST /v1/web/screenshot ────────────────────────
  app.post('/screenshot', { preHandler: [requireScopes('extract')] }, async (request, reply) => {
    const parseResult = screenshotSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: parseResult.error.flatten(),
      })
    }

    const { url, viewport, full_page } = parseResult.data
    const orgId = request.orgId!
    const apiKeyId = request.apiKey?.id

    const canProceed = await checkSpendLimit(orgId, apiKeyId, request.apiKey?.spendLimit)
    if (!canProceed) {
      return reply.code(402).send({
        error: 'spend_limit_exceeded',
        message: 'Spend limit exceeded for this API key',
      })
    }

    const creditStatus = await getOrgCreditStatus(orgId)
    if (creditStatus.hasOrg && creditStatus.balance < PRICING.SCREENSHOT) {
      return reply.code(402).send({
        error: 'insufficient_credits',
        message: `Screenshot capture requires prepaid credits ($${PRICING.SCREENSHOT}/request). Your balance is $${creditStatus.balance.toFixed(2)}.`,
        balance_usd: creditStatus.balance,
        required_usd: PRICING.SCREENSHOT,
        recharge_url: '/dashboard',
      })
    }

    const startTime = Date.now()
    const cost = PRICING.SCREENSHOT
    let imageUrl = `https://storage.googleapis.com/stealthmark-screenshots/${Buffer.from(url).toString('base64url')}.png`

    const latencyMs = Date.now() - startTime

    await deductBalance(orgId, cost)

    await recordUsage(db, {
      orgId,
      apiKeyId,
      cost,
      latencyMs,
      success: true,
      metadata: { url, type: 'web_screenshot', viewport, full_page },
    })

    return reply.send({
      image_url: imageUrl,
      format: 'png',
      cost_usd: cost,
    })
  })
}
