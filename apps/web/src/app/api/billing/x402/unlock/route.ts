import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { sanitizeAndValidateDomain } from '@/lib/security/network-guard';
import {
  canonicalTxHash,
  verifyCryptoPayment,
  type SupportedCryptoNetwork,
} from '@/lib/crypto-verifier';
import { issueScanUnlockToken, isScanUnlockConfigured } from '@/lib/scan-unlock';
import { buildFixPackDeliverables } from '@/lib/fix-pack-deliverables';
import { buildSignedTrustReceipt, fetchDomainAudit, receiptSecret } from '@/lib/trust-receipt';
import {
  buildDualRailAccepts,
  buildDualRailX402Challenge,
  parseX402PaymentHeader,
  settleX402FacilitatorPayment,
  verifyX402FacilitatorPayment,
  X402_UNLOCK_PRODUCTS,
  type X402UnlockProductSpec,
  type X402UnlockTierKey,
} from '@/lib/x402';
import { clientIp } from '@/lib/client-ip';
import { readBodyText } from '@/lib/request-body';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';
import { SITE_ORIGIN } from '@/lib/site';
import {
  checkExistingCreditOrder,
  cleanReferralCode,
  createFixedWindowRateLimiter,
  ledgerUnavailableResponse,
  parseSupportedCryptoNetwork,
  recordCryptoCreditOrder,
  txAlreadyClaimedResponse,
} from '@/lib/billing-crypto-helpers';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4096;
const checkLocalRateLimit = createFixedWindowRateLimiter(20);

function resolveTier(raw: unknown): X402UnlockTierKey {
  return String(raw || '').trim().toLowerCase() === 'micro_receipt' ? 'micro_receipt' : 'fix_pack';
}

type PreparedDeliverable =
  | {
      ok: true;
      tier: 'fix_pack';
      unlockToken: string;
      deliverables: ReturnType<typeof buildFixPackDeliverables>;
    }
  | {
      ok: true;
      tier: 'micro_receipt';
      receipt: ReturnType<typeof buildSignedTrustReceipt>['receipt'];
      signature: string;
    }
  | { ok: false; response: NextResponse };

async function prepareDeliverableBeforeSettle(params: {
  tier: X402UnlockTierKey;
  domain: string;
  orderId: string;
  spec: X402UnlockProductSpec;
  paymentRail: string;
  buyerAgent: string;
  statedClaim: string;
}): Promise<PreparedDeliverable> {
  if (params.tier === 'fix_pack') {
    if (!isScanUnlockConfigured()) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, verified: false, error: 'unlock_unavailable' },
          { status: 503 }
        ),
      };
    }
    const unlockToken = issueScanUnlockToken({
      checkoutId: params.orderId,
      domain: params.domain,
      productId: params.spec.productId,
    });
    if (!unlockToken) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, verified: false, error: 'unlock_unavailable' },
          { status: 503 }
        ),
      };
    }
    return {
      ok: true,
      tier: 'fix_pack',
      unlockToken,
      deliverables: buildFixPackDeliverables(params.domain),
    };
  }

  const secret = receiptSecret();
  if (!secret) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, verified: false, error: 'receipt_signing_unavailable' },
        { status: 503 }
      ),
    };
  }
  const audit = await fetchDomainAudit(params.domain);
  if (!audit) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          verified: false,
          error: 'audit_unavailable',
          detail: 'Domain audit could not complete; settlement was aborted cleanly.',
        },
        { status: 503 }
      ),
    };
  }
  const signed = buildSignedTrustReceipt({
    domain: params.domain,
    buyerAgent: params.buyerAgent,
    statedClaim: params.statedClaim,
    paymentRail: params.paymentRail,
    audit,
    secret,
  });
  return {
    ok: true,
    tier: 'micro_receipt',
    receipt: signed.receipt,
    signature: signed.signature,
  };
}

function buildSuccessJson(params: {
  prepared: Extract<PreparedDeliverable, { ok: true }>;
  domain: string;
  network: string;
  txHash: string;
  amountUsd: number;
  plan: string;
  settledVia: 'x402_facilitator' | 'onchain_rpc';
  xPaymentResponseHeader?: string;
}): NextResponse {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (params.xPaymentResponseHeader) {
    headers['X-Payment-Response'] = params.xPaymentResponseHeader;
  }

  if (params.prepared.tier === 'fix_pack') {
    headers['X-Unlock-Token'] = params.prepared.unlockToken;
    return NextResponse.json(
      {
        ok: true,
        verified: true,
        tier: 'fix_pack',
        settledVia: params.settledVia,
        domain: params.domain,
        network: params.network,
        tx_hash: params.txHash,
        amount_usd: params.amountUsd,
        plan: params.plan,
        unlock_token: params.prepared.unlockToken,
        deliverables: params.prepared.deliverables,
      },
      { status: 200, headers }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      verified: true,
      tier: 'micro_receipt',
      settledVia: params.settledVia,
      domain: params.domain,
      network: params.network,
      tx_hash: params.txHash,
      amount_usd: params.amountUsd,
      plan: params.plan,
      receipt: params.prepared.receipt,
      signature: params.prepared.signature,
      verificationInstruction:
        'POST /api/v2/trust-receipt with { "action": "verify_receipt", "receipt": <receipt>, "signature": "<signature>" }',
    },
    { status: 200, headers }
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tier = resolveTier(searchParams.get('tier'));
  const domain = sanitizeAndValidateDomain(searchParams.get('domain') || '');

  if (domain) {
    return buildDualRailX402Challenge(
      tier,
      `${SITE_ORIGIN}/api/billing/x402/unlock?tier=${tier}&domain=${encodeURIComponent(domain)}`
    );
  }

  return NextResponse.json(
    {
      ok: true,
      protocol: 'x402-deliver-then-settle',
      endpoint: `${SITE_ORIGIN}/api/billing/x402/unlock`,
      rails: ['eip155:8453', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
      tiers: {
        fix_pack: {
          priceUsd: X402_UNLOCK_PRODUCTS.fix_pack.priceUsd,
          atomicUsdc: X402_UNLOCK_PRODUCTS.fix_pack.atomicAmount,
          description: X402_UNLOCK_PRODUCTS.fix_pack.description,
        },
        micro_receipt: {
          priceUsd: X402_UNLOCK_PRODUCTS.micro_receipt.priceUsd,
          atomicUsdc: X402_UNLOCK_PRODUCTS.micro_receipt.atomicAmount,
          description: X402_UNLOCK_PRODUCTS.micro_receipt.description,
        },
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(req: NextRequest) {
  if (!checkLocalRateLimit(clientIp(req) || 'unknown')) {
    return NextResponse.json({ ok: false, verified: false, error: 'rate_limited' }, { status: 429 });
  }

  const raw = await readBodyText(req, MAX_BODY_BYTES);
  if (raw === null) {
    return NextResponse.json({ ok: false, verified: false, error: 'payload_too_large' }, { status: 413 });
  }
  let parsedBody: unknown;
  try {
    parsedBody = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ ok: false, verified: false, error: 'invalid_json' }, { status: 400 });
  }
  if (typeof parsedBody !== 'object' || parsedBody === null || Array.isArray(parsedBody)) {
    return NextResponse.json({ ok: false, verified: false, error: 'invalid_json' }, { status: 400 });
  }

  const body = parsedBody as Record<string, unknown>;
  const field = (k: string): string => (typeof body[k] === 'string' ? (body[k] as string) : '');
  const { searchParams } = new URL(req.url);

  const domain = sanitizeAndValidateDomain(field('domain') || searchParams.get('domain') || '');
  if (!domain) {
    return NextResponse.json({ ok: false, verified: false, error: 'invalid_domain' }, { status: 400 });
  }

  const tier = resolveTier(field('tier') || searchParams.get('tier'));
  const spec = X402_UNLOCK_PRODUCTS[tier];
  const cleanRef = cleanReferralCode(field('ref'));
  const buyerAgent = (field('buyerAgent') || 'autonomous_agent').slice(0, 80);
  const statedClaim = (
    field('claim') ||
    field('statedClaim') ||
    `${SCAN_CHECK_COUNT}-Point OWASP Top 10:2025 Counterparty Verification`
  ).slice(0, 180);

  const xPaymentHeader = req.headers.get('x-payment') || req.headers.get('payment-signature') || '';
  const txHashRaw = field('txHash').trim();

  const resourceUrl = `${SITE_ORIGIN}/api/billing/x402/unlock?tier=${tier}&domain=${encodeURIComponent(domain)}`;

  // 1. Challenge with HTTP 402 if no x402 payment header or direct txHash was submitted
  if (!xPaymentHeader && !txHashRaw) {
    return buildDualRailX402Challenge(tier, resourceUrl);
  }

  // Ledger must be reachable before verify/settle so replay checks cannot be bypassed
  const supabase = createSupabaseAdminClient();
  if (!supabase) return ledgerUnavailableResponse(true);

  // 2. Path A: Native HTTP x402 (EIP-3009 Base USDC / Solana SPL) — Deliver-Then-Settle
  if (xPaymentHeader) {
    const parsedPayment = parseX402PaymentHeader(xPaymentHeader);
    if (!parsedPayment) {
      return NextResponse.json(
        { ok: false, verified: false, error: 'invalid_x402_payment_header' },
        { status: 400 }
      );
    }

    const accepts = buildDualRailAccepts(tier, resourceUrl);
    const requirement = parsedPayment.isSolana ? accepts[1] : accepts[0];
    const orderId = `x402:${tier}:${parsedPayment.authDigest}:${domain}`;

    const { data: existingAuth, error: authLookupErr } = await checkExistingCreditOrder(
      supabase,
      orderId,
      undefined,
      'polar_order_id',
      'x402 Unlock'
    );
    if (authLookupErr) {
      return ledgerUnavailableResponse(true);
    }
    if (existingAuth) return txAlreadyClaimedResponse(undefined, true);

    const verified = await verifyX402FacilitatorPayment(parsedPayment, requirement);
    if (!verified.valid) {
      return NextResponse.json(
        { ok: false, verified: false, error: 'payment_not_verified', detail: verified.error },
        { status: verified.status === 503 ? 503 : 402 }
      );
    }

    const paymentRail = parsedPayment.isSolana
      ? `X402_SOLANA_USDC_${spec.priceUsd}`
      : `X402_BASE_USDC_${spec.priceUsd}`;

    // Deliver / prepare in memory BEFORE facilitator /settle (Deliver-Then-Settle invariant)
    const prepared = await prepareDeliverableBeforeSettle({
      tier,
      domain,
      orderId,
      spec,
      paymentRail,
      buyerAgent,
      statedClaim,
    });
    if (!prepared.ok) return prepared.response;

    const settled = await settleX402FacilitatorPayment(parsedPayment, requirement);
    if (!settled.settled) {
      return NextResponse.json(
        { ok: false, verified: false, error: 'settlement_failed', detail: settled.error },
        { status: 402 }
      );
    }

    const dbNetwork: SupportedCryptoNetwork = parsedPayment.isSolana ? 'solana' : 'base';
    const settledTxHash = canonicalTxHash(dbNetwork, settled.txHash) || settled.txHash.toLowerCase();
    const paidCents = Math.round(spec.minUsd * 100);

    const recordResult = await recordCryptoCreditOrder({
      supabase,
      orderId,
      productId: spec.productId,
      creditsEvents: spec.creditsGranted,
      amountCents: paidCents,
      currency: 'USDC',
      paymentMethod: 'x402_usdc',
      network: dbNetwork,
      txHash: settledTxHash,
      referrerCode: cleanRef,
      logPrefix: 'x402 Unlock',
    });
    if (!recordResult.ok) {
      if (recordResult.error === 'tx_already_claimed') return txAlreadyClaimedResponse(undefined, true);
      return ledgerUnavailableResponse(true);
    }

    const paymentResponseHeader = Buffer.from(
      JSON.stringify({
        success: true,
        transaction: settledTxHash,
        network: requirement.network,
        tier,
      })
    ).toString('base64');

    return buildSuccessJson({
      prepared,
      domain,
      network: dbNetwork,
      txHash: settledTxHash,
      amountUsd: spec.minUsd,
      plan: spec.plan,
      settledVia: 'x402_facilitator',
      xPaymentResponseHeader: paymentResponseHeader,
    });
  }

  // 3. Path B: Direct on-chain txHash fallback
  const network = parseSupportedCryptoNetwork(field('network'));
  if (!network) {
    return NextResponse.json({ ok: false, verified: false, error: 'invalid_network' }, { status: 400 });
  }
  const canonicalHash = canonicalTxHash(network, txHashRaw);
  if (!canonicalHash) {
    return NextResponse.json({ ok: false, verified: false, error: 'invalid_tx_hash' }, { status: 400 });
  }

  const orderId = `x402_onchain:${tier}:${network}:${canonicalHash}:${domain}`;
  const { data: existing, error: lookupError } = await checkExistingCreditOrder(
    supabase,
    orderId,
    canonicalHash,
    'polar_order_id',
    'x402 Unlock'
  );
  if (lookupError) {
    return ledgerUnavailableResponse(true);
  }
  if (existing) return txAlreadyClaimedResponse(undefined, true);

  let verification: Awaited<ReturnType<typeof verifyCryptoPayment>>;
  try {
    verification = await verifyCryptoPayment(network, canonicalHash, spec.minUsd);
  } catch (err: unknown) {
    console.error('[x402 Unlock] verifyCryptoPayment error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { ok: false, verified: false, error: 'verification_unavailable' },
      { status: 503 }
    );
  }
  if (!verification.valid || verification.amountUsd < spec.minUsd) {
    return NextResponse.json(
      {
        ok: false,
        verified: false,
        error: 'payment_not_verified',
        detail:
          verification.error ||
          `On-chain transfer must be at least $${spec.minUsd.toFixed(2)} USD (received $${verification.amountUsd.toFixed(2)}).`,
      },
      { status: 402 }
    );
  }

  const paymentRail = `ONCHAIN_${network.toUpperCase()}_${verification.tokenSymbol}_${verification.amountUsd}USD`;
  const prepared = await prepareDeliverableBeforeSettle({
    tier,
    domain,
    orderId,
    spec,
    paymentRail,
    buyerAgent,
    statedClaim,
  });
  if (!prepared.ok) return prepared.response;

  const paidCents = Math.round(verification.amountUsd * 100);
  const recordResult = await recordCryptoCreditOrder({
    supabase,
    orderId,
    productId: spec.productId,
    creditsEvents: spec.creditsGranted,
    amountCents: paidCents,
    currency: verification.tokenSymbol,
    paymentMethod: `crypto_${verification.tokenSymbol.toLowerCase()}`,
    network,
    txHash: canonicalHash,
    referrerCode: cleanRef,
    logPrefix: 'x402 Unlock',
  });
  if (!recordResult.ok) {
    if (recordResult.error === 'tx_already_claimed') return txAlreadyClaimedResponse(undefined, true);
    return ledgerUnavailableResponse(true);
  }

  return buildSuccessJson({
    prepared,
    domain,
    network,
    txHash: canonicalHash,
    amountUsd: verification.amountUsd,
    plan: spec.plan,
    settledVia: 'onchain_rpc',
  });
}
