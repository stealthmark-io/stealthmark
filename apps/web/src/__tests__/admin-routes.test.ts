import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

interface Call {
  table: string
  method: string
  args: unknown[]
}
interface Result {
  data: unknown
  error: { message: string } | null
}

const state = vi.hoisted(() => ({ client: null as unknown, canView: false }))

vi.mock('../lib/supabase/admin', () => ({ createSupabaseAdminClient: () => state.client }))
vi.mock('../lib/supabase/server', () => ({ createSupabaseServerClient: async () => null }))

import { GET as getOrganizations } from '../app/api/admin/organizations/route'
import { GET as getMetrics } from '../app/api/admin/metrics/route'
import { POST as postOverride } from '../app/api/admin/override-plan/route'
import { canViewAdminPages } from '../lib/admin-auth'

const ADMIN_KEY = 'test-admin-key-0123456789'
const ORG_A = '0b6a6f2e-4f7c-4d63-9d2a-3a1f9d2f7c11'
const ORG_B = '1c7b7f3f-5a8d-4e74-8e3b-4b2a0e3a8d22'

function fakeSupabase(resolve: (table: string, methods: string[], calls: Call[]) => Result) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const methods: string[] = []
      const builder: object = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === 'then') return (done: (value: Result) => void) => done(resolve(table, methods, calls))
            return (...args: unknown[]) => {
              methods.push(prop)
              calls.push({ table, method: prop, args })
              return builder
            }
          },
        },
      )
      return builder
    },
  }
  return { client, calls }
}

const withKey = { 'x-admin-key': ADMIN_KEY }
const get = (path: string, headers: Record<string, string> = withKey) => new NextRequest(`https://stealthmark.io${path}`, { headers })
const post = (path: string, body: unknown, headers: Record<string, string> = withKey) =>
  new NextRequest(`https://stealthmark.io${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

beforeEach(() => {
  vi.stubEnv('ADMIN_SECRET_KEY', ADMIN_KEY)
  state.client = null
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('admin authorization', () => {
  it('refuses callers without the founder session or the admin key, and never trusts a localhost Host header', async () => {
    const spoofed = { host: 'localhost:3000' }
    for (const res of [await getOrganizations(get('/api/admin/organizations', spoofed)), await getMetrics(get('/api/admin/metrics', spoofed))]) {
      expect(res.status).toBe(401)
    }
    expect((await getOrganizations(get('/api/admin/organizations', { 'x-admin-key': 'wrong-key-0123456789ab' }))).status).toBe(401)
    expect((await getOrganizations(get('/api/admin/organizations', { 'x-admin-key': '' }))).status).toBe(401)
  })

  it('shows the admin pages to nobody in production without a founder session', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(await canViewAdminPages()).toBe(false)
  })

  it('shows the admin pages on a developer machine', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(await canViewAdminPages()).toBe(true)
  })
})

describe('GET /api/admin/organizations', () => {
  it('lists real rows with their owner and invents no traffic figures', async () => {
    const fake = fakeSupabase((table) =>
      table === 'organizations'
        ? {
            data: [
              { id: ORG_A, name: 'Acme', slug: 'acme-1', domain: 'acme.example', plan: 'free', status: 'active', created_at: '2026-10-01T00:00:00Z', updated_at: null },
              { id: ORG_B, name: null, slug: 'ghost-2', domain: null, plan: null, status: null, created_at: '2026-10-02T00:00:00Z', updated_at: null },
            ],
            error: null,
          }
        : { data: [{ org_id: ORG_A, email: 'owner@acme.example' }], error: null },
    )
    state.client = fake.client

    const res = await getOrganizations(get('/api/admin/organizations'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.organizations).toHaveLength(2)
    expect(body.organizations[0]).toMatchObject({ id: ORG_A, ownerEmail: 'owner@acme.example', domain: 'acme.example', plan: 'free' })
    expect(body.organizations[1]).toMatchObject({ id: ORG_B, name: 'ghost-2', ownerEmail: null, domain: null, plan: 'free', status: 'active' })
    for (const org of body.organizations) {
      expect(org).not.toHaveProperty('requestsCount')
      expect(org).not.toHaveProperty('threatsBlocked')
      expect(org).not.toHaveProperty('billingEmail')
    }
    expect(fake.calls.find((c) => c.table === 'organizations' && c.method === 'select')?.args[0]).not.toContain('billing_email')
  })

  it('answers an empty list, not sample organizations, when the table is empty', async () => {
    state.client = fakeSupabase(() => ({ data: [], error: null })).client
    const body = await (await getOrganizations(get('/api/admin/organizations'))).json()
    expect(body).toEqual({ success: true, organizations: [] })
  })

  it('answers 502 instead of sample organizations when the query fails', async () => {
    state.client = fakeSupabase(() => ({ data: null, error: { message: 'column does not exist' } })).client
    const res = await getOrganizations(get('/api/admin/organizations'))
    const body = await res.json()
    expect(res.status).toBe(502)
    expect(body.organizations).toEqual([])
    expect(JSON.stringify(body)).not.toContain('column does not exist')
  })
})

describe('GET /api/admin/metrics plan distribution', () => {
  it('counts free, legacy developer and unset plans together so the distribution sums to the total', async () => {
    const fake = fakeSupabase((table, methods) =>
      table === 'organizations'
        ? { data: [{ plan: 'free' }, { plan: 'developer' }, { plan: null }, { plan: 'enterprise' }, { plan: 'pro' }, { plan: 'starter' }], error: null }
        : { data: null, error: null, ...(methods.includes('select') ? { count: 3 } : {}) } as Result,
    )
    state.client = fake.client
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const body = await (await getMetrics(get('/api/admin/metrics'))).json()
    const { planDistribution, totalOrganizations } = body.kpis
    expect(totalOrganizations).toBe(6)
    expect(Object.values<number>(planDistribution).reduce((a, b) => a + b, 0)).toBe(6)
    expect(planDistribution).toMatchObject({ developer: 4, pro: 1, business: 0, enterprise: 1 })
    vi.unstubAllGlobals()
  })
})

describe('POST /api/admin/override-plan', () => {
  const override = (body: unknown, headers?: Record<string, string>) => postOverride(post('/api/admin/override-plan', body, headers))

  it.each(['pro', 'business', 'developer', 'gold', ''])('refuses the plan %j', async (planTier) => {
    state.client = fakeSupabase(() => ({ data: [{ id: ORG_A }], error: null })).client
    const res = await override({ organizationId: ORG_A, planTier })
    expect(res.status).toBe(400)
  })

  it.each([['org-1'], ['1 or 1=1'], [''], [42]])('refuses organizationId %j', async (organizationId) => {
    state.client = fakeSupabase(() => ({ data: [{ id: ORG_A }], error: null })).client
    expect((await override({ organizationId, planTier: 'free' })).status).toBe(400)
  })

  it('reports success only when exactly the targeted row was updated', async () => {
    const fake = fakeSupabase(() => ({ data: [{ id: ORG_A }], error: null }))
    state.client = fake.client
    const res = await override({ organizationId: ORG_A, planTier: 'Enterprise' })
    expect(res.status).toBe(200)
    expect((await res.json()).newPlanTier).toBe('enterprise')
    expect(fake.calls.find((c) => c.method === 'update')?.args[0]).toMatchObject({ plan: 'enterprise' })
    expect(fake.calls.find((c) => c.method === 'eq')?.args).toEqual(['id', ORG_A])
    expect(fake.calls.some((c) => c.table === 'users')).toBe(false)
  })

  it('answers 404 when no organization matched', async () => {
    state.client = fakeSupabase(() => ({ data: [], error: null })).client
    const res = await override({ organizationId: ORG_A, planTier: 'free' })
    expect(res.status).toBe(404)
    expect((await res.json()).success).toBeUndefined()
  })

  it('answers 502 when the database rejects the update', async () => {
    state.client = fakeSupabase(() => ({ data: null, error: { message: 'permission denied for table organizations' } })).client
    const res = await override({ organizationId: ORG_A, planTier: 'free' })
    expect(res.status).toBe(502)
    expect(JSON.stringify(await res.json())).not.toContain('permission denied')
  })

  it('answers 503 when the database is not configured', async () => {
    state.client = null
    expect((await override({ organizationId: ORG_A, planTier: 'free' })).status).toBe(503)
  })

  it('refuses callers without admin rights before touching the database', async () => {
    const fake = fakeSupabase(() => ({ data: [{ id: ORG_A }], error: null }))
    state.client = fake.client
    expect((await override({ organizationId: ORG_A, planTier: 'free' }, {})).status).toBe(401)
    expect(fake.calls).toHaveLength(0)
  })
})
