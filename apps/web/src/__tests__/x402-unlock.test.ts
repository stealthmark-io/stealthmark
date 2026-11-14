import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../app/api/billing/x402/unlock/route';
import { verifyScanUnlockToken } from '../lib/scan-unlock';
import { verifyCanonicalReceiptConstantTime } from '../lib/trust-receipt';
import { OFFICIAL_CRYPTO_WALLETS } from '../lib/crypto-verifier';
import { fakeLedger, unknownColumns } from './helpers/credit-orders';

const UNLOCK_SECRET = 'test-unlock-secret-that-is-32-chars-minimum';
const RECEIPT_SECRET = 'test-receipt-hmac-secret-32-chars-min';
let ipCounter = 1;

function nextIp(): string {
  ipCounter += 1;
  return `10.42.0.${ipCounter}`;
}

function makeEip3009Header(nonce = '0x' + 'ab'.repeat(32), network = 'eip155:8453'): string {
  const payload = {
    x402Version: 1,
    scheme: 'exact',
    network,
    payload: {
      signature: '0x' + 'cd'.repeat(65),
      authorization: {
        from: '0x1111111111111111111111111111111111111111',
        to: OFFICIAL_CRYPTO_WALLETS.evm,
        value: '990000',
        validAfter: '0',
        validBefore: '1999999999',
        nonce,
      },
    },
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

describe('/api/billing/x402/unlock', () => {
  beforeEach(() => {
    vi.stubEnv('SCAN_UNLOCK_SECRET', UNLOCK_SECRET);
    vi.stubEnv('STEALTHMARK_RECEIPT_HMAC_SECRET', RECEIPT_SECRET);
    vi.stubEnv('X402_FACILITATOR_URL', 'https://facilitator.test');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('serves pricing metadata on GET and HTTP 402 dual-rail challenge when domain is provided', async () => {
    const infoRes = await GET(new NextRequest('https://stealthmark.io/api/billing/x402/unlock'));
    expect(infoRes.status).toBe(200);
    const info = await infoRes.json();
    expect(info.tiers.fix_pack.priceUsd).toBe('0.99');
    expect(info.tiers.micro_receipt.priceUsd).toBe('0.05');

    const fixChallengeRes = await GET(
      new NextRequest('https://stealthmark.io/api/billing/x402/unlock?domain=example.com&tier=fix_pack')
    );
    expect(fixChallengeRes.status).toBe(402);
    expect(fixChallengeRes.headers.get('X-Payment-Required')).toBe('true');
    expect(fixChallengeRes.headers.get('PAYMENT-REQUIRED')).toBeTruthy();
    const fixChallenge = await fixChallengeRes.json();
    expect(fixChallenge.accepts.map((a: { network: string; amount: string }) => [a.network, a.amount])).toEqual([
      ['eip155:8453', '990000'],
      ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', '990000'],
    ]);

    const microChallengeRes = await GET(
      new NextRequest('https://stealthmark.io/api/billing/x402/unlock?domain=example.com&tier=micro_receipt')
    );
    expect(microChallengeRes.status).toBe(402);
    const microChallenge = await microChallengeRes.json();
    expect(microChallenge.accepts[0].amount).toBe('50000');
  });

  it('challenges unpaid POST requests with HTTP 402', async () => {
    const res = await POST(
      new NextRequest('https://stealthmark.io/api/billing/x402/unlock', {
        method: 'POST',
        headers: { 'x-forwarded-for': nextIp(), 'content-type': 'application/json' },
        body: JSON.stringify({ domain: 'acme.ai' }),
      })
    );
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.priceUsd).toBe('0.99');
    expect(body.accepts).toHaveLength(2);
  });

  it('verifies, executes deliverables, settles, and records credit_orders with 30% referral for $0.99 Fix Pack', async () => {
    const ledger = fakeLedger();
    const calls: string[] = [];
    const settledTx = '0x' + '11'.repeat(32);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        calls.push(u);
        if (u.endsWith('/verify')) {
          return new Response(JSON.stringify({ isValid: true, payer: '0x1111' }), { status: 200 });
        }
        if (u.endsWith('/settle')) {
          return new Response(JSON.stringify({ success: true, transaction: settledTx }), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      })
    );

    const res = await POST(
      new NextRequest('https://stealthmark.io/api/billing/x402/unlock', {
        method: 'POST',
        headers: {
          'x-forwarded-for': nextIp(),
          'content-type': 'application/json',
          'X-PAYMENT': makeEip3009Header(),
        },
        body: JSON.stringify({ domain: 'acme.ai', ref: 'molt_partner' }),
      })
    );

    expect(res.status).toBe(200);
    expect(calls).toEqual(['https://facilitator.test/verify', 'https://facilitator.test/settle']);
    expect(res.headers.get('X-Payment-Response')).toBeTruthy();

    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.amount_usd).toBe(0.99);
    expect(verifyScanUnlockToken(body.unlock_token, 'acme.ai')?.dom).toBe('acme.ai');
    expect(body.deliverables.cloudflare_worker_code).toContain('acme.ai');

    const inserted = ledger.insert.mock.calls[0]?.[0];
    expect(unknownColumns(inserted)).toEqual([]);
    expect(inserted).toMatchObject({
      amount_cents: 99,
      currency: 'USDC',
      payment_method: 'x402_usdc',
      network: 'base',
      tx_hash: settledTx,
      referrer_code: 'molt_partner',
      commission_cents: 30,
    });
  });

  it('aborts BEFORE /settle when deliverable generation fails (Deliver-Then-Settle)', async () => {
    const ledger = fakeLedger();
    vi.stubEnv('SCAN_UNLOCK_SECRET', '');
    const calls: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        calls.push(u);
        if (u.endsWith('/verify')) {
          return new Response(JSON.stringify({ isValid: true }), { status: 200 });
        }
        if (u.endsWith('/settle')) {
          return new Response(JSON.stringify({ success: true, transaction: '0x' + '22'.repeat(32) }), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      })
    );

    const res = await POST(
      new NextRequest('https://stealthmark.io/api/billing/x402/unlock', {
        method: 'POST',
        headers: {
          'x-forwarded-for': nextIp(),
          'content-type': 'application/json',
          'X-PAYMENT': makeEip3009Header('0x' + 'cd'.repeat(32)),
        },
        body: JSON.stringify({ domain: 'acme.ai', tier: 'fix_pack' }),
      })
    );

    expect(res.status).toBe(503);
    expect(calls).toEqual(['https://facilitator.test/verify']);
    expect(ledger.insert).not.toHaveBeenCalled();
  });

  it('issues a signed $0.05 USDC micro-receipt after /api/scan/audit and blocks replay', async () => {
    const ledger = fakeLedger();
    const calls: string[] = [];
    const settledTx = '0x' + '33'.repeat(32);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        calls.push(u);
        if (u.endsWith('/verify')) {
          return new Response(JSON.stringify({ isValid: true }), { status: 200 });
        }
        if (u.includes('/api/scan/audit?domain=seller.io')) {
          return new Response(
            JSON.stringify({ badge: { grade: 'A' }, summary: { counts: { pass: 72, warn: 1, fail: 0 } } }),
            { status: 200 }
          );
        }
        if (u.endsWith('/settle')) {
          return new Response(JSON.stringify({ success: true, transaction: settledTx }), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      })
    );

    const res = await POST(
      new NextRequest('https://stealthmark.io/api/billing/x402/unlock', {
        method: 'POST',
        headers: {
          'x-forwarded-for': nextIp(),
          'content-type': 'application/json',
          'PAYMENT-SIGNATURE': makeEip3009Header('0x' + 'ef'.repeat(32)),
        },
        body: JSON.stringify({ domain: 'seller.io', tier: 'micro_receipt', buyerAgent: '@openclaw' }),
      })
    );

    expect(res.status).toBe(200);
    // Strict Verify -> Audit -> Settle execution order
    expect(calls[0]).toBe('https://facilitator.test/verify');
    expect(calls[1]).toContain('/api/scan/audit?domain=seller.io');
    expect(calls[2]).toBe('https://facilitator.test/settle');

    const body = await res.json();
    expect(body.tier).toBe('micro_receipt');
    expect(body.amount_usd).toBe(0.05);
    expect(body.receipt.decision).toBe('ALLOW_SETTLEMENT');
    expect(verifyCanonicalReceiptConstantTime(body.receipt, body.signature, RECEIPT_SECRET)).toBe(true);
    expect(ledger.insert.mock.calls[0]?.[0]?.amount_cents).toBe(5);

    // Replay with the same authorization nonce must be rejected 409 before facilitator/audit
    fakeLedger({ existing: { polar_order_id: 'x402:micro_receipt:existing' } });
    const replayRes = await POST(
      new NextRequest('https://stealthmark.io/api/billing/x402/unlock', {
        method: 'POST',
        headers: {
          'x-forwarded-for': nextIp(),
          'content-type': 'application/json',
          'PAYMENT-SIGNATURE': makeEip3009Header('0x' + 'ef'.repeat(32)),
        },
        body: JSON.stringify({ domain: 'seller.io', tier: 'micro_receipt' }),
      })
    );
    expect(replayRes.status).toBe(409);
  });

  it('supports direct on-chain Solana $0.05 USDC for micro_receipt while enforcing $0.99 for fix_pack', async () => {
    const solSig = '5' + 'K'.repeat(87);
    fakeLedger();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes('/api/scan/audit?domain=solseller.io')) {
          return new Response(
            JSON.stringify({ badge: { grade: 'B' }, summary: { counts: { pass: 60, warn: 2, fail: 0 } } }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            result: {
              meta: {
                err: null,
                preTokenBalances: [
                  {
                    accountIndex: 1,
                    owner: OFFICIAL_CRYPTO_WALLETS.solana,
                    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                    uiTokenAmount: { uiAmount: 10.0 },
                  },
                ],
                postTokenBalances: [
                  {
                    accountIndex: 1,
                    owner: OFFICIAL_CRYPTO_WALLETS.solana,
                    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                    uiTokenAmount: { uiAmount: 10.05 },
                  },
                ],
              },
              transaction: { message: { accountKeys: [] } },
            },
          }),
          { status: 200 }
        );
      })
    );

    // $0.05 rejected for fix_pack ($0.99 min)
    const tooSmallRes = await POST(
      new NextRequest('https://stealthmark.io/api/billing/x402/unlock', {
        method: 'POST',
        headers: { 'x-forwarded-for': nextIp(), 'content-type': 'application/json' },
        body: JSON.stringify({ domain: 'solseller.io', tier: 'fix_pack', network: 'solana', txHash: solSig }),
      })
    );
    expect(tooSmallRes.status).toBe(402);

    // $0.05 accepted for micro_receipt
    const microRes = await POST(
      new NextRequest('https://stealthmark.io/api/billing/x402/unlock', {
        method: 'POST',
        headers: { 'x-forwarded-for': nextIp(), 'content-type': 'application/json' },
        body: JSON.stringify({ domain: 'solseller.io', tier: 'micro_receipt', network: 'solana', txHash: solSig }),
      })
    );
    expect(microRes.status).toBe(200);
    const body = await microRes.json();
    expect(body.settledVia).toBe('onchain_rpc');
    expect(body.amount_usd).toBeCloseTo(0.05, 4);
    expect(body.receipt.decision).toBe('ALLOW_SETTLEMENT');
  });

  it('rejects invalid or unsupported crypto network on direct onchain unlock with 400', async () => {
    fakeLedger();
    const res = await POST(
      new NextRequest('https://stealthmark.io/api/billing/x402/unlock', {
        method: 'POST',
        headers: { 'x-forwarded-for': nextIp(), 'content-type': 'application/json' },
        body: JSON.stringify({ domain: 'solseller.io', tier: 'micro_receipt', network: 'dogecoin', txHash: '0x1234' }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ ok: false, verified: false, error: 'invalid_network' });
  });
});
