import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAgentShield } from '@stealthmark/shared'

const claims = {
  sub: 'agent-1',
  orgId: 'org-1',
  siteId: 'site-1',
  jti: 'jti-1',
  scopes: ['content:read'],
  trustLevel: 'trusted',
  trustScore: 90,
  iat: 1_700_000_000,
  exp: 1_700_003_600,
}

function respondWith(body: string | null, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(body, { status }))
}

describe('Agent Shield passport verification', () => {
  const shield = createAgentShield({ siteDomain: 'shop.example', gatewayUrl: 'https://gateway.example' })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('strips the Bearer prefix and returns the validated claims', async () => {
    const fetchSpy = respondWith(JSON.stringify({ valid: true, claims }))

    const result = await shield.verifyPassport('Bearer  token-abc ')

    expect(result).toEqual({ valid: true, payload: claims })
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://gateway.example/v1/gateway/tokens/verify',
      expect.objectContaining({ body: JSON.stringify({ token: 'token-abc' }) })
    )
  })

  it('fails closed when the gateway claims validity with a payload of the wrong shape', async () => {
    respondWith(JSON.stringify({ valid: true, claims: { sub: 'agent-1', scopes: 'content:read' } }))

    const result = await shield.verifyPassport('token-abc')

    expect(result).toEqual({ valid: false, error: 'Gateway returned a malformed verification response' })
  })

  it('does not accept valid: true without claims', async () => {
    respondWith(JSON.stringify({ valid: true, reason: 'expired' }))

    expect(await shield.verifyPassport('token-abc')).toEqual({ valid: false, error: 'expired' })
  })

  it('relays the gateway message on a non-2xx response', async () => {
    respondWith(JSON.stringify({ message: 'Passport revoked' }), 401)

    expect(await shield.verifyPassport('token-abc')).toEqual({ valid: false, error: 'Passport revoked' })
  })

  it('uses a generic error when a non-2xx response is not JSON', async () => {
    respondWith('<html>bad gateway</html>', 502)

    expect(await shield.verifyPassport('token-abc')).toEqual({ valid: false, error: 'Passport verification failed' })
  })

  it('reports network failures as invalid with the underlying message', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'))

    expect(await shield.verifyPassport('token-abc')).toEqual({
      valid: false,
      error: 'Verification network error: fetch failed',
    })
  })
})
