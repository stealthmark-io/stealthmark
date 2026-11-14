import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => state.client }));

async function freshModules() {
  vi.resetModules();
  const quota = await import('../lib/scan-quota');
  const route = await import('../app/api/telemetry/live-pulse/route');
  return { quota, route };
}

function recordScan(
  quota: typeof import('../lib/scan-quota'),
  cleanDomain: string,
  currentIssues: number,
  nowMs: number,
) {
  quota.evaluateAndRecordDomainScanQuota({
    cleanDomain,
    unlocked: false,
    shouldCountScan: true,
    currentScore: 70,
    currentGrade: 'C',
    currentPasses: SCAN_CHECK_COUNT - currentIssues,
    currentIssues,
    totalChecks: SCAN_CHECK_COUNT,
    nowMs,
  });
}

function fakeUsageClient(count: number) {
  const calls: unknown[][] = [];
  const query = {
    select: (...args: unknown[]) => (calls.push(['select', ...args]), query),
    eq: (...args: unknown[]) => (calls.push(['eq', ...args]), query),
    gte: (...args: unknown[]) => (calls.push(['gte', ...args]), Promise.resolve({ count, error: null })),
  };
  return { calls, client: { from: (table: string) => (calls.push(['from', table]), query) } };
}

afterEach(() => {
  state.client = null;
});

describe('GET /api/telemetry/live-pulse', () => {
  it('reports zeros for an empty store instead of invented floors', async () => {
    const { route } = await freshModules();
    const body = await (await route.GET()).json();

    expect(body).toMatchObject({
      ok: true,
      domainsScannedTotal: 0,
      domainsScanned24h: 0,
      issuesFound24h: 0,
      aiAgentsBlocked24h: null,
    });
    expect(Object.keys(body).sort()).toEqual(
      ['aiAgentsBlocked24h', 'domainsScanned24h', 'domainsScannedTotal', 'issuesFound24h', 'ok', 'updated_at'],
    );
  });

  it('counts recorded scans and never returns the scanned domains', async () => {
    const { quota, route } = await freshModules();
    const now = Date.now();
    recordScan(quota, 'live-pulse-alpha.test', 5, now);
    recordScan(quota, 'live-pulse-bravo.test', 3, now);
    recordScan(quota, 'live-pulse-old.test', 9, now - 2 * 24 * 60 * 60 * 1000);

    const response = await route.GET();
    const text = await response.text();
    const body = JSON.parse(text);

    expect(body).toMatchObject({ domainsScannedTotal: 3, domainsScanned24h: 2, issuesFound24h: 8 });
    expect(text).not.toContain('live-pulse');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('counts only agent_blocked usage events from the last 24 hours', async () => {
    const fake = fakeUsageClient(7);
    state.client = fake.client;
    const { route } = await freshModules();
    const body = await (await route.GET()).json();

    expect(body.aiAgentsBlocked24h).toBe(7);
    expect(fake.calls).toContainEqual(['from', 'usage_records']);
    expect(fake.calls).toContainEqual(['eq', 'event_type', 'agent_blocked']);
    expect(fake.calls.some((call) => call[0] === 'gte' && call[1] === 'created_at')).toBe(true);
  });
});
