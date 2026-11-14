import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { OFFICIAL_CRYPTO_WALLETS } from '@/lib/crypto-verifier';
import { findPackById } from '@/lib/polar-products';
import { FIX_PACK } from '@/lib/offer';

const STARTER_PACK = findPackById('starter');

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const idempotencyStore = new Map<string, { status: number; body: unknown; expiresAt: number }>();

export function getIdempotentReplay(key: string | null, scope: string): NextResponse | null {
  if (!key || key.trim().length < 4 || key.trim().length > 128) return null;
  const cacheKey = `${scope}:${key.trim()}`;
  const entry = idempotencyStore.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    idempotencyStore.delete(cacheKey);
    return null;
  }
  return NextResponse.json(entry.body, {
    status: entry.status,
    headers: {
      'X-Idempotent-Replay': 'true',
      'X-Charged-Credits': '0',
    },
  });
}

export function saveIdempotentReplay(key: string | null, scope: string, status: number, body: unknown): void {
  if (!key || key.trim().length < 4 || key.trim().length > 128) return;
  if (status < 200 || status >= 300) return;
  if (idempotencyStore.size >= 2_000) {
    const oldest = idempotencyStore.keys().next().value;
    if (oldest) idempotencyStore.delete(oldest);
  }
  idempotencyStore.set(`${scope}:${key.trim()}`, {
    status,
    body,
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
  });
}

export function buildX402PaymentRequiredResponse(resource: string, description: string, creditsRequired: number): NextResponse {
  const payload = {
    x402Version: 1,
    error: 'payment_required',
    message: description,
    creditsRequired,
    accepts: [
      {
        scheme: 'exact',
        network: 'base-mainnet',
        chainId: 8453,
        maxAmountRequired: '9000000',
        resource,
        description,
        mimeType: 'application/json',
        payTo: OFFICIAL_CRYPTO_WALLETS.evm,
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        extra: {
          name: 'USD Coin (Base)',
          claimEndpoint: 'https://stealthmark.io/api/billing/crypto/claim',
          polarCheckout: STARTER_PACK.checkoutUrl,
          creditsGranted: STARTER_PACK.credits,
          idempotencySupported: true,
        },
      },
      {
        scheme: 'exact',
        network: 'polygon-pos',
        chainId: 137,
        maxAmountRequired: '9000000',
        resource,
        description,
        mimeType: 'application/json',
        payTo: OFFICIAL_CRYPTO_WALLETS.evm,
        asset: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      },
      {
        scheme: 'exact',
        network: 'bsc-mainnet',
        chainId: 56,
        maxAmountRequired: '9000000000000000000',
        resource,
        description,
        mimeType: 'application/json',
        payTo: OFFICIAL_CRYPTO_WALLETS.evm,
        asset: '0x55d398326f99059fF775485246999027B3197955',
      },
      {
        scheme: 'exact',
        network: 'tron-mainnet',
        maxAmountRequired: '9000000',
        resource,
        description,
        mimeType: 'application/json',
        payTo: OFFICIAL_CRYPTO_WALLETS.tron,
        asset: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      },
    ],
  };

  return NextResponse.json(payload, {
    status: 402,
    headers: {
      'WWW-Authenticate': `x402 network="base-mainnet", asset="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount="9000000", payTo="${OFFICIAL_CRYPTO_WALLETS.evm}"`,
      'X-Payment-Required': 'true',
      'X-StealthMark-Idempotency': 'supported',
      'Cache-Control': 'no-store',
    },
  });
}

export const BASE_USDC_ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const BASE_MAINNET_CAIP2 = 'eip155:8453';
export const SOLANA_USDC_ASSET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const SOLANA_MAINNET_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export const DEFAULT_X402_FACILITATOR_URL = 'https://facilitator.payai.network';

export type X402UnlockTierKey = 'fix_pack' | 'micro_receipt';

export interface X402UnlockProductSpec {
  tier: X402UnlockTierKey;
  productId: string;
  plan: string;
  priceUsd: string;
  minUsd: number;
  atomicAmount: string;
  creditsGranted: number;
  description: string;
}

export const X402_UNLOCK_PRODUCTS: Record<X402UnlockTierKey, X402UnlockProductSpec> = {
  fix_pack: {
    tier: 'fix_pack',
    productId: FIX_PACK.starterProductId,
    plan: 'starter_pass',
    priceUsd: '0.99',
    minUsd: FIX_PACK.starterPriceUsd,
    atomicAmount: '990000',
    creditsGranted: 15_000,
    description:
      'StealthMark Fix Pack Unlock ($0.99 USDC): Edge Shield v6.0 Worker, Cloudflare WAF rule, Client RASP, verified badge & 30-day unlimited re-scans',
  },
  micro_receipt: {
    tier: 'micro_receipt',
    productId: 'micro_receipt_x402',
    plan: 'micro_receipt',
    priceUsd: '0.05',
    minUsd: 0.05,
    atomicAmount: '50000',
    creditsGranted: 0,
    description:
      'StealthMark Counterparty Posture Micro-Receipt ($0.05 USDC): HMAC-SHA256 signed trust verdict + 116-point v6 summary',
  },
};

export interface X402AcceptOption {
  scheme: 'exact';
  network: string;
  chainId?: number;
  maxAmountRequired: string;
  amount: string;
  resource: string;
  description: string;
  mimeType: 'application/json';
  payTo: string;
  asset: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

export function buildDualRailAccepts(
  productKey: X402UnlockTierKey,
  resource: string,
  descriptionOverride?: string
): X402AcceptOption[] {
  const spec = X402_UNLOCK_PRODUCTS[productKey];
  const description = descriptionOverride || spec.description;
  return [
    {
      scheme: 'exact',
      network: BASE_MAINNET_CAIP2,
      chainId: 8453,
      maxAmountRequired: spec.atomicAmount,
      amount: spec.atomicAmount,
      resource,
      description,
      mimeType: 'application/json',
      payTo: OFFICIAL_CRYPTO_WALLETS.evm,
      asset: BASE_USDC_ASSET,
      maxTimeoutSeconds: 60,
      extra: {
        name: 'USD Coin',
        version: '2',
        priceUsd: spec.priceUsd,
        tier: spec.tier,
        deliverThenSettle: true,
        claimEndpoint: 'https://stealthmark.io/api/billing/x402/unlock',
      },
    },
    {
      scheme: 'exact',
      network: SOLANA_MAINNET_CAIP2,
      maxAmountRequired: spec.atomicAmount,
      amount: spec.atomicAmount,
      resource,
      description,
      mimeType: 'application/json',
      payTo: OFFICIAL_CRYPTO_WALLETS.solana,
      asset: SOLANA_USDC_ASSET,
      maxTimeoutSeconds: 60,
      extra: {
        name: 'USD Coin (Solana SPL)',
        priceUsd: spec.priceUsd,
        tier: spec.tier,
        deliverThenSettle: true,
        claimEndpoint: 'https://stealthmark.io/api/billing/x402/unlock',
      },
    },
  ];
}

export function buildDualRailX402Challenge(
  productKey: X402UnlockTierKey,
  resource: string,
  descriptionOverride?: string
): NextResponse {
  const spec = X402_UNLOCK_PRODUCTS[productKey];
  const accepts = buildDualRailAccepts(productKey, resource, descriptionOverride);
  const challenge = {
    x402Version: 1,
    error: 'payment_required',
    message: descriptionOverride || spec.description,
    priceUsd: spec.priceUsd,
    tier: spec.tier,
    accepts,
  };
  const encodedChallenge = Buffer.from(JSON.stringify(challenge)).toString('base64');

  return NextResponse.json(challenge, {
    status: 402,
    headers: {
      'WWW-Authenticate': `x402 network="${BASE_MAINNET_CAIP2}", asset="${BASE_USDC_ASSET}", amount="${spec.atomicAmount}", payTo="${OFFICIAL_CRYPTO_WALLETS.evm}"`,
      'PAYMENT-REQUIRED': encodedChallenge,
      'X-Payment-Required': 'true',
      'X-StealthMark-Idempotency': 'supported',
      'Cache-Control': 'no-store',
    },
  });
}

export interface ParsedX402Payment {
  version: 1 | 2;
  payload: Record<string, unknown>;
  network: string;
  isSolana: boolean;
  authDigest: string;
}

export function parseX402PaymentHeader(rawHeader: string): ParsedX402Payment | null {
  const trimmed = rawHeader.trim();
  if (!trimmed || trimmed.length > 16_384) return null;

  let decodedText = trimmed;
  if (!trimmed.startsWith('{')) {
    try {
      const candidate = Buffer.from(trimmed, 'base64').toString('utf8').trim();
      if (candidate.startsWith('{')) decodedText = candidate;
    } catch {
      return null;
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodedText);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const version: 1 | 2 = obj.x402Version === 2 ? 2 : 1;
  const scheme = typeof obj.scheme === 'string' ? obj.scheme : '';
  const payloadObj = obj.payload as Record<string, unknown> | undefined;
  const acceptedObj = obj.accepted as Record<string, unknown> | undefined;

  if (scheme && scheme !== 'exact') return null;
  if (!payloadObj || typeof payloadObj !== 'object') return null;

  const network = String(obj.network || acceptedObj?.network || BASE_MAINNET_CAIP2).toLowerCase();
  const isSolana = network.includes('solana');
  const auth = (payloadObj.authorization as Record<string, unknown> | undefined) || {};
  const nonceOrSig =
    typeof auth.nonce === 'string' && auth.nonce
      ? `${network}:${auth.nonce}`
      : typeof payloadObj.transaction === 'string' && payloadObj.transaction
        ? `${network}:${payloadObj.transaction}`
        : trimmed;
  const authDigest = createHash('sha256').update(nonceOrSig).digest('hex').slice(0, 32);

  return {
    version,
    payload: obj,
    network,
    isSolana,
    authDigest,
  };
}

function facilitatorUrls(): string[] {
  const primary = (process.env.X402_FACILITATOR_URL || DEFAULT_X402_FACILITATOR_URL).replace(/\/$/, '');
  const secondary = (process.env.X402_FACILITATOR_SECONDARY_URL || '').replace(/\/$/, '');
  return secondary && secondary !== primary ? [primary, secondary] : [primary];
}

function buildFacilitatorRequestBody(
  parsed: ParsedX402Payment,
  requirement: X402AcceptOption
): Record<string, unknown> {
  const paymentPayload =
    parsed.version === 2 && !parsed.payload.accepted
      ? { ...parsed.payload, accepted: requirement }
      : parsed.payload;
  return {
    x402Version: parsed.version,
    paymentPayload,
    paymentRequirements: requirement,
  };
}

async function postToFacilitator(
  endpoint: 'verify' | 'settle',
  body: Record<string, unknown>
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string; status: number }> {
  let lastError = 'Facilitator unavailable';
  let lastStatus = 503;

  for (const base of facilitatorUrls()) {
    try {
      const res = await fetch(`${base}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // Non-JSON facilitator body
      }
      if (res.ok) {
        return { ok: true, data: json };
      }
      lastStatus = res.status;
      lastError = String(
        json.invalidMessage || json.invalidReason || json.errorMessage || json.error || `Facilitator HTTP ${res.status}`
      );
      if (res.status < 500 && res.status !== 429) {
        return { ok: false, error: lastError, status: res.status };
      }
    } catch (err: unknown) {
      lastStatus = 503;
      lastError = err instanceof Error ? err.message : 'Facilitator request failed';
    }
  }

  return { ok: false, error: lastError, status: lastStatus };
}

export async function verifyX402FacilitatorPayment(
  parsed: ParsedX402Payment,
  requirement: X402AcceptOption
): Promise<{ valid: true; data: Record<string, unknown> } | { valid: false; error: string; status: number }> {
  const res = await postToFacilitator('verify', buildFacilitatorRequestBody(parsed, requirement));
  if (!res.ok) {
    return { valid: false, error: res.error, status: res.status };
  }
  const valid = Boolean(res.data.isValid ?? res.data.valid);
  if (!valid) {
    const errMsg = String(
      res.data.invalidMessage || res.data.invalidReason || res.data.error || 'Payment rejected by facilitator'
    );
    return { valid: false, error: errMsg, status: 402 };
  }
  return { valid: true, data: res.data };
}

export async function settleX402FacilitatorPayment(
  parsed: ParsedX402Payment,
  requirement: X402AcceptOption
): Promise<{ settled: true; txHash: string; data: Record<string, unknown> } | { settled: false; error: string }> {
  const res = await postToFacilitator('settle', buildFacilitatorRequestBody(parsed, requirement));
  if (!res.ok) {
    return { settled: false, error: res.error };
  }
  const tx = res.data.transaction || res.data.txHash || res.data.tx;
  if (res.data.success !== true || typeof tx !== 'string' || !tx) {
    return {
      settled: false,
      error: String(res.data.errorMessage || res.data.errorReason || res.data.error || 'Settlement failed'),
    };
  }
  return { settled: true, txHash: tx, data: res.data };
}
