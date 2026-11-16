import { isIP } from 'node:net'
import { config } from '../config.js'

/** Request headers whose values never reach the logs. The header paths of the pino redact list are derived from it. */
const REDACTED_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-internal-secret',
  'x-auth-token',
  'x-access-token',
]
const REDACTED_HEADER_NAMES = new Set(REDACTED_HEADERS)

const REDACT_PATHS = [
  ...REDACTED_HEADERS.map((name) => `req.headers["${name}"]`),
  'res.headers["set-cookie"]',
  ...REDACTED_HEADERS.map((name) => `headers["${name}"]`),
  'authorization',
  'cookie',
  'apiKey',
  'x-api-key',
  'x-internal-secret',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'password',
  'email',
  '*.authorization',
  '*.cookie',
  '*.apiKey',
  '*.token',
  '*.secret',
  '*.password',
  '*.email',
]

const CF_RAY_HEADER_REGEX = /^[0-9a-f]{8,32}(?:-[a-z0-9]{2,8})?$/i

export function extractHeaderString(value: unknown, maxLength = 256): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/[\x00-\x1f\x7f]/g, '').trim()
  return cleaned ? cleaned.slice(0, maxLength) : null
}

/** TRUST_CLOUDFLARE_EDGE, trimmed and lowercased. The app reads it once, when it is built. */
export function readTrustEdgeMode(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.TRUST_CLOUDFLARE_EDGE?.trim().toLowerCase()
}

/**
 * Client address for the logs. A single CF-Connecting-IP literal wins unless the edge mode rejects it: "false" ignores
 * the header, "true" requires a well-formed CF-Ray, and any other value only rejects a malformed CF-Ray.
 */
export function resolveRequestClientIp(
  req: {
    ip?: string
    headers?: Record<string, unknown>
  },
  trustEdgeMode: string | undefined,
): string | null {
  const headers = req.headers ?? {}
  const rawCfIp = headers['cf-connecting-ip']
  const singleCfIp = typeof rawCfIp === 'string' && !rawCfIp.includes(',') ? rawCfIp.trim() : null

  if (trustEdgeMode !== 'false' && singleCfIp && isIP(singleCfIp) !== 0) {
    const cfRay = extractHeaderString(headers['cf-ray'], 64) ?? ''
    const rayCoherent =
      trustEdgeMode === 'true'
        ? CF_RAY_HEADER_REGEX.test(cfRay)
        : cfRay === '' || CF_RAY_HEADER_REGEX.test(cfRay)
    if (rayCoherent) {
      return singleCfIp
    }
  }

  if (typeof req.ip === 'string' && !req.ip.includes(',') && isIP(req.ip.trim()) !== 0) {
    return req.ip.trim()
  }
  return null
}

function redactRequestHeaders(headers: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!headers || typeof headers !== 'object') return {}
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (REDACTED_HEADER_NAMES.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]'
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}

function sanitizeLoggedUrl(url: string | undefined): string {
  if (!url) return '/'
  return url.replace(
    /([?&](?:token|secret|key|api_key|apikey|password|authorization|auth|cookie|email|code|sig)=)[^&#]*/gi,
    '$1[REDACTED]'
  )
}

export function buildLoggerOptions(
  options: { logLevel?: string; loggerStream?: NodeJS.WritableStream },
  trustEdgeMode: string | undefined,
) {
  return {
    level: options.logLevel ?? config.LOG_LEVEL,
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    serializers: {
      req(request: { method?: string; url?: string; hostname?: string; ip?: string; headers?: Record<string, unknown> }) {
        const headers = request.headers ?? {}
        return {
          method: request.method,
          url: sanitizeLoggedUrl(request.url),
          host: request.hostname,
          remoteAddress: request.ip,
          clientIp: resolveRequestClientIp({ ip: request.ip, headers }, trustEdgeMode),
          cfRay: extractHeaderString(headers['cf-ray'], 64),
          cfCountry: extractHeaderString(headers['cf-ipcountry'], 8),
          userAgent: extractHeaderString(headers['user-agent'], 256),
          headers: redactRequestHeaders(headers),
        }
      },
    },
    transport:
      !options.loggerStream && config.NODE_ENV === 'development'
        ? { target: 'pino-pretty' }
        : undefined,
    ...(options.loggerStream ? { stream: options.loggerStream } : {}),
  }
}
