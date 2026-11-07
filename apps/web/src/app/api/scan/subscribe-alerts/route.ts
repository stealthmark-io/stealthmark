import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { sanitizeAndValidateDomain } from '@/lib/security/network-guard';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';
import { LEAD_EMAIL_RE } from '@/lib/lead-email';
import { readBodyText } from '@/lib/request-body';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAX_BODY_BYTES = 4 * 1024;

export async function POST(req: NextRequest) {
  try {
    const raw = await readBodyText(req, MAX_BODY_BYTES);
    if (raw === null) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    let body: Record<string, unknown> | null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const rawEmail = String(body.email || '').trim().toLowerCase();
    const rawDomain = String(body.domain || '');
    const domain = sanitizeAndValidateDomain(rawDomain);
    const score = Number.isFinite(Number(body.score)) ? Number(body.score) : 0;
    const grade = String(body.grade || 'C').replace(/[^A-F+]/g, '');
    const passes = Number.isFinite(Number(body.passes)) ? Number(body.passes) : 0;
    const issues = Number.isFinite(Number(body.issues)) ? Number(body.issues) : 0;

    if (!LEAD_EMAIL_RE.test(rawEmail) || !domain) {
      return NextResponse.json({ error: 'Valid email and domain are required.' }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();
    if (supabase) {
      // 1. Anti-abuse: do not spam more than once every 24h to the same email + domain
      const { data: existing } = await supabase
        .from('scan_leads' as never)
        .select('id, created_at' as never)
        .eq('email', rawEmail)
        .eq('domain', domain)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const existingRecord = existing as Record<string, unknown> | null;
      if (existingRecord && typeof existingRecord.created_at === 'string') {
        const hoursAgo =
          (Date.now() - new Date(existingRecord.created_at).getTime()) /
          (1000 * 60 * 60);
        if (hoursAgo < 24) {
          return NextResponse.json({ ok: true, status: 'ALREADY_SUBSCRIBED_RECENTLY' });
        }
      }

      // 2. Safe insert matching real Supabase columns
      await supabase.from('scan_leads' as never).insert({
        email: rawEmail,
        domain,
        passes,
        issues,
        source: 'inbound_radar_alert',
        followup_sent: false,
        converted: false,
      } as never);
    }

    // 3. Confirmation via Resend, sent as the team (D-8: no personal name in any sender or signature)
    if (RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'StealthMark Security Team <security@stealthmark.io>',
            to: [rawEmail],
            reply_to: 'security@stealthmark.io',
            headers: { 'List-Unsubscribe': '<mailto:security@stealthmark.io?subject=unsubscribe>' },
            subject: `[Active] Security radar for ${domain} (Current Grade: ${grade})`,
            text: `Hi,

Passive security radar is now active for ${domain} (current evaluation: ${grade} — ${score}/100). We will notify you here if exposed critical ports (3389 RDP, 1433 SQL, 6379 Redis) or urgent vulnerabilities are detected.

You can inspect your ${SCAN_CHECK_COUNT}-point diagnostic report at any time:
https://stealthmark.io/scan?domain=${encodeURIComponent(domain)}

If you need the 3-Page White-Label PDF Report along with the copy-paste Cloudflare WAF rule and Worker (the Fix Pack, $0.99 USD one-time per domain), you can unlock it directly:
https://stealthmark.io/api/billing/polar/checkout?plan=starter_pass&domain=${encodeURIComponent(domain)}

To stop these alerts, reply with "unsubscribe".

StealthMark Security Team
https://stealthmark.io`,
          }),
        });
      } catch (emailErr) {
        console.error('Failed to dispatch alert email:', emailErr);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
