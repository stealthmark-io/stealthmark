import { describe, expect, it } from 'vitest'
import { describeSyncFailure } from '../lib/session-sync'

describe('describeSyncFailure', () => {
  it('includes the status and the route error so a failed login is diagnosable', () => {
    expect(describeSyncFailure(500, { error: 'account_provisioning_failed' })).toBe(
      'Your StealthMark session could not be created (HTTP 500 · account_provisioning_failed). Please try signing in again.',
    )
  })

  it('falls back to the status alone when the body has no error string', () => {
    expect(describeSyncFailure(401, { message: 'x' })).toContain('(HTTP 401)')
    expect(describeSyncFailure(502, null)).toContain('(HTTP 502)')
  })

  it('reports a network error when the request never answered', () => {
    expect(describeSyncFailure(0, null)).toContain('(network error)')
  })
})
