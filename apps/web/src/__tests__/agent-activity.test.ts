import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { GET as eventsGet } from '../app/api/usage/events/route';
import { GET as agentsGet } from '../app/api/usage/agents/route';
import {
  aggregateAgents,
  aggregateSites,
  decodeCursor,
  encodeCursor,
  parseHostFilter,
  parseLimit,
  parseUsageRows,
  type UsageEventItem,
} from '../app/api/usage/_shared';
import {
  AGENT_ACTIVITY_EMPTY_COPY,
  AGENT_ACTIVITY_HOST_EMPTY_COPY,
  AgentActivityView,
  HOST_SELECT_ID,
} from '../app/dashboard/components/AgentActivityPanel';
import {
  agentsEndpoint,
  eventsEndpoint,
  failedState,
  selectActivity,
  succeededState,
  type AgentActivityData,
  type FetchState,
} from '../app/dashboard/views/useAgentActivity';

interface QueryResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

interface Call {
  method: string;
  args: unknown[];
}

interface UsageRow {
  id: string;
  org_id: string;
  created_at: string;
  event_type: string;
  units: number;
  agent_identifier: string | null;
  source: string;
  site_id: string | null;
  metadata: Record<string, unknown> | null;
}

const state = vi.hoisted(() => ({
  client: null as unknown,
  session: null as { user: { id: string; orgId: string; email: string }; orgId: string } | null,
}));

vi.mock('../lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => state.client,
}));
vi.mock('../lib/session', () => ({
  getOrgSession: async () => state.session,
}));

const ORG_A = '22222222-2222-4222-8222-222222222222';
const ORG_B = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-09-30T12:00:00.000Z');

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function usageRow(n: number, overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    id: uuid(n),
    org_id: ORG_A,
    created_at: new Date(NOW.getTime() - n * 1000).toISOString(),
    event_type: 'agent_request',
    units: 1,
    agent_identifier: 'GPTBot',
    source: 'middleware',
    site_id: null,
    metadata: { path: '/pricing', method: 'GET', secret: 'must-not-leak' },
    ...overrides,
  };
}

function columnValue(row: UsageRow, column: string): unknown {
  const [base, jsonKey] = column.split('->>');
  const value = row[base as keyof UsageRow];
  if (jsonKey === undefined) return value;
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[jsonKey] : undefined;
}

function applyQuery(rows: readonly UsageRow[], calls: Call[]): UsageRow[] {
  let result = [...rows];
  for (const call of calls) {
    const [column, value] = call.args as [string, string];
    if (call.method === 'eq') result = result.filter((r) => columnValue(r, column) === value);
    if (call.method === 'gte') result = result.filter((r) => String(columnValue(r, column)) >= value);
    if (call.method === 'lt') result = result.filter((r) => String(columnValue(r, column)) < value);
  }
  result.sort((a, b) => (a.created_at === b.created_at ? b.id.localeCompare(a.id) : b.created_at.localeCompare(a.created_at)));
  const range = calls.find((c) => c.method === 'range');
  if (range) return result.slice(range.args[0] as number, (range.args[1] as number) + 1);
  const limit = calls.find((c) => c.method === 'limit');
  if (limit) return result.slice(0, limit.args[0] as number);
  return result;
}

function createFakeSupabase(rows: readonly UsageRow[], failWith: string | null = null) {
  const all: Call[] = [];
  const client = {
    from(table: string) {
      const own: Call[] = [];
      const builder: object = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === 'then') {
              return (resolve: (value: QueryResult) => void) =>
                resolve(
                  failWith
                    ? { data: null, error: { message: failWith } }
                    : { data: table === 'usage_records' ? applyQuery(rows, own) : [], error: null },
                );
            }
            return (...args: unknown[]) => {
              const call = { method: prop, args };
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

function eventsRequest(query = ''): NextRequest {
  return new NextRequest(`https://stealthmark.io/api/usage/events${query}`);
}

function agentsRequest(query = ''): NextRequest {
  return new NextRequest(`https://stealthmark.io/api/usage/agents${query}`);
}

describe('Usage routes (/api/usage/events and /api/usage/agents)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    state.client = null;
    state.session = { user: { id: 'user-1', orgId: ORG_A, email: 'dev@acme.io' }, orgId: ORG_A };
  });

  afterEach(() => {
    vi.useRealTimers();
    state.client = null;
    state.session = null;
  });

  describe('authentication', () => {
    it('rejects both routes with 401 and no database access when there is no session', async () => {
      state.session = null;
      const fake = createFakeSupabase([usageRow(1)]);
      state.client = fake.client;

      const events = await eventsGet(eventsRequest());
      const agents = await agentsGet(agentsRequest());

      expect(events.status).toBe(401);
      expect(agents.status).toBe(401);
      expect(fake.all).toEqual([]);
    });

    it('answers 503 when the database client is unavailable', async () => {
      expect((await eventsGet(eventsRequest())).status).toBe(503);
      expect((await agentsGet(agentsRequest())).status).toBe(503);
    });
  });

  describe('GET /api/usage/events', () => {
    it('returns only rows of the session organization with the documented fields', async () => {
      const fake = createFakeSupabase([
        usageRow(1),
        usageRow(2, { org_id: ORG_B, agent_identifier: 'other-tenant-bot' }),
        usageRow(3, { event_type: 'agent_blocked', units: 0, agent_identifier: 'ClaudeBot', site_id: uuid(900) }),
      ]);
      state.client = fake.client;

      const res = await eventsGet(eventsRequest());
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(fake.all).toContainEqual({ method: 'eq', args: ['org_id', ORG_A] });
      expect(data.events.map((e: UsageEventItem) => e.agent_identifier)).toEqual(['GPTBot', 'ClaudeBot']);
      expect(data.events[0]).toEqual({
        id: uuid(1),
        created_at: usageRow(1).created_at,
        event_type: 'agent_request',
        units: 1,
        agent_identifier: 'GPTBot',
        source: 'middleware',
        site_id: null,
        metadata: { path: '/pricing', method: 'GET', host: null, status: null, reason: null, served_at: null },
      });
      expect(data.events[1].site_id).toBe(uuid(900));
      expect(JSON.stringify(data)).not.toContain('must-not-leak');
      expect(JSON.stringify(data)).not.toContain('other-tenant-bot');
      expect(data.next_cursor).toBeNull();
    });

    it('paginates with an opaque cursor and filters the next page past the last row', async () => {
      const rows = Array.from({ length: 5 }, (_, i) => usageRow(i + 1));
      const fake = createFakeSupabase(rows);
      state.client = fake.client;

      const first = await (await eventsGet(eventsRequest('?limit=2'))).json();

      expect(first.events).toHaveLength(2);
      expect(first.next_cursor).toBe(encodeCursor(rows[1].created_at, rows[1].id));
      expect(decodeCursor(first.next_cursor)).toEqual({ createdAt: rows[1].created_at, id: rows[1].id });

      await eventsGet(eventsRequest(`?limit=2&cursor=${first.next_cursor}`));
      const orCall = fake.all.find((c) => c.method === 'or');
      expect(orCall?.args[0]).toBe(
        `created_at.lt."${rows[1].created_at}",and(created_at.eq."${rows[1].created_at}",id.lt."${rows[1].id}")`,
      );
    });

    it('clamps the page size to 200 and defaults to 50', async () => {
      const fake = createFakeSupabase([]);
      state.client = fake.client;

      await eventsGet(eventsRequest('?limit=9999'));
      await eventsGet(eventsRequest());

      const limits = fake.all.filter((c) => c.method === 'limit').map((c) => c.args[0]);
      expect(limits).toEqual([201, 51]);
    });

    it('rejects malformed limit and cursor values before querying', async () => {
      const fake = createFakeSupabase([usageRow(1)]);
      state.client = fake.client;
      const injected = Buffer.from(`2026-09-30T12:00:00Z"),id.gt.0|${uuid(1)}`).toString('base64url');

      const badLimit = await eventsGet(eventsRequest('?limit=abc'));
      const zeroLimit = await eventsGet(eventsRequest('?limit=0'));
      const badCursor = await eventsGet(eventsRequest('?cursor=not-a-cursor'));
      const injectedCursor = await eventsGet(eventsRequest(`?cursor=${injected}`));

      expect(badLimit.status).toBe(400);
      expect(zeroLimit.status).toBe(400);
      expect(badCursor.status).toBe(400);
      expect(injectedCursor.status).toBe(400);
      expect(await badCursor.json()).toEqual({ error: 'invalid_cursor' });
      expect(fake.all).toEqual([]);
    });

    it('exposes host and path of each row, with host null when the SDK did not send one', async () => {
      state.client = createFakeSupabase([
        usageRow(1, { metadata: { path: '/pricing', method: 'GET', host: 'acme.dev' } }),
        usageRow(2, { metadata: { path: '/docs', method: 'GET' } }),
      ]).client;

      const data = await (await eventsGet(eventsRequest())).json();

      expect(data.events.map((e: UsageEventItem) => [e.metadata.host, e.metadata.path])).toEqual([
        ['acme.dev', '/pricing'],
        [null, '/docs'],
      ]);
    });

    it('filters on metadata->>host server side and keeps the organization scope', async () => {
      const fake = createFakeSupabase([
        usageRow(1, { metadata: { path: '/a', host: 'acme.dev' } }),
        usageRow(2, { metadata: { path: '/b', host: 'blog.acme.dev' } }),
        usageRow(3, { metadata: { path: '/c' } }),
        usageRow(4, { org_id: ORG_B, metadata: { path: '/d', host: 'acme.dev' } }),
      ]);
      state.client = fake.client;

      const data = await (await eventsGet(eventsRequest('?host=acme.dev'))).json();

      expect(data.events.map((e: UsageEventItem) => e.id)).toEqual([uuid(1)]);
      expect(fake.all).toContainEqual({ method: 'eq', args: ['metadata->>host', 'acme.dev'] });
      expect(fake.all).toContainEqual({ method: 'eq', args: ['org_id', ORG_A] });
    });

    it('combines the host filter with the pagination cursor', async () => {
      const rows = Array.from({ length: 3 }, (_, i) => usageRow(i + 1, { metadata: { path: '/x', host: 'acme.dev' } }));
      const fake = createFakeSupabase(rows);
      state.client = fake.client;
      const cursor = encodeCursor(rows[0].created_at, rows[0].id);

      const res = await eventsGet(eventsRequest(`?limit=2&host=acme.dev&cursor=${cursor}`));

      expect(res.status).toBe(200);
      expect(fake.all).toContainEqual({ method: 'eq', args: ['metadata->>host', 'acme.dev'] });
      expect(fake.all.some((c) => c.method === 'or')).toBe(true);
    });

    it.each([
      ['uppercase', 'Acme.dev'],
      ['empty', ''],
      ['with a scheme', 'https://acme.dev'],
      ['with a path', 'acme.dev/admin'],
      ['with a port', 'acme.dev:3000'],
      ['with spaces', 'acme .dev'],
      ['with a filter injection', 'acme.dev,id.gt.0'],
      ['with quotes and parentheses', 'a")or(id.gt.0'],
      ['with an unclosed IPv6 bracket', '[::1'],
      ['with a bracketed IPv6 port', '[::1]:3000'],
      ['with a bare IPv6 literal', '::1'],
      ['with a non-hex IPv6 literal', '[xyz]'],
      ['over 253 characters', `${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(20)}.dev`],
    ])('rejects a host %s with 400 before querying', async (_label, host) => {
      const fake = createFakeSupabase([usageRow(1)]);
      state.client = fake.client;

      const res = await eventsGet(eventsRequest(`?host=${encodeURIComponent(host)}`));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_host' });
      expect(fake.all).toEqual([]);
    });

    it('answers 500 without leaking the database message', async () => {
      state.client = createFakeSupabase([], 'relation usage_records does not exist').client;

      const res = await eventsGet(eventsRequest());

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'query_failed' });
    });
  });

  describe('GET /api/usage/agents', () => {
    it('aggregates the current period of the session organization per agent', async () => {
      const lastMonth = new Date('2026-08-31T23:59:59.000Z').toISOString();
      const fake = createFakeSupabase([
        usageRow(1, { agent_identifier: 'GPTBot', metadata: { path: '/pricing' } }),
        usageRow(2, { agent_identifier: 'GPTBot', metadata: { path: '/pricing' } }),
        usageRow(3, { agent_identifier: 'GPTBot', event_type: 'agent_blocked', units: 0, metadata: { path: '/admin' } }),
        usageRow(4, { agent_identifier: 'ClaudeBot', metadata: { path: '/docs' } }),
        usageRow(5, { agent_identifier: null, metadata: null }),
        usageRow(6, { agent_identifier: 'GPTBot', created_at: lastMonth }),
        usageRow(7, { agent_identifier: 'other-tenant-bot', org_id: ORG_B }),
      ]);
      state.client = fake.client;

      const res = await agentsGet(agentsRequest());
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.period_month).toBe('2026-09-01');
      expect(data.sampled_rows).toBe(5);
      expect(data.truncated).toBe(false);
      expect(data.agents).toEqual([
        {
          agent: 'GPTBot',
          events: 3,
          units: 2,
          blocked: 1,
          last_seen: usageRow(1).created_at,
          top_paths: [
            { path: '/pricing', count: 2 },
            { path: '/admin', count: 1 },
          ],
        },
        { agent: 'ClaudeBot', events: 1, units: 1, blocked: 0, last_seen: usageRow(4).created_at, top_paths: [{ path: '/docs', count: 1 }] },
        { agent: 'unknown', events: 1, units: 1, blocked: 0, last_seen: usageRow(5).created_at, top_paths: [] },
      ]);
      expect(fake.all).toContainEqual({ method: 'eq', args: ['org_id', ORG_A] });
      expect(fake.all).toContainEqual({ method: 'gte', args: ['created_at', '2026-09-01T00:00:00.000Z'] });
      expect(fake.all).toContainEqual({ method: 'lt', args: ['created_at', '2026-10-01T00:00:00.000Z'] });
    });

    it('pages through up to 5000 rows and flags truncation', async () => {
      const rows = Array.from({ length: 5200 }, (_, i) =>
        usageRow(i + 1, { created_at: new Date(NOW.getTime() - i * 100).toISOString() }),
      );
      const fake = createFakeSupabase(rows);
      state.client = fake.client;

      const data = await (await agentsGet(agentsRequest())).json();

      expect(data.sampled_rows).toBe(5000);
      expect(data.truncated).toBe(true);
      expect(data.agents[0].events).toBe(5000);
      expect(fake.all.filter((c) => c.method === 'range').map((c) => c.args)).toEqual([
        [0, 999],
        [1000, 1999],
        [2000, 2999],
        [3000, 3999],
        [4000, 4999],
      ]);
    });

    it('stops after a short page and reports no truncation', async () => {
      const rows = Array.from({ length: 1200 }, (_, i) => usageRow(i + 1));
      const fake = createFakeSupabase(rows);
      state.client = fake.client;

      const data = await (await agentsGet(agentsRequest())).json();

      expect(data.sampled_rows).toBe(1200);
      expect(data.truncated).toBe(false);
      expect(fake.all.filter((c) => c.method === 'range')).toHaveLength(2);
    });

    it('groups the period by host with distinct agents and the latest event, host null for events without one', async () => {
      const lastMonth = new Date('2026-08-31T23:59:59.000Z').toISOString();
      state.client = createFakeSupabase([
        usageRow(1, { agent_identifier: 'GPTBot', metadata: { path: '/a', host: 'acme.dev' } }),
        usageRow(2, { agent_identifier: 'GPTBot', metadata: { path: '/b', host: 'acme.dev' } }),
        usageRow(3, { agent_identifier: 'ClaudeBot', metadata: { path: '/c', host: 'acme.dev' } }),
        usageRow(4, { agent_identifier: 'GPTBot', metadata: { path: '/d', host: 'blog.acme.dev' } }),
        usageRow(5, { agent_identifier: null, metadata: { path: '/e' } }),
        usageRow(6, { agent_identifier: 'GPTBot', created_at: lastMonth, metadata: { host: 'old.acme.dev' } }),
        usageRow(7, { org_id: ORG_B, metadata: { host: 'other-tenant.dev' } }),
      ]).client;

      const data = await (await agentsGet(agentsRequest())).json();

      expect(data.sites).toEqual([
        { host: 'acme.dev', events: 3, agents: 2, last_seen: usageRow(1).created_at },
        { host: 'blog.acme.dev', events: 1, agents: 1, last_seen: usageRow(4).created_at },
        { host: null, events: 1, agents: 1, last_seen: usageRow(5).created_at },
      ]);
      expect(JSON.stringify(data)).not.toContain('other-tenant.dev');
      expect(JSON.stringify(data)).not.toContain('old.acme.dev');
    });

    it('filters agents by host while the sites list still covers every host', async () => {
      const fake = createFakeSupabase([
        usageRow(1, { agent_identifier: 'GPTBot', metadata: { path: '/a', host: 'acme.dev' } }),
        usageRow(2, { agent_identifier: 'ClaudeBot', metadata: { path: '/b', host: 'blog.acme.dev' } }),
        usageRow(3, { agent_identifier: 'ClaudeBot', metadata: { path: '/c', host: 'blog.acme.dev' } }),
      ]);
      state.client = fake.client;

      const res = await agentsGet(agentsRequest('?host=blog.acme.dev'));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.agents.map((a: { agent: string; events: number }) => [a.agent, a.events])).toEqual([['ClaudeBot', 2]]);
      expect(data.sampled_rows).toBe(2);
      expect(data.sites.map((s: { host: string }) => s.host)).toEqual(['blog.acme.dev', 'acme.dev']);
      expect(fake.all).toContainEqual({ method: 'eq', args: ['metadata->>host', 'blog.acme.dev'] });
    });

    it('rejects an invalid host with 400 and no database access', async () => {
      const fake = createFakeSupabase([usageRow(1)]);
      state.client = fake.client;

      for (const host of ['Acme.dev', 'acme.dev/x', 'a"b', '']) {
        const res = await agentsGet(agentsRequest(`?host=${encodeURIComponent(host)}`));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'invalid_host' });
      }
      expect(fake.all).toEqual([]);
    });

    it('answers 500 without leaking the database message when a scan fails', async () => {
      state.client = createFakeSupabase([], 'relation usage_records does not exist').client;

      for (const query of ['', '?host=acme.dev']) {
        const res = await agentsGet(agentsRequest(query));
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'query_failed' });
      }
    });

    it('returns an empty aggregation for an organization without events', async () => {
      state.client = createFakeSupabase([usageRow(1, { org_id: ORG_B })]).client;

      const data = await (await agentsGet(agentsRequest())).json();

      expect(data).toEqual({ period_month: '2026-09-01', agents: [], sites: [], sampled_rows: 0, truncated: false });
    });
  });
});

describe('usage helpers', () => {
  it('parseLimit accepts positive integers and rejects anything else', () => {
    expect(parseLimit(null)).toBe(50);
    expect(parseLimit('10')).toBe(10);
    expect(parseLimit('500')).toBe(200);
    for (const bad of ['0', '-1', '1.5', 'x', '']) expect(parseLimit(bad)).toBeNull();
  });

  it('parseUsageRows drops rows without id or timestamp and keeps only path, method, host, status, reason and served_at of metadata', () => {
    const items = parseUsageRows([
      { id: 'a', created_at: '2026-09-30T12:00:00Z', metadata: { path: '/x', method: 'GET', extra: 1, ip_hash: '0123456789abcdef' } },
      { created_at: '2026-09-30T12:00:00Z' },
      null,
      'nope',
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].metadata).toEqual({ path: '/x', method: 'GET', host: null, status: null, reason: null, served_at: null });
    expect(items[0].event_type).toBe('agent_request');
    expect(parseUsageRows({ not: 'an array' })).toEqual([]);
  });

  it('parseUsageRows keeps metadata.status only when it is a finite number', () => {
    const at = (status: unknown) => ({ id: 'a', created_at: '2026-09-30T12:00:00Z', metadata: { path: '/x', status } });
    const statuses = parseUsageRows([at(502), at('502'), at(null), at(Number.NaN), at(Number.POSITIVE_INFINITY)]).map(
      (item) => item.metadata.status,
    );

    expect(statuses).toEqual([502, null, null, null, null]);
    expect(parseUsageRows([{ id: 'b', created_at: '2026-09-30T12:00:00Z', metadata: null }])[0].metadata.status).toBeNull();
  });

  it('aggregateAgents orders by events then name, breaks path ties alphabetically and limits top paths', () => {
    const at = (s: number, agent: string | null, path: string | null, type = 'agent_request'): UsageEventItem => ({
      id: `${agent}-${s}`,
      created_at: new Date(NOW.getTime() - s * 1000).toISOString(),
      event_type: type,
      units: type === 'agent_blocked' ? 0 : 1,
      agent_identifier: agent,
      source: 'middleware',
      site_id: null,
      metadata: { path, method: null, host: null, status: null, reason: null, served_at: null },
    });
    const items = [
      at(5, 'b-bot', '/z'),
      at(4, 'b-bot', '/a'),
      at(3, 'b-bot', '/m'),
      at(2, 'a-bot', '/a'),
      at(1, '  a-bot ', '/a', 'agent_blocked'),
    ];

    const summaries = aggregateAgents(items, 2);

    expect(summaries.map((s) => s.agent)).toEqual(['b-bot', 'a-bot']);
    expect(summaries[0].top_paths).toEqual([
      { path: '/a', count: 1 },
      { path: '/m', count: 1 },
    ]);
    expect(summaries[1]).toMatchObject({ events: 2, blocked: 1, units: 1, last_seen: items[4].created_at });

    const tied = aggregateAgents([at(2, 'z-bot', null), at(1, 'a-bot', null)]);
    expect(tied.map((s) => s.agent)).toEqual(['a-bot', 'z-bot']);
  });
});

describe('site helpers', () => {
  const event = (s: number, agent: string | null, host: string | null): UsageEventItem => ({
    id: `evt-${s}`,
    created_at: new Date(NOW.getTime() - s * 1000).toISOString(),
    event_type: 'agent_request',
    units: 1,
    agent_identifier: agent,
    source: 'middleware',
    site_id: null,
    metadata: { path: '/', method: 'GET', host, status: null, reason: null, served_at: null },
  });

  it('parseHostFilter treats a missing param as no filter and accepts lowercase hostnames', () => {
    expect(parseHostFilter(null)).toEqual({ valid: true, host: null });
    for (const host of ['acme.dev', 'blog.acme.dev', 'localhost', '192.168.0.1', 'my_site.acme-1.dev', 'a'.repeat(63)]) {
      expect(parseHostFilter(host)).toEqual({ valid: true, host });
    }
    expect(parseHostFilter(`${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`)).toMatchObject({ valid: true });
  });

  it('parseHostFilter accepts every form normalizeHost of @stealthmark/core can emit, bracketed IPv6 included', () => {
    const maxLength = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;
    expect(maxLength).toHaveLength(253);
    const emitted = [
      '[::1]',
      '[2001:db8::7]',
      '[::ffff:192.0.2.1]',
      '-a.dev',
      '.acme.dev',
      'acme..dev',
      'acme.dev.',
      `${'a'.repeat(64)}.dev`,
      'a'.repeat(253),
      maxLength,
    ];
    for (const host of emitted) {
      expect(parseHostFilter(host)).toEqual({ valid: true, host });
    }
  });

  it('parseHostFilter rejects anything normalizeHost never emits', () => {
    const tooLong = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`;
    expect(tooLong).toHaveLength(254);
    const rejected = [
      '',
      'ACME.dev',
      'acme.dev:80',
      'a b',
      'a,b',
      'acme.dev/x',
      '[::1',
      '::1',
      '[::1]:3000',
      '[::G]',
      '[]',
      '[::1]x',
      '[2001:DB8::7]',
      tooLong,
    ];
    for (const host of rejected) {
      expect(parseHostFilter(host)).toEqual({ valid: false });
    }
  });

  it('aggregateSites counts events and distinct agents per host, orders by events and puts the missing host after named hosts on ties', () => {
    const sites = aggregateSites([
      event(9, 'GPTBot', 'b.dev'),
      event(8, 'GPTBot', 'a.dev'),
      event(7, 'ClaudeBot', 'a.dev'),
      event(6, 'GPTBot', 'a.dev'),
      event(5, null, null),
      event(4, null, null),
      event(3, 'GPTBot', null),
      event(2, null, 'c.dev'),
      event(1, 'Googlebot', 'c.dev'),
    ]);

    expect(sites).toEqual([
      { host: 'a.dev', events: 3, agents: 2, last_seen: event(6, null, null).created_at },
      { host: null, events: 3, agents: 2, last_seen: event(3, null, null).created_at },
      { host: 'c.dev', events: 2, agents: 2, last_seen: event(1, null, null).created_at },
      { host: 'b.dev', events: 1, agents: 1, last_seen: event(9, null, null).created_at },
    ]);
  });

  it('aggregateSites breaks ties by host name with the missing host last, and handles no events', () => {
    const sites = aggregateSites([event(3, 'x', null), event(2, 'x', 'z.dev'), event(1, 'x', 'a.dev')]);
    expect(sites.map((s) => s.host)).toEqual(['a.dev', 'z.dev', null]);
    expect(aggregateSites([])).toEqual([]);
  });

  it('builds the endpoints with the host filter URL-encoded', () => {
    expect(agentsEndpoint(null)).toBe('/api/usage/agents');
    expect(agentsEndpoint('acme.dev')).toBe('/api/usage/agents?host=acme.dev');
    expect(eventsEndpoint(null)).toBe('/api/usage/events?limit=25');
    expect(eventsEndpoint('acme.dev')).toBe('/api/usage/events?limit=25&host=acme.dev');
    expect(eventsEndpoint('a&b=c')).toBe('/api/usage/events?limit=25&host=a%26b%3Dc');
  });
});

describe('useAgentActivity state selection', () => {
  const sites = [
    { host: 'acme.dev', events: 3, agents: 2, last_seen: '2026-09-30T11:45:00.000Z' },
    { host: 'blog.acme.dev', events: 1, agents: 1, last_seen: '2026-09-28T07:30:00.000Z' },
  ];
  const activityFor = (agent: string, host: string | null): AgentActivityData => ({
    periodMonth: '2026-09-01',
    truncated: false,
    sites,
    agents: [{ agent, events: 1, units: 1, blocked: 0, last_seen: null, top_paths: [] }],
    events: [
      {
        id: `${agent}-1`,
        created_at: '2026-09-30T11:45:00.000Z',
        event_type: 'agent_request',
        units: 1,
        agent_identifier: agent,
        source: 'middleware',
        site_id: null,
        metadata: { path: '/', method: 'GET', host, status: null, reason: null, served_at: null },
      },
    ],
  });
  const acme = activityFor('GPTBot', 'acme.dev');
  const blog = activityFor('ClaudeBot', 'blog.acme.dev');

  it('returns the data of the host it was loaded for', () => {
    const view = selectActivity(succeededState(acme, 'acme.dev'), true, 'acme.dev');
    expect(view).toEqual({ data: acme, sites, loading: false, error: null });
  });

  it('hides the previous host data and reports loading after the host changes', () => {
    const view = selectActivity(succeededState(acme, 'acme.dev'), true, 'blog.acme.dev');
    expect(view.data).toBeNull();
    expect(view.loading).toBe(true);
    expect(view.error).toBeNull();
    expect(view.sites).toEqual(sites);
  });

  it('hides the all-sites data when a host is selected, and the other way around', () => {
    expect(selectActivity(succeededState(acme, null), true, 'acme.dev').data).toBeNull();
    expect(selectActivity(succeededState(acme, 'acme.dev'), true, null).data).toBeNull();
  });

  it('shows data again once the new host response settles', () => {
    const settled = succeededState(blog, 'blog.acme.dev');
    expect(selectActivity(settled, true, 'blog.acme.dev')).toEqual({ data: blog, sites, loading: false, error: null });
  });

  it('drops the previous host data when the new host fails, keeping the sites list and the error', () => {
    const failed = failedState(succeededState(acme, 'acme.dev'), 'blog.acme.dev', 'agent_activity_request_failed_500');
    const view = selectActivity(failed, true, 'blog.acme.dev');
    expect(view.data).toBeNull();
    expect(view.loading).toBe(false);
    expect(view.error).toBe('agent_activity_request_failed_500');
    expect(view.sites).toEqual(sites);
  });

  it('keeps the data of the same host when a refresh fails', () => {
    const failed = failedState(succeededState(acme, 'acme.dev'), 'acme.dev', 'agent_activity_request_failed_500');
    const view = selectActivity(failed, true, 'acme.dev');
    expect(view.data).toBe(acme);
    expect(view.error).toBe('agent_activity_request_failed_500');
  });

  it('does not show the error of the previous host while the new host loads', () => {
    const failed = failedState(succeededState(acme, 'acme.dev'), 'blog.acme.dev', 'agent_activity_request_failed_500');
    const view = selectActivity(failed, true, 'acme.dev');
    expect(view.error).toBeNull();
    expect(view.data).toBeNull();
    expect(view.loading).toBe(true);
  });

  it('exposes nothing while disabled', () => {
    const state: FetchState = succeededState(acme, 'acme.dev');
    expect(selectActivity(state, false, 'acme.dev')).toEqual({ data: null, sites: [], loading: false, error: null });
  });
});

describe('AgentActivityView markup', () => {
  const data: AgentActivityData = {
    periodMonth: '2026-09-01',
    truncated: false,
    sites: [
      { host: 'acme.dev', events: 1000, agents: 2, last_seen: '2026-09-30T11:45:00.000Z' },
      { host: 'blog.acme.dev', events: 234, agents: 1, last_seen: '2026-09-28T07:30:00.000Z' },
      { host: null, events: 12, agents: 1, last_seen: '2026-09-29T08:00:00.000Z' },
    ],
    agents: [
      {
        agent: 'GPTBot',
        events: 1234,
        units: 1200,
        blocked: 34,
        last_seen: '2026-09-30T11:45:00.000Z',
        top_paths: [{ path: '/pricing', count: 900 }],
      },
      { agent: 'ClaudeBot', events: 12, units: 12, blocked: 0, last_seen: '2026-09-29T08:00:00.000Z', top_paths: [] },
    ],
    events: [
      {
        id: 'e1',
        created_at: '2026-09-30T11:45:00.000Z',
        event_type: 'agent_blocked',
        units: 0,
        agent_identifier: 'GPTBot',
        source: 'middleware',
        site_id: null,
        metadata: { path: '/admin', method: 'GET', host: 'blog.acme.dev', status: null, reason: null, served_at: null },
      },
    ],
  };

  function render(props: {
    data?: AgentActivityData | null;
    sites?: AgentActivityData['sites'];
    loading?: boolean;
    error?: string | null;
    signedIn?: boolean;
    selectedHost?: string | null;
  }): string {
    return renderToStaticMarkup(
      createElement(AgentActivityView, {
        data: props.data ?? null,
        sites: props.sites,
        loading: props.loading ?? false,
        error: props.error ?? null,
        signedIn: props.signedIn ?? true,
        selectedHost: props.selectedHost ?? null,
        onSelectHost: () => undefined,
      }),
    );
  }

  it('renders the loading skeleton before the first response', () => {
    const html = render({ loading: true });
    expect(html).toContain('data-testid="agent-activity-loading"');
    expect(html).not.toContain(AGENT_ACTIVITY_EMPTY_COPY);
  });

  it('renders the empty state with the SDK call to action', () => {
    const html = render({ data: { periodMonth: '2026-09-01', truncated: false, sites: [], agents: [], events: [] } });
    expect(html).toContain(AGENT_ACTIVITY_EMPTY_COPY);
    expect(html).toContain('data-testid="agent-activity-empty"');
    expect(html).not.toContain('data-testid="agent-activity-table"');
  });

  it('renders the error state with a refresh button', () => {
    const html = render({ error: 'agent_activity_request_failed_500' });
    expect(html).toContain('data-testid="agent-activity-error"');
    expect(html).toContain('Refresh');
    expect(html).not.toContain(AGENT_ACTIVITY_EMPTY_COPY);
  });

  it('renders the per-agent table and recent events when populated', () => {
    const html = render({ data });
    expect(html).toContain('Events this period');
    expect(html).toContain('GPTBot');
    expect(html).toContain('1,234');
    expect(html).toContain('/pricing');
    expect(html).toContain('x900');
    expect(html).toContain('2026-09-30 11:45 UTC');
    expect(html).toContain('ClaudeBot');
    expect(html).toContain('Recent events');
    expect(html).toContain('GET /admin');
    expect(html).toContain('agent_blocked');
    expect(html).toContain('September 2026');
    expect(html).not.toContain(AGENT_ACTIVITY_EMPTY_COPY);
  });

  it('keeps the last good data visible next to an error', () => {
    const html = render({ data, error: 'agent_activity_request_failed_500' });
    expect(html).toContain('data-testid="agent-activity-error"');
    expect(html).toContain('data-testid="agent-activity-table"');
  });

  it('asks guests to sign in and hides the refresh button', () => {
    const html = render({ signedIn: false });
    expect(html).toContain('data-testid="agent-activity-signed-out"');
    expect(html).not.toContain('Refresh');
  });

  it('renders the sites summary with host, events, agents and last seen, labelling a missing host as unknown', () => {
    const html = render({ data });
    expect(html).toContain('data-testid="agent-activity-sites"');
    expect(html).toContain('acme.dev');
    expect(html).toContain('blog.acme.dev');
    expect(html).toContain('>unknown<');
    expect(html).toContain('Agents</th>');
    expect(html).toContain('2026-09-28 07:30 UTC');
  });

  it('renders a labelled site selector listing every named host and defaulting to all sites', () => {
    const html = render({ data });
    expect(html).toContain(`<label for="${HOST_SELECT_ID}"`);
    expect(html).toContain(`<select id="${HOST_SELECT_ID}"`);
    expect(html).toContain('<option value="" selected="">All sites</option>');
    expect(html).toContain('<option value="acme.dev">acme.dev</option>');
    expect(html).toContain('<option value="blog.acme.dev">blog.acme.dev</option>');
    expect(html).not.toContain('<option value="unknown"');
  });

  it('marks the selected host in the selector and keeps it listed even when the sites list lacks it', () => {
    const html = render({ data, selectedHost: 'blog.acme.dev' });
    expect(html).toContain('<option value="blog.acme.dev" selected="">blog.acme.dev</option>');
    expect(html).toContain('Which agents read blog.acme.dev');

    const missing = render({ data: { ...data, sites: [] }, selectedHost: 'gone.acme.dev' });
    expect(missing).toContain('<option value="gone.acme.dev" selected="">gone.acme.dev</option>');
  });

  it('keeps the selector and shows no agents or events while the selected host loads', () => {
    const html = render({ data: null, sites: data.sites, loading: true, selectedHost: 'blog.acme.dev' });
    expect(html).toContain('data-testid="agent-activity-loading"');
    expect(html).toContain('<option value="blog.acme.dev" selected="">blog.acme.dev</option>');
    expect(html).not.toContain('data-testid="agent-activity-table"');
    expect(html).not.toContain('data-testid="agent-activity-events"');
    expect(html).not.toContain('GPTBot');
  });

  it('hides the selector when no event carries a host', () => {
    const html = render({
      data: { ...data, sites: [{ host: null, events: 1246, agents: 2, last_seen: '2026-09-30T11:45:00.000Z' }] },
    });
    expect(html).toContain('data-testid="agent-activity-sites"');
    expect(html).not.toContain(`<select id="${HOST_SELECT_ID}"`);
  });

  it('shows a Site column in the events list with the host or unknown', () => {
    const html = render({
      data: {
        ...data,
        events: [
          { ...data.events[0], id: 'e1', metadata: { path: '/admin', method: 'GET', host: 'blog.acme.dev', status: null, reason: null, served_at: null } },
          { ...data.events[0], id: 'e2', metadata: { path: '/docs', method: 'GET', host: null, status: null, reason: null, served_at: null } },
        ],
      },
    });
    expect(html).toContain('>Site</th>');
    expect(html).toMatch(/data-testid="agent-activity-event-site">blog\.acme\.dev</);
    expect(html).toMatch(/data-testid="agent-activity-event-site"><span[^>]*>unknown</);
  });

  it('shows a site specific empty state with the selector still available', () => {
    const html = render({
      data: { periodMonth: '2026-09-01', truncated: false, sites: data.sites, agents: [], events: [] },
      selectedHost: 'acme.dev',
    });
    expect(html).toContain(AGENT_ACTIVITY_HOST_EMPTY_COPY);
    expect(html).not.toContain(AGENT_ACTIVITY_EMPTY_COPY);
    expect(html).toContain(`<select id="${HOST_SELECT_ID}"`);
  });
});
