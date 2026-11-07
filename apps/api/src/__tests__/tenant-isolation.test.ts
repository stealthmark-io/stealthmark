import { describe, it, expect } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { DbClient } from '@stealthmark/db'
import { buildApp } from '../app.js'
import { authHeaders, ENABLED_FEATURES, nonAdminKeyResolver, testApiKeyResolver, TEST_ORG_ID } from './helpers/test-auth.js'

const FOREIGN_ORG_ID = '00000000-0000-4000-8000-000000000999'
const FOREIGN_ID = '00000000-0000-4000-8000-000000000123'

const dialect = new PgDialect()

type Rows = Record<string, unknown>[]
type Thenable<T> = { then: (resolve: (value: T) => unknown) => unknown }

interface RecordingDb {
  db: DbClient
  wheres: SQL[]
  inserts: Record<string, unknown>[]
}

/**
 * Drizzle stand-in that records every WHERE condition the handler builds and answers with a fixed row set.
 * The key-touch update done by the auth hook (lastUsedAt only) is not a handler query, so it is not recorded.
 */
function createRecordingDb(rows: Rows): RecordingDb {
  const wheres: SQL[] = []
  const inserts: Record<string, unknown>[] = []

  const result = () => ({
    limit: async () => rows,
    orderBy: async () => [] as Rows,
    returning: async () => rows,
    then: (resolve: (value: Rows) => unknown) => resolve(rows),
  })
  const record = (cond: SQL | undefined) => {
    if (cond) wheres.push(cond)
    return result()
  }
  const isAuthTouch = (data: Record<string, unknown>) =>
    Object.keys(data).length === 1 && 'lastUsedAt' in data

  const thenableRows: Thenable<Rows> = { then: (resolve) => resolve(rows) }

  const db = {
    select: () => ({ from: () => ({ where: record, ...thenableRows }) }),
    update: () => ({
      set: (data: Record<string, unknown>) => ({
        where: (cond: SQL | undefined) => (isAuthTouch(data) ? result() : record(cond)),
      }),
    }),
    delete: () => ({ where: record }),
    insert: () => ({
      values: (data: Record<string, unknown>) => {
        inserts.push(data)
        return { returning: async () => [{ ...data, id: FOREIGN_ID, createdAt: new Date() }] }
      },
    }),
  } as unknown as DbClient

  return { db, wheres, inserts }
}

function paramsOf(cond: SQL): unknown[] {
  return dialect.sqlToQuery(cond).params
}

const foreignRow: Record<string, unknown> = {
  id: FOREIGN_ID,
  orgId: FOREIGN_ORG_ID,
  name: 'Foreign',
  slug: 'foreign',
  plan: 'free',
  status: 'active',
  email: 'owner@foreign.example',
  role: 'member',
  keyPrefix: 'sk_live_forei...1234',
  scopes: ['extract'],
}

interface TenantRoute {
  label: string
  method: 'GET' | 'PATCH' | 'POST' | 'DELETE'
  url: string
  payload?: Record<string, unknown>
  adminStatus?: number
}

const CROSS_TENANT_ROUTES: TenantRoute[] = [
  { label: 'GET /v1/organizations/:id', method: 'GET', url: `/v1/organizations/${FOREIGN_ID}` },
  {
    label: 'PATCH /v1/organizations/:id',
    method: 'PATCH',
    url: `/v1/organizations/${FOREIGN_ID}`,
    payload: { name: 'Hijacked' },
  },
  { label: 'GET /v1/users/:id', method: 'GET', url: `/v1/users/${FOREIGN_ID}` },
  { label: 'DELETE /v1/users/:id', method: 'DELETE', url: `/v1/users/${FOREIGN_ID}` },
  { label: 'DELETE /v1/api-keys/:id', method: 'DELETE', url: `/v1/api-keys/${FOREIGN_ID}` },
  { label: 'GET /v1/agents/:id', method: 'GET', url: `/v1/agents/${FOREIGN_ID}` },
  {
    label: 'PATCH /v1/agents/:id',
    method: 'PATCH',
    url: `/v1/agents/${FOREIGN_ID}`,
    payload: { name: 'Hijacked' },
  },
  { label: 'POST /v1/agents/:id/suspend', method: 'POST', url: `/v1/agents/${FOREIGN_ID}/suspend` },
  { label: 'GET /v1/agents/:id/context', method: 'GET', url: `/v1/agents/${FOREIGN_ID}/context` },
  {
    label: 'POST /v1/agents/:id/context',
    method: 'POST',
    url: `/v1/agents/${FOREIGN_ID}/context`,
    payload: { org_id: TEST_ORG_ID, capability_id: FOREIGN_ID, preference_score: 0.5 },
  },
  {
    label: 'POST /v1/agents/:id/context/record',
    method: 'POST',
    url: `/v1/agents/${FOREIGN_ID}/context/record`,
    payload: { org_id: TEST_ORG_ID, capability_id: FOREIGN_ID, success: true },
    adminStatus: 201,
  },
]

describe('Sprint 0 — API key scope escalation', () => {
  async function createKey(
    resolver: ReturnType<typeof testApiKeyResolver>,
    payload: Record<string, unknown>,
  ) {
    const recording = createRecordingDb([])
    const app = await buildApp({ db: recording.db, apiKeyResolver: resolver })
    const res = await app.inject({ method: 'POST', url: '/v1/api-keys', headers: authHeaders, payload })
    await app.close()
    return { res, recording }
  }

  it.each([
    { scopes: ['*'] },
    { scopes: ['admin'] },
    { scopes: ['platform:admin'] },
    { scopes: ['extract', '*'] },
  ])(
    'refuses to let a non-admin key mint a key with scopes $scopes',
    async ({ scopes }) => {
      const { res, recording } = await createKey(nonAdminKeyResolver(), { name: 'Escalated', scopes })

      expect(res.statusCode).toBe(403)
      expect(recording.inserts).toHaveLength(0)
      expect(res.json()).not.toHaveProperty('key')
    },
  )

  it('lets a non-admin key mint a key with scopes it already has', async () => {
    const { res, recording } = await createKey(nonAdminKeyResolver(), { name: 'Same scope', scopes: ['extract'] })

    expect(res.statusCode).toBe(201)
    expect(res.json().scopes).toEqual(['extract'])
    expect(recording.inserts).toHaveLength(1)
    expect(recording.inserts[0]).toMatchObject({ orgId: TEST_ORG_ID, scopes: ['extract'] })
  })

  it('refuses a non-admin key minting a key for a foreign organization', async () => {
    const { res, recording } = await createKey(nonAdminKeyResolver(), {
      name: 'Foreign',
      scopes: ['extract'],
      orgId: FOREIGN_ORG_ID,
    })

    expect(res.statusCode).toBe(403)
    expect(recording.inserts).toHaveLength(0)
  })

  it.each([{ scopes: ['*'] }, { scopes: ['admin'] }, { scopes: ['extract', 'capabilities:read'] }])(
    'lets the admin key grant scopes $scopes',
    async ({ scopes }) => {
      const { res } = await createKey(testApiKeyResolver(), { name: 'Admin grant', scopes })

      expect(res.statusCode).toBe(201)
      expect(res.json().scopes).toEqual(scopes)
    },
  )
})

describe('Sprint 0 — cross-tenant access to by-id routes', () => {
  describe.each(CROSS_TENANT_ROUTES)('$label', (route) => {
    it('answers 404 for a foreign id and scopes every query to the caller organization', async () => {
      const recording = createRecordingDb([])
      const app = await buildApp({ db: recording.db, apiKeyResolver: nonAdminKeyResolver(), features: ENABLED_FEATURES })

      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: authHeaders,
        ...(route.payload ? { payload: route.payload } : {}),
      })
      await app.close()

      expect(res.statusCode).toBe(404)
      for (const cond of recording.wheres) {
        const params = paramsOf(cond)
        expect(params).toContain(FOREIGN_ID)
        expect(params).toContain(TEST_ORG_ID)
      }
    })

    it('reaches the row with the admin key', async () => {
      const recording = createRecordingDb([foreignRow])
      const app = await buildApp({ db: recording.db, apiKeyResolver: testApiKeyResolver(), features: ENABLED_FEATURES })

      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: authHeaders,
        ...(route.payload ? { payload: route.payload } : {}),
      })
      await app.close()

      expect(res.statusCode).toBe(route.adminStatus ?? 200)
      expect(recording.wheres.length).toBeGreaterThan(0)
    })
  })

  it.each([
    { label: 'GET /v1/organizations/:id/users', method: 'GET' as const, suffix: '/users', payload: undefined },
    {
      label: 'POST /v1/organizations/:id/users',
      method: 'POST' as const,
      suffix: '/users',
      payload: { email: 'intruder@example.com' },
    },
  ])('$label never serves a foreign organization to a non-admin key', async ({ method, suffix, payload }) => {
    const recording = createRecordingDb([])
    const app = await buildApp({ db: recording.db, apiKeyResolver: nonAdminKeyResolver() })

    const res = await app.inject({
      method,
      url: `/v1/organizations/${FOREIGN_ORG_ID}${suffix}`,
      headers: authHeaders,
      ...(payload ? { payload } : {}),
    })
    await app.close()

    expect([403, 404]).toContain(res.statusCode)
    expect(recording.inserts).toHaveLength(0)
  })

  it('still lets a non-admin key read its own organization and agent', async () => {
    const own = { ...foreignRow, id: TEST_ORG_ID, orgId: TEST_ORG_ID }
    const recording = createRecordingDb([own])
    const app = await buildApp({ db: recording.db, apiKeyResolver: nonAdminKeyResolver() })

    const org = await app.inject({ method: 'GET', url: `/v1/organizations/${TEST_ORG_ID}`, headers: authHeaders })
    const agent = await app.inject({ method: 'GET', url: `/v1/agents/${TEST_ORG_ID}`, headers: authHeaders })
    await app.close()

    expect(org.statusCode).toBe(200)
    expect(agent.statusCode).toBe(200)
  })
})

describe('Sprint 0 — organization plan escalation', () => {
  const ownOrg: Record<string, unknown> = { ...foreignRow, id: TEST_ORG_ID, orgId: TEST_ORG_ID, plan: 'enterprise' }

  async function patchOwnOrg(resolver: ReturnType<typeof testApiKeyResolver>, payload: Record<string, unknown>) {
    const recording = createRecordingDb([ownOrg])
    const app = await buildApp({ db: recording.db, apiKeyResolver: resolver })
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${TEST_ORG_ID}`,
      headers: authHeaders,
      payload,
    })
    await app.close()
    return res
  }

  it('refuses an ordinary key changing the plan of its own organization', async () => {
    const res = await patchOwnOrg(nonAdminKeyResolver(), { plan: 'enterprise' })
    expect(res.statusCode).toBe(403)
  })

  it('refuses an ordinary key combining a plan change with other edits', async () => {
    const res = await patchOwnOrg(nonAdminKeyResolver(), { name: 'Renamed', plan: 'growth' })
    expect(res.statusCode).toBe(403)
  })

  it('lets the admin key change the plan', async () => {
    const res = await patchOwnOrg(testApiKeyResolver(), { plan: 'enterprise' })
    expect(res.statusCode).toBe(200)
    expect(res.json().plan).toBe('enterprise')
  })

  it('still lets an ordinary key rename its own organization', async () => {
    const res = await patchOwnOrg(nonAdminKeyResolver(), { name: 'Renamed' })
    expect(res.statusCode).toBe(200)
  })
})
