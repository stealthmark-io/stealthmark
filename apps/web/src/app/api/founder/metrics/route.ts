import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';
import { isAdminEmail, isAuthorizedAdmin } from '@/lib/admin-auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
  'X-Robots-Tag': 'noindex, nofollow',
};

const PORTFOLIO_SITES = [
  { name: 'StealthMark Web & /scan', url: 'https://stealthmark.io' },
  { name: 'StealthMark Core API', url: 'https://api.stealthmark.io/health' },
];

async function isCallerFounder(req: NextRequest): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (sessionCookie) {
      const payload = await verifySessionToken(sessionCookie);
      if (payload?.user?.email && isAdminEmail(payload.user.email)) {
        return true;
      }
    }
  } catch {
    // Fall through to Supabase session / x-admin-key check
  }
  return isAuthorizedAdmin(req);
}

export async function GET(req: NextRequest) {
  const authorized = await isCallerFounder(req);
  if (!authorized) {
    // Return 404 so unauthenticated scanners cannot even fingerprint the endpoint
    return NextResponse.json({ error: 'Not Found' }, { status: 404, headers: NO_STORE_HEADERS });
  }

  const supabase = createSupabaseAdminClient();

  // 1. Supabase queries in parallel
  const [ordersRes, scanLeadsRes, usersRes, usageCountRes, recentUsageRes] = await Promise.all([
    supabase
      ? supabase
          .from('credit_orders')
          .select('polar_order_id, product_id, credits_events, amount_cents, currency, payment_method, network, tx_hash, referrer_code, commission_cents, created_at')
          .order('created_at', { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    supabase
      ? supabase
          .from('scan_leads')
          .select('id, email, domain, source, followup_sent, converted, created_at')
          .order('created_at', { ascending: false })
          .limit(25)
      : Promise.resolve({ data: [], error: null }),
    supabase
      ? supabase
          .from('users')
          .select('email, provider, created_at')
          .order('created_at', { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    supabase
      ? supabase
          .from('usage_records')
          .select('id', { count: 'exact', head: true })
      : Promise.resolve({ count: 0, error: null }),
    supabase
      ? supabase
          .from('usage_records')
          .select('event_type, agent_id, path, created_at')
          .order('created_at', { ascending: false })
          .limit(40)
      : Promise.resolve({ data: [], error: null }),
  ]);

  // 2. Resend live emails
  let resendEmails: Array<{
    id: string;
    to: string;
    subject: string;
    status: string;
    created_at: string;
  }> = [];
  const resendSummary = { delivered: 0, opened: 0, clicked: 0, bounced: 0, total: 0 };

  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    try {
      const rRes = await fetch('https://api.resend.com/emails?limit=35', {
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'User-Agent': 'StealthMarkCommandCenter/1.0',
        },
        cache: 'no-store',
      });
      if (rRes.ok) {
        const rJson = (await rRes.json()) as {
          data?: Array<{
            id: string;
            to?: string[];
            subject?: string;
            last_event?: string;
            created_at?: string;
          }>;
        };
        const list = rJson.data ?? [];
        resendSummary.total = list.length;
        resendEmails = list.map((item) => {
          const st = (item.last_event || 'sent').toLowerCase();
          if (st === 'delivered') resendSummary.delivered += 1;
          else if (st === 'opened') resendSummary.opened += 1;
          else if (st === 'clicked') resendSummary.clicked += 1;
          else if (st === 'bounced' || st === 'complained') resendSummary.bounced += 1;
          return {
            id: item.id,
            to: (item.to && item.to[0]) || '',
            subject: item.subject || '',
            status: st,
            created_at: item.created_at || '',
          };
        });
      }
    } catch {
      // Non-fatal if Resend is unreachable
    }
  }

  // 3. Portfolio live health checks
  const portfolioHealth = await Promise.all(
    PORTFOLIO_SITES.map(async (site) => {
      const start = Date.now();
      try {
        const res = await fetch(site.url, {
          method: 'GET',
          headers: { 'User-Agent': 'StealthMarkHealthMonitor/1.0' },
          cache: 'no-store',
          signal: AbortSignal.timeout(6000),
        });
        return {
          name: site.name,
          url: site.url,
          status: res.status,
          ok: res.status >= 200 && res.status < 400,
          latencyMs: Date.now() - start,
        };
      } catch {
        return {
          name: site.name,
          url: site.url,
          status: 0,
          ok: false,
          latencyMs: Date.now() - start,
        };
      }
    })
  );

  const orders = (ordersRes.data ?? []) as Array<{
    polar_order_id: string;
    product_id: string;
    credits_events: number;
    amount_cents: number;
    currency: string;
    payment_method: string;
    network: string | null;
    tx_hash: string | null;
    referrer_code: string | null;
    commission_cents: number | null;
    created_at: string;
  }>;

  const totalRevenueCents = orders.reduce((acc, o) => acc + Number(o.amount_cents || 0), 0);

  return NextResponse.json(
    {
      timestamp: new Date().toISOString(),
      revenue: {
        totalOrders: orders.length,
        totalRevenueUsd: (totalRevenueCents / 100).toFixed(2),
        orders,
      },
      leads: {
        scanLeads: scanLeadsRes.data ?? [],
        users: usersRes.data ?? [],
      },
      telemetry: {
        totalEvents: usageCountRes.count ?? 0,
        recentEvents: recentUsageRes.data ?? [],
      },
      resend: {
        configured: Boolean(resendApiKey),
        summary: resendSummary,
        emails: resendEmails,
      },
      portfolio: portfolioHealth,
    },
    { status: 200, headers: NO_STORE_HEADERS }
  );
}
