import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { clientIp } from '@/lib/client-ip';
import fs from 'node:fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONSOLE_ORG_ID =
  process.env.STEALTHMARK_CONSOLE_ORG_ID ||
  'ecf26102-eff1-4a45-8bb4-630cba346b4a';

const OPENS_LOG_FILE =
  process.env.STEALTHMARK_EMAIL_OPENS_FILE ||
  '/var/cache/stealthmark-web/email_opens.json';

// 1x1 transparent GIF
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const domain = (searchParams.get('domain') || '').toLowerCase().trim().slice(0, 253);
  const email = (searchParams.get('email') || '').toLowerCase().trim().slice(0, 254);
  const ip = clientIp(req) || '127.0.0.1';
  const ua = (req.headers.get('user-agent') || '').slice(0, 300);
  const nowIso = new Date().toISOString();

  if (domain) {
    try {
      let data: Record<string, { email: string; open_count: number; first_opened_at: string; last_opened_at: string; last_ua: string; last_ip: string }> = {};
      if (fs.existsSync(OPENS_LOG_FILE)) {
        data = JSON.parse(fs.readFileSync(OPENS_LOG_FILE, 'utf-8'));
      }
      const prev = data[domain];
      data[domain] = {
        email: email || prev?.email || '',
        open_count: (prev?.open_count || 0) + 1,
        first_opened_at: prev?.first_opened_at || nowIso,
        last_opened_at: nowIso,
        last_ua: ua,
        last_ip: ip,
      };
      fs.writeFileSync(OPENS_LOG_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Non-blocking file log
    }

    const supabase = createSupabaseAdminClient();
    if (supabase) {
      try {
        await supabase.from('usage_records').insert({
          org_id: CONSOLE_ORG_ID,
          event_type: 'agent_request',
          units: 1,
          source: 'sdk',
          agent_identifier: 'EmailOpened',
          metadata: {
            path: `/api/telemetry/open?domain=${domain}`,
            method: 'GET',
            host: 'stealthmark.io',
            domain,
            email,
            ua,
          },
        } as never);
      } catch {
        // Non-blocking supabase insert
      }
    }
  }

  return new NextResponse(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
