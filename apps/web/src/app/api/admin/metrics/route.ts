import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '../../../../lib/supabase/admin';
import { isAuthorizedAdmin } from '../../../../lib/admin-auth';

interface OrganizationRow {
  plan?: string | null;
  domain?: string | null;
}

interface GatewayTelemetryBody {
  status?: string;
  total_requests?: number;
  threats_blocked?: number | Record<string, number>;
  metrics?: {
    total_requests?: number;
    threats_blocked?: number | Record<string, number>;
  };
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function sumThreats(value: number | Record<string, number> | undefined): number {
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).reduce((sum, v) => sum + count(v), 0);
  }
  return count(value);
}

export async function GET(req: NextRequest) {
  try {
    const isAuthorized = await isAuthorizedAdmin(req);
    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Unauthorized: Founder session or valid x-admin-key required' },
        { status: 401 }
      );
    }

    const adminSupabase = createSupabaseAdminClient();

    let totalOrganizations = 0;
    let totalUsers = 0;
    let activeGateways = 0;
    const planCounts = { developer: 0, pro: 0, business: 0, enterprise: 0 };

    if (adminSupabase) {
      try {
        const { data: orgsData } = await adminSupabase
          .from('organizations')
          .select('id, name, slug, domain, plan, status, created_at');
        const orgs: OrganizationRow[] = Array.isArray(orgsData) ? orgsData : [];

        totalOrganizations = orgs.length;
        activeGateways = orgs.filter((o) => Boolean(o.domain)).length;
        planCounts.pro = orgs.filter((o) => o.plan === 'pro').length;
        planCounts.business = orgs.filter((o) => o.plan === 'business').length;
        planCounts.enterprise = orgs.filter((o) => o.plan === 'enterprise').length;
        // Every organization that is not on a named paid or legacy plan is on the free tier ('free', legacy 'developer', unset).
        planCounts.developer = orgs.length - planCounts.pro - planCounts.business - planCounts.enterprise;

        const { count: usersCount } = await adminSupabase
          .from('users')
          .select('*', { count: 'exact', head: true });
        totalUsers = count(usersCount);
      } catch {
        // Counters stay at 0 when the database is unreachable
      }
    }

    // Prepaid credits carry no recurring revenue; only enterprise contracts (invoiced) count as MRR.
    const mrr = 0;
    const arr = mrr * 12;

    let totalRequests = 0;
    let threatsNeutralized = 0;
    let gatewayStatus = 'unknown';

    try {
      const gatewayUrl = process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://gateway.stealthmark.io';
      const teleRes = await fetch(`${gatewayUrl.replace(/\/$/, '')}/api/v1/telemetry/metrics`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (teleRes.ok) {
        const teleData: GatewayTelemetryBody = await teleRes.json();
        totalRequests = count(teleData.metrics?.total_requests) || count(teleData.total_requests);
        threatsNeutralized = sumThreats(teleData.metrics?.threats_blocked) || sumThreats(teleData.threats_blocked);
        if (typeof teleData.status === 'string') gatewayStatus = teleData.status;
      }
    } catch {
      // Gateway unreachable: volume and threat counters stay at 0
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      authorized: isAuthorized,
      kpis: {
        mrr,
        arr,
        currency: 'USD',
        totalOrganizations,
        totalUsers,
        totalProcessedVolume: totalRequests,
        threatsNeutralized,
        activeGatewaysCount: activeGateways,
        planDistribution: planCounts,
      },
      infrastructure: {
        gatewayStatus,
        cloudRunEnclave: 'us-central1 (GCP)',
        merchantOfRecord: 'Polar.sh Live (stealthmark-sa)',
      },
    });
  } catch (err: unknown) {
    console.error('[Admin Metrics Error]:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'metrics_failed' }, { status: 500 });
  }
}
