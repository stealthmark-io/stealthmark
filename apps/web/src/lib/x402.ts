import { NextResponse } from 'next/server';
import { OFFICIAL_CRYPTO_WALLETS } from '@/lib/crypto-verifier';
import { findPackById } from '@/lib/polar-products';

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
