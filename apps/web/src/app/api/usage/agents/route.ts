import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '../../../../lib/supabase/admin';
import { getOrgSession } from '../../../../lib/session';
import { currentPeriodMonth, nextPeriodMonth } from '../../../../lib/quota';
import {
  AGENT_MAX_ROWS,
  AGENT_PAGE_SIZE,
  HOST_COLUMN,
  USAGE_COLUMNS,
  aggregateAgents,
  aggregateSites,
  parseHostFilter,
  parseUsageRows,
  type UsageAgentsResponse,
  type UsageEventItem,
} from '../_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store' };

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

interface PeriodScan {
  items: UsageEventItem[];
  truncated: boolean;
}

interface ScanScope {
  orgId: string;
  periodStart: string;
  periodEnd: string;
  host: string | null;
}

function respond(body: UsageAgentsResponse | { error: string }, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Pages through the latest events of the period (up to AGENT_MAX_ROWS), or returns null when a query fails. */
async function scanPeriod(supabase: AdminClient, scope: ScanScope): Promise<PeriodScan | null> {
  const items: UsageEventItem[] = [];
  let lastPageFull = false;
  for (let from = 0; from < AGENT_MAX_ROWS; from += AGENT_PAGE_SIZE) {
    let query = supabase
      .from('usage_records')
      .select(USAGE_COLUMNS)
      .eq('org_id', scope.orgId)
      .gte('created_at', scope.periodStart)
      .lt('created_at', scope.periodEnd);
    if (scope.host) query = query.eq(HOST_COLUMN, scope.host);
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + AGENT_PAGE_SIZE - 1);
    if (error) return null;

    const rawRows: unknown[] = Array.isArray(data) ? data : [];
    items.push(...parseUsageRows(rawRows));
    lastPageFull = rawRows.length >= AGENT_PAGE_SIZE;
    if (!lastPageFull) break;
  }
  return { items, truncated: lastPageFull };
}

// GET /api/usage/agents?host= - Per-agent and per-site aggregation of the latest events of the current period
export async function GET(req: NextRequest) {
  const session = await getOrgSession();
  if (!session) return respond({ error: 'unauthorized' }, 401);

  const hostFilter = parseHostFilter(req.nextUrl.searchParams.get('host'));
  if (!hostFilter.valid) return respond({ error: 'invalid_host' }, 400);

  const supabase = createSupabaseAdminClient();
  if (!supabase) return respond({ error: 'service_unavailable' }, 503);

  const periodMonth = currentPeriodMonth();
  const scope: ScanScope = {
    orgId: session.orgId,
    periodStart: `${periodMonth}T00:00:00.000Z`,
    periodEnd: `${nextPeriodMonth(periodMonth)}T00:00:00.000Z`,
    host: hostFilter.host,
  };

  // The sites table always lists every host of the organization, so a host filter needs its own unfiltered scan.
  const [agentScan, siteScan] = await Promise.all([
    scanPeriod(supabase, scope),
    hostFilter.host === null ? null : scanPeriod(supabase, { ...scope, host: null }),
  ]);
  if (!agentScan || (hostFilter.host !== null && !siteScan)) return respond({ error: 'query_failed' }, 500);
  const sitesSource = siteScan ?? agentScan;

  return respond(
    {
      period_month: periodMonth,
      agents: aggregateAgents(agentScan.items),
      sites: aggregateSites(sitesSource.items),
      sampled_rows: agentScan.items.length,
      truncated: agentScan.truncated || sitesSource.truncated,
    },
    200,
  );
}
