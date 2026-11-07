import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { canonicalTxHash, verifyCryptoPayment, type SupportedCryptoNetwork } from '@/lib/crypto-verifier';
import { readBodyText } from '@/lib/request-body';
import { verifyScanUnlockToken } from '@/lib/scan-unlock';
import { sanitizeAndValidateDomain } from '@/lib/security/network-guard';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { SITE_ORIGIN } from '@/lib/site';

// Receipts are signed only with a configured secret: a default in the source would let anyone forge one.
function receiptSecret(): string | null {
  return process.env.STEALTHMARK_RECEIPT_HMAC_SECRET || process.env.STEALTHMARK_UNSUB_SECRET || null;
}

const BASE_USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EVM_TREASURY_WALLET = '0xc8dc4ecb93c4c665Fad07E1261F5f7D60e3C6E0F';
const TRON_TREASURY_WALLET = 'TYgGahN7wK9NtUVFZaXCwZqktaYmkuNxD8';

const MAX_BODY_BYTES = 4096;
// A sandbox receipt is signed so integrators can test the flow, but verify_receipt never reports it as valid.
const SANDBOX_RAIL = 'SANDBOX_PREVIEW_NON_PRODUCTION';

interface CanonicalReceiptPayload {
  version: 'stealthmark-trust-receipt-v1';
  receiptId: string;
  nonce: string;
  sellerDomain: string;
  buyerAgent: string;
  statedClaim: string;
  decision: 'ALLOW_SETTLEMENT' | 'CONDITIONAL_ESCROW' | 'ABORT_HIGH_RISK';
  grade: string;
  passCount: number;
  warnCount: number;
  failCount: number;
  paymentRail: string;
  issuedAt: string;
  expiresAt: string;
}

function signCanonicalReceipt(payload: CanonicalReceiptPayload, secret: string): string {
  const canonical = JSON.stringify({
    version: payload.version,
    receiptId: payload.receiptId,
    nonce: payload.nonce,
    sellerDomain: payload.sellerDomain,
    buyerAgent: payload.buyerAgent,
    statedClaim: payload.statedClaim,
    decision: payload.decision,
    grade: payload.grade,
    passCount: payload.passCount,
    warnCount: payload.warnCount,
    failCount: payload.failCount,
    paymentRail: payload.paymentRail,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  });
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

function verifyCanonicalReceiptConstantTime(
  payload: CanonicalReceiptPayload,
  signatureHex: string,
  secret: string
): boolean {
  try {
    const expectedHex = signCanonicalReceipt(payload, secret);
    const a = Buffer.from(expectedHex, 'hex');
    const b = Buffer.from(String(signatureHex || ''), 'hex');
    if (a.length !== b.length || a.length === 0) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

interface DomainAudit {
  grade: string;
  passCount: number;
  warnCount: number;
  failCount: number;
}

interface AuditBody {
  badge?: { grade?: unknown } | null;
  summary?: { counts?: { pass?: unknown; warn?: unknown; fail?: unknown } } | null;
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

// Returns null when the audit cannot be read, so a receipt is never signed over counts the scanner did not produce.
async function fetchDomainAudit(domain: string): Promise<DomainAudit | null> {
  try {
    const res = await fetch(`http://127.0.0.1:3000/api/scan/audit?domain=${encodeURIComponent(domain)}`, {
      headers: { 'User-Agent': 'StealthMarkOutboundAuditor/1.0' },
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error(`[Trust Receipt] audit answered ${res.status}`);
      return null;
    }
    const data = (await res.json()) as AuditBody | null;
    const grade = data?.badge?.grade;
    const pass = data?.summary?.counts?.pass;
    const warn = data?.summary?.counts?.warn;
    const fail = data?.summary?.counts?.fail;
    if (typeof grade !== 'string' || !grade || !isCount(pass) || !isCount(warn) || !isCount(fail)) {
      console.error('[Trust Receipt] audit answered without a grade and counts');
      return null;
    }
    return { grade, passCount: pass, warnCount: warn, failCount: fail };
  } catch (err: unknown) {
    console.error('[Trust Receipt] audit failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

function auditUnavailable() {
  return NextResponse.json(
    { ok: false, error: 'The domain audit is unavailable, so nothing was signed and no payment was used. Retry later.' },
    { status: 503 }
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const domain = sanitizeAndValidateDomain(url.searchParams.get('domain') || '');
  const claim = (url.searchParams.get('claim') || 'HTTPS + OWASP Top 10:2025 Counterparty Readiness').slice(0, 180);

  if (!domain) {
    return NextResponse.json(
      {
        ok: false,
        service: 'StealthMark Pre-Pay Trust & Claim-Verification Receipt Microservice',
        usage: 'GET /api/v2/trust-receipt?domain=<seller_domain>&claim=<stated_claim> or POST /api/v2/trust-receipt',
        pricing: {
          x402SingleReceiptUsd: 9,
          fixPackUsd: 24.5,
          fleetDefenseMonthlyUsd: 149,
          acceptedCrypto: ['USDC (Base Mainnet / Polygon / BNB Chain)', 'USDT (Polygon / BNB Chain / Tron TRC-20)'],
          evmTreasuryWallet: EVM_TREASURY_WALLET,
          tronTreasuryWallet: TRON_TREASURY_WALLET,
        },
      },
      { status: 400 }
    );
  }

  const audit = await fetchDomainAudit(domain);
  if (!audit) return auditUnavailable();
  const decision: CanonicalReceiptPayload['decision'] =
    audit.failCount > 0
      ? 'ABORT_HIGH_RISK'
      : audit.warnCount <= 3
        ? 'ALLOW_SETTLEMENT'
        : 'CONDITIONAL_ESCROW';

  return NextResponse.json({
    ok: true,
    mode: 'PRE_PAY_QUOTE_PREVIEW',
    sellerDomain: domain,
    statedClaim: claim,
    preliminaryDecision: decision,
    perimeterSummary: {
      grade: audit.grade,
      passedControls: audit.passCount,
      warnings: audit.warnCount,
      criticalFailures: audit.failCount,
      benchmark: '60-Point OWASP Top 10:2025 & Agentic Surface Standard',
    },
    x402PaymentRequiredForSignedReceipt: {
      x402Version: 1,
      priceUsd: '9.00',
      network: 'base-mainnet',
      chainId: 8453,
      assetContract: BASE_USDC_CONTRACT,
      recipientWallet: EVM_TREASURY_WALLET,
      multiChainTreasury: {
        evmPolygonBaseBsc: EVM_TREASURY_WALLET,
        tronTrc20: TRON_TREASURY_WALLET,
      },
      polarCheckoutUrl: `${SITE_ORIGIN}/api/billing/polar/checkout?plan=fix_pack_49&domain=${encodeURIComponent(domain)}&ref=trust_receipt_api`,
      howToIssueSignedReceipt:
        'POST /api/v2/trust-receipt with { domain, buyerAgent, claim, txHash, chain } (or sandbox: true for a test receipt that never verifies as valid) or Verify an existing receipt with { action: "verify_receipt", receipt, signature }.',
    },
  });
}

const PG_UNIQUE_VIOLATION = '23505';
const TRUST_RECEIPT_CHAINS: SupportedCryptoNetwork[] = ['base', 'polygon', 'bsc', 'tron'];

function ledgerUnavailable() {
  return NextResponse.json(
    { ok: false, error: 'Payment ledger unavailable, so the transaction was not used. Retry later.' },
    { status: 503 }
  );
}

function replayBlocked() {
  return NextResponse.json({ ok: false, error: 'Replay blocked: txHash already consumed' }, { status: 409 });
}

export async function POST(req: Request) {
  const secret = receiptSecret();
  if (!secret) {
    console.error('[Trust Receipt] STEALTHMARK_RECEIPT_HMAC_SECRET is not configured');
    return NextResponse.json({ ok: false, error: 'Receipt signing is not configured. Retry later.' }, { status: 503 });
  }

  try {
    const raw = await readBodyText(req, MAX_BODY_BYTES);
    if (raw === null) {
      return NextResponse.json({ ok: false, error: 'Payload too large' }, { status: 413 });
    }
    let parsed: unknown = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return NextResponse.json({ ok: false, error: 'Body must be a JSON object' }, { status: 400 });
      }
    }
    // `null`, an array or a bare value is valid JSON but carries none of the fields.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json({ ok: false, error: 'Body must be a JSON object' }, { status: 400 });
    }
    const body = parsed as Record<string, unknown>;
    const action = String(body.action || 'issue_receipt');

    // 1. Constant-time cryptographic verification of an existing Trust Receipt
    if (action === 'verify_receipt') {
      const receipt = body.receipt as CanonicalReceiptPayload | undefined;
      const signature = String(body.signature || '');
      if (!receipt || !receipt.receiptId || !receipt.nonce || !receipt.expiresAt) {
        return NextResponse.json({ ok: false, valid: false, error: 'Missing canonical receipt fields' }, { status: 400 });
      }
      const sigValid = verifyCanonicalReceiptConstantTime(receipt, signature, secret);
      const notExpired = new Date(receipt.expiresAt).getTime() > Date.now();
      const sandboxReceipt = receipt.paymentRail === SANDBOX_RAIL;
      return NextResponse.json({
        ok: true,
        valid: sigValid && notExpired && !sandboxReceipt,
        sandbox: sandboxReceipt,
        signatureVerifiedConstantTime: sigValid,
        notExpired,
        receiptId: receipt.receiptId,
        sellerDomain: receipt.sellerDomain,
        decision: receipt.decision,
      });
    }

    // 2. Issue a new signed Pre-Pay Trust & Claim-Verification Receipt
    const domain = sanitizeAndValidateDomain(String(body.domain || body.sellerDomain || ''));
    const buyerAgent = String(body.buyerAgent || 'autonomous_agent').slice(0, 80);
    const statedClaim = String(body.claim || body.statedClaim || '60-Point OWASP Top 10:2025 Counterparty Verification').slice(0, 180);
    const txHash = String(body.txHash || req.headers.get('x-payment-tx') || '').trim();
    const chain = String(body.chain || 'base').trim().toLowerCase() as SupportedCryptoNetwork;
    const unlockToken = String(body.unlockToken || '').trim();
    const sandbox = Boolean(body.sandbox);

    if (!domain) {
      return NextResponse.json({ ok: false, error: 'Valid seller domain is required' }, { status: 400 });
    }

    let paymentRail = 'UNVERIFIED';
    let paidVerified = false;
    let audit: DomainAudit | null = null;

    if (unlockToken && verifyScanUnlockToken(unlockToken, domain)) {
      paidVerified = true;
      paymentRail = 'POLAR_OR_UNLOCK_TOKEN';
    } else if (txHash) {
      if (!TRUST_RECEIPT_CHAINS.includes(chain)) {
        return NextResponse.json({ ok: false, error: 'Unsupported chain: use base, polygon, bsc or tron' }, { status: 400 });
      }
      const canonicalHash = canonicalTxHash(chain, txHash);
      if (!canonicalHash) {
        return NextResponse.json({ ok: false, error: 'Malformed txHash for this chain' }, { status: 400 });
      }
      // Without the ledger a transaction could be replayed, so the receipt fails closed.
      const supabase = createSupabaseAdminClient();
      if (!supabase) return ledgerUnavailable();
      // The unique index on lower(tx_hash) also rejects a hash already used by crypto/claim or unlock-scan.
      const orderId = `trust_receipt:${chain}:${canonicalHash}`;
      const { data: existing, error: lookupError } = await supabase
        .from('credit_orders')
        .select('polar_order_id')
        .or(`polar_order_id.eq.${orderId},tx_hash.eq.${canonicalHash}`)
        .limit(1)
        .maybeSingle();
      if (lookupError) {
        console.error(`[Trust Receipt] credit_orders lookup failed: ${lookupError.code}`);
        return ledgerUnavailable();
      }
      if (existing) return replayBlocked();
      const verification = await verifyCryptoPayment(chain, canonicalHash);
      if (!verification.valid) {
        return NextResponse.json(
          { ok: false, error: verification.error || 'On-chain payment verification failed' },
          { status: 402 }
        );
      }
      // The audit runs before the insert, so when it fails the transaction stays unused and the buyer can retry with it.
      audit = await fetchDomainAudit(domain);
      if (!audit) return auditUnavailable();
      // The receipt is signed only after this insert succeeds, so a failed insert or a concurrent
      // replay of the same transaction gets no receipt.
      const { error: insertError } = await supabase.from('credit_orders').insert({
        polar_order_id: orderId,
        org_id: process.env.STEALTHMARK_CONSOLE_ORG_ID || 'ecf26102-eff1-4a45-8bb4-630cba346b4a',
        product_id: 'trust_receipt_x402',
        credits_events: 0,
        amount_cents: Math.round(verification.amountUsd * 100),
        currency: verification.tokenSymbol,
        payment_method: 'crypto',
        network: chain,
        tx_hash: canonicalHash,
      });
      if (insertError) {
        if (insertError.code === PG_UNIQUE_VIOLATION) return replayBlocked();
        console.error(`[Trust Receipt] credit_orders insert failed: ${insertError.code}`);
        return ledgerUnavailable();
      }
      paidVerified = true;
      paymentRail = `ONCHAIN_${chain.toUpperCase()}_${verification.tokenSymbol}_${verification.amountUsd}USD`;
    } else if (sandbox) {
      paidVerified = true;
      paymentRail = SANDBOX_RAIL;
    }

    if (!paidVerified) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Payment Required (x402Version: 1) — Provide on-chain txHash (Base/Polygon/BNB/Tron >= 9.00 USDC/USDT), unlockToken, or set sandbox: true for a test receipt that never verifies as valid.',
          x402Challenge: {
            x402Version: 1,
            priceUsd: '9.00',
            network: 'base-mainnet',
            chainId: 8453,
            asset: BASE_USDC_CONTRACT,
            recipient: EVM_TREASURY_WALLET,
            tronRecipient: TRON_TREASURY_WALLET,
          },
        },
        {
          status: 402,
          headers: {
            'WWW-Authenticate': `x402 network="base-mainnet", asset="${BASE_USDC_CONTRACT}", recipient="${EVM_TREASURY_WALLET}", amount="9.00"`,
          },
        }
      );
    }

    audit ??= await fetchDomainAudit(domain);
    if (!audit) return auditUnavailable();
    const decision: CanonicalReceiptPayload['decision'] =
      audit.failCount > 0
        ? 'ABORT_HIGH_RISK'
        : audit.warnCount <= 3
          ? 'ALLOW_SETTLEMENT'
          : 'CONDITIONAL_ESCROW';

    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const receiptPayload: CanonicalReceiptPayload = {
      version: 'stealthmark-trust-receipt-v1',
      receiptId: `tr_${randomBytes(10).toString('hex')}`,
      nonce: randomBytes(16).toString('hex'),
      sellerDomain: domain,
      buyerAgent,
      statedClaim,
      decision,
      grade: audit.grade,
      passCount: audit.passCount,
      warnCount: audit.warnCount,
      failCount: audit.failCount,
      paymentRail,
      issuedAt,
      expiresAt,
    };

    const signature = signCanonicalReceipt(receiptPayload, secret);

    return NextResponse.json({
      ok: true,
      receipt: receiptPayload,
      signature,
      verificationInstruction: 'POST /api/v2/trust-receipt with { "action": "verify_receipt", "receipt": <receipt>, "signature": "<signature>" }',
    });
  } catch (err: unknown) {
    console.error('[Trust Receipt] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}
