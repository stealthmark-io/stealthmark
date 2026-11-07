import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '../../../../lib/supabase/admin';
import { USAGE_COLUMNS, parseUsageRows } from '../../usage/_shared';
import { NO_STORE, resolveTelemetryAccess, unauthorized, unavailable } from '../_access';
import { toAuditEvent } from '../_audit-event';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const EVENT_LIMIT = 50;

interface GatewayEventsBody {
  events?: unknown;
}

async function fetchGatewayMemoryEvents(): Promise<unknown[] | null> {
  const gatewayUrl =
    process.env.NEXT_PUBLIC_GATEWAY_URL ||
    'https://gateway.stealthmark.io';
  try {
    const res = await fetch(`${gatewayUrl.replace(/\/$/, '')}/api/v1/telemetry/events`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body: GatewayEventsBody = await res.json();
    return Array.isArray(body.events) ? body.events : null;
  } catch (error) {
    console.warn('[StealthMark Telemetry] Gateway events unreachable:', error instanceof Error ? error.name : 'unknown');
    return null;
  }
}

// GET /api/telemetry/events - Latest agent events of the session organization (all rows for platform admins)
export async function GET(req: NextRequest) {
  const access = await resolveTelemetryAccess(req);
  if (!access) return unauthorized();

  const supabase = createSupabaseAdminClient();
  if (!supabase && !access.isAdmin) return unavailable();

  if (supabase) {
    let query = supabase
      .from('usage_records')
      .select(USAGE_COLUMNS)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(EVENT_LIMIT);
    if (!access.isAdmin) query = query.eq('org_id', access.orgId);

    const { data, error } = await query;
    if (error) console.error('[StealthMark Telemetry] Usage events query failed:', error.message);
    if (error && !access.isAdmin) {
      return NextResponse.json({ events: [], source: 'error' }, { status: 503, headers: NO_STORE });
    }

    if (!error && Array.isArray(data) && data.length > 0) {
      const events = parseUsageRows(data).map(toAuditEvent);
      return NextResponse.json({ events, source: 'supabase' }, { headers: NO_STORE });
    }
  }

  // The gateway keeps an unscoped in-memory ring buffer, so only platform admins may read it.
  if (access.isAdmin) {
    const gatewayEvents = await fetchGatewayMemoryEvents();
    if (gatewayEvents) {
      return NextResponse.json({ events: gatewayEvents, source: 'gateway-memory' }, { headers: NO_STORE });
    }
  }

  return NextResponse.json({ events: [], source: 'empty' }, { headers: NO_STORE });
}
