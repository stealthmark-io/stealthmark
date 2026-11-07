import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '../../../../lib/supabase/admin';
import { currentPeriodMonth, nextPeriodMonth } from '../../../../lib/quota';
import { BLOCKED_EVENT_TYPE } from '../../usage/_shared';
import { NO_STORE, resolveTelemetryAccess, unauthorized, unavailable } from '../_access';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface GatewayMetricsBlock {
  total_requests?: number;
  threats_blocked?: {
    semantic_injections?: number;
    spoofed_identities?: number;
    payload_bombs?: number;
    rate_limit_throttled?: number;
  };
  performance?: {
    latency_p50_ms?: number;
    latency_p95_ms?: number;
    throughput_peak_rps?: number;
  };
  economic_impact?: {
    tokens_saved?: number;
    bandwidth_saved_mb?: number;
  };
}

interface GatewayMetricsBody {
  status?: string;
  metrics?: GatewayMetricsBlock;
}

interface UsageTotals {
  totalEvents: number;
  blockedEvents: number;
}

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

const EMPTY_USAGE: UsageTotals = { totalEvents: 0, blockedEvents: 0 };

function positive(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Counts the usage_records of the current period (the ledger the SDK reports into). `orgId` scopes every
 * query to one organization, null reads the whole platform.
 */
async function readUsage(supabase: AdminClient, orgId: string | null): Promise<UsageTotals> {
  const periodMonth = currentPeriodMonth();
  const periodStart = `${periodMonth}T00:00:00.000Z`;
  const periodEnd = `${nextPeriodMonth(periodMonth)}T00:00:00.000Z`;

  let total = supabase
    .from('usage_records')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', periodStart)
    .lt('created_at', periodEnd);
  let blocked = supabase
    .from('usage_records')
    .select('*', { count: 'exact', head: true })
    .eq('event_type', BLOCKED_EVENT_TYPE)
    .gte('created_at', periodStart)
    .lt('created_at', periodEnd);
  if (orgId) {
    total = total.eq('org_id', orgId);
    blocked = blocked.eq('org_id', orgId);
  }

  const [totalRes, blockedRes] = await Promise.all([total, blocked]);
  if (totalRes.error || blockedRes.error) throw new Error('usage_ledger_query_failed');
  return { totalEvents: totalRes.count ?? 0, blockedEvents: blockedRes.count ?? 0 };
}

async function readGateway(): Promise<GatewayMetricsBody | null> {
  const gatewayUrl =
    process.env.NEXT_PUBLIC_GATEWAY_URL ||
    'https://gateway.stealthmark.io';
  try {
    const res = await fetch(`${gatewayUrl.replace(/\/$/, '')}/api/v1/telemetry/metrics`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body: GatewayMetricsBody = await res.json();
    return body;
  } catch (error) {
    console.warn('[StealthMark Telemetry] Gateway metrics unreachable:', error instanceof Error ? error.name : 'unknown');
    return null;
  }
}

// GET /api/telemetry/metrics - Usage metrics of the session organization; platform admins also get gateway totals
export async function GET(req: NextRequest) {
  const access = await resolveTelemetryAccess(req);
  if (!access) return unauthorized();

  const supabase = createSupabaseAdminClient();
  if (!supabase && !access.isAdmin) return unavailable();

  let usage = EMPTY_USAGE;
  let usageAvailable = false;
  if (supabase) {
    try {
      usage = await readUsage(supabase, access.isAdmin ? null : access.orgId);
      usageAvailable = true;
    } catch (error) {
      console.error('[StealthMark Telemetry] Usage ledger query failed:', error instanceof Error ? error.message : 'unknown');
      if (!access.isAdmin) return unavailable();
    }
  }

  // The gateway counters are platform-wide and carry no org_id, so only platform admins may read them.
  const gateway = await readGateway();
  const gw = access.isAdmin ? gateway?.metrics : undefined;
  const gwThreats = gw?.threats_blocked;
  const gwPerf = gw?.performance;
  const gwEcon = gw?.economic_impact;

  const semanticInjections = positive(gwThreats?.semantic_injections);
  const payloadBombs = positive(gwThreats?.payload_bombs);
  const spoofedIdentities = positive(gwThreats?.spoofed_identities);
  const rateLimitThrottled = positive(gwThreats?.rate_limit_throttled);
  const classifiedThreats = semanticInjections + payloadBombs + spoofedIdentities + rateLimitThrottled;
  const tokensSaved = positive(gwEcon?.tokens_saved);

  const sources: string[] = [];
  if (usageAvailable) sources.push('supabase');
  if (access.isAdmin && gw) sources.push('gateway');

  return NextResponse.json(
    {
      status: gateway?.status ?? 'unknown',
      timestamp: Date.now(),
      scope: access.isAdmin ? 'platform' : 'organization',
      metrics: {
        total_requests: Math.max(usage.totalEvents, positive(gw?.total_requests)),
        threats_blocked: {
          policy_blocked: usage.blockedEvents,
          semantic_injections: semanticInjections,
          spoofed_identities: spoofedIdentities,
          payload_bombs: payloadBombs,
          rate_limit_throttled: rateLimitThrottled,
          total_threats: usage.blockedEvents + classifiedThreats,
        },
        performance: {
          latency_p50_ms: positive(gwPerf?.latency_p50_ms),
          latency_p95_ms: positive(gwPerf?.latency_p95_ms),
          throughput_peak_rps: positive(gwPerf?.throughput_peak_rps),
        },
        economic_impact: {
          tokens_saved: tokensSaved,
          bandwidth_saved_mb: positive(gwEcon?.bandwidth_saved_mb),
          estimated_usd_saved: Number(((tokensSaved / 1_000_000) * 3.0).toFixed(2)),
        },
      },
      source: sources.length > 0 ? sources.join('+') : 'empty',
    },
    { headers: NO_STORE },
  );
}
