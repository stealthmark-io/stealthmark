import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { sanitizeAndValidateDomain } from '@/lib/security/network-guard';
import { canonicalTxHash, verifyCryptoPayment, SupportedCryptoNetwork } from '@/lib/crypto-verifier';
import { issueScanUnlockToken, isScanUnlockConfigured, signBadge } from '@/lib/scan-unlock';
import { FIX_PACK, FLEET_DEFENSE } from '@/lib/offer';
import { CLOUDFLARE_WAF_RULE, buildEdgeWorker, buildClientRaspShield } from '@/lib/fix-pack-deliverables';
import { clientIp } from '@/lib/client-ip';
import { readBodyText } from '@/lib/request-body';

export const dynamic = 'force-dynamic';

const VALID_NETWORKS: SupportedCryptoNetwork[] = ['ethereum', 'btc', 'solana', 'polygon', 'base', 'bsc', 'tron'];
const MAX_BODY_BYTES = 2048;
// Credits name the plan that was bought: the verifier grants 15,000 for the $0.99 Fix Pack, and older ledger rows may carry 60,000 or 250,000.
const PLANS_BY_CREDITS = new Map<number, { plan: string; productId: string }>([
  [250_000, { plan: FLEET_DEFENSE.plan, productId: FLEET_DEFENSE.productId }],
  [60_000, { plan: FIX_PACK.plan, productId: FIX_PACK.productId }],
  [15_000, { plan: 'starter_pass', productId: FIX_PACK.starterProductId }],
]);
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkLocalRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt <= now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 15;
}

const PG_UNIQUE_VIOLATION = '23505';

function txAlreadyClaimed() {
  return NextResponse.json(
    { verified: false, error: 'tx_already_claimed', detail: 'This transaction hash has already been used.' },
    { status: 409 }
  );
}

function ledgerUnavailable() {
  return NextResponse.json(
    {
      verified: false,
      error: 'ledger_unavailable',
      detail: 'The payment could not be recorded right now, so the transaction was not used. Retry in a minute.',
    },
    { status: 503 }
  );
}

function unlockResponse(unlock: {
  domain: string;
  network: SupportedCryptoNetwork;
  txHash: string;
  amountUsd: number;
  plan: string;
  unlockToken: string;
}) {
  const badgeSig = signBadge(unlock.domain, 'A+', 98);
  const badgeUrl = `https://stealthmark.io/api/badge/${encodeURIComponent(unlock.domain)}.svg${
    badgeSig ? `?sig=${badgeSig}` : ''
  }`;

  return NextResponse.json({
    verified: true,
    domain: unlock.domain,
    network: unlock.network,
    tx_hash: unlock.txHash,
    amount_usd: unlock.amountUsd,
    plan: unlock.plan,
    unlock_token: unlock.unlockToken,
    deliverables: {
      cloudflare_visual_waf_rule: CLOUDFLARE_WAF_RULE,
      cloudflare_worker_code: buildEdgeWorker(unlock.domain),
      client_rasp_shield_js: buildClientRaspShield(unlock.domain),
      live_badge_html: `<a href="https://stealthmark.io/verify/${encodeURIComponent(
        unlock.domain
      )}?utm_source=trust_badge" target="_blank" rel="noopener"><img src="${badgeUrl}" alt="StealthMark Verified Perimeter" height="28" /></a>`,
    },
  });
}

export async function POST(req: NextRequest) {
  if (!checkLocalRateLimit(clientIp(req) || 'unknown')) {
    return NextResponse.json({ verified: false, error: 'rate_limited' }, { status: 429 });
  }

  if (!isScanUnlockConfigured()) {
    return NextResponse.json({ verified: false, error: 'unlock_unavailable' }, { status: 503 });
  }

  const raw = await readBodyText(req, MAX_BODY_BYTES);
  if (raw === null) {
    return NextResponse.json({ verified: false, error: 'payload_too_large' }, { status: 413 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ verified: false, error: 'invalid_json' }, { status: 400 });
  }
  // `null`, an array or a bare value is valid JSON but carries none of the fields.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return NextResponse.json({ verified: false, error: 'invalid_json' }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  const field = (key: string): string => {
    const value = body[key];
    return typeof value === 'string' ? value : '';
  };

  const domain = sanitizeAndValidateDomain(field('domain'));
  const network = field('network').toLowerCase() as SupportedCryptoNetwork;
  const rawRef = field('ref').trim().toLowerCase();
  const cleanRef = /^[a-z0-9_.-]{2,64}$/.test(rawRef) ? rawRef : null;

  if (!domain) {
    return NextResponse.json({ verified: false, error: 'invalid_domain' }, { status: 400 });
  }
  if (!VALID_NETWORKS.includes(network)) {
    return NextResponse.json({ verified: false, error: 'invalid_network' }, { status: 400 });
  }
  const txHash = canonicalTxHash(network, field('txHash'));
  if (!txHash) {
    return NextResponse.json({ verified: false, error: 'invalid_tx_hash' }, { status: 400 });
  }

  // Without the ledger a transaction could be replayed, so the unlock fails closed.
  const supabase = createSupabaseAdminClient();
  if (!supabase) return ledgerUnavailable();
  // The order id carries the domain so a buyer who lost the response can retry for that domain; the unique index on
  // lower(tx_hash) still lets one transaction pay for one order across every crypto route.
  const orderId = `crypto:${network}:${txHash}:${domain}`;

  // 1. Anti-Replay / Double-Spend check in credit_orders
  const { data: existing, error: lookupError } = await supabase
    .from('credit_orders')
    .select('polar_order_id, amount_cents, credits_events')
    .or(`polar_order_id.eq.${orderId},tx_hash.eq.${txHash}`)
    .limit(1)
    .maybeSingle();
  if (lookupError) {
    console.error(`[Crypto Unlock] credit_orders lookup failed: ${lookupError.code}`);
    return ledgerUnavailable();
  }
  if (existing) {
    // A retry for the same domain gets its token again from the recorded sale, without asking the chain twice.
    const recorded = existing.polar_order_id === orderId ? PLANS_BY_CREDITS.get(existing.credits_events) : undefined;
    if (!recorded || typeof existing.amount_cents !== 'number') return txAlreadyClaimed();
    const unlockToken = issueScanUnlockToken({ checkoutId: orderId, domain, productId: recorded.productId });
    if (!unlockToken) {
      return NextResponse.json({ verified: false, error: 'unlock_unavailable' }, { status: 503 });
    }
    return unlockResponse({
      domain,
      network,
      txHash,
      amountUsd: existing.amount_cents / 100,
      plan: recorded.plan,
      unlockToken,
    });
  }

  // 2. Cryptographic RPC Verification on-chain (Ethereum, BTC, Solana, Polygon, Base, BSC, or Tron TRC-20)
  const verification = await verifyCryptoPayment(network, txHash);
  const purchase = verification.valid ? PLANS_BY_CREDITS.get(verification.creditsGranted) : undefined;
  if (!purchase) {
    return NextResponse.json(
      {
        verified: false,
        error: 'payment_not_verified',
        detail:
          verification.error ||
          `On-chain transfer must be at least ${FIX_PACK.starterPriceLabel} USD for the Fix Pack (received $${verification.amountUsd.toFixed(2)}).`,
      },
      { status: 402 }
    );
  }
  const paidCents = Math.round(verification.amountUsd * 100);

  // 3. Issue cryptographic HMAC unlock token for this domain
  const unlockToken = issueScanUnlockToken({
    checkoutId: orderId,
    domain,
    productId: purchase.productId,
  });
  if (!unlockToken) {
    return NextResponse.json({ verified: false, error: 'unlock_unavailable' }, { status: 503 });
  }

  // 4. Record the sale before returning the token, so a failed insert or a concurrent replay of the same transaction
  // gets nothing. A referral code and its 30% commission are recorded, not paid out automatically.
  const { error: insertError } = await supabase.from('credit_orders').insert({
    polar_order_id: orderId,
    org_id: process.env.STEALTHMARK_CONSOLE_ORG_ID || 'ecf26102-eff1-4a45-8bb4-630cba346b4a',
    product_id: purchase.productId,
    credits_events: verification.creditsGranted,
    amount_cents: paidCents,
    currency: verification.tokenSymbol,
    payment_method: `crypto_${verification.tokenSymbol.toLowerCase()}`,
    network,
    tx_hash: txHash,
    referrer_code: cleanRef,
    commission_cents: cleanRef ? Math.round(paidCents * 0.30) : 0,
  });
  if (insertError) {
    if (insertError.code === PG_UNIQUE_VIOLATION) return txAlreadyClaimed();
    console.error(`[Crypto Unlock] credit_orders insert failed: ${insertError.code}`);
    return ledgerUnavailable();
  }

  return unlockResponse({
    domain,
    network,
    txHash,
    amountUsd: verification.amountUsd,
    plan: purchase.plan,
    unlockToken,
  });
}
