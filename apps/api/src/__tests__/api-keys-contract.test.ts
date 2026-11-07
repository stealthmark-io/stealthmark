import { describe, it, expect, vi } from 'vitest'

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return {
    ...actual,
    randomBytes: vi.fn(() => Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')),
  }
})

import { generateApiKey, hashApiKey } from '../lib/crypto.js'
import { buildApp } from '../app.js'
import { emptyResultDb, testApiKeyRecord } from './helpers/test-auth.js'
import type { ApiKeyResolver } from '../middleware/api-key-auth.js'

const FIXED_KEY = 'sk_live_000102030405060708090a0b0c0d0e0f'
const FIXED_KEY_HASH = 'ce9baf6cf5e39d52066ca08ac5bbae24c03e50c1fae7192e0729e790b8810c90'
const HASH_VECTOR_KEY = 'sk_live_0123456789abcdef0123456789abcdef'
const HASH_VECTOR = '0dd9d97a3da0cbadcbce40a79d539c8a79745dae25b2c85bdefc9a44b219663e'

describe('API key format contract (mirrored by apps/web/src/__tests__/api-keys-contract.test.ts)', () => {
  it('produces the exact fixed vector for deterministic random bytes', () => {
    expect(generateApiKey()).toEqual({
      key: FIXED_KEY,
      keyHash: FIXED_KEY_HASH,
      keyPrefix: 'sk_live_0001...0e0f',
    })
  })

  it('uses the sk_live_ prefix, 40 characters and a lowercase hex body', () => {
    const { key } = generateApiKey()
    expect(key).toMatch(/^sk_live_[0-9a-f]{32}$/)
    expect(key).toHaveLength(40)
  })

  it('shapes keyPrefix as prefix + first 4 hex + "..." + last 4 hex', () => {
    expect(generateApiKey().keyPrefix).toMatch(/^sk_live_[0-9a-f]{4}\.\.\.[0-9a-f]{4}$/)
  })

  it('honours a custom prefix without changing the body or hash rule', () => {
    const custom = generateApiKey('sk_test_')
    expect(custom.key).toBe('sk_test_000102030405060708090a0b0c0d0e0f')
    expect(custom.keyPrefix).toBe('sk_test_0001...0e0f')
    expect(custom.keyHash).toBe(hashApiKey(custom.key))
  })

  it('hashes with SHA-256 hex against a fixed vector', () => {
    expect(hashApiKey(HASH_VECTOR_KEY)).toBe(HASH_VECTOR)
    expect(hashApiKey(HASH_VECTOR_KEY)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('A generated key authenticates against the API', () => {
  async function appFor(keyHash: string, keyPrefix: string) {
    const record = testApiKeyRecord({ keyHash, keyPrefix })
    const resolver: ApiKeyResolver = async (hash) => (hash === record.keyHash ? record : undefined)
    return buildApp({ db: emptyResultDb(), apiKeyResolver: resolver })
  }

  it('accepts a freshly generated sk_live_ key through createApiKeyAuth', async () => {
    const { key, keyHash, keyPrefix } = generateApiKey()
    const app = await appFor(keyHash, keyPrefix)
    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/00000000-0000-4000-8000-000000000001',
      headers: { authorization: `Bearer ${key}` },
    })
    await app.close()

    expect(res.statusCode).toBe(404)
  })

  it('accepts the same key through the x-api-key header', async () => {
    const { key, keyHash, keyPrefix } = generateApiKey()
    const app = await appFor(keyHash, keyPrefix)
    const res = await app.inject({ method: 'GET', url: '/v1/users/00000000-0000-4000-8000-000000000001', headers: { 'x-api-key': key } })
    await app.close()

    expect(res.statusCode).toBe(404)
  })

  it('rejects an sm_live_ key with 401 even when its hash is registered', async () => {
    const legacy = 'sm_live_000102030405060708090a0b0c0d0e0f'
    const app = await appFor(hashApiKey(legacy), 'sm_live_0001...0e0f')
    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/public-key',
      headers: { authorization: `Bearer ${legacy}` },
    })
    await app.close()

    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('invalid_api_key')
  })

  it('rejects a well-formed sk_live_ key whose hash is unknown', async () => {
    const { keyHash, keyPrefix } = generateApiKey()
    const app = await appFor(keyHash, keyPrefix)
    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/public-key',
      headers: { authorization: 'Bearer sk_live_ffffffffffffffffffffffffffffffff' },
    })
    await app.close()

    expect(res.statusCode).toBe(401)
  })
})
