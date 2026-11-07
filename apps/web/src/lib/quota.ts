export type BillingMode = 'free' | 'credits' | 'enterprise';
export type QuotaLevel = 'ok' | 'warning' | 'exceeded';

export interface QuotaInput {
  billing_mode: string | null | undefined;
  monthly_event_cap: number | null | undefined;
  credit_balance_events: number | null | undefined;
  used: number | null | undefined;
}

export interface QuotaSummary {
  cap: number | null;
  used: number;
  remaining: number | null;
  percent: number;
  mode: BillingMode;
  level: QuotaLevel;
}

export interface QuotaAlerts {
  eighty_percent_sent_at: string | null;
  hundred_percent_sent_at: string | null;
}

export interface QuotaResponse extends QuotaSummary {
  period_month: string;
  alerts: QuotaAlerts;
}

export const WARNING_THRESHOLD_PERCENT = 80;

function toEventCount(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function normalizeBillingMode(value: string | null | undefined): BillingMode {
  return value === 'credits' || value === 'enterprise' ? value : 'free';
}

function levelFor(used: number, cap: number): QuotaLevel {
  if (used >= cap) return 'exceeded';
  if (used * 100 >= cap * WARNING_THRESHOLD_PERCENT) return 'warning';
  return 'ok';
}

/**
 * Effective quota per billing mode. For credits, `credit_balance_events` is the
 * remaining balance, so the period cap is what was consumed plus what is left.
 */
export function computeQuota(input: QuotaInput): QuotaSummary {
  const mode = normalizeBillingMode(input.billing_mode);
  const used = toEventCount(input.used);

  if (mode === 'enterprise') {
    return { cap: null, used, remaining: null, percent: 0, mode, level: 'ok' };
  }

  const cap = mode === 'credits'
    ? used + toEventCount(input.credit_balance_events)
    : toEventCount(input.monthly_event_cap);
  const level = levelFor(used, cap);
  const percent = level === 'exceeded' ? 100 : Math.floor((used * 100) / cap);

  return { cap, used, remaining: Math.max(0, cap - used), percent, mode, level };
}

/** First day of the UTC month containing `now`, as YYYY-MM-DD (matches usage_records.period_month). */
export function currentPeriodMonth(now: Date = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${now.getUTCFullYear()}-${month}-01`;
}

/** First day of the UTC month after the given YYYY-MM-01 period, as YYYY-MM-DD. */
export function nextPeriodMonth(periodMonth: string): string {
  const start = new Date(`${periodMonth}T00:00:00.000Z`);
  return currentPeriodMonth(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)));
}

/** An alert stamp only counts for the period it was sent in; older stamps are reset implicitly. */
export function alertStampForPeriod(stamp: string | null | undefined, periodMonth: string): string | null {
  if (!stamp) return null;
  const sentAt = new Date(stamp);
  if (Number.isNaN(sentAt.getTime())) return null;
  return currentPeriodMonth(sentAt) === periodMonth ? stamp : null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

/** Runtime guard for the /api/billing/quota payload consumed by the console. */
export function isQuotaResponse(value: unknown): value is QuotaResponse {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  const alerts = body.alerts;
  if (typeof alerts !== 'object' || alerts === null) return false;
  const stamps = alerts as Record<string, unknown>;

  return (
    isNullableNumber(body.cap) &&
    typeof body.used === 'number' &&
    isNullableNumber(body.remaining) &&
    typeof body.percent === 'number' &&
    (body.mode === 'free' || body.mode === 'credits' || body.mode === 'enterprise') &&
    (body.level === 'ok' || body.level === 'warning' || body.level === 'exceeded') &&
    typeof body.period_month === 'string' &&
    isNullableString(stamps.eighty_percent_sent_at) &&
    isNullableString(stamps.hundred_percent_sent_at)
  );
}
