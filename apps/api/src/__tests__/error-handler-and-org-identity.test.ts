import { describe, it, expect } from 'vitest'
import { buildApp } from '../app.js'
import { config } from '../config.js'
import type { DbClient } from '@stealthmark/db'
import { authHeaders, testApiKeyResolver, testApiKeyRecord, TEST_ORG_ID } from './helpers/test-auth.js'
import { isAuthorizedForOrg, orgScope } from '../lib/org-context.js'
import { agents } from '@stealthmark/db'
import type { FastifyRequest } from 'fastify'

const FOREIGN_ORG_ID = '00000000-0000-0000-0000-000000000000'

function throwingDb(message: string) {
  return {
    select: () => ({
      from: () => ({
        where: () => {
          throw new Error(message)
        },
      }),
    }),
  } as unknown as DbClient
}

function insertingDb() {
  return {
    insert: () => ({
      values: (data: Record<string, unknown>) => ({
        returning: async () => [{ ...data, id: TEST_ORG_ID, createdAt: new Date() }],
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [] }),
      }),
    }),
  } as unknown as DbClient
}

describe('Sprint 0 — organization scoping helpers', () => {
  const asRequest = (overrides: Partial<FastifyRequest>) => ({ orgId: TEST_ORG_ID, ...overrides }) as FastifyRequest

  it('denies resources without an organization to ordinary keys and allows platform callers', () => {
    const ordinary = asRequest({ apiKey: testApiKeyRecord({ scopes: ['extract'] }) })
    const admin = asRequest({ apiKey: testApiKeyRecord({ scopes: ['admin'] }) })
    expect(isAuthorizedForOrg(ordinary, null)).toBe(false)
    expect(isAuthorizedForOrg(ordinary, FOREIGN_ORG_ID)).toBe(false)
    expect(isAuthorizedForOrg(ordinary, TEST_ORG_ID)).toBe(true)
    expect(isAuthorizedForOrg(admin, null)).toBe(true)
    expect(isAuthorizedForOrg(asRequest({ orgId: undefined, internalCaller: true }), FOREIGN_ORG_ID)).toBe(true)
  })

  it('scopes by-id lookups to the caller organization unless the key is platform-level', () => {
    const ordinary = asRequest({ apiKey: testApiKeyRecord({ scopes: ['extract'] }) })
    const admin = asRequest({ apiKey: testApiKeyRecord({ scopes: ['platform:admin'] }) })
    expect(orgScope(ordinary, agents.orgId)).toBeDefined()
    expect(orgScope(admin, agents.orgId)).toBeUndefined()
  })
})

describe('Sprint 0 — error handler and organization identity', () => {
  it('never exposes driver or query details on server errors', async () => {
    const app = await buildApp({
      db: throwingDb('Failed query: select "id" from "agents" where "agents"."org_id" = $1 params: abc'),
      apiKeyResolver: testApiKeyResolver(),
    })
    const res = await app.inject({ method: 'GET', url: '/v1/agents', headers: authHeaders })

    expect(res.statusCode).toBe(500)
    const body = res.json()
    expect(body.error).toBe('internal_error')
    expect(typeof body.requestId).toBe('string')
    expect(JSON.stringify(body)).not.toMatch(/select|agents|params|Failed query/i)
  })

  it('rejects unauthenticated /v1 requests even when orgId is supplied', async () => {
    const app = await buildApp({ db: insertingDb(), apiKeyResolver: testApiKeyResolver() })
    const res = await app.inject({ method: 'GET', url: `/v1/agents?orgId=${FOREIGN_ORG_ID}` })
    expect(res.statusCode).toBe(401)
  })

  it('refuses a foreign orgId for keys without an admin scope', async () => {
    const app = await buildApp({
      db: insertingDb(),
      apiKeyResolver: testApiKeyResolver({ scopes: ['extract'] }),
    })
    const res = await app.inject({
      method: 'GET',
      url: `/v1/agents?orgId=${FOREIGN_ORG_ID}`,
      headers: authHeaders,
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('forbidden')
  })

  it('accepts the internal secret only on bootstrap routes', async () => {
    const app = await buildApp({ db: insertingDb(), apiKeyResolver: testApiKeyResolver() })
    const secret = { 'x-internal-secret': config.INTERNAL_AUTH_SECRET }

    const created = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: secret,
      payload: { name: 'Bootstrap Org', slug: 'bootstrap-org' },
    })
    expect(created.statusCode).toBe(201)

    const denied = await app.inject({ method: 'GET', url: '/v1/agents', headers: secret })
    expect(denied.statusCode).toBe(401)
  })

  it('keeps public v1 metadata reachable without credentials', async () => {
    const app = await buildApp({ db: insertingDb(), apiKeyResolver: testApiKeyResolver() })
    expect((await app.inject({ method: 'GET', url: '/v1/openapi.json' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/v1' })).statusCode).toBe(200)
  })
})
