import { FastifyRequest, FastifyReply } from 'fastify'
import { eq } from 'drizzle-orm'
import { apiKeys, type ApiKey, type Organization, type DbClient } from '@stealthmark/db'
import { hashApiKey } from '../lib/crypto.js'

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: ApiKey
    orgId?: string
    organization?: Organization
    user?: {
      uid: string
      email?: string
    }
    /** Set when the request was authenticated with the internal bootstrap secret instead of an API key. */
    internalCaller?: boolean
  }
}

/** Looks up an API key record by its hash. Injected in tests; production falls back to the database. */
export type ApiKeyResolver = (keyHash: string) => Promise<ApiKey | undefined>

export function createApiKeyAuth(getDb: () => DbClient | undefined, resolver?: ApiKeyResolver) {
  return async function apiKeyAuth(request: FastifyRequest, reply: FastifyReply) {
    let rawKey: string | undefined

    const authHeader = request.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      rawKey = authHeader.slice(7).trim()
    } else if (typeof request.headers['x-api-key'] === 'string') {
      rawKey = request.headers['x-api-key'].trim()
    }

    if (!rawKey) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Missing API key. Provide via Authorization Bearer token or x-api-key header.',
      })
    }

    if (!rawKey.startsWith('sk_')) {
      return reply.code(401).send({
        error: 'invalid_api_key',
        message: 'Invalid API key format. Must start with sk_',
      })
    }

    const keyHash = hashApiKey(rawKey)
    const db = getDb()

    let keyRecord: ApiKey | undefined = resolver ? await resolver(keyHash) : undefined
    const loadedFromDb = !keyRecord

    if (!keyRecord) {
      if (!db) {
        return reply.code(503).send({
          error: 'service_unavailable',
          message: 'Database connection is not available',
        })
      }
      ;[keyRecord] = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.keyHash, keyHash))
        .limit(1)
    }

    if (!keyRecord) {
      return reply.code(401).send({
        error: 'invalid_api_key',
        message: 'Invalid or unknown API key',
      })
    }

    if (keyRecord.status !== 'active') {
      return reply.code(403).send({
        error: 'api_key_revoked',
        message: `API key is ${keyRecord.status}`,
      })
    }

    // Attach to request
    request.apiKey = keyRecord
    request.orgId = keyRecord.orgId

    // Best-effort bookkeeping for keys stored in the database; a failure is logged and never fails the request.
    if (db && loadedFromDb) {
      const keyId = keyRecord.id
      touchLastUsedAt(db, keyId).catch((err: unknown) => {
        request.log.warn({ err, keyId }, 'Failed to update API key last_used_at')
      })
    }
  }
}

async function touchLastUsedAt(db: DbClient, keyId: string): Promise<void> {
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, keyId))
}

export function requireScopes(...requiredScopes: string[]) {
  return async function scopeGuard(request: FastifyRequest, reply: FastifyReply) {
    if (!request.apiKey) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication required before checking scopes',
      })
    }

    const keyScopes = request.apiKey.scopes ?? []
    if (keyScopes.includes('*')) {
      return
    }

    const hasAll = requiredScopes.every((s) => keyScopes.includes(s))

    if (!hasAll) {
      return reply.code(403).send({
        error: 'insufficient_scope',
        message: `Missing required scope(s): ${requiredScopes.join(', ')}`,
      })
    }
  }
}
