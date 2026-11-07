import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '../../../../lib/supabase/admin';
import { getOrgSession } from '../../../../lib/session';
import {
  HOST_COLUMN,
  USAGE_COLUMNS,
  decodeCursor,
  encodeCursor,
  parseHostFilter,
  parseLimit,
  parseUsageRows,
  type UsageEventsResponse,
} from '../_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store' };

function respond(body: UsageEventsResponse | { error: string }, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

// GET /api/usage/events?limit=&cursor=&host= - Recent SDK and gateway events of the session organization
export async function GET(req: NextRequest) {
  const session = await getOrgSession();
  if (!session) return respond({ error: 'unauthorized' }, 401);

  const params = req.nextUrl.searchParams;
  const limit = parseLimit(params.get('limit'));
  if (limit === null) return respond({ error: 'invalid_limit' }, 400);

  const rawCursor = params.get('cursor');
  const cursor = rawCursor === null ? null : decodeCursor(rawCursor);
  if (rawCursor !== null && !cursor) return respond({ error: 'invalid_cursor' }, 400);

  const hostFilter = parseHostFilter(params.get('host'));
  if (!hostFilter.valid) return respond({ error: 'invalid_host' }, 400);

  const supabase = createSupabaseAdminClient();
  if (!supabase) return respond({ error: 'service_unavailable' }, 503);

  let query = supabase
    .from('usage_records')
    .select(USAGE_COLUMNS)
    .eq('org_id', session.orgId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (hostFilter.host) query = query.eq(HOST_COLUMN, hostFilter.host);
  if (cursor) {
    query = query.or(
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt."${cursor.id}")`,
    );
  }

  const { data, error } = await query;
  if (error) return respond({ error: 'query_failed' }, 500);

  const rawRows: unknown[] = Array.isArray(data) ? data : [];
  const hasMore = rawRows.length > limit;
  const events = parseUsageRows(rawRows.slice(0, limit));
  const last = events[events.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null;

  return respond({ events, next_cursor: nextCursor }, 200);
}
