import { beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { authHeaders, ENABLED_FEATURES, nonAdminKeyResolver, testApiKeyResolver } from '../helpers/test-auth.js'
import { asDb, resetGatewayState, SAMPLE_ORG_ID, SAMPLE_SITE_ID, siteVerificationDb, type Row } from './fixtures.js'

function site(overrides: Row = {}): Row {
  return {
    id: SAMPLE_SITE_ID,
    orgId: SAMPLE_ORG_ID,
    domain: 'unproven.example.org',
    status: 'pending',
    dnsVerified: false,
    dnsVerificationToken: 'sm-verify-abc',
    ...overrides,
  }
}

async function patch(resolver: ReturnType<typeof testApiKeyResolver>, row: Row, payload: Row) {
  const app = await buildApp({ db: siteVerificationDb(row), apiKeyResolver: resolver, features: ENABLED_FEATURES })
  const res = await app.inject({ method: 'PATCH', url: `/v1/gateway/sites/${SAMPLE_SITE_ID}`, headers: authHeaders, payload })
  await app.close()
  return res
}

describe('a site becomes active only through DNS verification', () => {
  beforeEach(resetGatewayState)

  const tenant = () => nonAdminKeyResolver({ orgId: SAMPLE_ORG_ID })

  it('refuses a tenant key that activates a site whose DNS is not verified', async () => {
    const res = await patch(tenant(), site(), { status: 'active' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('dns_not_verified')
  })

  it('does not let the same request slip through bundled with other changes', async () => {
    const res = await patch(tenant(), site(), { status: 'active', maxRpm: 500 })
    expect(res.statusCode).toBe(409)
  })

  it('still lets a tenant suspend an unverified site and edit its policy', async () => {
    expect((await patch(tenant(), site(), { status: 'suspended' })).statusCode).toBe(200)
    expect((await patch(tenant(), site(), { maxRpm: 50 })).statusCode).toBe(200)
  })

  it('lets a tenant resume a site whose DNS was verified', async () => {
    const res = await patch(tenant(), site({ status: 'suspended', dnsVerified: true }), { status: 'active' })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('active')
  })

  it('leaves platform callers able to activate any site', async () => {
    const res = await patch(testApiKeyResolver({ orgId: SAMPLE_ORG_ID }), site(), { status: 'active' })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('active')
  })

  it('never writes the status when the activation is refused', async () => {
    let statusWrites = 0
    const row = site()
    const db = asDb({
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
      update: () => ({
        set: (values: Row) => {
          if ('status' in values) statusWrites += 1
          return { where: () => ({ returning: async () => [{ ...row, ...values }] }) }
        },
      }),
    })
    const app = await buildApp({ db, apiKeyResolver: tenant(), features: ENABLED_FEATURES })
    const res = await app.inject({ method: 'PATCH', url: `/v1/gateway/sites/${SAMPLE_SITE_ID}`, headers: authHeaders, payload: { status: 'active' } })
    await app.close()
    expect(res.statusCode).toBe(409)
    expect(statusWrites).toBe(0)
  })
})
