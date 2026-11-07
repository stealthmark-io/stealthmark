import type { ApiKey, DbClient } from '@stealthmark/db'
import { hashApiKey } from '../../lib/crypto.js'
import type { ApiKeyResolver } from '../../middleware/api-key-auth.js'

export const TEST_ORG_ID = '123e4567-e89b-12d3-a456-426614174000'
export const TEST_API_KEY = 'sk_test_stealthmark_0123456789abcdef'

/** Platform-admin key by default so existing fixtures that pass an explicit orgId keep working. */
export function testApiKeyRecord(overrides: Partial<ApiKey> = {}): ApiKey {
  const base: ApiKey = {
    id: '987fcdeb-51a2-43f7-9abc-def012345678',
    orgId: TEST_ORG_ID,
    keyHash: hashApiKey(TEST_API_KEY),
    keyPrefix: 'sk_test_stea...cdef',
    name: 'Test Key',
    scopes: ['platform:admin'],
    rateLimitRpm: 1000,
    rateLimitRpd: 100000,
    spendLimit: null,
    status: 'active',
    lastUsedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }
  return { ...base, ...overrides }
}

export function testApiKeyResolver(overrides: Partial<ApiKey> = {}): ApiKeyResolver {
  const record = testApiKeyRecord(overrides)
  return async (keyHash) => (keyHash === record.keyHash ? record : undefined)
}

export const authHeaders = { authorization: `Bearer ${TEST_API_KEY}` } as const

/** Opt-in switches for the feature-gated route groups (commerce, passports). */
export const ENABLED_FEATURES = { commerce: true, passports: true } as const

export const NON_ADMIN_SCOPES = ['extract']

/** Ordinary tenant key: scoped to its own organization, no platform scope. */
export function nonAdminKeyResolver(overrides: Partial<ApiKey> = {}): ApiKeyResolver {
  return testApiKeyResolver({ scopes: NON_ADMIN_SCOPES, ...overrides })
}

type Resolve = (value: unknown[]) => unknown

/** Chainable Drizzle stand-in: every builder call returns itself and awaiting it yields an empty row set. */
export function emptyResultDb(): DbClient {
  const proxy: unknown = new Proxy(function builder() {}, {
    get: (_target, prop) => (prop === 'then' ? (resolve: Resolve) => resolve([]) : proxy),
    apply: () => proxy,
  })
  return proxy as DbClient
}
