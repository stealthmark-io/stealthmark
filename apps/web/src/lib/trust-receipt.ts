import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { SITE_ORIGIN } from '@/lib/site';

export const SANDBOX_RECEIPT_RAIL = 'SANDBOX_PREVIEW_NON_PRODUCTION';

export interface CanonicalReceiptPayload {
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

export interface DomainAudit {
  grade: string;
  passCount: number;
  warnCount: number;
  failCount: number;
}

interface AuditBody {
  badge?: { grade?: unknown } | null;
  summary?: { counts?: { pass?: unknown; warn?: unknown; fail?: unknown } } | null;
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * Receipts are signed only with a configured secret: a default in source would let anyone forge one.
 */
export function receiptSecret(): string | null {
  return process.env.STEALTHMARK_RECEIPT_HMAC_SECRET || process.env.STEALTHMARK_UNSUB_SECRET || null;
}

export function signCanonicalReceipt(payload: CanonicalReceiptPayload, secret: string): string {
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

export function verifyCanonicalReceiptConstantTime(
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

export function computeTrustDecision(audit: DomainAudit): CanonicalReceiptPayload['decision'] {
  if (audit.failCount > 0) return 'ABORT_HIGH_RISK';
  return audit.warnCount <= 3 ? 'ALLOW_SETTLEMENT' : 'CONDITIONAL_ESCROW';
}

export function buildSignedTrustReceipt(params: {
  domain: string;
  buyerAgent: string;
  statedClaim: string;
  paymentRail: string;
  audit: DomainAudit;
  secret: string;
  now?: number;
}): { receipt: CanonicalReceiptPayload; signature: string } {
  const nowMs = params.now ?? Date.now();
  const receipt: CanonicalReceiptPayload = {
    version: 'stealthmark-trust-receipt-v1',
    receiptId: `tr_${randomBytes(10).toString('hex')}`,
    nonce: randomBytes(16).toString('hex'),
    sellerDomain: params.domain,
    buyerAgent: params.buyerAgent,
    statedClaim: params.statedClaim,
    decision: computeTrustDecision(params.audit),
    grade: params.audit.grade,
    passCount: params.audit.passCount,
    warnCount: params.audit.warnCount,
    failCount: params.audit.failCount,
    paymentRail: params.paymentRail,
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + 24 * 3600 * 1000).toISOString(),
  };
  return {
    receipt,
    signature: signCanonicalReceipt(receipt, params.secret),
  };
}

/**
 * Returns null when the audit cannot be read, so a receipt is never signed over unverified counts.
 */
export async function fetchDomainAudit(domain: string): Promise<DomainAudit | null> {
  try {
    const baseUrl = (process.env.INTERNAL_APP_URL || SITE_ORIGIN).replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/api/scan/audit?domain=${encodeURIComponent(domain)}`, {
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
