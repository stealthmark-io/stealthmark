import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest'
import { getTableName, type SQL, type Table } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/pg-proxy'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'
import { asDb, buildGatewayApp, SAMPLE_ORG_ID, SAMPLE_SITE_ID, type Row } from './gateway/fixtures.js'
import { authHeaders, ENABLED_FEATURES, TEST_ORG_ID, testApiKeyResolver } from './helpers/test-auth.js'

const AGENT_ID = '3f2c8a1e-6b4d-4e7f-9a0b-1c2d3e4f5a6b'
const ACTION_ID = '4a5b6c7d-8e9f-4a0b-8c1d-2e3f4a5b6c7d'
const VALID_ID = '6f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f'
const MALFORMED_ID = 'not-a-uuid'
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const dialect = new PgDialect()

/** Fails the way Postgres does (SQLSTATE 22P02) when a uuid parameter is not a uuid. */
function rejectMalformedUuids(params: unknown[], typings: unknown[]): void {
  const invalid = params.find((value, i) => typings[i] === 'uuid' && !UUID_TEXT.test(String(value)))
  if (invalid !== undefined) {
    throw Object.assign(new Error(`invalid input syntax for type uuid: "${String(invalid)}"`), { code: '22P02' })
  }
}

interface Lookup {
  table: string
  where: string
}

/**
 * Stand-in for `select().from().where().limit()` that fails like Postgres on a malformed uuid; every other lookup
 * gets the rows `rowsFor` returns.
 */
function postgresLikeDb(rowsFor: (lookup: Lookup) => Row[] = () => []) {
  const lookups: Lookup[] = []
  const db = asDb({
    select: () => ({
      from: (table: Table) => ({
        where: (condition: SQL) => ({
          limit: async () => {
            const { sql, params, typings = [] } = dialect.sqlToQuery(condition)
            const lookup = { table: getTableName(table), where: sql }
            lookups.push(lookup)
            rejectMalformedUuids(params, typings)
            return rowsFor(lookup)
          },
        }),
      }),
    }),
  })
  return { db, lookups }
}

/** Drizzle's own query building over a driver that answers no rows and fails like Postgres on a malformed uuid. */
function noRowsPostgresDb() {
  const queries: string[] = []
  const db = asDb(
    drizzle(async (sql, params, _method, typings = []) => {
      queries.push(sql)
      rejectMalformedUuids(params, typings)
      return { rows: [] }
    }),
  )
  return { db, queries }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** Every route with a uuid path param. `param` is the one sent malformed (default `id`); any other gets a valid uuid. */
const uuidParamRoutes: Array<{ method: Method; path: string; param?: string }> = [
  { method: 'DELETE', path: '/v1/api-keys/:id' },
  { method: 'GET', path: '/v1/organizations/:id' },
  { method: 'PATCH', path: '/v1/organizations/:id' },
  { method: 'GET', path: '/v1/organizations/:id/users' },
  { method: 'POST', path: '/v1/organizations/:id/users' },
  { method: 'GET', path: '/v1/users/:id' },
  { method: 'DELETE', path: '/v1/users/:id' },
  { method: 'GET', path: '/v1/agents/:id' },
  { method: 'PATCH', path: '/v1/agents/:id' },
  { method: 'POST', path: '/v1/agents/:id/suspend' },
  { method: 'GET', path: '/v1/agents/:id/context' },
  { method: 'POST', path: '/v1/agents/:id/context' },
  { method: 'POST', path: '/v1/agents/:id/context/record' },
  { method: 'GET', path: '/v1/capabilities/:id' },
  { method: 'PATCH', path: '/v1/capabilities/:id' },
  { method: 'GET', path: '/v1/capabilities/:id/trust' },
  { method: 'POST', path: '/v1/capabilities/:id/verify' },
  { method: 'GET', path: '/v1/capabilities/:id/badges' },
  { method: 'POST', path: '/v1/capabilities/:id/badges/evaluate' },
  { method: 'GET', path: '/v1/capabilities/:id/evaluation' },
  { method: 'POST', path: '/v1/capabilities/:id/evaluate' },
  { method: 'GET', path: '/v1/capabilities/:id/reviews' },
  { method: 'POST', path: '/v1/capabilities/:id/reviews' },
  { method: 'PATCH', path: '/v1/publisher/capabilities/:id' },
  { method: 'GET', path: '/v1/tasks/:id' },
  { method: 'GET', path: '/v1/tasks/:id/trace' },
  { method: 'POST', path: '/v1/tasks/:id/cancel' },
  { method: 'GET', path: '/v1/commerce/negotiate/:id' },
  { method: 'POST', path: '/v1/commerce/negotiate/:id/counter' },
  { method: 'POST', path: '/v1/commerce/negotiate/:id/accept' },
  { method: 'POST', path: '/v1/commerce/negotiate/:id/reject' },
  { method: 'GET', path: '/v1/commerce/contracts/:id' },
  { method: 'POST', path: '/v1/commerce/contracts/:id/sign' },
  { method: 'GET', path: '/v1/commerce/escrow/:id' },
  { method: 'POST', path: '/v1/commerce/escrow/:id/submit' },
  { method: 'POST', path: '/v1/commerce/escrow/:id/release' },
  { method: 'POST', path: '/v1/commerce/escrow/:id/dispute' },
  { method: 'POST', path: '/v1/commerce/escrow/:id/refund' },
  { method: 'POST', path: '/v1/enterprise/kill-switch/:id/disarm' },
  { method: 'GET', path: '/v1/gateway/sites/:id' },
  { method: 'PATCH', path: '/v1/gateway/sites/:id' },
  { method: 'DELETE', path: '/v1/gateway/sites/:id' },
  { method: 'POST', path: '/v1/gateway/sites/:id/verify' },
  { method: 'POST', path: '/v1/gateway/sites/:id/access' },
  { method: 'GET', path: '/v1/gateway/sites/:id/events' },
  { method: 'GET', path: '/v1/gateway/sites/:id/events/verify' },
  { method: 'GET', path: '/v1/gateway/sites/:id/analytics' },
  { method: 'GET', path: '/v1/gateway/sites/:id/agent-manifest' },
  { method: 'GET', path: '/v1/gateway/sites/:id/actions' },
  { method: 'POST', path: '/v1/gateway/sites/:id/actions' },
  { method: 'GET', path: '/v1/gateway/sites/:id/actions/:slugOrId' },
  { method: 'PUT', path: '/v1/gateway/sites/:id/actions/:actionId' },
  { method: 'PUT', path: '/v1/gateway/sites/:id/actions/:actionId', param: 'actionId' },
  { method: 'DELETE', path: '/v1/gateway/sites/:id/actions/:actionId' },
  { method: 'DELETE', path: '/v1/gateway/sites/:id/actions/:actionId', param: 'actionId' },
  { method: 'GET', path: '/v1/gateway/agents/:id/behavioral' },
  { method: 'POST', path: '/v1/gateway/agents/:id/behavioral/reset' },
  { method: 'GET', path: '/v1/gateway/passport/:id' },
  { method: 'POST', path: '/v1/gateway/passport/:id/revoke' },
]

const site: Row = { id: SAMPLE_SITE_ID, orgId: SAMPLE_ORG_ID, domain: 'shop.example.com', status: 'active' }
const action: Row = { id: ACTION_ID, siteId: SAMPLE_SITE_ID, actionSlug: 'add_to_cart', displayName: 'Add to cart' }

const isSlugLookup = (where: string) => where.includes('"action_slug"')

/** The site exists and is owned by the caller; action lookups answer with `actionsFor`. */
function siteDb(actionsFor: (where: string) => Row[] = () => []) {
  return postgresLikeDb(({ table, where }) => (table === 'registered_sites' ? [site] : actionsFor(where)))
}

describe('Malformed path input answers 4xx instead of 500', () => {
  let app: FastifyInstance | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  describe('uuid path params', () => {
    const { db, queries } = noRowsPostgresDb()
    let tableApp: FastifyInstance

    beforeAll(async () => {
      // `admin` lets the two admin-only routes reach their handler.
      const apiKeyResolver = testApiKeyResolver({ scopes: ['platform:admin', 'admin'] })
      tableApp = await buildApp({ db, apiKeyResolver, features: ENABLED_FEATURES })
    })

    afterAll(async () => {
      await tableApp.close()
    })

    for (const { method, path, param = 'id' } of uuidParamRoutes) {
      it(`${method} ${path} answers 400 validation_error for a malformed :${param}, without querying`, async () => {
        queries.length = 0
        const url = path.replace(/:(\w+)/g, (_match, name: string) => (name === param ? MALFORMED_ID : VALID_ID))

        const res = await tableApp.inject({ method, url, headers: authHeaders })

        expect(res.statusCode).toBe(400)
        expect(res.json()).toMatchObject({
          error: 'validation_error',
          details: { fieldErrors: { [param]: expect.any(Array) } },
        })
        expect(queries).toEqual([])
      })
    }
  })

  describe('GET /v1/agents/:id', () => {
    it('still returns the agent for a UUID id', async () => {
      const agent: Row = { id: AGENT_ID, orgId: TEST_ORG_ID, name: 'Scout Agent', status: 'active' }
      const { db } = postgresLikeDb(({ table }) => (table === 'agents' ? [agent] : []))
      app = await buildApp({ db, apiKeyResolver: testApiKeyResolver() })

      const res = await app.inject({ method: 'GET', url: `/v1/agents/${AGENT_ID}`, headers: authHeaders })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ id: AGENT_ID })
    })
  })

  describe('GET /v1/gateway/manifest/:domain', () => {
    it('answers 400 for a domain too short to be valid, without querying', async () => {
      const { db, lookups } = postgresLikeDb()
      app = await buildGatewayApp(db)

      const res = await app.inject({ method: 'GET', url: '/v1/gateway/manifest/ab', headers: authHeaders })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'bad_request', message: 'Invalid domain name' })
      expect(lookups).toEqual([])
    })

    it('still answers 404 not_found for a valid domain that is not registered', async () => {
      const { db } = postgresLikeDb()
      app = await buildGatewayApp(db)

      const res = await app.inject({ method: 'GET', url: '/v1/gateway/manifest/unknown.example.com', headers: authHeaders })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: 'not_found' })
    })
  })

  describe('GET /v1/gateway/sites/:id/actions/:slugOrId', () => {
    it('answers 404 not_found for an unknown slug without looking it up as an action id', async () => {
      const { db, lookups } = siteDb()
      app = await buildGatewayApp(db)

      const res = await app.inject({
        method: 'GET',
        url: `/v1/gateway/sites/${SAMPLE_SITE_ID}/actions/missing-slug`,
        headers: authHeaders,
      })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: 'not_found' })
      expect(lookups.map((lookup) => lookup.table)).toEqual(['registered_sites', 'action_schemas'])
    })

    it('finds an action by its slug', async () => {
      const { db } = siteDb((where) => (isSlugLookup(where) ? [action] : []))
      app = await buildGatewayApp(db)

      const res = await app.inject({
        method: 'GET',
        url: `/v1/gateway/sites/${SAMPLE_SITE_ID}/actions/add_to_cart`,
        headers: authHeaders,
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ id: ACTION_ID })
    })

    it('falls back to the action id when no slug matches', async () => {
      const { db } = siteDb((where) => (isSlugLookup(where) ? [] : [action]))
      app = await buildGatewayApp(db)

      const res = await app.inject({
        method: 'GET',
        url: `/v1/gateway/sites/${SAMPLE_SITE_ID}/actions/${ACTION_ID}`,
        headers: authHeaders,
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ id: ACTION_ID })
    })
  })
})
