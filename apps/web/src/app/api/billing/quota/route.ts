import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '../../../../lib/supabase/admin';
import { getOrgSession } from '../../../../lib/session';
import {
  alertStampForPeriod,
  computeQuota,
  currentPeriodMonth,
  nextPeriodMonth,
  type QuotaResponse,
} from '../../../../lib/quota';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ORG_COLUMNS =
  'billing_mode, monthly_event_cap, credit_balance_events, quota_alert_80_sent_at, quota_alert_100_sent_at';
const PAGE_SIZE = 1000;
const MAX_PAGES = 200;
const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204']);
const NO_STORE = { 'Cache-Control': 'no-store' };

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type PeriodScope = 'period_month' | 'created_at';

interface QueryError {
  message: string;
  code?: string;
}

interface OrgQuotaRow {
  billing_mode: string | null;
  monthly_event_cap: number | null;
  credit_balance_events: number | null;
  quota_alert_80_sent_at: string | null;
  quota_alert_100_sent_at: string | null;
}

interface PeriodFilter {
  column: string;
  operator: 'eq' | 'gte' | 'lt';
  value: string;
}

class QuotaQueryError extends Error {
  readonly code: string | undefined;

  constructor(error: QueryError) {
    super(error.message);
    this.name = 'QuotaQueryError';
    this.code = error.code;
  }

  get isMissingColumn(): boolean {
    return this.code !== undefined && MISSING_COLUMN_CODES.has(this.code);
  }
}

function respond(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseOrgRow(data: unknown): OrgQuotaRow | null {
  if (typeof data !== 'object' || data === null) return null;
  const row = data as Record<string, unknown>;
  return {
    billing_mode: asNullableString(row.billing_mode),
    monthly_event_cap: asNullableNumber(row.monthly_event_cap),
    credit_balance_events: asNullableNumber(row.credit_balance_events),
    quota_alert_80_sent_at: asNullableString(row.quota_alert_80_sent_at),
    quota_alert_100_sent_at: asNullableString(row.quota_alert_100_sent_at),
  };
}

function periodFilters(orgId: string, scope: PeriodScope, periodMonth: string): PeriodFilter[] {
  const org: PeriodFilter = { column: 'org_id', operator: 'eq', value: orgId };
  if (scope === 'period_month') return [org, { column: 'period_month', operator: 'eq', value: periodMonth }];
  return [
    org,
    { column: 'created_at', operator: 'gte', value: `${periodMonth}T00:00:00.000Z` },
    { column: 'created_at', operator: 'lt', value: `${nextPeriodMonth(periodMonth)}T00:00:00.000Z` },
  ];
}

/** Sum of units equals the count of single-unit rows plus the units of the rare multi-unit rows. */
async function sumUnits(supabase: AdminClient, orgId: string, periodMonth: string, scope: PeriodScope): Promise<number> {
  const filters = periodFilters(orgId, scope, periodMonth);

  let countQuery = supabase.from('usage_records').select('units', { count: 'exact', head: true }).eq('units', 1);
  for (const f of filters) countQuery = countQuery.filter(f.column, f.operator, f.value);
  const single = await countQuery;
  if (single.error) throw new QuotaQueryError(single.error);

  let total = single.count ?? 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let rowsQuery = supabase.from('usage_records').select('units').neq('units', 1).order('id', { ascending: true });
    for (const f of filters) rowsQuery = rowsQuery.filter(f.column, f.operator, f.value);
    const from = page * PAGE_SIZE;
    const { data, error } = await rowsQuery.range(from, from + PAGE_SIZE - 1);
    if (error) throw new QuotaQueryError(error);

    const rows = (data ?? []) as Array<{ units: number | null }>;
    for (const row of rows) total += typeof row.units === 'number' ? row.units : 0;
    if (rows.length < PAGE_SIZE) return total;
  }
  throw new Error('usage_records pagination limit exceeded');
}

async function usedUnitsThisPeriod(supabase: AdminClient, orgId: string, periodMonth: string): Promise<number> {
  try {
    return await sumUnits(supabase, orgId, periodMonth, 'period_month');
  } catch (err: unknown) {
    if (!(err instanceof QuotaQueryError) || !err.isMissingColumn) throw err;
    return sumUnits(supabase, orgId, periodMonth, 'created_at');
  }
}

// GET /api/billing/quota - Quota status of the session organization for the current period
export async function GET() {
  const session = await getOrgSession();
  if (!session) return respond({ error: 'unauthorized' }, 401);

  const supabase = createSupabaseAdminClient();
  if (!supabase) return respond({ error: 'service_unavailable' }, 503);

  try {
    const { data, error } = await supabase
      .from('organizations')
      .select(ORG_COLUMNS)
      .eq('id', session.orgId)
      .maybeSingle();
    if (error) throw new QuotaQueryError(error);

    const org = parseOrgRow(data);
    if (!org) return respond({ error: 'organization_not_found' }, 404);

    const periodMonth = currentPeriodMonth();
    const used = await usedUnitsThisPeriod(supabase, session.orgId, periodMonth);

    const body: QuotaResponse = {
      ...computeQuota({ ...org, used }),
      period_month: periodMonth,
      alerts: {
        eighty_percent_sent_at: alertStampForPeriod(org.quota_alert_80_sent_at, periodMonth),
        hundred_percent_sent_at: alertStampForPeriod(org.quota_alert_100_sent_at, periodMonth),
      },
    };
    return respond(body, 200);
  } catch (err: unknown) {
    if (err instanceof QuotaQueryError && err.isMissingColumn) {
      console.error('[Billing Quota GET] Quota schema is not applied:', err.message);
      return respond({ error: 'quota_unavailable' }, 503);
    }
    console.error('[Billing Quota GET Error]:', err instanceof Error ? err.message : err);
    return respond({ error: 'failed_to_load_quota', code: err instanceof QuotaQueryError ? err.code ?? null : null }, 500);
  }
}
