import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { clientIp } from '@/lib/client-ip';

export const runtime = 'nodejs';

const REF_PATTERN = /^[a-zA-Z0-9_.-]{2,64}$/;
const STATS_WINDOW_MS = 60_000;
const MAX_STATS_PER_IP_PER_MIN = 30;
const statsIpHits = new Map<string, { count: number; resetAt: number }>();

function checkStatsRateLimit(ip: string): boolean {
  if (ip === 'unknown') return true;
  const now = Date.now();
  const entry = statsIpHits.get(ip);
  if (!entry || now >= entry.resetAt) {
    if (statsIpHits.size >= 5_000) {
      const oldest = statsIpHits.keys().next().value;
      if (oldest) statsIpHits.delete(oldest);
    }
    statsIpHits.set(ip, { count: 1, resetAt: now + STATS_WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_STATS_PER_IP_PER_MIN) return false;
  entry.count += 1;
  return true;
}

interface ReferralOrderRow {
  amount_cents: number | null;
  commission_cents: number | null;
  credits_events: number | null;
  currency: string | null;
  payment_method: string | null;
  network: string | null;
  created_at: string | null;
}

export async function GET(req: NextRequest) {
  const ip = clientIp(req) ?? 'unknown';
  if (!checkStatsRateLimit(ip)) {
    return NextResponse.json(
      { error: 'rate_limit_exceeded', message: 'Too many requests. Retry in a minute.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  const ref = (req.nextUrl.searchParams.get('ref') || '').trim().toLowerCase();
  if (!ref || !REF_PATTERN.test(ref)) {
    return NextResponse.json(
      {
        error: 'invalid_ref',
        message: 'Provide a valid ?ref=<agent_name_or_wallet> parameter (2-64 alphanumeric characters).',
      },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: 'database_unavailable' }, { status: 503 });
  }

  const { data, error } = await supabase
    .from('credit_orders')
    .select('amount_cents, commission_cents, credits_events, currency, payment_method, network, created_at')
    .eq('referrer_code', ref)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: 'query_failed' }, { status: 500 });
  }

  const orders = (data ?? []) as ReferralOrderRow[];
  const verifiedSalesCount = orders.length;
  const totalVolumeCents = orders.reduce((acc: number, o: ReferralOrderRow) => acc + (Number(o.amount_cents) || 0), 0);
  const totalCommissionCents = orders.reduce(
    (acc: number, o: ReferralOrderRow) => acc + (Number(o.commission_cents) || 0),
    0
  );

  return NextResponse.json(
    {
      referrer: ref,
      commission_rate: '30%',
      commission_details:
        '30% commission recorded per referred unlock. Commissions are recorded, not paid out automatically.',
      payout_methods: [],
      verified_sales_count: verifiedSalesCount,
      total_volume_usd: Number((totalVolumeCents / 100).toFixed(2)),
      earned_commission_usd: Number(((totalVolumeCents * 0.30) / 100).toFixed(2)),
      bonus_credits_earned: verifiedSalesCount * 1500,
      referral_link: `https://stealthmark.io/scan?ref=${encodeURIComponent(ref)}`,
      recent_referrals: orders.slice(0, 10).map((o: ReferralOrderRow) => ({
        amount_usd: Number(((Number(o.amount_cents) || 0) / 100).toFixed(2)),
        commission_usd: Number(((Number(o.commission_cents) || 0) / 100).toFixed(2)),
        payment_method: o.payment_method,
        network: o.network,
        created_at: o.created_at,
      })),
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
      },
    }
  );
}
