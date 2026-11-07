import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { hashApiKey } from '@/lib/api-keys';
import { clientIp } from '@/lib/client-ip';
import { readBodyText } from '@/lib/request-body';

const verifyKeySchema = z.object({
  api_key: z
    .string()
    .trim()
    .regex(/^sk_live_[0-9a-fA-F]{32}$/, 'API key must match sk_live_<32-hex-chars>'),
});

const RATE_WINDOW_MS = 60_000;
const MAX_VERIFY_PER_IP_PER_MIN = 20;
const MAX_TRACKED_IPS = 5_000;
const MAX_BODY_BYTES = 2 * 1024;
const ipHits = new Map<string, { count: number; resetAt: number }>();

function checkVerifyRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now >= entry.resetAt) {
    if (ipHits.size >= MAX_TRACKED_IPS) {
      const oldestKey = ipHits.keys().next().value;
      if (oldestKey) ipHits.delete(oldestKey);
    }
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_VERIFY_PER_IP_PER_MIN) {
    return false;
  }
  entry.count += 1;
  return true;
}

interface OrgBillingRow {
  id: string;
  plan: string | null;
  billing_mode: string | null;
  credit_balance_events: number | null;
}

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req) ?? 'unknown';

    if (!checkVerifyRateLimit(ip)) {
      return NextResponse.json(
        { valid: false, error: 'rate_limit_exceeded', message: 'Too many verification attempts. Try again in a minute.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }

    const raw = await readBodyText(req, MAX_BODY_BYTES);
    if (raw === null) {
      return NextResponse.json(
        { valid: false, error: 'payload_too_large', message: 'Request body is too large.' },
        { status: 413 }
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }
    const parsed = verifyKeySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { valid: false, error: 'invalid_key_format', message: 'Invalid API key format.' },
        { status: 400 }
      );
    }

    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { valid: false, error: 'server_configuration_error' },
        { status: 500 }
      );
    }

    const keyHash = hashApiKey(parsed.data.api_key);
    const { data: keyRecord, error } = await supabase
      .from('api_keys')
      .select('id, org_id, status')
      .eq('key_hash', keyHash)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (error || !keyRecord) {
      return NextResponse.json(
        { valid: false, error: 'invalid_key', message: 'API key not found or revoked.' },
        { status: 401 }
      );
    }

    const orgId = (keyRecord as { org_id: string }).org_id;
    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .select('id, plan, billing_mode, credit_balance_events')
      .eq('id', orgId)
      .maybeSingle();

    if (orgError || !orgData) {
      return NextResponse.json(
        { valid: false, error: 'organization_not_found', message: 'Associated organization not found.' },
        { status: 401 }
      );
    }

    const org = orgData as OrgBillingRow;
    const creditBalance = Number(org.credit_balance_events ?? 0);
    const isEnterprise = org.billing_mode === 'enterprise' || org.plan === 'enterprise';
    const hasPaidCredits = creditBalance > 0 || isEnterprise;

    if (!hasPaidCredits) {
      return NextResponse.json(
        {
          valid: false,
          error: 'free_tier_key',
          message:
            'Free Tier keys only include passive SDK telemetry (250 events/mo). Unlocking full remediation code and 1-click /llms.txt & agent.json generation requires a prepaid credit pack (Starter from $9, one-time).',
        },
        { status: 402 }
      );
    }

    return NextResponse.json({
      valid: true,
      org_id: orgId,
      credits_remaining: creditBalance,
    });
  } catch {
    return NextResponse.json(
      { valid: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}
