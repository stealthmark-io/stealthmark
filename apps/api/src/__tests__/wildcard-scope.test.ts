import type { FastifyRequest } from 'fastify'
import { describe, expect, it } from 'vitest'
import { agents, type DbClient } from '@stealthmark/db'
import { buildApp } from '../app.js'
import { canGrantScopes, hasAdminScope, isAuthorizedForOrg, isPlatformCaller, orgScope } from '../lib/org-context.js'
import { authHeaders, TEST_ORG_ID, testApiKeyRecord, testApiKeyResolver } from './helpers/test-auth.js'

const FOREIGN_ORG_ID = '00000000-0000-4000-8000-000000000999'

const asRequest = (scopes: string[]) =>
  ({ orgId: TEST_ORG_ID, apiKey: testApiKeyRecord({ scopes }) }) as FastifyRequest

describe("the '*' scope stays inside its own organization", () => {
  it("is not a platform scope: console-minted keys carry '*'", () => {
    const wildcard = asRequest(['*'])
    expect(hasAdminScope(wildcard)).toBe(false)
    expect(isPlatformCaller(wildcard)).toBe(false)
    expect(isAuthorizedForOrg(wildcard, FOREIGN_ORG_ID)).toBe(false)
    expect(isAuthorizedForOrg(wildcard, null)).toBe(false)
    expect(isAuthorizedForOrg(wildcard, TEST_ORG_ID)).toBe(true)
    expect(orgScope(wildcard, agents.orgId)).toBeDefined()
  })

  it.each([['admin'], ['platform:admin']])("keeps '%s' as the platform scope", (scope) => {
    const platform = asRequest([scope])
    expect(isPlatformCaller(platform)).toBe(true)
    expect(isAuthorizedForOrg(platform, FOREIGN_ORG_ID)).toBe(true)
  })

  it("lets a '*' holder grant ordinary scopes but never a platform scope", () => {
    const wildcard = asRequest(['*'])
    expect(canGrantScopes(wildcard, ['usage:ingest', 'gateway:invoke', '*'])).toBe(true)
    expect(canGrantScopes(wildcard, ['admin'])).toBe(false)
    expect(canGrantScopes(wildcard, ['platform:admin'])).toBe(false)
    expect(canGrantScopes(asRequest(['platform:admin']), ['admin'])).toBe(true)
  })

  it("refuses a '*' key that tries to change another organization's plan", async () => {
    const app = await buildApp({
      db: {} as DbClient,
      apiKeyResolver: testApiKeyResolver({ scopes: ['*'] }),
    })
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${FOREIGN_ORG_ID}`,
      headers: authHeaders,
      payload: { plan: 'enterprise' },
    })
    await app.close()
    expect([403, 404]).toContain(res.statusCode)
  })
})
