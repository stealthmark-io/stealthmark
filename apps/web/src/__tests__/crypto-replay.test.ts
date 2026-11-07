import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as unlockScan } from '../app/api/billing/crypto/unlock-scan/route';
import { GET as trustReceiptGet, POST as trustReceipt } from '../app/api/v2/trust-receipt/route';
import * as cryptoVerifier from '../lib/crypto-verifier';
import { canonicalTxHash, type SupportedCryptoNetwork } from '../lib/crypto-verifier';
import * as adminSupabase from '../lib/supabase/admin';
import { verifyScanUnlockToken } from '../lib/scan-unlock';
import { fakeLedger, unknownColumns } from './helpers/credit-orders';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const HEX = 'ab'.repeat(32);
const INJECTED_HASH = `0x${HEX},polar_order_id.neq.none`;
let ip = 0;

// Mirrors the verifier: 15,000 credits from the $0.99 Fix Pack price up, and below it the payment is not valid.
function paidOnChain(amountUsd: number, tokenSymbol = 'USDC') {
  const creditsGranted = amountUsd >= 0.99 ? 15_000 : 0;
  return vi.spyOn(cryptoVerifier, 'verifyCryptoPayment').mockImplementation(async (network, txHash) => ({
    valid: creditsGranted > 0,
    network,
    txHash,
    recipientAddress: '0xtreasury',
    tokenSymbol,
    amountUsd,
    creditsGranted,
    packName: 'test',
  }));
}

function unlockRequest(body: unknown): NextRequest {
  return new NextRequest('https://stealthmark.io/api/billing/crypto/unlock-scan', {
    method: 'POST',
    headers: { 'cf-connecting-ip': `203.0.113.${++ip}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function receiptRequest(body: unknown): Request {
  return new Request('https://stealthmark.io/api/v2/trust-receipt', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv('SCAN_UNLOCK_SECRET', SECRET);
  vi.stubEnv('STEALTHMARK_RECEIPT_HMAC_SECRET', SECRET);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ badge: { grade: 'A' }, summary: { counts: { pass: 58, warn: 2, fail: 0 } } }), {
          status: 200,
        })
    )
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/billing/crypto/unlock-scan: one transaction, one unlock', () => {
  const paid = { domain: 'shop.example.com', network: 'base', txHash: `0X${HEX.toUpperCase()}` };

  it('records the sale in the real credit_orders columns before returning the token', async () => {
    const ledger = fakeLedger();
    const verifier = paidOnChain(9);

    const res = await unlockScan(unlockRequest(paid));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.plan).toBe('starter_pass');
    expect(verifyScanUnlockToken(body.unlock_token, 'shop.example.com')).not.toBeNull();
    expect(verifier).toHaveBeenCalledWith('base', `0x${HEX}`);
    expect(ledger.or).toHaveBeenCalledWith(
      `polar_order_id.eq.crypto:base:0x${HEX}:shop.example.com,tx_hash.eq.0x${HEX}`
    );
    const row = ledger.insert.mock.calls[0]?.[0];
    expect(unknownColumns(row)).toEqual([]);
    expect(row).toMatchObject({
      polar_order_id: `crypto:base:0x${HEX}:shop.example.com`,
      tx_hash: `0x${HEX}`,
      network: 'base',
      amount_cents: 900,
      credits_events: 15000,
    });
  });

  it('withholds the token when the insert fails', async () => {
    fakeLedger({ insertError: { code: '08006' } });
    paidOnChain(9);

    const res = await unlockScan(unlockRequest(paid));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ verified: false, error: 'ledger_unavailable', detail: expect.any(String) });
    expect(console.error).toHaveBeenCalledWith('[Crypto Unlock] credit_orders insert failed: 08006');
  });

  it('answers 409 when a concurrent claim inserted the same transaction first', async () => {
    fakeLedger({ insertError: { code: '23505' } });
    paidOnChain(9);

    const res = await unlockScan(unlockRequest(paid));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('tx_already_claimed');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('rejects a recorded transaction before asking the chain', async () => {
    const ledger = fakeLedger({ existing: { polar_order_id: `crypto:base:0x${HEX}` } });
    const verifier = paidOnChain(9);

    expect((await unlockScan(unlockRequest(paid))).status).toBe(409);
    expect(verifier).not.toHaveBeenCalled();
    expect(ledger.insert).not.toHaveBeenCalled();
  });

  it('fails closed when the ledger cannot be read or is not configured', async () => {
    fakeLedger({ lookupError: { code: '08006' } });
    const verifier = paidOnChain(9);
    expect((await unlockScan(unlockRequest(paid))).status).toBe(503);

    vi.spyOn(adminSupabase, 'createSupabaseAdminClient').mockReturnValue(null);
    expect((await unlockScan(unlockRequest(paid))).status).toBe(503);
    expect(verifier).not.toHaveBeenCalled();
  });

  it('refuses an unknown network and a hash that is not one before touching the ledger', async () => {
    const ledger = fakeLedger();
    paidOnChain(9);

    expect((await unlockScan(unlockRequest({ ...paid, network: 'dogecoin' }))).status).toBe(400);
    expect((await unlockScan(unlockRequest({ ...paid, txHash: INJECTED_HASH }))).status).toBe(400);
    expect((await unlockScan(unlockRequest({ ...paid, txHash: '0x1234' }))).status).toBe(400);
    expect(ledger.or).not.toHaveBeenCalled();
  });

  it('records nothing for a transfer below the $0.99 Fix Pack floor', async () => {
    const ledger = fakeLedger();
    paidOnChain(0.98);

    const res = await unlockScan(unlockRequest(paid));

    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe('payment_not_verified');
    expect(ledger.insert).not.toHaveBeenCalled();
  });

  it.each<[number, string, number]>([
    [0.99, 'starter_pass', 15_000],
    [24.5, 'starter_pass', 15_000],
  ])('records a %s USD transfer as %s with its credits', async (amountUsd, plan, credits) => {
    const ledger = fakeLedger();
    paidOnChain(amountUsd);

    const res = await unlockScan(unlockRequest(paid));

    expect(res.status).toBe(200);
    expect((await res.json()).plan).toBe(plan);
    expect(ledger.insert.mock.calls[0]?.[0]).toMatchObject({
      credits_events: credits,
      amount_cents: Math.round(amountUsd * 100),
    });
  });

  it('gives the same domain its token again from the recorded sale without asking the chain', async () => {
    const ledger = fakeLedger({
      existing: { polar_order_id: `crypto:base:0x${HEX}:shop.example.com`, amount_cents: 900, credits_events: 15000 },
    });
    const verifier = paidOnChain(9);

    const res = await unlockScan(unlockRequest(paid));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ verified: true, plan: 'starter_pass', amount_usd: 9, tx_hash: `0x${HEX}` });
    expect(verifyScanUnlockToken(body.unlock_token, 'shop.example.com')).not.toBeNull();
    expect(verifier).not.toHaveBeenCalled();
    expect(ledger.insert).not.toHaveBeenCalled();
  });

  it('answers 409 when the transaction already unlocked another domain', async () => {
    const ledger = fakeLedger({
      existing: { polar_order_id: `crypto:base:0x${HEX}:other.example.com`, amount_cents: 900, credits_events: 15000 },
    });

    expect((await unlockScan(unlockRequest(paid))).status).toBe(409);
    expect(ledger.insert).not.toHaveBeenCalled();
  });

  it.each(['null', '[]', '"shop.example.com"', '{'])('refuses the body %s before touching the ledger', async (raw) => {
    const ledger = fakeLedger();

    const res = await unlockScan(unlockRequest(raw));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_json');
    expect(ledger.or).not.toHaveBeenCalled();
  });

  it('refuses a body over 2 KB before touching the ledger', async () => {
    const ledger = fakeLedger();

    const res = await unlockScan(unlockRequest({ ...paid, pad: 'x'.repeat(3000) }));

    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('payload_too_large');
    expect(ledger.or).not.toHaveBeenCalled();
  });
});

describe('POST /api/v2/trust-receipt: one transaction, one receipt', () => {
  it.each<[SupportedCryptoNetwork, string, string, string]>([
    ['base', `0X${HEX.toUpperCase()}`, `0x${HEX}`, 'USDC'],
    ['tron', `0x${HEX}`, HEX, 'USDT'],
  ])('signs a %s receipt only after recording the transaction', async (chain, sent, canonical, token) => {
    const ledger = fakeLedger();
    const verifier = paidOnChain(9, token);

    const res = await trustReceipt(receiptRequest({ domain: 'shop.example.com', txHash: sent, chain }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(body.receipt.paymentRail).toBe(`ONCHAIN_${chain.toUpperCase()}_${token}_9USD`);
    expect(verifier).toHaveBeenCalledWith(chain, canonical);
    expect(ledger.or).toHaveBeenCalledWith(`polar_order_id.eq.trust_receipt:${chain}:${canonical},tx_hash.eq.${canonical}`);
    const row = ledger.insert.mock.calls[0]?.[0];
    expect(unknownColumns(row)).toEqual([]);
    expect(row).toMatchObject({
      product_id: 'trust_receipt_x402',
      credits_events: 0,
      payment_method: 'crypto',
      network: chain,
      tx_hash: canonical,
      amount_cents: 900,
    });
  });

  const paid = { domain: 'shop.example.com', txHash: `0x${HEX}`, chain: 'base' };

  it('signs nothing when the insert fails', async () => {
    fakeLedger({ insertError: { code: '08006' } });
    paidOnChain(9);

    const res = await trustReceipt(receiptRequest(paid));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'Payment ledger unavailable, so the transaction was not used. Retry later.',
    });
    expect(console.error).toHaveBeenCalledWith('[Trust Receipt] credit_orders insert failed: 08006');
  });

  it('answers 409 when a concurrent request inserted the same transaction first', async () => {
    fakeLedger({ insertError: { code: '23505' } });
    paidOnChain(9);

    const res = await trustReceipt(receiptRequest(paid));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Replay blocked: txHash already consumed');
  });

  it('rejects a recorded transaction before asking the chain', async () => {
    fakeLedger({ existing: { polar_order_id: `trust_receipt:base:0x${HEX}` } });
    const verifier = paidOnChain(9);

    expect((await trustReceipt(receiptRequest(paid))).status).toBe(409);
    expect(verifier).not.toHaveBeenCalled();
  });

  it('fails closed when the ledger cannot be read or is not configured', async () => {
    fakeLedger({ lookupError: { code: '08006' } });
    const verifier = paidOnChain(9);
    expect((await trustReceipt(receiptRequest(paid))).status).toBe(503);

    vi.spyOn(adminSupabase, 'createSupabaseAdminClient').mockReturnValue(null);
    expect((await trustReceipt(receiptRequest(paid))).status).toBe(503);
    expect(verifier).not.toHaveBeenCalled();
  });

  it('refuses other chains and malformed hashes before touching the ledger', async () => {
    const ledger = fakeLedger();
    paidOnChain(9);

    expect((await trustReceipt(receiptRequest({ ...paid, chain: 'ethereum' }))).status).toBe(400);
    expect((await trustReceipt(receiptRequest({ ...paid, chain: 'solana' }))).status).toBe(400);
    expect((await trustReceipt(receiptRequest({ ...paid, txHash: '0x1234' }))).status).toBe(400);
    expect((await trustReceipt(receiptRequest({ ...paid, txHash: INJECTED_HASH }))).status).toBe(400);
    expect(ledger.or).not.toHaveBeenCalled();
  });

  it('records nothing when the chain does not confirm the payment', async () => {
    const ledger = fakeLedger();
    vi.spyOn(cryptoVerifier, 'verifyCryptoPayment').mockResolvedValue({
      valid: false,
      network: 'base',
      txHash: `0x${HEX}`,
      recipientAddress: '0xtreasury',
      tokenSymbol: 'USDC',
      amountUsd: 2,
      creditsGranted: 0,
      packName: 'none',
      error: 'Transfer amount ($2.00) is below minimum',
    });

    expect((await trustReceipt(receiptRequest(paid))).status).toBe(402);
    expect(ledger.insert).not.toHaveBeenCalled();
  });

  it('quotes $9.00 in the x402 challenge and in GET', async () => {
    const res = await trustReceipt(receiptRequest({ domain: 'shop.example.com' }));
    const body = await res.json();
    expect(res.status).toBe(402);
    expect(body.error).toContain('9.00');
    expect(body.x402Challenge.priceUsd).toBe('9.00');
    expect(res.headers.get('WWW-Authenticate')).toContain('amount="9.00"');

    const usage = await trustReceiptGet(new Request('https://stealthmark.io/api/v2/trust-receipt'));
    expect(usage.status).toBe(400);
    expect((await usage.json()).pricing.x402SingleReceiptUsd).toBe(9);

    const quote = await trustReceiptGet(new Request('https://stealthmark.io/api/v2/trust-receipt?domain=shop.example.com'));
    expect((await quote.json()).x402PaymentRequiredForSignedReceipt.priceUsd).toBe('9.00');
  });

  it.each<[string, number, unknown]>([
    ['answers 502', 502, { error: 'bad gateway' }],
    ['has no counts', 200, { badge: { grade: 'A' } }],
  ])('signs nothing and leaves the transaction unused when the audit %s', async (_label, status, auditBody) => {
    const ledger = fakeLedger();
    const verifier = paidOnChain(9);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(auditBody), { status })));

    const res = await trustReceipt(receiptRequest(paid));

    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('nothing was signed');
    expect(verifier).toHaveBeenCalled();
    expect(ledger.insert).not.toHaveBeenCalled();
  });

  it('answers 503 to a quote when the audit is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })));

    const res = await trustReceiptGet(new Request('https://stealthmark.io/api/v2/trust-receipt?domain=shop.example.com'));

    expect(res.status).toBe(503);
    expect(console.error).toHaveBeenCalledWith('[Trust Receipt] audit answered 429');
  });

  it('signs a sandbox receipt that never verifies as valid and touches no ledger', async () => {
    const ledger = fakeLedger();

    const issued = await trustReceipt(receiptRequest({ domain: 'shop.example.com', sandbox: true }));
    const { receipt, signature } = await issued.json();
    expect(issued.status).toBe(200);
    expect(receipt.paymentRail).toBe('SANDBOX_PREVIEW_NON_PRODUCTION');

    const checked = await trustReceipt(receiptRequest({ action: 'verify_receipt', receipt, signature }));
    expect(await checked.json()).toMatchObject({
      valid: false,
      sandbox: true,
      signatureVerifiedConstantTime: true,
      notExpired: true,
    });
    expect(ledger.or).not.toHaveBeenCalled();
  });

  it('signs the audit counts into a paid receipt and rejects one with a changed count', async () => {
    fakeLedger();
    paidOnChain(9);

    const issued = await trustReceipt(receiptRequest(paid));
    const { receipt, signature } = await issued.json();
    expect(receipt).toMatchObject({ grade: 'A', passCount: 58, warnCount: 2, failCount: 0, decision: 'ALLOW_SETTLEMENT' });

    const checked = await trustReceipt(receiptRequest({ action: 'verify_receipt', receipt, signature }));
    expect(await checked.json()).toMatchObject({ valid: true, sandbox: false });

    const forged = await trustReceipt(
      receiptRequest({ action: 'verify_receipt', receipt: { ...receipt, passCount: 60 }, signature })
    );
    expect((await forged.json()).valid).toBe(false);
  });

  it.each(['null', '[]', '"shop.example.com"', '{'])('refuses the body %s before touching the ledger', async (raw) => {
    const ledger = fakeLedger();

    const res = await trustReceipt(receiptRequest(raw));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Body must be a JSON object');
    expect(ledger.or).not.toHaveBeenCalled();
  });

  it('refuses a body over 4 KB before touching the ledger', async () => {
    const ledger = fakeLedger();

    const res = await trustReceipt(receiptRequest({ ...paid, pad: 'x'.repeat(5000) }));

    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('Payload too large');
    expect(ledger.or).not.toHaveBeenCalled();
  });

  it('signs and verifies nothing without a configured secret', async () => {
    vi.stubEnv('STEALTHMARK_RECEIPT_HMAC_SECRET', '');
    vi.stubEnv('STEALTHMARK_UNSUB_SECRET', '');
    const ledger = fakeLedger();
    const verifier = paidOnChain(9);
    const stored = { receiptId: 'tr_1', nonce: 'n', expiresAt: '2099-01-01T00:00:00.000Z' };

    expect((await trustReceipt(receiptRequest(paid))).status).toBe(503);
    expect((await trustReceipt(receiptRequest({ domain: 'shop.example.com', sandbox: true }))).status).toBe(503);
    expect(
      (await trustReceipt(receiptRequest({ action: 'verify_receipt', receipt: stored, signature: 'ab' }))).status
    ).toBe(503);
    expect(verifier).not.toHaveBeenCalled();
    expect(ledger.or).not.toHaveBeenCalled();
  });

  it('signs for the normalized domain and refuses one that is not a public host name', async () => {
    fakeLedger();

    const res = await trustReceipt(receiptRequest({ domain: 'https://Shop.Example.com/checkout', sandbox: true }));
    expect((await res.json()).receipt.sellerDomain).toBe('shop.example.com');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('domain=shop.example.com'), expect.anything());

    expect((await trustReceipt(receiptRequest({ domain: '127.0.0.1', sandbox: true }))).status).toBe(400);
  });
});

describe('canonicalTxHash', () => {
  it('folds case and the 0x prefix the way each chain spells a hash', () => {
    expect(canonicalTxHash('ethereum', `0X${HEX.toUpperCase()}`)).toBe(`0x${HEX}`);
    expect(canonicalTxHash('polygon', HEX)).toBe(`0x${HEX}`);
    expect(canonicalTxHash('tron', `0x${HEX}`)).toBe(HEX);
    expect(canonicalTxHash('btc', HEX.toUpperCase())).toBe(HEX);
    expect(canonicalTxHash('solana', '2'.repeat(88))).toBe('2'.repeat(88));
  });

  it('returns null for anything that is not a hash of that chain', () => {
    expect(canonicalTxHash('base', 'ab'.repeat(31))).toBeNull();
    expect(canonicalTxHash('base', INJECTED_HASH)).toBeNull();
    expect(canonicalTxHash('solana', `0x${HEX}`)).toBeNull();
  });
});
