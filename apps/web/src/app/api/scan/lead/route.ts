import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { clientIp } from '@/lib/client-ip';
import { readBodyText } from '@/lib/request-body';

const CONSOLE_ORG_ID =
  process.env.STEALTHMARK_CONSOLE_ORG_ID ||
  'ecf26102-eff1-4a45-8bb4-630cba346b4a';

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,15}$/;
const VALID_DOMAIN_RE =
  /^(?:https?:\/\/)?([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}(?:\/.*)?$/;

const RATE_WINDOW_MS = 60_000;
const MAX_LEADS_PER_IP = 10;
const MAX_BODY_BYTES = 4 * 1024;
const ipHits = new Map<string, { count: number; resetAt: number }>();

function checkLeadRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || entry.resetAt <= now) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_LEADS_PER_IP) return false;
  entry.count += 1;
  return true;
}

export async function POST(request: Request) {
  const ip = clientIp(request) ?? 'unknown';

  if (!checkLeadRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a minute.' },
      { status: 429 }
    );
  }

  const raw = await readBodyText(request, MAX_BODY_BYTES);
  if (raw === null) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }
  let body: {
    email?: unknown;
    domain?: unknown;
    passes?: number;
    issues?: number;
    source?: unknown;
  } | null;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > 180 || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }
  const domainField = body.domain ?? '';
  if (typeof domainField !== 'string') {
    return NextResponse.json({ error: 'Invalid domain' }, { status: 400 });
  }
  const rawDomain = domainField.trim().toLowerCase();
  if (rawDomain && !VALID_DOMAIN_RE.test(rawDomain)) {
    return NextResponse.json({ error: 'Invalid domain' }, { status: 400 });
  }

  const cleanDomain = rawDomain
    ? rawDomain.replace(/^https?:\/\//i, '').split('/')[0].slice(0, 120)
    : 'unknown';

  const passes = Number.isFinite(body.passes) ? Number(body.passes) : 0;
  const issues = Number.isFinite(body.issues) ? Number(body.issues) : 0;
  const source = (typeof body.source === 'string' && body.source ? body.source : 'scan_modal').slice(0, 40);

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  try {
    await supabase.from('scan_leads' as never).insert({
      email,
      domain: cleanDomain,
      passes,
      issues,
      source,
      followup_sent: false,
      converted: false,
    } as never);

    await supabase.from('usage_records').insert({
      org_id: CONSOLE_ORG_ID,
      event_type: 'agent_request',
      units: 1,
      source: 'sdk',
      agent_identifier: 'LeadEmailCaptured',
      metadata: {
        path: `/scan?domain=${cleanDomain}&lead=${email}`,
        method: 'POST',
        host: 'stealthmark.io',
      },
    } as never);

    return NextResponse.json({ saved: true });
  } catch {
    return NextResponse.json({ error: 'Could not save lead' }, { status: 500 });
  }
}
