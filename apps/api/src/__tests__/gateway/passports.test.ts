import { beforeEach, describe, expect, it } from 'vitest'
import {
  getJwks,
  signPassportJwt,
  verifyPassportLocally,
  type PassportClaims,
} from '../../services/passport.js'
import { authHeaders } from '../helpers/test-auth.js'
import {
  asDb,
  buildGatewayApp,
  nowSeconds,
  passportClaims,
  passportIssuanceDb,
  resetGatewayState,
  SAMPLE_AGENT_ID,
  SAMPLE_ORG_ID,
  SAMPLE_SITE_ID,
  SUITE_NAME,
} from './fixtures.js'

describe(SUITE_NAME, () => {
  beforeEach(resetGatewayState)

  describe('Cryptographic Passport Authority (Ed25519)', () => {
    it('signs and creates valid 3-part EdDSA JWT passport with claims', () => {
      const token = signPassportJwt(passportClaims())
      const parts = token.split('.')
      expect(parts).toHaveLength(3)

      const header: { alg: string; typ: string } = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf8'),
      )
      expect(header.alg).toBe('EdDSA')
      expect(header.typ).toBe('JWT')
    })

    it('verifies passport signature locally and offline with public key', () => {
      const now = nowSeconds()
      const claims = passportClaims({
        aud: 'shop.online.com',
        jti: 'sm_pass_verify_test',
        iat: now,
        exp: now + 1800,
        agent_name: 'Buyer Bot',
        scopes: ['order:create'],
        trust_level: 'established',
        trust_score: 80,
        behavioral_score: 88,
      })

      const result = verifyPassportLocally(signPassportJwt(claims))

      expect(result.valid).toBe(true)
      expect(result.payload?.sub).toBe(SAMPLE_AGENT_ID)
      expect(result.payload?.aud).toBe('shop.online.com')
      expect(result.payload?.behavioral_score).toBe(88)
    })

    it('rejects expired passport token during local verification', () => {
      const pastTime = nowSeconds() - 100
      const claims = passportClaims({
        aud: 'expired.domain.com',
        jti: 'sm_pass_expired',
        iat: pastTime - 3600,
        exp: pastTime,
        agent_name: 'Late Agent',
        scopes: [],
        trust_level: 'emerging',
        trust_score: 60,
        behavioral_score: 70,
      })

      const result = verifyPassportLocally(signPassportJwt(claims))

      expect(result.valid).toBe(false)
      expect(result.error).toContain('expired')
    })

    it('detects tampered payload and fails cryptographic signature verification', () => {
      const claims = passportClaims({
        aud: 'secure.bank.com',
        jti: 'sm_pass_tamper',
        agent_name: 'Safe Agent',
        scopes: ['read:public'],
        trust_level: 'emerging',
        trust_score: 50,
        behavioral_score: 80,
      })

      const [headerB64, payloadB64, sigB64] = signPassportJwt(claims).split('.')

      // Attacker tries to modify claims to elevate scopes to root
      const parsedPayload: PassportClaims = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      )
      parsedPayload.scopes = ['admin:root', 'funds:drain']
      const tamperedPayloadB64 = Buffer.from(JSON.stringify(parsedPayload)).toString('base64url')

      const result = verifyPassportLocally(`${headerB64}.${tamperedPayloadB64}.${sigB64}`)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('signature')
    })

    it('exports standard JWKS with Ed25519 OKP key parameters', () => {
      const jwks = getJwks()
      expect(jwks.keys).toHaveLength(1)

      const key = jwks.keys[0]
      expect(key.kty).toBe('OKP')
      expect(key.crv).toBe('Ed25519')
      expect(key.alg).toBe('EdDSA')
      expect(key.use).toBe('sig')
      expect(typeof key.x).toBe('string')
    })
  })

  describe('Gateway API Endpoints', () => {
    it('POST /v1/gateway/passport rejects unauthenticated requests (401)', async () => {
      const app = await buildGatewayApp(asDb({}))

      const res = await app.inject({
        method: 'POST',
        url: '/v1/gateway/passport',
        payload: {
          agentId: SAMPLE_AGENT_ID,
          siteId: SAMPLE_SITE_ID,
        },
      })

      expect(res.statusCode).toBe(401)
      expect(res.json().error).toBe('unauthorized')
    })

    it('POST /v1/gateway/passport issues signed Ed25519 passport when authenticated', async () => {
      const mockAgent = {
        id: SAMPLE_AGENT_ID,
        orgId: SAMPLE_ORG_ID,
        name: 'Worker Agent',
        status: 'active',
      }
      const mockSite = {
        id: SAMPLE_SITE_ID,
        domain: 'target.platform.com',
        allowedScopes: ['read', 'write'],
        accessPolicy: 'open',
        passportTtlSeconds: 3600,
        status: 'active',
      }

      const app = await buildGatewayApp(passportIssuanceDb(mockSite, mockAgent))

      const res = await app.inject({
        method: 'POST',
        url: '/v1/gateway/passport',
        headers: authHeaders,
        payload: {
          agentId: SAMPLE_AGENT_ID,
          siteId: SAMPLE_SITE_ID,
          scopes: ['read'],
        },
      })

      expect(res.statusCode).toBe(201)
      const body = res.json()
      expect(body.token).toBeDefined()
      expect(body.claims.sub).toBe(SAMPLE_AGENT_ID)
      expect(body.claims.aud).toBe('target.platform.com')
      expect(body.claims.trust_level).toBe('established')
    })

    it('GET /v1/gateway/public-key returns Ed25519 JWK format', async () => {
      const app = await buildGatewayApp(asDb({}))

      const res = await app.inject({
        method: 'GET',
        url: '/v1/gateway/public-key',
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.kty).toBe('OKP')
      expect(body.crv).toBe('Ed25519')
      expect(body.alg).toBe('EdDSA')
    })

    it('GET /.well-known/stealthmark-keys.json returns JWKS collection', async () => {
      const app = await buildGatewayApp(asDb({}))

      const res = await app.inject({
        method: 'GET',
        url: '/.well-known/stealthmark-keys.json',
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.keys).toBeDefined()
      expect(Array.isArray(body.keys)).toBe(true)
      expect(body.keys[0].crv).toBe('Ed25519')
    })
  })
})
