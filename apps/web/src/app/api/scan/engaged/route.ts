import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { clientIp, clientNetwork } from '@/lib/client-ip';
import { sanitizeAndValidateDomain } from '@/lib/security/network-guard';
import { classifyUserAgent, parseAttribution } from '@/lib/scan-telemetry';
import { readBodyText } from '@/lib/request-body';

const CONSOLE_ORG_ID =
  process.env.STEALTHMARK_CONSOLE_ORG_ID ||
  'ecf26102-eff1-4a45-8bb4-630cba346b4a';

const ENGAGEMENT_ACTIONS = ['findings_viewed', 'interaction'] as const;

const RATE_WINDOW_MS = 60_000;
const MAX_EVENTS_PER_NETWORK = 10;
// Ceiling for the whole server: rotating networks must not flood usage_records with funnel rows.
const MAX_EVENTS_PER_MINUTE = 60;
const MAX_BODY_BYTES = 2048;

type Window = { count: number; resetAt: number };
const eventsByNetwork = new Map<string, Window>();
const eventsAccepted = new Map<string, Window>();

function countIn(hits: Map<string, Window>, key: string, now: number): number {
  const entry = hits.get(key);
  return entry && entry.resetAt > now ? entry.count : 0;
}

function record(hits: Map<string, Window>, key: string, now: number): void {
  if (hits.size > 2000) {
    for (const [k, v] of hits) {
      if (v.resetAt <= now) hits.delete(k);
    }
  }
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) hits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
  else entry.count += 1;
}

function checkNetworkRateLimit(ip: string): boolean {
  const now = Date.now();
  const network = clientNetwork(ip);
  if (countIn(eventsByNetwork, network, now) >= MAX_EVENTS_PER_NETWORK) return false;
  record(eventsByNetwork, network, now);
  return true;
}

// Spent only on an event about to become a row, so malformed posts cannot use up the minute for real visitors.
function takeServerSlot(): boolean {
  const now = Date.now();
  if (countIn(eventsAccepted, 'all', now) >= MAX_EVENTS_PER_MINUTE) return false;
  record(eventsAccepted, 'all', now);
  return true;
}

/**
 * Records that a visitor actually looked at a /scan report: scrolled the findings into view or
 * interacted with the page. Mail link scanners load /scan with a browser UA but do neither, so this
 * event, not the audit call, is the human signal. Anyone can still post it by hand; it is a signal
 * for the funnel, never an input to billing (the row debits no credits, but on a monthly cap it counts toward the
 * console org's units).
 */
export async function POST(request: Request) {
  // D-5: without a client IP the per-network limiter cannot work, so the request is refused.
  const ip = clientIp(request);
  if (!ip || !checkNetworkRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 });
  }
  // A cross-site page could otherwise make its own visitors' browsers post events with a text/plain body, each from a
  // different network; JSON needs a preflight this route never grants.
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return NextResponse.json({ error: 'Send the event as JSON.' }, { status: 415 });
  }

  const text = await readBodyText(request, MAX_BODY_BYTES);
  if (text === null) {
    return NextResponse.json({ error: 'The event is too large.' }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const domain = typeof fields.domain === 'string' && fields.domain.length <= 253
    ? sanitizeAndValidateDomain(fields.domain)
    : null;
  const action = ENGAGEMENT_ACTIONS.find((candidate) => candidate === fields.action);
  if (!domain || !action) {
    return NextResponse.json({ error: 'Invalid engagement event.' }, { status: 400 });
  }

  const uaClass = classifyUserAgent(request.headers.get('user-agent') || '');
  const supabase = uaClass === 'stealthmark' ? null : createSupabaseAdminClient();
  if (supabase) {
    if (!takeServerSlot()) {
      return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 });
    }
    try {
      await supabase.from('usage_records').insert({
        org_id: CONSOLE_ORG_ID,
        event_type: 'agent_request',
        units: 1,
        source: 'sdk',
        agent_identifier: 'ScanEngaged',
        metadata: {
          path: `/scan?domain=${domain}`,
          method: 'POST',
          host: 'stealthmark.io',
          ua_class: uaClass,
          ref: parseAttribution(typeof fields.ref === 'string' ? fields.ref : null, null),
          action,
        },
      } as never);
    } catch {
      // Non-blocking telemetry
    }
  }
  return new NextResponse(null, { status: 204 });
}
