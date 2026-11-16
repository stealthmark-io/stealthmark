import { describe, expect, it } from 'vitest'
import { readTrustEdgeMode, resolveRequestClientIp } from '../request-logging.js'

const PEER_IP = '35.191.0.1'
const EDGE_IP = '203.0.113.50'
const WELL_FORMED_RAY = '8e11223344556677-EZE'
const MALFORMED_RAY = 'not-a-ray!'

function clientIp(env: NodeJS.ProcessEnv, headers: Record<string, string> = {}): string | null {
  return resolveRequestClientIp(
    { ip: PEER_IP, headers: { 'cf-connecting-ip': EDGE_IP, ...headers } },
    readTrustEdgeMode(env),
  )
}

describe('resolveRequestClientIp under each TRUST_CLOUDFLARE_EDGE mode', () => {
  it('unset: trusts CF-Connecting-IP with or without a CF-Ray', () => {
    expect(clientIp({})).toBe(EDGE_IP)
    expect(clientIp({}, { 'cf-ray': WELL_FORMED_RAY })).toBe(EDGE_IP)
  })

  it('true: trusts CF-Connecting-IP only next to a well-formed CF-Ray', () => {
    expect(clientIp({ TRUST_CLOUDFLARE_EDGE: 'true' }, { 'cf-ray': WELL_FORMED_RAY })).toBe(EDGE_IP)
    expect(clientIp({ TRUST_CLOUDFLARE_EDGE: ' TRUE ' }, { 'cf-ray': WELL_FORMED_RAY })).toBe(EDGE_IP)
    expect(clientIp({ TRUST_CLOUDFLARE_EDGE: 'true' })).toBe(PEER_IP)
  })

  it('false: ignores CF-Connecting-IP even next to a well-formed CF-Ray', () => {
    expect(clientIp({ TRUST_CLOUDFLARE_EDGE: 'false' }, { 'cf-ray': WELL_FORMED_RAY })).toBe(PEER_IP)
  })

  it.each([
    ['unset', {}],
    ['true', { TRUST_CLOUDFLARE_EDGE: 'true' }],
  ])('malformed CF-Ray (%s): falls back to the peer address', (_mode, env: NodeJS.ProcessEnv) => {
    expect(clientIp(env, { 'cf-ray': MALFORMED_RAY })).toBe(PEER_IP)
  })
})
