import { afterEach, describe, expect, it, vi } from 'vitest';
import { unlockCheckoutId, withoutCheckoutParams } from '../lib/checkout-return';
import { issueScanUnlockToken } from '../lib/scan-unlock';

function tokenWith(payload: unknown): string {
  return `smu1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

describe('withoutCheckoutParams', () => {
  it('drops checkout_id and session_id and keeps the rest of the URL', () => {
    expect(
      withoutCheckoutParams('https://stealthmark.io/scan?domain=acme.example&checkout_id=co_123&ref=hof#report'),
    ).toBe('/scan?domain=acme.example&ref=hof#report');
    expect(withoutCheckoutParams('https://stealthmark.io/scan?session_id=cs_1&domain=acme.example')).toBe(
      '/scan?domain=acme.example',
    );
  });

  it('removes every copy of both params and leaves no bare question mark', () => {
    expect(withoutCheckoutParams('https://stealthmark.io/scan?checkout_id=a&session_id=b&checkout_id=c')).toBe('/scan');
  });

  it('returns null when there is nothing to strip, so the page leaves history alone', () => {
    expect(withoutCheckoutParams('https://stealthmark.io/scan?domain=acme.example')).toBeNull();
    expect(withoutCheckoutParams('https://stealthmark.io/scan')).toBeNull();
  });
});

describe('unlockCheckoutId', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reads the checkout id from a token the server issued', () => {
    vi.stubEnv('SCAN_UNLOCK_SECRET', 'test-secret-with-at-least-32-characters!!');
    const token = issueScanUnlockToken({ checkoutId: 'co_RenewMe_123', domain: 'shop.example.com', productId: 'p1' });
    expect(token).not.toBeNull();
    expect(unlockCheckoutId(token ?? '')).toBe('co_RenewMe_123');
  });

  it('reads payloads whose base64url needs - and _ mapped back', () => {
    const token = tokenWith({ v: 1, cid: 'co_1', dom: '>>>???.example' });
    expect(token).toMatch(/[-_]/);
    expect(unlockCheckoutId(token)).toBe('co_1');
  });

  it('returns null for anything that is not an smu1 token with a checkout id', () => {
    expect(unlockCheckoutId('')).toBeNull();
    expect(unlockCheckoutId('smu1.')).toBeNull();
    expect(unlockCheckoutId(tokenWith({ cid: 'co_1' }).replace('smu1.', 'smu2.'))).toBeNull();
    expect(unlockCheckoutId('smu1.%%%not-base64%%%.sig')).toBeNull();
    expect(unlockCheckoutId(`smu1.${Buffer.from('not json').toString('base64url')}.sig`)).toBeNull();
    expect(unlockCheckoutId(tokenWith({ v: 1 }))).toBeNull();
    expect(unlockCheckoutId(tokenWith({ cid: '' }))).toBeNull();
    expect(unlockCheckoutId(tokenWith({ cid: 42 }))).toBeNull();
    expect(unlockCheckoutId(tokenWith(null))).toBeNull();
  });
});
