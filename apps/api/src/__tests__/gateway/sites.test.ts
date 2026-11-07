import { beforeEach, describe, expect, it } from 'vitest'
import {
  normalizeDomain,
  registerSite,
  verifySiteDns,
} from '../../services/site-registration.js'
import { fakeTxtResolver } from '../helpers/fake-dns.js'
import { authHeaders } from '../helpers/test-auth.js'
import {
  asDb,
  buildGatewayApp,
  resetGatewayState,
  SAMPLE_ORG_ID,
  SAMPLE_SITE_ID,
  siteRegistrationDb,
  siteVerificationDb,
  SUITE_NAME,
} from './fixtures.js'

describe(SUITE_NAME, () => {
  beforeEach(resetGatewayState)

  describe('Site Registration & DNS Verification', () => {
    it('normalizes domains stripping http, https, ports and paths', () => {
      expect(normalizeDomain('https://api.example.com/v1/')).toBe('api.example.com')
      expect(normalizeDomain('http://SHOP.STORE.COM:8080/')).toBe('shop.store.com')
      expect(normalizeDomain('  docs.stealthmark.io  ')).toBe('docs.stealthmark.io')
    })

    it('registers a new site with pending status and DNS verification token', async () => {
      const result = await registerSite(siteRegistrationDb(), {
        orgId: SAMPLE_ORG_ID,
        domain: 'api.acme.org',
        displayName: 'Acme Catalog',
        description: 'Agentic endpoint',
        maxRpm: 150,
      })

      expect(result.site.domain).toBe('api.acme.org')
      expect(result.site.status).toBe('pending')
      expect(result.site.dnsVerified).toBe(false)
      expect(result.verification.recordType).toBe('TXT')
      expect(result.verification.host).toBe('_stealthmark-verify.api.acme.org')
      expect(result.verification.value).toMatch(/^sm-verify-[a-f0-9]+$/)
    })

    it('verifies site DNS TXT record when matching token is present', async () => {
      const mockSite = {
        id: SAMPLE_SITE_ID,
        domain: 'verify.example.org',
        dnsVerificationToken: 'sm-verify-testtoken123',
        dnsVerified: false,
        status: 'pending',
      }

      const resolveTxt = fakeTxtResolver({ '_stealthmark-verify.verify.example.org': ['sm-verify-testtoken123'] })

      const result = await verifySiteDns(siteVerificationDb(mockSite), SAMPLE_SITE_ID, { resolveTxt })
      expect(result.verified).toBe(true)
      expect(result.site.status).toBe('active')
      expect(result.site.dnsVerified).toBe(true)
    })

    it('rejects verification when DNS TXT token does not match', async () => {
      const mockSite = {
        id: SAMPLE_SITE_ID,
        domain: 'fake.example.org',
        dnsVerificationToken: 'sm-verify-correct',
        dnsVerified: false,
        status: 'pending',
      }

      const resolveTxt = fakeTxtResolver({ '_stealthmark-verify.fake.example.org': ['sm-verify-wrong'] })

      const result = await verifySiteDns(siteVerificationDb(mockSite), SAMPLE_SITE_ID, { resolveTxt })
      expect(result.verified).toBe(false)
      expect(result.error).toContain('does not match verification token')
    })

    it('reports the resolver failure code when the TXT lookup fails, without activating the site', async () => {
      const mockSite = {
        id: SAMPLE_SITE_ID,
        domain: 'nxdomain.example.org',
        dnsVerificationToken: 'sm-verify-correct',
        dnsVerified: false,
        status: 'pending',
      }

      const result = await verifySiteDns(siteVerificationDb(mockSite), SAMPLE_SITE_ID, {
        resolveTxt: fakeTxtResolver({}),
      })

      expect(result.verified).toBe(false)
      expect(result.error).toBe('DNS lookup failed for _stealthmark-verify.nxdomain.example.org: ENOTFOUND')
    })

    it('joins TXT chunks before comparing them with the verification token', async () => {
      const mockSite = {
        id: SAMPLE_SITE_ID,
        domain: 'chunked.example.org',
        dnsVerificationToken: 'sm-verify-abcdef',
        dnsVerified: false,
        status: 'pending',
      }

      const result = await verifySiteDns(siteVerificationDb(mockSite), SAMPLE_SITE_ID, {
        resolveTxt: async () => [['sm-verify-', 'abcdef']],
      })

      expect(result.verified).toBe(true)
    })
  })

  describe('Gateway API Endpoints', () => {
    it('POST /v1/gateway/sites rejects unauthenticated requests (401)', async () => {
      const app = await buildGatewayApp(asDb({}))

      const res = await app.inject({
        method: 'POST',
        url: '/v1/gateway/sites',
        payload: {
          orgId: SAMPLE_ORG_ID,
          domain: 'api.unauth.io',
          displayName: 'Unauth Site',
        },
      })

      expect(res.statusCode).toBe(401)
      expect(res.json().error).toBe('unauthorized')
    })

    it('POST /v1/gateway/sites registers site via API when authenticated', async () => {
      const app = await buildGatewayApp(siteRegistrationDb())

      const res = await app.inject({
        method: 'POST',
        url: '/v1/gateway/sites',
        headers: authHeaders,
        payload: {
          orgId: SAMPLE_ORG_ID,
          domain: 'api.hub.io',
          displayName: 'Hub Catalog',
          maxRpm: 120,
        },
      })

      expect(res.statusCode).toBe(201)
      const body = res.json()
      expect(body.site.domain).toBe('api.hub.io')
      expect(body.verification.host).toBe('_stealthmark-verify.api.hub.io')
    })
  })
})
