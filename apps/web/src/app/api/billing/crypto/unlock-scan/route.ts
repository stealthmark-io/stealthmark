import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { sanitizeAndValidateDomain } from '@/lib/security/network-guard';
import { canonicalTxHash, verifyCryptoPayment, type SupportedCryptoNetwork } from '@/lib/crypto-verifier';
import { issueScanUnlockToken, isScanUnlockConfigured } from '@/lib/scan-unlock';
import { FIX_PACK, FLEET_DEFENSE } from '@/lib/offer';
import { buildFixPackDeliverables } from '@/lib/fix-pack-deliverables';
import { clientIp } from '@/lib/client-ip';
import { readBodyText } from '@/lib/request-body';
import {
  checkExistingCreditOrder,
  createFixedWindowRateLimiter,
  ledgerUnavailableResponse,
  parseSupportedCryptoNetwork,
  recordCryptoCreditOrder,
  txAlreadyClaimedResponse,
} from '@/lib/billing-crypto-helpers';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2048;
// Credits name the plan that was bought: the verifier grants 15,000 for the $0.99 Fix Pack, and older ledger rows may carry 60,000 or 250,000.
const PLANS_BY_CREDITS = new Map<number, { plan: string; productId: string }>([
  [250_000, { plan: FLEET_DEFENSE.plan, productId: FLEET_DEFENSE.productId }],
  [60_000, { plan: FIX_PACK.plan, productId: FIX_PACK.productId }],
  [15_000, { plan: 'starter_pass', productId: FIX_PACK.starterProductId }],
]);
const checkLocalRateLimit = createFixedWindowRateLimiter(15);

function unlockResponse(unlock: {
  domain: string;
  network: SupportedCryptoNetwork;
  txHash: string;
  amountUsd: number;
  plan: string;
  unlockToken: string;
}) {
  return NextResponse.json({
    verified: true,
    domain: unlock.domain,
    network: unlock.network,
    tx_hash: unlock.txHash,
    amount_usd: unlock.amountUsd,
    plan: unlock.plan,
    unlock_token: unlock.unlockToken,
    deliverables: buildFixPackDeliverables(unlock.domain),
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
  if (!domain) {
    return NextResponse.json({ verified: false, error: 'invalid_domain' }, { status: 400 });
  }

  const network = parseSupportedCryptoNetwork(field('network'));
  if (!network) {
    return NextResponse.json({ verified: false, error: 'invalid_network' }, { status: 400 });
  }

  const txHash = canonicalTxHash(network, field('txHash'));
  if (!txHash) {
    return NextResponse.json({ verified: false, error: 'invalid_tx_hash' }, { status: 400 });
  }

  // Without the ledger a transaction could be replayed, so the unlock fails closed.
  const supabase = createSupabaseAdminClient();
  if (!supabase) return ledgerUnavailableResponse();
  // The order id carries the domain so a buyer who lost the response can retry for that domain; the unique index on
  // lower(tx_hash) still lets one transaction pay for one order across every crypto route.
  const orderId = `crypto:${network}:${txHash}:${domain}`;

  // 1. Anti-Replay / Double-Spend check in credit_orders
  const { data: existing, error: lookupError } = await checkExistingCreditOrder(
    supabase,
    orderId,
    txHash,
    'polar_order_id, amount_cents, credits_events',
    'Crypto Unlock'
  );
  if (lookupError) {
    return ledgerUnavailableResponse();
  }
  if (existing) {
    // A retry for the same domain gets its token again from the recorded sale, without asking the chain twice.
    const recorded = existing.polar_order_id === orderId && typeof existing.credits_events === 'number'
      ? PLANS_BY_CREDITS.get(existing.credits_events)
      : undefined;
    if (!recorded || typeof existing.amount_cents !== 'number') return txAlreadyClaimedResponse();
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
  let verification: Awaited<ReturnType<typeof verifyCryptoPayment>>;
  try {
    verification = await verifyCryptoPayment(network, txHash);
  } catch (err: unknown) {
    console.error('[Crypto Unlock] verifyCryptoPayment unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        verified: false,
        error: 'verification_unavailable',
        detail: 'On-chain payment verification is temporarily unavailable. Retry in a minute.',
      },
      { status: 503 }
    );
  }
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
  const recordResult = await recordCryptoCreditOrder({
    supabase,
    orderId,
    productId: purchase.productId,
    creditsEvents: verification.creditsGranted,
    amountCents: paidCents,
    currency: verification.tokenSymbol,
    paymentMethod: `crypto_${verification.tokenSymbol.toLowerCase()}`,
    network,
    txHash,
    referrerCode: field('ref'),
    logPrefix: 'Crypto Unlock',
  });
  if (!recordResult.ok) {
    if (recordResult.error === 'tx_already_claimed') return txAlreadyClaimedResponse();
    return ledgerUnavailableResponse();
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
