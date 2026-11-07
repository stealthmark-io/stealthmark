import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as eventsGet } from '../app/api/telemetry/events/route';
import { GET as metricsGet } from '../app/api/telemetry/metrics/route';
import { POST as pingPost, GET as pingGet } from '../app/api/telemetry/ping/route';
import { GATEWAY_FIXTURES, installGatewayFetchMock } from './helpers/gateway-mock';
import type { GatewayFetchMock } from './helpers/gateway-mock';

interface QueryResult {
  data: unknown;
  count?: number | null;
  error: { message: string; code?: string } | null;
}

interface Call {
  table: string;
  method: string;
  args: unknown[];
}

type Resolver = (table: string, calls: Call[]) => QueryResult;

const state = vi.hoisted(() => ({
  client: null as unknown,
  session: null as { user: { id: string; orgId: string; email: string }; orgId: string } | null,
  admin: false,
}));

vi.mock('../lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => state.client,
}));
vi.mock('../lib/session', () => ({
  getOrgSession: async () => state.session,
}));
vi.mock('../lib/admin-auth', () => ({
  isAuthorizedAdmin: async () => state.admin,
}));

const ORG_ID = '22222222-2222-4222-8222-222222222222';

function createFakeSupabase(resolver: Resolver) {
  const all: Call[] = [];
  const client = {
    from(table: string) {
      const own: Call[] = [];
      const builder: object = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === 'then') {
              return (resolve: (value: QueryResult) => void) => resolve(resolver(table, own));
            }
            return (...args: unknown[]) => {
              const call = { table, method: prop, args };
              own.push(call);
              all.push(call);
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  return { client, all };
}

function orgScoped(calls: Call[]): boolean {
  return calls.some((c) => c.method === 'eq' && c.args[0] === 'org_id' && c.args[1] === ORG_ID);
}

function isHead(calls: Call[]): boolean {
  const select = calls.find((c) => c.method === 'select');
  const options = select?.args[1] as { head?: boolean } | undefined;
  return options?.head === true;
}

const USAGE_ROW = {
  id: '33333333-3333-4333-8333-333333333333',
  created_at: '2026-09-30T12:00:00.000Z',
  event_type: 'agent_request',
  units: 1,
  agent_identifier: 'GPTBot',
  source: 'middleware',
  site_id: null,
  metadata: { path: '/pricing', method: 'GET', host: 'acme.io' },
};

function usageResolver(rows: unknown[], counts: { total: number; blocked: number }): Resolver {
  return (_table, calls) => {
    if (isHead(calls)) {
      const blocked = calls.some((c) => c.method === 'eq' && c.args[0] === 'event_type');
      return { data: null, count: blocked ? counts.blocked : counts.total, error: null };
    }
    return { data: rows, error: null };
  };
}

function requestFor(path: string): NextRequest {
  return new NextRequest(`https://stealthmark.io${path}`);
}

describe('Telemetry routes require a session and scope rows by organization', () => {
  let gateway: GatewayFetchMock;

  beforeEach(() => {
    gateway = installGatewayFetchMock();
    state.client = null;
    state.session = { user: { id: 'user-1', orgId: ORG_ID, email: 'dev@acme.io' }, orgId: ORG_ID };
    state.admin = false;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    state.client = null;
    state.session = null;
    state.admin = false;
  });

  describe('without a session', () => {
    it('returns 401 from events, metrics and ping without touching the database or the gateway', async () => {
      state.session = null;
      state.admin = true;
      const fake = createFakeSupabase(usageResolver([USAGE_ROW], { total: 1, blocked: 0 }));
      state.client = fake.client;

      const events = await eventsGet(requestFor('/api/telemetry/events'));
      const metrics = await metricsGet(requestFor('/api/telemetry/metrics'));
      const post = await pingPost(new Request('https://stealthmark.io/api/telemetry/ping', { method: 'POST' }));
      const get = await pingGet();

      expect([events.status, metrics.status, post.status, get.status]).toEqual([401, 401, 401, 401]);
      expect(await events.json()).toEqual({ error: 'unauthorized' });
      expect(fake.all).toEqual([]);
      expect(gateway.calls).toEqual([]);
      expect(gateway.strayCalls).toEqual([]);
    });
  });

  describe('GET /api/telemetry/events', () => {
    it('reads usage_records for a non-admin, limited to its own organization, and never reads gateway memory', async () => {
      const fake = createFakeSupabase(usageResolver([USAGE_ROW], { total: 1, blocked: 0 }));
      state.client = fake.client;

      const res = await eventsGet(requestFor('/api/telemetry/events'));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.source).toBe('supabase');
      expect(fake.all.every((c) => c.table === 'usage_records')).toBe(true);
      expect(fake.all.some((c) => c.method === 'eq' && c.args[0] === 'org_id' && c.args[1] === ORG_ID)).toBe(true);
      expect(gateway.calls).toEqual([]);
    });

    it('returns an empty list for a tenant without rows instead of the shared gateway buffer', async () => {
      const fake = createFakeSupabase(usageResolver([], { total: 0, blocked: 0 }));
      state.client = fake.client;

      const res = await eventsGet(requestFor('/api/telemetry/events'));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual({ events: [], source: 'empty' });
      expect(gateway.calls).toEqual([]);
    });

    it('lets a platform admin read every row without an org filter', async () => {
      state.admin = true;
      const fake = createFakeSupabase(usageResolver([USAGE_ROW], { total: 1, blocked: 0 }));
      state.client = fake.client;

      const res = await eventsGet(requestFor('/api/telemetry/events'));

      expect(res.status).toBe(200);
      expect(fake.all.some((c) => c.method === 'eq' && c.args[0] === 'org_id')).toBe(false);
    });

    it('maps SDK events without inventing latency, token savings or a KYA verdict', async () => {
      const fake = createFakeSupabase(usageResolver([USAGE_ROW], { total: 1, blocked: 0 }));
      state.client = fake.client;

      const data = await (await eventsGet(requestFor('/api/telemetry/events'))).json();
      const event = data.events[0];

      expect(event).toEqual({
        id: USAGE_ROW.id,
        time: USAGE_ROW.created_at,
        timestamp: USAGE_ROW.created_at,
        agent: 'GPTBot',
        provider: 'acme.io',
        targetPath: '/pricing',
        method: 'GET',
        status: null,
        decision: 'allowed',
        identity: 'ua_declared',
        securityCheck: 'UA declared (unverified)',
      });
      expect(JSON.stringify(data)).not.toMatch(/KYA Verified|latencyMs|tokenSavings/);
    });

    it('labels agent_blocked rows as blocked by policy', async () => {
      const blocked = { ...USAGE_ROW, event_type: 'agent_blocked' };
      const fake = createFakeSupabase(usageResolver([blocked], { total: 1, blocked: 1 }));
      state.client = fake.client;

      const data = await (await eventsGet(requestFor('/api/telemetry/events'))).json();

      expect(data.events[0].decision).toBe('blocked');
      expect(data.events[0].status).toBeNull();
      expect(data.events[0].securityCheck).toBe('Blocked by policy');
    });

    it('passes the upstream status the gateway recorded in metadata.status', async () => {
      const row = { ...USAGE_ROW, metadata: { ...USAGE_ROW.metadata, status: 502 } };
      state.client = createFakeSupabase(usageResolver([row], { total: 1, blocked: 0 })).client;

      const data = await (await eventsGet(requestFor('/api/telemetry/events'))).json();

      expect(data.events[0]).toMatchObject({ status: 502, decision: 'allowed' });
    });

    it('answers 503 for a non-admin when the database is unavailable', async () => {
      state.client = null;
      const res = await eventsGet(requestFor('/api/telemetry/events'));
      expect(res.status).toBe(503);
      expect(gateway.calls).toEqual([]);
    });
  });

  describe('GET /api/telemetry/metrics', () => {
    it('counts the organization usage ledger for a non-admin and ignores platform gateway totals', async () => {
      const fake = createFakeSupabase(usageResolver([], { total: 7, blocked: 2 }));
      state.client = fake.client;

      const res = await metricsGet(requestFor('/api/telemetry/metrics'));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.scope).toBe('organization');
      expect(data.metrics.total_requests).toBe(7);
      expect(data.metrics.total_requests).not.toBe(GATEWAY_FIXTURES.telemetry.metrics.total_requests);
      expect(data.metrics.threats_blocked.policy_blocked).toBe(2);
      expect(data.metrics.threats_blocked.total_threats).toBe(2);
      expect(data.metrics.economic_impact.tokens_saved).toBe(0);
      expect(data.metrics.performance).toEqual({ latency_p50_ms: 0, latency_p95_ms: 0, throughput_peak_rps: 0 });
      expect(fake.all.some((c) => c.table === 'audit_events')).toBe(false);
      const scoped = fake.all.filter((c) => c.table === 'usage_records' && c.method === 'eq' && c.args[0] === 'org_id');
      expect(scoped).toHaveLength(2);
    });

    it('counts only the current period', async () => {
      const fake = createFakeSupabase(usageResolver([], { total: 1, blocked: 0 }));
      state.client = fake.client;

      await metricsGet(requestFor('/api/telemetry/metrics'));

      const bounds = fake.all.filter((c) => c.method === 'gte' || c.method === 'lt');
      expect(bounds.length).toBeGreaterThanOrEqual(4);
      expect(bounds.every((c) => c.args[0] === 'created_at')).toBe(true);
    });

    it('adds platform gateway totals for a platform admin', async () => {
      state.admin = true;
      const fake = createFakeSupabase(usageResolver([], { total: 7, blocked: 2 }));
      state.client = fake.client;

      const data = await (await metricsGet(requestFor('/api/telemetry/metrics'))).json();

      expect(data.scope).toBe('platform');
      expect(data.metrics.total_requests).toBe(GATEWAY_FIXTURES.telemetry.metrics.total_requests);
      expect(data.metrics.performance.latency_p50_ms).toBe(GATEWAY_FIXTURES.telemetry.metrics.performance.latency_p50_ms);
      expect(fake.all.some((c) => c.method === 'eq' && c.args[0] === 'org_id')).toBe(false);
    });

    it('returns zeros and no fabricated latency when no source has data', async () => {
      state.admin = true;
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new Error('gateway down');
      }));

      const res = await metricsGet(requestFor('/api/telemetry/metrics'));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.source).toBe('empty');
      expect(data.status).toBe('unknown');
      expect(data.metrics.total_requests).toBe(0);
      expect(data.metrics.performance).toEqual({ latency_p50_ms: 0, latency_p95_ms: 0, throughput_peak_rps: 0 });
      expect(data.metrics.economic_impact.tokens_saved).toBe(0);
      expect(JSON.stringify(data)).not.toMatch(/12\.4|28\.6|120\.9|142850/);
    });

    it('answers 503 for a non-admin when the ledger query fails', async () => {
      const fake = createFakeSupabase(() => ({ data: null, count: null, error: { message: 'boom' } }));
      state.client = fake.client;

      const res = await metricsGet(requestFor('/api/telemetry/metrics'));

      expect(res.status).toBe(503);
      expect(orgScoped(fake.all)).toBe(true);
    });
  });
});
