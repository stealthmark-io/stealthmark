import { describe, it, expect } from 'vitest'
import { generateApiKey, hashApiKey } from '../crypto.js'

describe('Crypto utilities', () => {
  it('generates an API key with correct prefix and length', () => {
    const { key, keyHash, keyPrefix } = generateApiKey()

    expect(key.startsWith('sk_live_')).toBe(true)
    // 'sk_live_' (8 chars) + 32 hex chars = 40 chars
    expect(key.length).toBe(40)
    expect(keyHash.length).toBe(64) // SHA-256 is 64 hex chars
    expect(keyPrefix.startsWith('sk_live_')).toBe(true)
  })

  it('hashes an API key deterministically with SHA-256', () => {
    const key = 'sk_live_0123456789abcdef0123456789abcdef'
    const hash1 = hashApiKey(key)
    const hash2 = hashApiKey(key)

    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^[a-f0-9]{64}$/)
  })

  it('generates unique keys on successive calls', () => {
    const key1 = generateApiKey()
    const key2 = generateApiKey()

    expect(key1.key).not.toBe(key2.key)
    expect(key1.keyHash).not.toBe(key2.keyHash)
  })
})
