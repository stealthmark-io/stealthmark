import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { clientIp } from '@/lib/client-ip';
import { generateApiKey } from '@/lib/api-keys';
import { verifyCryptoPayment, type SupportedCryptoNetwork } from '@/lib/crypto-verifier';
import { readBodyText } from '@/lib/request-body';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 2048;
const VALID_DOMAIN_RE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?\.[a-z]{2,}$/;
const CLAIM_WINDOW_MS = 60_000;
const MAX_CLAIMS_PER_IP_PER_MIN = 15;
const claimIpHits = new Map<string, { count: number; resetAt: number }>();

function checkClaimRateLimit(ip: string): boolean {
  if (ip === 'unknown') return true;
  const now = Date.now();
  const entry = claimIpHits.get(ip);
  if (!entry || now >= entry.resetAt) {
    if (claimIpHits.size >= 5_000) {
      const oldest = claimIpHits.keys().next().value;
      if (oldest) claimIpHits.delete(oldest);
    }
    claimIpHits.set(ip, { count: 1, resetAt: now + CLAIM_WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_CLAIMS_PER_IP_PER_MIN) return false;
  entry.count += 1;
  return true;
}

const claimSchema = z.object({
  network: z.enum(['base', 'polygon', 'bsc', 'tron']),
  tx_hash: z
    .string()
    .trim()
    .min(10, 'Transaction hash too short')
    .max(130)
    .regex(/^(?:0x)?[0-9a-zA-Z_-]{10,128}$/, 'Invalid transaction hash format'),
  domain: z.string().max(255).optional(),
  referrer: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_.-]{2,64}$/, 'Invalid referrer code')
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req) ?? 'unknown';
    if (!checkClaimRateLimit(ip)) {
      return NextResponse.json(
        { error: 'rate_limit_exceeded', message: 'Too many claim attempts from this address. Try again in a minute.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }

    const raw = await readBodyText(req, MAX_BODY_BYTES);
    if (raw === null) {
      return NextResponse.json(
        { error: 'payload_too_large', message: 'Request body is too large.' },
        { status: 413 }
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }
    const parsed = claimSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation_error', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { network, tx_hash, domain, referrer } = parsed.data;
    const rawLower = tx_hash.trim().toLowerCase();
    const normalizedHash =
      network === 'tron'
        ? rawLower.replace(/^0x/, '')
        : rawLower.startsWith('0x')
          ? rawLower
          : `0x${rawLower}`;
    const orderId = `crypto:${network}:${normalizedHash}`;

    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { error: 'database_unavailable', message: 'Backend database connection is not configured' },
        { status: 503 }
      );
    }

    // 1. Idempotency check: verify this tx has not been claimed yet
    const { data: existingOrder } = await supabase
      .from('credit_orders')
      .select('polar_order_id, org_id, credits_events, created_at')
      .or(`polar_order_id.eq.${orderId},tx_hash.eq.${normalizedHash.toLowerCase()}`)
      .limit(1)
      .maybeSingle();

    if (existingOrder) {
      return NextResponse.json(
        {
          error: 'already_claimed',
          message: 'This transaction hash has already been claimed and credits were provisioned.',
        },
        { status: 409 }
      );
    }

    // 2. Real on-chain verification
    const verification = await verifyCryptoPayment(network as SupportedCryptoNetwork, normalizedHash);
    if (!verification.valid) {
      return NextResponse.json(
        {
          error: 'verification_failed',
          message: verification.error || 'On-chain verification failed. Check transaction status and receiving address.',
        },
        { status: 400 }
      );
    }

    // 3. Atomically provision organization + API key
    const shortHash = normalizedHash.replace(/^0x/i, '').slice(0, 8);
    const orgName = `Crypto (${network.toUpperCase()}:${shortHash})`;
    const orgSlug = `crypto-${crypto.randomUUID().slice(0, 10)}`;

    const { data: createdOrg, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name: orgName,
        slug: orgSlug,
        plan: 'free',
        status: 'active',
        billing_mode: 'credits',
        monthly_event_cap: 250,
        credit_balance_events: verification.creditsGranted,
      })
      .select('id, name, slug')
      .single();

    if (orgError || !createdOrg) {
      console.error('[Crypto Claim] Org creation failed:', orgError);
      return NextResponse.json(
        { error: 'provisioning_failed', message: 'Failed to provision organization.' },
        { status: 500 }
      );
    }

    // 4. Record order in credit_orders (idempotency anchor + 30% A2A referral commission)
    const amountCents = Math.round(verification.amountUsd * 100);
    const senderLower = (verification.senderAddress || '').toLowerCase();
    const cleanReferrer =
      referrer && referrer.trim().toLowerCase() !== senderLower ? referrer.trim().toLowerCase() : null;
    const commissionCents = cleanReferrer ? Math.round(amountCents * 0.30) : 0;

    const { error: orderError } = await supabase.from('credit_orders').insert({
      polar_order_id: orderId,
      org_id: createdOrg.id,
      product_id: `crypto_${verification.packName.toLowerCase().replace(/\s+/g, '_')}`,
      credits_events: verification.creditsGranted,
      amount_cents: amountCents,
      currency: verification.tokenSymbol,
      payment_method: 'crypto',
      network,
      tx_hash: normalizedHash.toLowerCase(),
      referrer_code: cleanReferrer,
      commission_cents: commissionCents,
    });

    if (orderError) {
      console.error('[Crypto Claim] Credit orders insert failed:', orderError);
      // Rollback org if duplicate race or DB constraint hit
      await supabase.from('organizations').delete().eq('id', createdOrg.id);
      return NextResponse.json(
        { error: 'order_recording_failed', message: 'Failed to register credit order.' },
        { status: 409 }
      );
    }

    // 5. Generate and store active API key
    const { key, keyPrefix, keyHash } = generateApiKey();
    const { error: keyError } = await supabase.from('api_keys').insert({
      org_id: createdOrg.id,
      name: `Crypto Key (${verification.packName})`,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      scopes: ['extract', 'capabilities:read', 'audit'],
      rate_limit_rpm: 120,
      rate_limit_rpd: 10000,
      status: 'active',
    });

    if (keyError) {
      console.error('[Crypto Claim] API Key insert failed:', keyError);
      // Rollback credit_orders and organization so the user can retry claiming their tx_hash
      await supabase.from('credit_orders').delete().eq('polar_order_id', orderId);
      await supabase.from('organizations').delete().eq('id', createdOrg.id);
      return NextResponse.json(
        { error: 'key_generation_failed', message: 'Key generation failed. Please retry your claim.' },
        { status: 500 }
      );
    }

    // 6. Optional domain association (strictly validated hostname)
    if (domain && domain.trim()) {
      const cleanDomain = domain
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .split('/')[0]
        .split('?')[0]
        .split('#')[0]
        .split('@')
        .pop()!
        .split(':')[0]
        .replace(/\.$/, '');
      if (VALID_DOMAIN_RE.test(cleanDomain)) {
        try {
          await supabase.from('registered_sites').insert({
            org_id: createdOrg.id,
            domain: cleanDomain,
            display_name: cleanDomain,
            status: 'pending',
          });
        } catch {
          // Non-blocking optional domain association
        }
      }
    }

    return NextResponse.json(
      {
        success: true,
        api_key: key,
        credits: verification.creditsGranted,
        pack: verification.packName,
        amount_usd: verification.amountUsd,
        token: verification.tokenSymbol,
        network,
        tx_hash: normalizedHash,
        org_id: createdOrg.id,
        message: 'Crypto credit pack active. Save your API key: it will not be shown again.',
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    console.error('[Crypto Claim Error]:', err);
    return NextResponse.json(
      { error: 'internal_error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
