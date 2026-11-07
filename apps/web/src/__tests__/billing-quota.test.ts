import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  alertStampForPeriod,
  computeQuota,
  currentPeriodMonth,
  isQuotaResponse,
  nextPeriodMonth,
  type QuotaInput,
  type QuotaLevel,
  type QuotaResponse,
  type QuotaSummary,
} from '../lib/quota';
import { GET as quotaGet } from '../app/api/billing/quota/route';

interface QueryResult {
  data: unknown;
  count?: number | null;
  error: { message: string; code?: string } | null;
}

interface Call {
  method: string;
  args: unknown[];
}

type Resolver = (table: string, calls: Call[]) => QueryResult;

const dbState = vi.hoisted(() => ({
  client: null as unknown,
  session: null as { user: { id: string; orgId: string; email: string }; orgId: string } | null,
}));

vi.mock('../lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => dbState.client,
}));
vi.mock('../lib/session', () => ({
  getOrgSession: async () => dbState.session,
}));

const ORG_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-09-30T12:00:00.000Z');

function createFakeSupabase(resolver: Resolver) {
  const builders: Array<{ table: string; calls: Call[] }> = [];
  const client = {
    from(table: string) {
      const calls: Call[] = [];
      builders.push({ table, calls });
      const builder: object = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === 'then') {
              return (resolve: (value: QueryResult) => void) => resolve(resolver(table, calls));
            }
            return (...args: unknown[]) => {
              calls.push({ method: prop, args });
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  return { client, builders };
}

function isHeadCount(calls: Call[]): boolean {
  const select = calls.find((c) => c.method === 'select');
  const options = select?.args[1] as { head?: boolean } | undefined;
  return options?.head === true;
}

function filtersOf(calls: Call[]): Array<[string, string, string]> {
  return calls
    .filter((c) => c.method === 'filter')
    .map((c) => [String(c.args[0]), String(c.args[1]), String(c.args[2])]);
}

function orgRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    billing_mode: 'free',
    monthly_event_cap: 10_000,
    credit_balance_events: 0,
    quota_alert_80_sent_at: null,
    quota_alert_100_sent_at: null,
    ...overrides,
  };
}

interface Scenario {
  org?: Record<string, unknown> | null;
  orgError?: { message: string; code?: string };
  singleUnitCount?: number;
  multiUnitPages?: Array<Array<{ units: number }>>;
  failPeriodMonth?: boolean;
}

function scenarioResolver(scenario: Scenario): Resolver {
  let rowPage = 0;
  return (table, calls) => {
    if (table === 'organizations') {
      if (scenario.orgError) return { data: null, error: scenario.orgError };
      return { data: scenario.org === undefined ? orgRow() : scenario.org, error: null };
    }
    if (scenario.failPeriodMonth && filtersOf(calls).some(([column]) => column === 'period_month')) {
      return { data: null, error: { message: 'column usage_records.period_month does not exist', code: '42703' } };
    }
    if (isHeadCount(calls)) return { data: null, count: scenario.singleUnitCount ?? 0, error: null };
    const page = scenario.multiUnitPages?.[rowPage] ?? [];
    rowPage += 1;
    return { data: page, error: null };
  };
}

function installDb(scenario: Scenario) {
  const fake = createFakeSupabase(scenarioResolver(scenario));
  dbState.client = fake.client;
  return fake;
}

describe('computeQuota', () => {
  const sum = (mode: QuotaSummary['mode'], cap: number | null, used: number, remaining: number | null, percent: number, level: QuotaLevel): QuotaSummary =>
    ({ cap, used, remaining, percent, mode, level });
  const input = (billing_mode: string | null, cap: number | null, balance: number | undefined, used: number | undefined): QuotaInput =>
    ({ billing_mode, monthly_event_cap: cap, credit_balance_events: balance, used });

  const cases: Array<[string, QuotaInput, QuotaSummary]> = [
    ['free under 80%', input('free', 10_000, 0, 2_500), sum('free', 10_000, 2_500, 7_500, 25, 'ok')],
    ['free at 79.99% stays ok and never rounds up to 80', input('free', 10_000, 0, 7_999), sum('free', 10_000, 7_999, 2_001, 79, 'ok')],
    ['free exactly at 80% warns', input('free', 10_000, 0, 8_000), sum('free', 10_000, 8_000, 2_000, 80, 'warning')],
    ['free at 99.99% is still a warning below 100', input('free', 10_000, 0, 9_999), sum('free', 10_000, 9_999, 1, 99, 'warning')],
    ['free exactly at the cap is exceeded', input('free', 10_000, 0, 10_000), sum('free', 10_000, 10_000, 0, 100, 'exceeded')],
    ['free over the cap clamps percent and remaining', input('free', 10_000, 0, 12_345), sum('free', 10_000, 12_345, 0, 100, 'exceeded')],
    ['free with a zero cap is exceeded without dividing by zero', input('free', 0, 0, 0), sum('free', 0, 0, 0, 100, 'exceeded')],
    ['credits: cap is used plus the remaining balance', input('credits', 10_000, 900, 100), sum('credits', 1_000, 100, 900, 10, 'ok')],
    ['credits warns when 20% of the balance is left', input('credits', 10_000, 200, 800), sum('credits', 1_000, 800, 200, 80, 'warning')],
    ['credits with an empty balance is exceeded', input('credits', 10_000, 0, 750), sum('credits', 750, 750, 0, 100, 'exceeded')],
    ['credits never reads a negative balance', input('credits', 10_000, -40, 10), sum('credits', 10, 10, 0, 100, 'exceeded')],
    ['credits without balance or usage is exceeded', input('credits', 10_000, 0, 0), sum('credits', 0, 0, 0, 100, 'exceeded')],
    ['enterprise has no cap and is never exceeded', input('enterprise', 10_000, 0, 5_000_000), sum('enterprise', null, 5_000_000, null, 0, 'ok')],
    ['unknown billing mode falls back to free', input('legacy', 100, 50, 10), sum('free', 100, 10, 90, 10, 'ok')],
    ['missing values are treated as zero', input(null, null, undefined, undefined), sum('free', 0, 0, 0, 100, 'exceeded')],
    ['fractional usage is floored', input('free', 1_000, 0, 12.9), sum('free', 1_000, 12, 988, 1, 'ok')],
  ];

  it.each(cases)('%s', (_name, given, expected) => {
    expect(computeQuota(given)).toEqual(expected);
  });

  it('never reports exceeded for enterprise at any usage', () => {
    for (const used of [0, 10_000, 10_001, Number.MAX_SAFE_INTEGER]) {
      const level: QuotaLevel = computeQuota({
        billing_mode: 'enterprise',
        monthly_event_cap: 10_000,
        credit_balance_events: 0,
        used,
      }).level;
      expect(level).toBe('ok');
    }
  });
});

describe('period helpers', () => {
  it('derives the UTC period month', () => {
    expect(currentPeriodMonth(new Date('2026-09-30T23:59:59.999Z'))).toBe('2026-09-01');
    expect(currentPeriodMonth(new Date('2026-10-01T00:00:00.000Z'))).toBe('2026-10-01');
  });

  it('rolls the next period over the year boundary', () => {
    expect(nextPeriodMonth('2026-09-01')).toBe('2026-10-01');
    expect(nextPeriodMonth('2026-12-01')).toBe('2027-01-01');
  });

  it('keeps an alert stamp only for the period it was sent in', () => {
    expect(alertStampForPeriod('2026-09-12T08:00:00.000Z', '2026-09-01')).toBe('2026-09-12T08:00:00.000Z');
    expect(alertStampForPeriod('2026-08-31T23:59:59.000Z', '2026-09-01')).toBeNull();
    expect(alertStampForPeriod('not a date', '2026-09-01')).toBeNull();
    expect(alertStampForPeriod(null, '2026-09-01')).toBeNull();
  });
});

describe('isQuotaResponse', () => {
  const valid: QuotaResponse = {
    cap: 10_000,
    used: 1,
    remaining: 9_999,
    percent: 0,
    mode: 'free',
    level: 'ok',
    period_month: '2026-09-01',
    alerts: { eighty_percent_sent_at: null, hundred_percent_sent_at: null },
  };

  it('accepts the route payload shape, including a null cap', () => {
    expect(isQuotaResponse(valid)).toBe(true);
    expect(isQuotaResponse({ ...valid, cap: null, remaining: null, mode: 'enterprise' })).toBe(true);
  });

  it('rejects malformed payloads', () => {
    expect(isQuotaResponse(null)).toBe(false);
    expect(isQuotaResponse({ ...valid, level: 'critical' })).toBe(false);
    expect(isQuotaResponse({ ...valid, alerts: undefined })).toBe(false);
    expect(isQuotaResponse({ ...valid, used: '1' })).toBe(false);
  });
});

describe('GET /api/billing/quota', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    dbState.session = { user: { id: 'u1', orgId: ORG_ID, email: 'dev@example.com' }, orgId: ORG_ID };
    dbState.client = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns 401 without a session and never touches the database', async () => {
    dbState.session = null;
    const fake = installDb({});
    const res = await quotaGet();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(fake.builders).toHaveLength(0);
  });

  it('returns 503 when Supabase is not configured', async () => {
    dbState.client = null;
    const res = await quotaGet();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'service_unavailable' });
  });

  it('returns the free quota with unit sums and period-scoped alerts', async () => {
    const fake = installDb({
      org: orgRow({
        quota_alert_80_sent_at: '2026-09-20T10:00:00.000Z',
        quota_alert_100_sent_at: '2026-08-30T10:00:00.000Z',
      }),
      singleUnitCount: 8_200,
      multiUnitPages: [[{ units: 3 }, { units: 2 }]],
    });

    const res = await quotaGet();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({
      cap: 10_000,
      used: 8_205,
      remaining: 1_795,
      percent: 82,
      mode: 'free',
      level: 'warning',
      period_month: '2026-09-01',
      alerts: {
        eighty_percent_sent_at: '2026-09-20T10:00:00.000Z',
        hundred_percent_sent_at: null,
      },
    });

    const org = fake.builders.find((b) => b.table === 'organizations');
    expect(org?.calls.find((c) => c.method === 'eq')?.args).toEqual(['id', ORG_ID]);

    const usage = fake.builders.filter((b) => b.table === 'usage_records');
    expect(usage.length).toBeGreaterThan(0);
    for (const builder of usage) {
      expect(filtersOf(builder.calls)).toEqual([
        ['org_id', 'eq', ORG_ID],
        ['period_month', 'eq', '2026-09-01'],
      ]);
    }
  });

  it('falls back to created_at bounds when period_month does not exist yet', async () => {
    const fake = installDb({ singleUnitCount: 40, failPeriodMonth: true });

    const res = await quotaGet();
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuotaResponse;
    expect(body.used).toBe(40);

    const fallback = fake.builders
      .filter((b) => b.table === 'usage_records')
      .map((b) => filtersOf(b.calls))
      .filter((filters) => filters.some(([column]) => column === 'created_at'));
    expect(fallback.length).toBeGreaterThan(0);
    expect(fallback[0]).toEqual([
      ['org_id', 'eq', ORG_ID],
      ['created_at', 'gte', '2026-09-01T00:00:00.000Z'],
      ['created_at', 'lt', '2026-10-01T00:00:00.000Z'],
    ]);
  });

  it('sums multi-unit rows across pages', async () => {
    const fullPage = Array.from({ length: 1000 }, () => ({ units: 2 }));
    const fake = installDb({
      singleUnitCount: 1,
      multiUnitPages: [fullPage, [{ units: 5 }]],
    });

    const res = await quotaGet();
    const body = (await res.json()) as QuotaResponse;
    expect(body.used).toBe(1 + 2_000 + 5);

    const ranges = fake.builders
      .filter((b) => b.table === 'usage_records')
      .flatMap((b) => b.calls.filter((c) => c.method === 'range').map((c) => c.args));
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('reports credits as used plus remaining balance', async () => {
    installDb({
      org: orgRow({ billing_mode: 'credits', credit_balance_events: 900 }),
      singleUnitCount: 100,
    });
    const body = (await (await quotaGet()).json()) as QuotaResponse;
    expect(body).toMatchObject({ mode: 'credits', cap: 1_000, used: 100, remaining: 900, percent: 10, level: 'ok' });
  });

  it('reports enterprise without a cap', async () => {
    installDb({ org: orgRow({ billing_mode: 'enterprise' }), singleUnitCount: 123_456 });
    const body = (await (await quotaGet()).json()) as QuotaResponse;
    expect(body).toMatchObject({ mode: 'enterprise', cap: null, remaining: null, percent: 0, level: 'ok', used: 123_456 });
  });

  it('returns 503 quota_unavailable when the quota columns are not applied', async () => {
    installDb({ orgError: { message: 'column organizations.billing_mode does not exist', code: '42703' } });
    const res = await quotaGet();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'quota_unavailable' });
  });

  it('returns 404 when the organization row is missing', async () => {
    installDb({ org: null });
    const res = await quotaGet();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'organization_not_found' });
  });

  it('returns 500 on unexpected database errors with only the SQLSTATE code, never the message', async () => {
    installDb({ orgError: { message: 'connection reset by peer', code: '08006' } });
    const res = await quotaGet();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'failed_to_load_quota', code: '08006' });
    expect(JSON.stringify(body)).not.toContain('connection reset');
  });
});
