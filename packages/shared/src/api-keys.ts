import { createHash, randomBytes } from 'node:crypto'

export interface GeneratedApiKey {
  key: string
  keyHash: string
  keyPrefix: string
}

/**
 * Single source of truth for the StealthMark API key format.
 * Format: `sk_live_` + 32 random hex characters (16 random bytes).
 * keyPrefix is `<prefix><first 4 hex>...<last 4 hex>`; keyHash is the SHA-256 hex digest of the key.
 */
export function generateApiKey(prefix = 'sk_live_'): GeneratedApiKey {
  const randomPart = randomBytes(16).toString('hex')
  const key = `${prefix}${randomPart}`
  const keyHash = hashApiKey(key)
  const keyPrefix = `${prefix}${randomPart.slice(0, 4)}...${randomPart.slice(-4)}`

  return {
    key,
    keyHash,
    keyPrefix,
  }
}

/** Computes the SHA-256 hex digest of an API key string. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}
