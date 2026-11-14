import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SUPPORTED_CRYPTO_NETWORKS,
  PG_UNIQUE_VIOLATION,
  DEFAULT_CONSOLE_ORG_ID,
  REFERRAL_COMMISSION_RATE,
  parseSupportedCryptoNetwork,
  cleanReferralCode,
  calculateReferralCommission,
  createFixedWindowRateLimiter,
  ledgerUnavailableResponse,
  txAlreadyClaimedResponse,
  checkExistingCreditOrder,
  recordCryptoCreditOrder,
} from '../lib/billing-crypto-helpers';
import { fakeLedger, unknownColumns } from './helpers/credit-orders';

describe('billing-crypto-helpers', () => {
  describe('SUPPORTED_CRYPTO_NETWORKS & parseSupportedCryptoNetwork', () => {
    it('contains all 7 supported chains', () => {
      expect(SUPPORTED_CRYPTO_NETWORKS).toEqual([
        'ethereum',
        'btc',
        'solana',
        'polygon',
        'base',
        'bsc',
        'tron',
      ]);
    });

    it('parses valid networks in various casings and with whitespace', () => {
      expect(parseSupportedCryptoNetwork('base')).toBe('base');
      expect(parseSupportedCryptoNetwork('BASE')).toBe('base');
      expect(parseSupportedCryptoNetwork('  Base  ')).toBe('base');
      expect(parseSupportedCryptoNetwork('solana')).toBe('solana');
      expect(parseSupportedCryptoNetwork('SOLANA')).toBe('solana');
      expect(parseSupportedCryptoNetwork('polygon')).toBe('polygon');
      expect(parseSupportedCryptoNetwork('ethereum')).toBe('ethereum');
      expect(parseSupportedCryptoNetwork('bsc')).toBe('bsc');
      expect(parseSupportedCryptoNetwork('tron')).toBe('tron');
      expect(parseSupportedCryptoNetwork('btc')).toBe('btc');
    });

    it('rejects unsupported or malformed network values with null', () => {
      expect(parseSupportedCryptoNetwork('dogecoin')).toBeNull();
      expect(parseSupportedCryptoNetwork('monero')).toBeNull();
      expect(parseSupportedCryptoNetwork('arbitrum')).toBeNull();
      expect(parseSupportedCryptoNetwork('')).toBeNull();
      expect(parseSupportedCryptoNetwork('   ')).toBeNull();
      expect(parseSupportedCryptoNetwork(null)).toBeNull();
      expect(parseSupportedCryptoNetwork(undefined)).toBeNull();
      expect(parseSupportedCryptoNetwork(123)).toBeNull();
      expect(parseSupportedCryptoNetwork({})).toBeNull();
      expect(parseSupportedCryptoNetwork(['base'])).toBeNull();
    });
  });

  describe('cleanReferralCode & calculateReferralCommission', () => {
    it('normalizes valid referral codes', () => {
      expect(cleanReferralCode('partner_1')).toBe('partner_1');
      expect(cleanReferralCode('  PARTNER-2  ')).toBe('partner-2');
      expect(cleanReferralCode('agent.007')).toBe('agent.007');
      expect(cleanReferralCode('ab')).toBe('ab');
    });

    it('rejects invalid referral codes with null', () => {
      expect(cleanReferralCode('a')).toBeNull(); // too short (min 2)
      expect(cleanReferralCode('a'.repeat(65))).toBeNull(); // too long (max 64)
      expect(cleanReferralCode('inv@lid!')).toBeNull();
      expect(cleanReferralCode('has space')).toBeNull();
      expect(cleanReferralCode('')).toBeNull();
      expect(cleanReferralCode(null)).toBeNull();
      expect(cleanReferralCode(undefined)).toBeNull();
      expect(cleanReferralCode(99)).toBeNull();
    });

    it('calculates 30% rounded referral commission', () => {
      expect(REFERRAL_COMMISSION_RATE).toBe(0.30);
      expect(calculateReferralCommission(99, 'partner')).toBe(30); // 99 * 0.3 = 29.7 -> 30
      expect(calculateReferralCommission(2450, 'partner')).toBe(735); // 2450 * 0.3 = 735
      expect(calculateReferralCommission(5, 'partner')).toBe(2); // 5 * 0.3 = 1.5 -> 2
      expect(calculateReferralCommission(900, 'partner')).toBe(270);
      expect(calculateReferralCommission(100, null)).toBe(0);
      expect(calculateReferralCommission(100, undefined)).toBe(0);
      expect(calculateReferralCommission(100, '')).toBe(0);
    });
  });

  describe('createFixedWindowRateLimiter', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('allows requests up to maxPerWindow and blocks beyond it', () => {
      const limiter = createFixedWindowRateLimiter(3, 60_000);
      const ip = '192.168.1.1';

      expect(limiter(ip)).toBe(true); // 1
      expect(limiter(ip)).toBe(true); // 2
      expect(limiter(ip)).toBe(true); // 3
      expect(limiter(ip)).toBe(false); // 4 (blocked)
      expect(limiter(ip)).toBe(false); // 5 (blocked)
    });

    it('tracks different IPs separately', () => {
      const limiter = createFixedWindowRateLimiter(2, 60_000);

      expect(limiter('ip-a')).toBe(true);
      expect(limiter('ip-a')).toBe(true);
      expect(limiter('ip-a')).toBe(false);

      expect(limiter('ip-b')).toBe(true);
      expect(limiter('ip-b')).toBe(true);
      expect(limiter('ip-b')).toBe(false);
    });

    it('resets count after windowMs expires', () => {
      const limiter = createFixedWindowRateLimiter(1, 60_000);
      const ip = '10.0.0.1';

      expect(limiter(ip)).toBe(true);
      expect(limiter(ip)).toBe(false);

      vi.advanceTimersByTime(60_001);

      expect(limiter(ip)).toBe(true);
    });

    it('clears all entries with reset() and reports size()', () => {
      const limiter = createFixedWindowRateLimiter(5, 60_000);
      limiter('1.1.1.1');
      limiter('2.2.2.2');
      expect(limiter.size()).toBe(2);

      limiter.reset();
      expect(limiter.size()).toBe(0);
    });

    it('sweeps expired entries when exceeding maxEntries', () => {
      const limiter = createFixedWindowRateLimiter(5, 10_000, 2);
      limiter('ip-1');
      limiter('ip-2');
      expect(limiter.size()).toBe(2);

      // Expire current entries
      vi.advanceTimersByTime(11_000);

      // Adding 3rd entry triggers sweep of expired entries
      limiter('ip-3');
      expect(limiter.size()).toBe(1);
    });
  });

  describe('ledger error response helpers', () => {
    it('ledgerUnavailableResponse produces status 503 with exact shapes', async () => {
      // includeOk = true (x402 route)
      const x402Res = ledgerUnavailableResponse(true);
      expect(x402Res.status).toBe(503);
      const x402Body = await x402Res.json();
      expect(x402Body).toEqual({
        ok: false,
        verified: false,
        error: 'ledger_unavailable',
        detail: 'Payment ledger unavailable; no settlement or charge occurred. Retry shortly.',
      });

      // includeOk = false (unlock-scan route)
      const cryptoRes = ledgerUnavailableResponse(false);
      expect(cryptoRes.status).toBe(503);
      const cryptoBody = await cryptoRes.json();
      expect(cryptoBody).toEqual({
        verified: false,
        error: 'ledger_unavailable',
        detail: 'The payment could not be recorded right now, so the transaction was not used. Retry in a minute.',
      });
      expect(cryptoBody).not.toHaveProperty('ok');

      // Custom detail
      const customRes = ledgerUnavailableResponse(true, 'Custom ledger error');
      const customBody = await customRes.json();
      expect(customBody.detail).toBe('Custom ledger error');
    });

    it('txAlreadyClaimedResponse produces status 409 with exact shapes', async () => {
      // includeOk = true (x402 route)
      const x402Res = txAlreadyClaimedResponse(undefined, true);
      expect(x402Res.status).toBe(409);
      const x402Body = await x402Res.json();
      expect(x402Body).toEqual({
        ok: false,
        verified: false,
        error: 'tx_already_claimed',
        detail: 'This x402 authorization or transaction hash has already been consumed.',
      });

      // includeOk = false (unlock-scan route)
      const cryptoRes = txAlreadyClaimedResponse();
      expect(cryptoRes.status).toBe(409);
      const cryptoBody = await cryptoRes.json();
      expect(cryptoBody).toEqual({
        verified: false,
        error: 'tx_already_claimed',
        detail: 'This transaction hash has already been used.',
      });
      expect(cryptoBody).not.toHaveProperty('ok');

      // Custom detail with includeOk = false
      const customRes = txAlreadyClaimedResponse('Custom duplicate detail', false);
      const customBody = await customRes.json();
      expect(customBody.detail).toBe('Custom duplicate detail');
      expect(customBody).not.toHaveProperty('ok');
    });
  });

  describe('checkExistingCreditOrder', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('queries with orderId and txHash using exact .or filter', async () => {
      const ledger = fakeLedger({ existing: { polar_order_id: 'ord_123', amount_cents: 99 } });
      const client = { from: () => ledger };

      const result = await checkExistingCreditOrder(
        client as never,
        'ord_123',
        '0xabc',
        'polar_order_id, amount_cents',
        'TestPrefix'
      );

      expect(ledger.or).toHaveBeenCalledWith('polar_order_id.eq.ord_123,tx_hash.eq.0xabc');
      expect(ledger.limit).toHaveBeenCalledWith(1);
      expect(result.data?.polar_order_id).toBe('ord_123');
      expect(result.error).toBeNull();
    });

    it('queries with orderId only when txHash is omitted', async () => {
      const ledger = fakeLedger({ existing: null });
      const client = { from: () => ledger };

      const result = await checkExistingCreditOrder(
        client as never,
        'ord_456',
        undefined,
        'polar_order_id'
      );

      expect(ledger.or).toHaveBeenCalledWith('polar_order_id.eq.ord_456');
      expect(result.data).toBeNull();
      expect(result.error).toBeNull();
    });

    it('logs error when lookup fails with logPrefix', async () => {
      const ledger = fakeLedger({ lookupError: { code: '08006' } });
      const client = { from: () => ledger };

      const result = await checkExistingCreditOrder(
        client as never,
        'ord_789',
        '0x123',
        undefined,
        'TestLookup'
      );

      expect(result.error?.code).toBe('08006');
      expect(console.error).toHaveBeenCalledWith('[TestLookup] credit_orders lookup failed: 08006');
    });
  });

  describe('recordCryptoCreditOrder', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('inserts order with all valid fields and 30% referral commission', async () => {
      const ledger = fakeLedger();
      const client = { from: () => ledger };

      const result = await recordCryptoCreditOrder({
        supabase: client as never,
        orderId: 'crypto:base:0x123:example.com',
        productId: 'prod_fixpack',
        creditsEvents: 15000,
        amountCents: 99,
        currency: 'USDC',
        paymentMethod: 'crypto_usdc',
        network: 'base',
        txHash: '0x123',
        referrerCode: 'affiliate_1',
        logPrefix: 'TestInsert',
      });

      expect(result).toEqual({ ok: true });
      const row = ledger.insert.mock.calls[0]?.[0];
      expect(unknownColumns(row)).toEqual([]);
      expect(row).toMatchObject({
        polar_order_id: 'crypto:base:0x123:example.com',
        org_id: DEFAULT_CONSOLE_ORG_ID,
        product_id: 'prod_fixpack',
        credits_events: 15000,
        amount_cents: 99,
        currency: 'USDC',
        payment_method: 'crypto_usdc',
        network: 'base',
        tx_hash: '0x123',
        referrer_code: 'affiliate_1',
        commission_cents: 30,
      });
      expect(console.error).not.toHaveBeenCalled();
    });

    it('maps PG_UNIQUE_VIOLATION (23505) to tx_already_claimed without logging error', async () => {
      expect(PG_UNIQUE_VIOLATION).toBe('23505');
      const ledger = fakeLedger({ insertError: { code: '23505' } });
      const client = { from: () => ledger };

      const result = await recordCryptoCreditOrder({
        supabase: client as never,
        orderId: 'crypto:base:0x123:example.com',
        productId: 'prod_fixpack',
        creditsEvents: 15000,
        amountCents: 99,
        currency: 'USDC',
        paymentMethod: 'crypto_usdc',
        network: 'base',
        txHash: '0x123',
        logPrefix: 'TestInsert',
      });

      expect(result).toEqual({ ok: false, error: 'tx_already_claimed', dbCode: '23505' });
      expect(console.error).not.toHaveBeenCalled();
    });

    it('maps other DB errors to ledger_unavailable and logs prefix', async () => {
      const ledger = fakeLedger({ insertError: { code: '08006' } });
      const client = { from: () => ledger };

      const result = await recordCryptoCreditOrder({
        supabase: client as never,
        orderId: 'crypto:base:0x123:example.com',
        productId: 'prod_fixpack',
        creditsEvents: 15000,
        amountCents: 99,
        currency: 'USDC',
        paymentMethod: 'crypto_usdc',
        network: 'base',
        txHash: '0x123',
        logPrefix: 'TestInsert',
      });

      expect(result).toEqual({ ok: false, error: 'ledger_unavailable', dbCode: '08006' });
      expect(console.error).toHaveBeenCalledWith('[TestInsert] credit_orders insert failed: 08006');
    });
  });
});
