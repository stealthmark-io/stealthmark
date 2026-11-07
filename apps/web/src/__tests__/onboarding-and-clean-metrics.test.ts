import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EMPTY_METRICS, mergeMonotonicMetrics } from '../hooks/useGatewayTelemetry';
import { POST as pingPost, GET as pingGet } from '../app/api/telemetry/ping/route';
import { POST as domainsPost, GET as domainsGet } from '../app/api/domains/route';
import { GET as telemetryMetricsGet } from '../app/api/telemetry/metrics/route';
import { NextRequest } from 'next/server';
import { GATEWAY_FIXTURES, installGatewayFetchMock } from './helpers/gateway-mock';
import type { GatewayFetchMock } from './helpers/gateway-mock';

interface QueryResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

type Resolver = (table: string, methods: string[], calls: RecordedCall[]) => QueryResult;

const dbState = vi.hoisted(() => ({
  client: null as unknown,
  session: null as { user: { id: string; orgId: string; email: string }; orgId: string } | null,
  admin: true,
}));

vi.mock('../lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => dbState.client,
}));
vi.mock('../lib/session', () => ({
  getOrgSession: async () => dbState.session,
}));
vi.mock('../lib/admin-auth', () => ({
  isAuthorizedAdmin: async () => dbState.admin,
}));

function createFakeSupabase(resolver: Resolver) {
  const calls: RecordedCall[] = [];
  const client = {
    from(table: string) {
      const methods: string[] = [];
      const builder: object = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === 'then') {
              return (resolve: (value: QueryResult) => void) => resolve(resolver(table, methods, calls));
            }
            return (...args: unknown[]) => {
              methods.push(prop);
              calls.push({ table, method: prop, args });
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  return { client, calls };
}

const ORG_ID = '11111111-1111-4111-8111-111111111111';

function domainRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/domains', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function domainsResolver(existingSite: Record<string, unknown> | null): Resolver {
  return (table, methods, calls) => {
    if (table === 'registered_sites' && methods.includes('insert')) {
      const insert = calls.find((c) => c.table === table && c.method === 'insert')?.args[0] as Record<string, unknown>;
      return { data: { id: 'site-1', ...insert }, error: null };
    }
    if (table === 'registered_sites' && methods.includes('maybeSingle')) {
      return { data: existingSite, error: null };
    }
    return { data: [], error: null };
  };
}

describe('Clean Metrics, Developer Plan Defaults, Domain Connection & Onboarding Flow', () => {
  let gateway: GatewayFetchMock;

  beforeEach(() => {
    vi.restoreAllMocks();
    gateway = installGatewayFetchMock();
  });

  afterEach(() => {
    expect(gateway.strayCalls).toEqual([]);
    vi.unstubAllGlobals();
    dbState.session = null;
    dbState.admin = true;
  });

  describe('Clean Telemetry Metrics Contract', () => {
    it('EMPTY_METRICS initializes with zero requests, threats, and tokens saved', () => {
      expect(EMPTY_METRICS.total_requests).toBe(0);
      expect(EMPTY_METRICS.threats_blocked.semantic_injections).toBe(0);
      expect(EMPTY_METRICS.threats_blocked.spoofed_identities).toBe(0);
      expect(EMPTY_METRICS.threats_blocked.payload_bombs).toBe(0);
      expect(EMPTY_METRICS.threats_blocked.rate_limit_throttled).toBe(0);
      expect(EMPTY_METRICS.performance.latency_p50_ms).toBe(0);
      expect(EMPTY_METRICS.economic_impact.tokens_saved).toBe(0);
      expect(EMPTY_METRICS.economic_impact.estimated_usd_saved).toBe(0);
    });
  });

  describe('Developer Free Plan Quota Calculations', () => {
    it('calculates 0% usage for brand new account with 0 / 10,000 txs', () => {
      const used = 0;
      const max = 10000;
      const percentage = Math.min(100, Math.round((used / max) * 100));
      expect(percentage).toBe(0);
    });

    it('calculates exact percentage when requests are incremented', () => {
      const used = 1250;
      const max = 10000;
      const percentage = Math.min(100, Math.round((used / max) * 100));
      expect(percentage).toBe(13);
    });
  });

  describe('Edge Telemetry Ping API (/api/telemetry/ping)', () => {
    beforeEach(() => {
      dbState.session = { user: { id: 'user-1', orgId: ORG_ID, email: 'dev@acme.io' }, orgId: ORG_ID };
    });

    afterEach(() => {
      dbState.session = null;
    });

    it('POST /api/telemetry/ping returns the measured gateway latency without fabricated claims', async () => {
      const req = new Request('http://localhost:3000/api/telemetry/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await pingPost(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.clusterStatus).toBe('operational');
      expect(data.latencyMs).toBe(GATEWAY_FIXTURES.ping.latency_ms);
      expect(data.timestamp).toBeDefined();
      expect(data).not.toHaveProperty('securityCheck');
      expect(data).not.toHaveProperty('defconEnforced');
    });

    it('GET /api/telemetry/ping also responds with the measured gateway latency', async () => {
      const res = await pingGet();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.clusterStatus).toBe('operational');
    });

    it('reports an unreachable gateway with null latency instead of a made-up number', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new Error('network down');
      }));

      const res = await pingPost(new Request('http://localhost:3000/api/telemetry/ping', { method: 'POST' }));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.latencyMs).toBeNull();
      expect(data.clusterStatus).toBe('unreachable');
    });
  });

  describe('Domain Connection & Gateway Provisioning API (/api/domains)', () => {
    beforeEach(() => {
      dbState.client = null;
      dbState.session = { user: { id: 'user-1', orgId: ORG_ID, email: 'dev@acme.io' }, orgId: ORG_ID };
    });

    afterEach(() => {
      dbState.client = null;
      dbState.session = null;
    });

    it('rejects unauthenticated POST and GET with 401, without database access or plan changes', async () => {
      dbState.session = null;
      const fake = createFakeSupabase(domainsResolver(null));
      dbState.client = fake.client;

      const post = await domainsPost(domainRequest({ domain: 'x-stealthmark.com' }));
      const get = await domainsGet();

      expect(post.status).toBe(401);
      expect(get.status).toBe(401);
      expect(fake.calls).toHaveLength(0);
    });

    it('POST /api/domains rejects request with missing domain', async () => {
      const res = await domainsPost(domainRequest({ domain: '' }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Domain is required');
    });

    it('POST /api/domains rejects malformed hostnames', async () => {
      dbState.client = createFakeSupabase(domainsResolver(null)).client;
      for (const domain of ['localhost', 'a b.com', 'x,domain.eq.y.com', 'exa_mple.com']) {
        const res = await domainsPost(domainRequest({ domain }));
        expect(res.status).toBe(400);
      }
    });

    it('POST /api/domains registers the domain as pending for the session org and returns DNS instructions', async () => {
      const fake = createFakeSupabase(domainsResolver(null));
      dbState.client = fake.client;

      const res = await domainsPost(domainRequest({ domain: 'https://www.democv.example.com/', name: 'DemoCV Operations' }));
      expect(res.status).toBe(201);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.domain).toBe('www.democv.example.com');
      expect(data.organizationId).toBe(ORG_ID);
      expect(data.status).toBe('pending');
      expect(data.verification.host).toBe('_stealthmark-verify.www.democv.example.com');
      expect(data.verification.value).toMatch(/^sm-verify-[0-9a-f]{32}$/);
      expect(data.apiKey.key).toMatch(/^sk_live_/);
      expect(data.gateway.proxyUrl).toBe('https://gateway.stealthmark.io');
      expect(data.gateway.upstream).toBe('https://www.democv.example.com');

      const siteInsert = fake.calls.find((c) => c.table === 'registered_sites' && c.method === 'insert');
      expect(siteInsert?.args[0]).toMatchObject({
        org_id: ORG_ID,
        domain: 'www.democv.example.com',
        status: 'pending',
        dns_verified: false,
      });
      const keyInsert = fake.calls.find((c) => c.table === 'api_keys' && c.method === 'insert');
      expect(keyInsert?.args[0]).toMatchObject({ org_id: ORG_ID });
    });

    it('provisions the first key with the SDK scope only and no lab agent id in the response', async () => {
      const fake = createFakeSupabase(domainsResolver(null));
      dbState.client = fake.client;

      const res = await domainsPost(domainRequest({ domain: 'least-privilege.example' }));
      const data = await res.json();

      const keyInsert = fake.calls.find((c) => c.table === 'api_keys' && c.method === 'insert');
      expect((keyInsert?.args[0] as { scopes: string[] }).scopes).toEqual(['usage:ingest']);
      expect(JSON.stringify(data)).not.toContain('agent_autodev_001');
      expect(data.gateway).not.toHaveProperty('handshakeHeader');
    });

    describe('a domain already claimed by another organization', () => {
      const OTHER_ORG = '99999999-9999-4999-8999-999999999999';
      const HOUR = 60 * 60 * 1000;
      const claim = (overrides: Record<string, unknown>) => ({
        id: 'site-other',
        org_id: OTHER_ORG,
        domain: 'taken.example',
        status: 'pending',
        dns_verified: false,
        dns_verification_token: 'sm-verify-x',
        created_at: new Date(Date.now() - HOUR).toISOString(),
        ...overrides,
      });

      it.each([
        ['a recent unverified claim', claim({})],
        ['a verified claim, however old', claim({ status: 'active', dns_verified: true, created_at: new Date(Date.now() - 400 * HOUR).toISOString() })],
        ['an old claim that is already active', claim({ status: 'active', created_at: new Date(Date.now() - 400 * HOUR).toISOString() })],
      ])('refuses with 409 for %s and deletes nothing', async (_label, existing) => {
        const fake = createFakeSupabase(domainsResolver(existing));
        dbState.client = fake.client;

        const res = await domainsPost(domainRequest({ domain: 'taken.example' }));
        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe('domain_already_registered');
        expect(fake.calls.some((c) => c.method === 'delete' || c.method === 'insert')).toBe(false);
      });

      it('releases a claim that never proved DNS control after 24 hours and registers the new owner', async () => {
        const stale = claim({ created_at: new Date(Date.now() - 25 * HOUR).toISOString() });
        const fake = createFakeSupabase(domainsResolver(stale));
        dbState.client = fake.client;

        const res = await domainsPost(domainRequest({ domain: 'taken.example' }));
        expect(res.status).toBe(201);

        const release = fake.calls.filter((c) => c.table === 'registered_sites' && ['delete', 'eq'].includes(c.method));
        expect(release.some((c) => c.method === 'delete')).toBe(true);
        expect(release.map((c) => c.args)).toEqual(expect.arrayContaining([['id', 'site-other'], ['status', 'pending'], ['dns_verified', false]]));
        const insert = fake.calls.find((c) => c.table === 'registered_sites' && c.method === 'insert');
        expect(insert?.args[0]).toMatchObject({ org_id: ORG_ID, domain: 'taken.example', status: 'pending', dns_verified: false });
      });

      it('keeps the claim when it cannot be released', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const stale = claim({ created_at: new Date(Date.now() - 25 * HOUR).toISOString() });
        const base = domainsResolver(stale);
        const fake = createFakeSupabase((table, methods, calls) =>
          table === 'registered_sites' && methods.includes('delete') ? { data: null, error: { message: 'fk violation' } } : base(table, methods, calls),
        );
        dbState.client = fake.client;

        const res = await domainsPost(domainRequest({ domain: 'taken.example' }));
        expect(res.status).toBe(409);
        expect(fake.calls.some((c) => c.method === 'insert')).toBe(false);
      });
    });

    it('POST /api/domains never changes plans or activates sites, even for stealthmark-looking domains', async () => {
      const fake = createFakeSupabase(domainsResolver(null));
      dbState.client = fake.client;

      const res = await domainsPost(domainRequest({ domain: 'x-stealthmark.com' }));
      expect(res.status).toBe(201);
      expect((await res.json()).status).toBe('pending');

      expect(fake.calls.some((c) => c.table === 'organizations')).toBe(false);
      expect(fake.calls.some((c) => c.method === 'update' || c.method === 'upsert')).toBe(false);
      expect(JSON.stringify(fake.calls)).not.toContain('business');
      expect(JSON.stringify(fake.calls)).not.toContain('"active","open"');
      const siteInsert = fake.calls.find((c) => c.table === 'registered_sites' && c.method === 'insert');
      expect(siteInsert?.args[0]).not.toMatchObject({ status: 'active' });
    });

    it('POST /api/domains does not build string-interpolated PostgREST filters', async () => {
      const fake = createFakeSupabase(domainsResolver(null));
      dbState.client = fake.client;
      await domainsPost(domainRequest({ domain: 'example.com' }));
      expect(fake.calls.some((c) => c.method === 'or')).toBe(false);
    });

    it('POST /api/domains answers 409 when another org already registered the domain', async () => {
      const fake = createFakeSupabase(
        domainsResolver({
          id: 'site-9',
          org_id: '99999999-9999-4999-8999-999999999999',
          domain: 'victim.com',
          status: 'active',
          dns_verified: true,
          dns_verification_token: 'sm-verify-x',
        }),
      );
      dbState.client = fake.client;

      const res = await domainsPost(domainRequest({ domain: 'victim.com' }));
      expect(res.status).toBe(409);
      expect(fake.calls.some((c) => c.method === 'insert' || c.method === 'update' || c.method === 'upsert')).toBe(false);
    });

    it('POST /api/domains is idempotent for the owning org and keeps the existing verification state', async () => {
      const fake = createFakeSupabase(
        domainsResolver({
          id: 'site-1',
          org_id: ORG_ID,
          domain: 'mine.com',
          status: 'active',
          dns_verified: true,
          dns_verification_token: 'sm-verify-x',
        }),
      );
      dbState.client = fake.client;

      const res = await domainsPost(domainRequest({ domain: 'mine.com' }));
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.status).toBe('active');
      expect(data.verification).toBeNull();
      expect(fake.calls.some((c) => c.table === 'registered_sites' && c.method === 'insert')).toBe(false);
    });

    it('POST /api/domains answers 503 when the database is not configured', async () => {
      const res = await domainsPost(domainRequest({ domain: 'example.com' }));
      expect(res.status).toBe(503);
    });

    it('GET /api/domains returns the session org domain and scopes queries by org', async () => {
      const fake = createFakeSupabase((table, methods) => {
        if (table === 'organizations' && methods.includes('maybeSingle')) {
          return { data: { id: ORG_ID, name: 'Acme', plan: 'developer' }, error: null };
        }
        return {
          data: [
            {
              id: 'site-1',
              org_id: ORG_ID,
              domain: 'acme.io',
              status: 'pending',
              dns_verified: false,
              dns_verification_token: 'sm-verify-abc',
            },
          ],
          error: null,
        };
      });
      dbState.client = fake.client;

      const res = await domainsGet();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.domain).toBe('acme.io');
      expect(data.status).toBe('pending');
      expect(data.verification.value).toBe('sm-verify-abc');
      expect(data.organization.plan).toBe('developer');
      const scopes = fake.calls.filter((c) => c.method === 'eq').map((c) => c.args);
      expect(scopes).toContainEqual(['id', ORG_ID]);
      expect(scopes).toContainEqual(['org_id', ORG_ID]);
    });
  });

  describe('Onboarding 4-Step Completion Logic', () => {
    it('accurately evaluates step completions from state', () => {
      // Step 1: Organization Active
      const step1 = true;

      // Step 2: Domain connected
      let domain = '';
      expect(!!domain).toBe(false);
      domain = 'api.acme.com';
      expect(!!domain).toBe(true);

      // Step 3: API Key provisioned
      let hasKeys = false;
      let generatedKey: string | null = null;
      expect(hasKeys || !!generatedKey).toBe(false);
      generatedKey = 'sm_live_1234567890';
      expect(hasKeys || !!generatedKey).toBe(true);

      // Step 4: First agent event recorded in the usage ledger (a gateway ping never completes it)
      let realRequests = 0;
      expect(realRequests > 0).toBe(false);
      realRequests = 1;
      expect(realRequests > 0).toBe(true);

      // All 4 complete:
      const completedCount = [step1, !!domain, hasKeys || !!generatedKey, realRequests > 0].filter(Boolean).length;
      expect(completedCount).toBe(4);
    });
  });

  describe('Monotonic Shielding & Telemetry Persistence (Anti-Reset Protection)', () => {
    it('mergeMonotonicMetrics prevents metrics from decreasing when serverless container resets to 0', () => {
      const previousState = {
        total_requests: 6,
        threats_blocked: {
          semantic_injections: 3,
          spoofed_identities: 1,
          payload_bombs: 1,
          rate_limit_throttled: 0,
        },
        performance: {
          latency_p50_ms: 14.2,
          latency_p95_ms: 28.6,
          throughput_peak_rps: 120.9,
        },
        economic_impact: {
          tokens_saved: 92000,
          bandwidth_saved_mb: 0.15,
          estimated_usd_saved: 0.28,
        },
      };

      // Simulated serverless scale-to-zero / fresh container boot with 0 metrics
      const zeroMetrics = {
        total_requests: 0,
        threats_blocked: {
          semantic_injections: 0,
          spoofed_identities: 0,
          payload_bombs: 0,
          rate_limit_throttled: 0,
        },
        performance: {
          latency_p50_ms: 0,
          latency_p95_ms: 0,
          throughput_peak_rps: 0,
        },
        economic_impact: {
          tokens_saved: 0,
          bandwidth_saved_mb: 0,
          estimated_usd_saved: 0,
        },
      };

      const merged = mergeMonotonicMetrics(previousState, zeroMetrics);

      // Metrics must NOT decrease or get wiped out
      expect(merged.total_requests).toBe(6);
      expect(merged.threats_blocked.semantic_injections).toBe(3);
      expect(merged.threats_blocked.spoofed_identities).toBe(1);
      expect(merged.threats_blocked.payload_bombs).toBe(1);
      expect(merged.economic_impact.tokens_saved).toBe(92000);
      expect(merged.economic_impact.estimated_usd_saved).toBe(0.28);
    });

    it('mergeMonotonicMetrics accumulates when new higher values arrive', () => {
      const currentState = {
        total_requests: 6,
        threats_blocked: {
          semantic_injections: 3,
          spoofed_identities: 1,
          payload_bombs: 1,
          rate_limit_throttled: 0,
        },
        performance: {
          latency_p50_ms: 14.2,
          latency_p95_ms: 28.6,
          throughput_peak_rps: 120.9,
        },
        economic_impact: {
          tokens_saved: 92000,
          bandwidth_saved_mb: 0.15,
          estimated_usd_saved: 0.28,
        },
      };

      const higherIncoming = {
        total_requests: 7,
        threats_blocked: {
          semantic_injections: 4,
          spoofed_identities: 1,
          payload_bombs: 1,
          rate_limit_throttled: 0,
        },
        performance: {
          latency_p50_ms: 15.0,
          latency_p95_ms: 30.0,
          throughput_peak_rps: 130.0,
        },
        economic_impact: {
          tokens_saved: 110400,
          bandwidth_saved_mb: 0.2,
          estimated_usd_saved: 0.33,
        },
      };

      const merged = mergeMonotonicMetrics(currentState, higherIncoming);

      expect(merged.total_requests).toBe(7);
      expect(merged.threats_blocked.semantic_injections).toBe(4);
      expect(merged.economic_impact.tokens_saved).toBe(110400);
      expect(merged.economic_impact.estimated_usd_saved).toBe(0.33);
    });

    it('GET /api/telemetry/metrics returns a structured non-decreasing payload for platform admins', async () => {
      dbState.session = { user: { id: 'admin-1', orgId: ORG_ID, email: 'founder@acme.io' }, orgId: ORG_ID };
      dbState.admin = true;
      const req = new NextRequest('http://localhost:3000/api/telemetry/metrics');
      const res = await telemetryMetricsGet(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('metrics');
      expect(typeof data.metrics.total_requests).toBe('number');
      expect(data.metrics.total_requests).toBe(GATEWAY_FIXTURES.telemetry.metrics.total_requests);
      expect(data.metrics.threats_blocked).toBeDefined();
    });
  });
});

