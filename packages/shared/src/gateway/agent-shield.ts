import { z } from 'zod'

export interface AgentShieldConfig {
  siteDomain: string
  gatewayUrl?: string
  siteApiKey?: string
  manifest?: Record<string, unknown>
  actionHandlers?: Record<string, (payload: unknown, agentContext: AgentPassportPayload) => unknown>
}

export interface AgentPassportPayload {
  sub: string // agent_id
  orgId: string
  siteId: string
  jti: string
  scopes: string[]
  trustLevel: string
  trustScore?: number
  behavioralScore?: number
  iat: number
  exp: number
}

const passportPayloadSchema = z.object({
  sub: z.string(),
  orgId: z.string(),
  siteId: z.string(),
  jti: z.string(),
  scopes: z.array(z.string()),
  trustLevel: z.string(),
  trustScore: z.number().optional(),
  behavioralScore: z.number().optional(),
  iat: z.number(),
  exp: z.number(),
})

const gatewayErrorSchema = z.object({ message: z.string().optional() })

const gatewayVerificationSchema = z.object({
  valid: z.boolean(),
  claims: passportPayloadSchema.optional(),
  reason: z.string().optional(),
})

export interface ShieldVerificationResult {
  valid: boolean
  payload?: AgentPassportPayload
  error?: string
}

/**
 * Creates an Agent Shield middleware helper for HTTP servers (Node/Express/Fastify/Next.js)
 */
export function createAgentShield(config: AgentShieldConfig) {
  const gatewayUrl = config.gatewayUrl || 'https://api.stealthmark.io'

  /**
   * Fast header / query inspection to check if the incoming request is an autonomous AI agent
   */
  function isAgentRequest(req: {
    headers: Record<string, string | string[] | undefined>
    url?: string
  }): boolean {
    const userAgent = (req.headers['user-agent'] as string) || ''
    const accept = (req.headers['accept'] as string) || ''
    const smAgentHeader = req.headers['x-stealthmark-agent']
    const hasPassport = Boolean(req.headers['authorization']?.toString().startsWith('Bearer smp_'))

    if (smAgentHeader === 'true' || smAgentHeader === '1' || hasPassport) {
      return true
    }

    if (accept.includes('application/vnd.stealthmark+json') || accept.includes('application/vnd.agent+json')) {
      return true
    }

    // Known autonomous agent frameworks
    if (/LangChain|AutoGPT|BabyAGI|Cursor|HermesAgent|Claude-Agent/i.test(userAgent)) {
      return true
    }

    return false
  }

  /**
   * Verifies an agent passport against the StealthMark Gateway
   */
  async function verifyPassport(token: string): Promise<ShieldVerificationResult> {
    try {
      const cleanToken = token.replace(/^Bearer\s+/i, '').trim()
      const res = await fetch(`${gatewayUrl}/v1/gateway/tokens/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cleanToken }),
      })

      if (!res.ok) {
        const errorData = gatewayErrorSchema.safeParse(await res.json().catch(() => null))
        return { valid: false, error: (errorData.success && errorData.data.message) || 'Passport verification failed' }
      }

      const parsed = gatewayVerificationSchema.safeParse(await res.json())
      if (!parsed.success) {
        return { valid: false, error: 'Gateway returned a malformed verification response' }
      }

      const { valid, claims, reason } = parsed.data
      if (valid && claims) {
        return { valid: true, payload: claims }
      }

      return { valid: false, error: reason || 'Invalid passport' }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { valid: false, error: `Verification network error: ${message}` }
    }
  }

  return {
    isAgentRequest,
    verifyPassport,
    getConfig: () => config,
  }
}
