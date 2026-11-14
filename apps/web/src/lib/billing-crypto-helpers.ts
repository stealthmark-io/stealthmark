import { NextResponse } from 'next/server';
import type { SupportedCryptoNetwork } from '@/lib/crypto-verifier';
import type { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const SUPPORTED_CRYPTO_NETWORKS: readonly SupportedCryptoNetwork[] = [
  'ethereum',
  'btc',
  'solana',
  'polygon',
  'base',
  'bsc',
  'tron',
] as const;

export const PG_UNIQUE_VIOLATION = '23505';
export const DEFAULT_CONSOLE_ORG_ID = 'ecf26102-eff1-4a45-8bb4-630cba346b4a';
export const REFERRAL_COMMISSION_RATE = 0.30;

/**
 * Validates and normalizes a candidate network string into a supported crypto network.
 * Returns null if the value is not a supported network string.
 */
export function parseSupportedCryptoNetwork(raw: unknown): SupportedCryptoNetwork | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  return (SUPPORTED_CRYPTO_NETWORKS as readonly string[]).includes(normalized)
    ? (normalized as SupportedCryptoNetwork)
    : null;
}

/**
 * Normalizes and validates an affiliate / referral code.
 * Accepts lowercase alphanumeric, underscores, dots, and hyphens (2-64 chars).
 */
export function cleanReferralCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  return /^[a-z0-9_.-]{2,64}$/.test(normalized) ? normalized : null;
}

/**
 * Calculates a 30% affiliate commission rounded to nearest cent.
 * Returns 0 if no valid referrer code is present.
 */
export function calculateReferralCommission(amountCents: number, referrerCode?: string | null): number {
  if (!referrerCode) return 0;
  return Math.round(amountCents * REFERRAL_COMMISSION_RATE);
}

export interface FixedWindowRateLimiter {
  (ip: string): boolean;
  reset: () => void;
  size: () => number;
}

/**
 * Creates an in-memory fixed-window rate limiter per IP with automatic LRU-like sweep.
 */
export function createFixedWindowRateLimiter(
  maxPerWindow: number,
  windowMs = 60_000,
  maxEntries = 2000
): FixedWindowRateLimiter {
  const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

  const limiter: FixedWindowRateLimiter = (ip: string): boolean => {
    const now = Date.now();
    if (rateLimitMap.size >= maxEntries) {
      for (const [k, v] of rateLimitMap) {
        if (v.resetAt <= now) rateLimitMap.delete(k);
      }
    }
    const entry = rateLimitMap.get(ip);
    if (!entry || entry.resetAt <= now) {
      rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= maxPerWindow;
  };

  limiter.reset = () => rateLimitMap.clear();
  limiter.size = () => rateLimitMap.size;

  return limiter;
}

/**
 * Returns an HTTP 503 ledger unavailable response.
 * - When `includeOk` is true: `{ ok: false, verified: false, error: 'ledger_unavailable', detail: '...' }`
 * - When `includeOk` is false: `{ verified: false, error: 'ledger_unavailable', detail: '...' }`
 */
export function ledgerUnavailableResponse(
  includeOkOrDetail?: boolean | string,
  detail?: string
): NextResponse {
  let hasOk = false;
  let customDetail = detail;

  if (typeof includeOkOrDetail === 'boolean') {
    hasOk = includeOkOrDetail;
  } else if (typeof includeOkOrDetail === 'string') {
    customDetail = includeOkOrDetail;
  }

  const defaultDetail = hasOk
    ? 'Payment ledger unavailable; no settlement or charge occurred. Retry shortly.'
    : 'The payment could not be recorded right now, so the transaction was not used. Retry in a minute.';

  const payload: Record<string, unknown> = {
    verified: false,
    error: 'ledger_unavailable',
    detail: customDetail || defaultDetail,
  };

  if (hasOk) {
    return NextResponse.json({ ok: false, ...payload }, { status: 503 });
  }
  return NextResponse.json(payload, { status: 503 });
}

/**
 * Returns an HTTP 409 transaction already claimed response.
 * - When `includeOk` is true: `{ ok: false, verified: false, error: 'tx_already_claimed', detail: '...' }`
 * - When `includeOk` is false: `{ verified: false, error: 'tx_already_claimed', detail: '...' }`
 */
export function txAlreadyClaimedResponse(
  detailOrIncludeOk?: string | boolean,
  includeOk = false
): NextResponse {
  let detail: string | undefined;
  let hasOk = includeOk;

  if (typeof detailOrIncludeOk === 'boolean') {
    hasOk = detailOrIncludeOk;
  } else if (typeof detailOrIncludeOk === 'string') {
    detail = detailOrIncludeOk;
  }

  const defaultDetail = hasOk
    ? 'This x402 authorization or transaction hash has already been consumed.'
    : 'This transaction hash has already been used.';

  const payload: Record<string, unknown> = {
    verified: false,
    error: 'tx_already_claimed',
    detail: detail || defaultDetail,
  };

  if (hasOk) {
    return NextResponse.json({ ok: false, ...payload }, { status: 409 });
  }
  return NextResponse.json(payload, { status: 409 });
}

export interface ExistingCreditOrder {
  polar_order_id: string;
  amount_cents?: number | null;
  credits_events?: number | null;
  [key: string]: unknown;
}

/**
 * Queries Supabase `credit_orders` for an existing authorization or on-chain transaction hash.
 */
export async function checkExistingCreditOrder(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  orderId: string,
  txHash?: string | null,
  selectColumns = 'polar_order_id, amount_cents, credits_events',
  logPrefix?: string
): Promise<{
  data: ExistingCreditOrder | null;
  error: { code: string; message?: string } | null;
}> {
  const filter = txHash
    ? `polar_order_id.eq.${orderId},tx_hash.eq.${txHash}`
    : `polar_order_id.eq.${orderId}`;

  const { data, error } = await supabase
    .from('credit_orders')
    .select(selectColumns)
    .or(filter)
    .limit(1)
    .maybeSingle();

  if (error && logPrefix) {
    console.error(`[${logPrefix}] credit_orders lookup failed: ${error.code}`);
  }

  return {
    data: (data as unknown as ExistingCreditOrder) ?? null,
    error: (error as { code: string; message?: string } | null) ?? null,
  };
}

export interface RecordCryptoCreditOrderParams {
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  orderId: string;
  productId: string;
  creditsEvents: number;
  amountCents: number;
  currency: string;
  paymentMethod: string;
  network: SupportedCryptoNetwork;
  txHash: string;
  referrerCode?: string | null;
  orgId?: string;
  logPrefix?: string;
}

export type RecordCreditOrderResult =
  | { ok: true }
  | { ok: false; error: 'tx_already_claimed' | 'ledger_unavailable'; dbCode?: string };

/**
 * Inserts a crypto or x402 payment into Supabase `credit_orders`, computing 30% referral commission
 * and translating PG_UNIQUE_VIOLATION ('23505') into 'tx_already_claimed'.
 */
export async function recordCryptoCreditOrder(
  params: RecordCryptoCreditOrderParams
): Promise<RecordCreditOrderResult> {
  const cleanRef = cleanReferralCode(params.referrerCode);
  const commissionCents = calculateReferralCommission(params.amountCents, cleanRef);
  const orgId = params.orgId || process.env.STEALTHMARK_CONSOLE_ORG_ID || DEFAULT_CONSOLE_ORG_ID;

  const { error: insertError } = await params.supabase.from('credit_orders').insert({
    polar_order_id: params.orderId,
    org_id: orgId,
    product_id: params.productId,
    credits_events: params.creditsEvents,
    amount_cents: params.amountCents,
    currency: params.currency,
    payment_method: params.paymentMethod,
    network: params.network,
    tx_hash: params.txHash,
    referrer_code: cleanRef,
    commission_cents: commissionCents,
  });

  if (insertError) {
    if (insertError.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: 'tx_already_claimed', dbCode: insertError.code };
    }
    if (params.logPrefix) {
      console.error(`[${params.logPrefix}] credit_orders insert failed: ${insertError.code}`);
    }
    return { ok: false, error: 'ledger_unavailable', dbCode: insertError.code };
  }

  return { ok: true };
}
