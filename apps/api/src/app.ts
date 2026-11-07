import Fastify, { type FastifyError } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import sensible from '@fastify/sensible'
import rateLimit from '@fastify/rate-limit'
import { sql } from 'drizzle-orm'
import { createDb, type DbClient } from '@stealthmark/db'
import { config, resolveFeatures, type FeatureFlags } from './config.js'
import { apiKeysRoutes } from './routes/v1/api-keys.js'
import { organizationsRoutes } from './routes/v1/organizations.js'
import { usersRoutes } from './routes/v1/users.js'
import { agentsRoutes } from './routes/v1/agents.js'
import { capabilitiesRoutes } from './routes/v1/capabilities.js'
import { usageRoutes } from './routes/v1/usage.js'
import { webRoutes } from './routes/v1/web.js'
import { discoveryRoutes } from './routes/v1/discovery.js'
import { tasksRoutes } from './routes/v1/tasks.js'
import { publisherRoutes } from './routes/v1/publisher.js'
import { evaluationsRoutes } from './routes/v1/evaluations.js'
import { reviewsRoutes } from './routes/v1/reviews.js'
import { badgesRoutes } from './routes/v1/badges.js'
import { negotiationsRoutes } from './routes/v1/negotiations.js'
import { contractsRoutes } from './routes/v1/contracts.js'
import { escrowRoutes } from './routes/v1/escrow.js'
import { balancesRoutes } from './routes/v1/balances.js'
import { policiesRoutes } from './routes/v1/policies.js'
import { auditRoutes } from './routes/v1/audit.js'
import { killSwitchRoutes } from './routes/v1/kill-switch.js'
import { finopsRoutes } from './routes/v1/finops.js'
import { privateRegistriesRoutes } from './routes/v1/private-registries.js'
import { agentContextRoutes } from './routes/v1/agent-context.js'
import { gatewayRoutes } from './routes/v1/gateway.js'
import { getJwks } from './services/passport.js'
import { internalTrustRoutes } from './routes/internal/trust.js'
import { internalAuthRoutes } from './routes/internal/auth.js'
import { a2aRoutes } from './routes/a2a.js'
import { openApiSpec } from './openapi.js'
import { createApiKeyAuth, type ApiKeyResolver } from './middleware/api-key-auth.js'
import { isInternalSecretValid } from './lib/internal-secret.js'
import { STATUS_CODES } from 'node:http'

export interface AppOptions {
  db?: DbClient
  /** Test seam: resolve API keys without a database. Production always uses the database. */
  apiKeyResolver?: ApiKeyResolver
  /** Overrides the FEATURE_* environment flags. Gated-off route groups are not registered, so they answer 404. */
  features?: Partial<FeatureFlags>
}

const PUBLIC_V1_PATHS = ['/v1', '/v1/', '/v1/openapi.json']
const PUBLIC_PASSPORT_PATHS = ['/v1/gateway/public-key', '/v1/gateway/jwks']
// Bootstrap routes create the first organization and key; the ingest takes Canary hits forwarded by the web app.
const INTERNAL_SECRET_ROUTES = new Set(['POST /v1/organizations', 'POST /v1/api-keys', 'POST /v1/usage/ingest'])

/**
 * Trusts exactly `hops` proxies in front of the API, so request.ip is the Nth address from the right of X-Forwarded-For
 * (the one the proxy itself appended) and never an entry the caller wrote. Fastify's numeric form does not do this.
 */
function trustedProxyHops(hops: number): false | ((address: string, hop: number) => boolean) {
  return hops > 0 ? (_address, hop) => hop < hops : false
}

function normalizePath(url: string): string {
  const path = url.split('?')[0] ?? ''
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

interface RateLimitBody {
  statusCode: number
  error: 'rate_limit_exceeded'
  message: string
  retry_after: number
}

function isRateLimitBody(value: unknown): value is RateLimitBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    value.error === 'rate_limit_exceeded' &&
    'retry_after' in value &&
    typeof value.retry_after === 'number'
  )
}

export async function buildApp(options: AppOptions = {}) {
  const features = resolveFeatures(options.features)
  const publicV1Paths = new Set(features.passports ? [...PUBLIC_V1_PATHS, ...PUBLIC_PASSPORT_PATHS] : PUBLIC_V1_PATHS)
  const app = Fastify({
    trustProxy: trustedProxyHops(config.TRUSTED_PROXY_HOPS),
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === 'development'
          ? { target: 'pino-pretty' }
          : undefined,
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  })

  // ── Database Client ────────────────────────────────
  let db = options.db
  if (!db && config.DATABASE_URL) {
    try {
      db = createDb(config.DATABASE_URL)
    } catch (err) {
      app.log.warn({ err }, 'Failed to initialize database client at startup')
    }
  }

  // ── Core Plugins ──────────────────────────────────
  await app.register(cors, {
    origin: config.CORS_ORIGINS.split(',').map((s) => s.trim()),
  })
  await app.register(helmet, {
    contentSecurityPolicy: false, // API-only
  })
  await app.register(sensible)

  // ── Rate Limiting (TASK-11 & P2 Granular Hardening) ──
  await app.register(rateLimit, {
    global: true,
    hook: 'preHandler',
    max: (req) => {
      // Sensitive cryptographic endpoint rate limiting:
      // Passport issuance is an intensive Ed25519 signing operation
      if (req.url?.startsWith('/v1/gateway/passport') && req.method === 'POST') {
        const keyRpm = req.apiKey?.rateLimitRpm ?? 30
        return Math.min(keyRpm, 60)
      }
      return req.apiKey?.rateLimitRpm ?? 100
    },
    timeWindow: '1 minute',
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    errorResponseBuilder: (_req, context) => {
      const retryAfter = Math.ceil(context.ttl / 1000)
      return {
        statusCode: context.statusCode,
        error: 'rate_limit_exceeded',
        message: `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
        retry_after: retryAfter,
      }
    },
  })

  // ── Error Handler ──────────────────────────────────
  // Server errors never expose driver or query details to clients; the full error goes to the log with the request id.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (isRateLimitBody(error)) {
      return reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.error,
        message: error.message,
        retry_after: error.retry_after,
      })
    }

    const statusCode = typeof error.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500

    if (statusCode >= 500) {
      request.log.error({ err: error, requestId: request.id }, 'Unhandled server error')
      return reply.code(statusCode).send({
        error: 'internal_error',
        message: 'An unexpected error occurred. Quote the requestId when contacting support.',
        requestId: request.id,
      })
    }

    const statusText = STATUS_CODES[statusCode] ?? 'Error'
    return reply.code(statusCode).send({
      statusCode,
      error: statusText,
      message: error instanceof Error ? error.message : statusText,
      ...(error.code ? { code: error.code } : {}),
    })
  })

  // ── Health & Readiness Endpoints ──────────────────
  app.get('/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  }))

  app.get('/ready', async (request, reply) => {
    if (!db) {
      return reply.code(503).send({ status: 'not_ready', reason: 'No database client' })
    }
    try {
      // Fast ping to postgres
      await db.execute(sql`SELECT 1`)
      return { status: 'ready', database: 'connected' }
    } catch (err) {
      request.log.error({ err }, 'Readiness check failed: database unreachable')
      return reply.code(503).send({ status: 'not_ready', database: 'disconnected' })
    }
  })

  // ── Root Endpoint ──────────────────────────────────
  app.get('/', async () => ({
    name: 'StealthMark Core API',
    status: 'operational',
    version: '0.1.0',
    protocol: 'Agent Governance Control Plane',
    documentation: 'https://stealthmark.io/docs',
    endpoints: {
      health: '/health',
      discovery: '/.well-known/ai-catalog.json',
      ...(features.passports ? { jwks: '/.well-known/jwks.json' } : {}),
      v1_api: '/v1',
      openapi: '/v1/openapi.json',
    },
  }))

  // ── Agent Resource Discovery (ARD) ────────────────
  app.get('/.well-known/ai-catalog.json', async () => ({
    version: '1.0',
    organization: {
      name: 'StealthMark',
      url: 'https://stealthmark.io',
      description: 'Infrastructure for the Agentic Economy',
    },
    resources: [
      {
        type: 'api',
        name: 'StealthMark API',
        url: 'https://api.stealthmark.io/v1/openapi.json',
        description: 'REST API for observing and governing AI agent traffic on registered sites',
      },
      {
        type: 'documentation',
        name: 'StealthMark Docs',
        url: 'https://stealthmark.io/docs',
        description: 'Middleware installation for Next.js, Express and Fastify, and agent policy reference',
      },
    ],
  }))

  // ── API v1 Routes ─────────────────────────────────
  await app.register(
    async (v1) => {
      v1.get('/', async () => ({
        name: 'StealthMark API',
        version: 'v1',
        docs: 'https://stealthmark.io/docs',
      }))

      v1.get('/openapi.json', async () => openApiSpec)

      // Every /v1 route requires an API key, except public metadata and INTERNAL_SECRET_ROUTES,
      // which the control plane may call with the internal secret instead.
      const auth = createApiKeyAuth(() => db, options.apiKeyResolver)
      v1.addHook('preHandler', async (request, reply) => {
        const path = normalizePath(request.url)
        if (publicV1Paths.has(path)) {
          return
        }
        if (
          INTERNAL_SECRET_ROUTES.has(`${request.method} ${path}`) &&
          isInternalSecretValid(request.headers['x-internal-secret'])
        ) {
          request.internalCaller = true
          return
        }
        return auth(request, reply)
      })

      if (db) {
        await v1.register(apiKeysRoutes, { prefix: '/api-keys', db })
        await v1.register(organizationsRoutes, { prefix: '/organizations', db })
        await v1.register(usersRoutes, { prefix: '/users', db })
        await v1.register(agentsRoutes, { prefix: '/agents', db })
        await v1.register(usageRoutes, { prefix: '/usage', db })
        await v1.register(gatewayRoutes, { prefix: '/gateway', db, passports: features.passports })

        if (features.commerce) {
          await v1.register(capabilitiesRoutes, { prefix: '/capabilities', db })
          await v1.register(webRoutes, { prefix: '/web', db })
          await v1.register(discoveryRoutes, { prefix: '/discovery', db })
          await v1.register(tasksRoutes, { prefix: '/tasks', db })
          await v1.register(publisherRoutes, { prefix: '/publisher', db })
          await v1.register(evaluationsRoutes, { db })
          await v1.register(reviewsRoutes, { db })
          await v1.register(badgesRoutes, { db })
          await v1.register(negotiationsRoutes, { db })
          await v1.register(contractsRoutes, { db })
          await v1.register(escrowRoutes, { db })
          await v1.register(balancesRoutes, { db })
          await v1.register(finopsRoutes, { db })
          await v1.register(privateRegistriesRoutes, { db })
        }

        if (features.passports) {
          await v1.register(policiesRoutes, { db })
          await v1.register(auditRoutes, { db })
          await v1.register(killSwitchRoutes, { db })
          await v1.register(agentContextRoutes, { db })
        }
      }
    },

    { prefix: '/v1' },
  )

  if (db) {
    await app.register(internalAuthRoutes, { prefix: '/internal/auth', db })
    if (features.passports) {
      await app.register(internalTrustRoutes, { prefix: '/internal/trust', db })
    }
    if (features.commerce) {
      await app.register(a2aRoutes, { prefix: '/a2a', db })
    }
  }

  // JWKS Endpoints for offline agent passport verification (frozen with the rest of the passport surface)
  if (features.passports) {
    app.get('/.well-known/stealthmark-keys.json', async () => getJwks())
    app.get('/.well-known/jwks.json', async () => getJwks())
  }

  // A2A Agent Card specification endpoint
  app.get('/.well-known/agent.json', async () => ({
    name: 'StealthMark Agent Governance API',
    description: 'Control plane for sites that observe, rate-limit and authorize AI agent traffic through StealthMark middleware.',
    url: 'https://api.stealthmark.io',
    version: '2.0.0',
    protocol_version: 'A2A/v0.2',
    authentication: {
      schemes: ['bearer'],
      header: 'Authorization',
    },
    capabilities: ['site-registration', 'agent-events', 'usage-metering'],
  }))

  return app
}
