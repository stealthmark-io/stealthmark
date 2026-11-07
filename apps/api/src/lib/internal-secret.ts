import { timingSafeEqual } from 'node:crypto'
import { config, INSECURE_INTERNAL_AUTH_SECRET_DEFAULT } from '../config.js'

/**
 * Validates the internal bootstrap secret in constant time.
 * In production the shipped development default is never accepted, so a missing env var closes the door instead of opening it.
 */
export function isInternalSecretValid(provided: unknown): boolean {
  const expected = config.INTERNAL_AUTH_SECRET
  if (config.NODE_ENV === 'production' && expected === INSECURE_INTERNAL_AUTH_SECRET_DEFAULT) return false
  if (typeof provided !== 'string' || provided.length === 0 || expected.length === 0) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
