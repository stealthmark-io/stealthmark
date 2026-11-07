import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/billing/crypto/claim/route';
import * as cryptoVerifier from '../lib/crypto-verifier';
import * as adminSupabase from '../lib/supabase/admin';
import { buildX402PaymentRequiredResponse } from '../lib/x402';
import { CREDIT_PACKS } from '../lib/polar-products';

describe('Crypto Claim API (POST /api/billing/crypto/claim)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects invalid or missing network', async () => {
    const req = new NextRequest('http://localhost/api/billing/crypto/claim', {
      method: 'POST',
      body: JSON.stringify({ network: 'solana', tx_hash: '0x1234567890abcdef' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('validation_error');
  });

  it('rejects transaction hashes that are too short', async () => {
    const req = new NextRequest('http://localhost/api/billing/crypto/claim', {
      method: 'POST',
      body: JSON.stringify({ network: 'polygon', tx_hash: '0x123' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('validation_error');
  });

  it('returns 409 if transaction hash was already claimed (idempotency)', async () => {
    const fakeSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'credit_orders') {
          return {
            select: vi.fn().mockReturnThis(),
            or: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                polar_order_id: 'crypto:polygon:0xabcdef1234567890',
                org_id: 'org-123',
                credits_events: 15_000,
              },
              error: null,
            }),
          };
        }
        return {};
      }),
    };

    vi.spyOn(adminSupabase, 'createSupabaseAdminClient').mockReturnValue(fakeSupabase as never);

    const req = new NextRequest('http://localhost/api/billing/crypto/claim', {
      method: 'POST',
      body: JSON.stringify({ network: 'polygon', tx_hash: '0xabcdef1234567890' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('already_claimed');
  });

  it('verifies on-chain payment and provisions organization with sk_live_ key', async () => {
    const fakeSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'credit_orders') {
          return {
            select: vi.fn().mockReturnThis(),
            or: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        if (table === 'organizations') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'new-org-uuid', name: 'Crypto', slug: 'crypto-slug' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'api_keys') {
          return {
            insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        if (table === 'registered_sites') {
          return {
            insert: vi.fn().mockReturnValue({
              catch: vi.fn().mockResolvedValue(null),
            }),
          };
        }
        return {};
      }),
    };

    vi.spyOn(adminSupabase, 'createSupabaseAdminClient').mockReturnValue(fakeSupabase as never);
    vi.spyOn(cryptoVerifier, 'verifyCryptoPayment').mockResolvedValue({
      valid: true,
      network: 'polygon',
      txHash: '0xabcdef1234567890',
      recipientAddress: '0xc8dc4ecb93c4c665fad07e1261f5f7d60e3c6e0f',
      tokenSymbol: 'USDT',
      amountUsd: 9,
      creditsGranted: 15_000,
      packName: 'Starter Quick Pass',
    });

    const req = new NextRequest('http://localhost/api/billing/crypto/claim', {
      method: 'POST',
      body: JSON.stringify({
        network: 'polygon',
        tx_hash: '0xabcdef1234567890',
        domain: 'mysite.com',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.api_key).toMatch(/^sk_live_[0-9a-f]{32}$/);
    expect(body.credits).toBe(15_000);
    expect(body.pack).toBe('Starter Quick Pass');
    expect(body.message).toContain('Crypto credit pack active');
    expect(body.network).toBe('polygon');
    expect(body.org_id).toBe('new-org-uuid');
  });

  it('rejects claim when on-chain verification fails', async () => {
    const fakeSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'credit_orders') {
          return {
            select: vi.fn().mockReturnThis(),
            or: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {};
      }),
    };

    vi.spyOn(adminSupabase, 'createSupabaseAdminClient').mockReturnValue(fakeSupabase as never);
    vi.spyOn(cryptoVerifier, 'verifyCryptoPayment').mockResolvedValue({
      valid: false,
      network: 'tron',
      txHash: 'tx_fail',
      recipientAddress: 'TYgGahN7wK9NtUVFZaXCwZqktaYmkuNxD8',
      tokenSymbol: 'USDT',
      amountUsd: 0,
      creditsGranted: 0,
      packName: '',
      error: 'Transaction failed on-chain',
    });

    const req = new NextRequest('http://localhost/api/billing/crypto/claim', {
      method: 'POST',
      body: JSON.stringify({ network: 'tron', tx_hash: 'tx_fail_12345678' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('verification_failed');
  });

  describe('Tron verification & anti-fraud security', () => {
    it('blocks Approval event bypass when attacker calls approve instead of transfer', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          receipt: { result: 'SUCCESS' },
          log: [
            {
              address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
              topics: [
                // Approval(address,address,uint256) signature
                '8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
                '000000000000000000000000attacker1234567890',
                // Spender is the receiving wallet address
                '000000000000000000000000f916cf613ecf65390ff217cc15afa764563cad75',
              ],
              data: '0000000000000000000000000000000000000000000000000000000005f5e100', // 100 USDT
            },
          ],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await cryptoVerifier.verifyTronPayment('1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
      expect(result.valid).toBe(false);
      vi.unstubAllGlobals();
    });

    it('blocks transaction if receipt.result is not SUCCESS (fail-closed), even with a matching Transfer log', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          receipt: {}, // Missing result
          log: [
            {
              address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
              topics: [
                'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                '000000000000000000000000sender123456789012',
                '000000000000000000000000f916cf613ecf65390ff217cc15afa764563cad75',
              ],
              data: '000000000000000000000000000000000000000000000000000000000175d720', // 24.50 USDT (24,500,000 sun)
            },
          ],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await cryptoVerifier.verifyTronPayment('1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
      expect(result.valid).toBe(false);
      expect(result.creditsGranted).toBe(0);
      expect(result.error).toContain('UNCONFIRMED');
      vi.unstubAllGlobals();
    });

    it('accepts legitimate Transfer events matching TYgGahN7wK9NtUVFZaXCwZqktaYmkuNxD8 hex for the $0.99 Fix Pack, and a larger transfer buys the same pack', async () => {
      const cases = [
        { data: (990_000).toString(16).padStart(64, '0'), amountUsd: 0.99, creditsGranted: 15_000, packName: 'Fix Pack' }, // 0.99 USDT (990,000 sun)
        { data: '000000000000000000000000000000000000000000000000000000000175d720', amountUsd: 24.5, creditsGranted: 15_000, packName: 'Fix Pack' }, // 24.50 USDT (24,500,000 sun)
      ];
      for (const { data, ...expected } of cases) {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            receipt: { result: 'SUCCESS' },
            log: [
              {
                address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
                topics: [
                  // Transfer(address,address,uint256) signature
                  'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                  '000000000000000000000000sender123456789012',
                  // Receiving wallet: 41f916cf613ecf65390ff217cc15afa764563cad75
                  '000000000000000000000000f916cf613ecf65390ff217cc15afa764563cad75',
                ],
                data,
              },
            ],
          }),
        });
        vi.stubGlobal('fetch', mockFetch);

        const result = await cryptoVerifier.verifyTronPayment('1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
        expect(result.valid).toBe(true);
        expect(result).toMatchObject(expected);
        vi.unstubAllGlobals();
      }
    });

    it.each([980_000, 500_000])('rejects a transfer of %i sun now that the minimum is the $0.99 Fix Pack', async (sun) => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          receipt: { result: 'SUCCESS' },
          log: [
            {
              address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
              topics: [
                'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                '000000000000000000000000sender123456789012',
                '000000000000000000000000f916cf613ecf65390ff217cc15afa764563cad75',
              ],
              data: sun.toString(16).padStart(64, '0'),
            },
          ],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await cryptoVerifier.verifyTronPayment('1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
      expect(result.valid).toBe(false);
      expect(result.creditsGranted).toBe(0);
      expect(result.error).toContain('below minimum ($0.99 USD)');
      vi.unstubAllGlobals();
    });

    it('ignores transaction info whose id is missing or belongs to another transaction', async () => {
      const transfer = {
        receipt: { result: 'SUCCESS' },
        log: [
          {
            address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
            topics: [
              'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '000000000000000000000000sender123456789012',
              '000000000000000000000000f916cf613ecf65390ff217cc15afa764563cad75',
            ],
            data: '000000000000000000000000000000000000000000000000000000000175d720',
          },
        ],
      };
      for (const id of [undefined, 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff']) {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...transfer, id }) }));
        const result = await cryptoVerifier.verifyTronPayment('1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
        expect(result.valid, String(id)).toBe(false);
        expect(result.creditsGranted, String(id)).toBe(0);
        vi.unstubAllGlobals();
      }
    });

    it('rejects transaction hashes with characters that could manipulate PostgREST filters', async () => {
      const req = new NextRequest('http://localhost/api/billing/crypto/claim', {
        method: 'POST',
        body: JSON.stringify({ network: 'polygon', tx_hash: '0x12345,eq.evil' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('validation_error');
    });
  });

  describe('Bitcoin verification', () => {
    const BTC_HASH = 'a'.repeat(64);
    const paysTenThousandSats = (confirmed: boolean) => ({
      ok: true,
      json: async () => ({
        status: { confirmed },
        vout: [{ scriptpubkey_address: cryptoVerifier.OFFICIAL_CRYPTO_WALLETS.btc, value: 10_000 }],
      }),
    });

    it('does not pay for a transaction that is still in the mempool', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(paysTenThousandSats(false)));
      const result = await cryptoVerifier.verifyBtcPayment(BTC_HASH);
      expect(result.valid).toBe(false);
      expect(result.creditsGranted).toBe(0);
      expect(result.error).toContain('not confirmed yet');
      vi.unstubAllGlobals();
    });

    it('pays the Fix Pack once the transaction is mined', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(paysTenThousandSats(true)));
      const result = await cryptoVerifier.verifyBtcPayment(BTC_HASH);
      expect(result).toMatchObject({ valid: true, creditsGranted: 15_000, packName: 'Fix Pack' });
      vi.unstubAllGlobals();
    });
  });
});

describe('x402 payment requirement', () => {
  it('advertises the $9.00 Starter Quick Pass as the minimum payment on every network', async () => {
    const starter = CREDIT_PACKS.find((pack) => pack.pack === 'starter');
    const res = buildX402PaymentRequiredResponse('https://stealthmark.io/api/scan/manifests', 'Payment required', 25);
    expect(res.status).toBe(402);
    expect(res.headers.get('WWW-Authenticate')).toContain('amount="9000000"');
    const body = await res.json();
    const amounts = body.accepts.map((entry: { network: string; maxAmountRequired: string }) => [entry.network, entry.maxAmountRequired]);
    expect(amounts).toEqual([
      ['base-mainnet', '9000000'],
      ['polygon-pos', '9000000'],
      ['bsc-mainnet', '9000000000000000000'],
      ['tron-mainnet', '9000000'],
    ]);
    expect(body.accepts[0].extra.creditsGranted).toBe(15_000);
    expect(body.accepts[0].extra.polarCheckout).toBe(starter?.checkoutUrl);
  });
});
