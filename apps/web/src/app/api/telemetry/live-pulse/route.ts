import { NextResponse } from 'next/server';
import { getQuotaStoreStats } from '@/lib/scan-quota';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export interface LivePulseResponse {
  ok: true;
  updated_at: string;
  domainsScannedTotal: number;
  domainsScanned24h: number;
  issuesFound24h: number;
  aiAgentsBlocked24h: number | null;
}

const CACHE_TTL_MS = 5_000;

let cachedPulse: { expiresAt: number; payload: LivePulseResponse } | null = null;

async function countAgentBlocks24h(nowMs: number): Promise<number | null> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return null;
  const { count, error } = await supabase
    .from('usage_records')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'agent_blocked')
    .gte('created_at', new Date(nowMs - 24 * 60 * 60 * 1000).toISOString());
  return error ? null : (count ?? null);
}

export async function GET() {
  const nowMs = Date.now();
  if (!cachedPulse || cachedPulse.expiresAt <= nowMs) {
    cachedPulse = {
      expiresAt: nowMs + CACHE_TTL_MS,
      payload: {
        ok: true,
        updated_at: new Date(nowMs).toISOString(),
        ...getQuotaStoreStats(nowMs),
        aiAgentsBlocked24h: await countAgentBlocks24h(nowMs),
      },
    };
  }
  return NextResponse.json(cachedPulse.payload, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
