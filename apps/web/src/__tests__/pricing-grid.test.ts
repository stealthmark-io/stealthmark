import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PricingGrid } from '../components/landing/PricingGrid';
import { CREDIT_PACKS, creditsForProduct, findPackByProductId, pricePer1k } from '../lib/polar-products';
import { FREE_SITE_ALLOWANCE } from '../lib/plan-copy';

describe('PricingGrid markup', () => {
  const html = renderToStaticMarkup(createElement(PricingGrid));

  it('renders Free, the three credit packs and Enterprise', () => {
    expect(html).toContain('250 agent events / month');
    expect(html).toContain(FREE_SITE_ALLOWANCE);
    expect(html).not.toContain('1 protected site');
    expect(html).toContain('7-day event history');
    for (const pack of CREDIT_PACKS) {
      expect(html).toContain(`data-testid="pack-${pack.pack}"`);
      expect(html).toContain(`${pack.credits.toLocaleString('en-US')} agent events`);
      expect(html).toContain(`$${pack.priceUsd}`);
      expect(html).toContain(`$${pricePer1k(pack)} / 1k`);
      expect(html).toContain(`/api/billing/checkout?pack=${pack.pack}`);
    }
    expect(html).toContain('href="/enterprise/contact"');
  });

  it('states one-time payment and 12 month validity', () => {
    expect(html).toContain('no subscription');
    expect(html).toContain('12 months');
  });

  it('does not render the retired subscription plans or the billing toggle', () => {
    for (const retired of ['$99', '$250', 'Business Gateway', 'Pro Gateway', '1,500,000', 'Annual', 'Monthly']) {
      expect(html).not.toContain(retired);
    }
  });
});

describe('credit pack catalog', () => {
  it('prices the packs at $9, $29 and $79', () => {
    expect(CREDIT_PACKS.map((p) => [p.pack, p.priceUsd, p.credits])).toEqual([
      ['starter', 9, 15_000],
      ['growth', 29, 60_000],
      ['scale', 79, 250_000],
    ]);
  });

  it('resolves credits with catalog precedence for known products and metadata for custom', () => {
    // For known products, code catalog strictly takes precedence over Polar metadata; the retired pack is no longer sold but still credits
    expect(creditsForProduct({ id: 'ae5303ba-3cc7-4c9e-a8f4-0d5b654fd305', metadata: { credits_events: '100' } })).toBe(2_500);
    expect(findPackByProductId('ae5303ba-3cc7-4c9e-a8f4-0d5b654fd305')).toBeNull();
    expect(creditsForProduct({ id: '18a27e56-8407-4cad-96ad-e5f833b3be71', metadata: { credits_events: '100000' } })).toBe(15_000);
    expect(creditsForProduct({ id: '310f8f11-b9f9-4442-8a52-4babbef16b95' })).toBe(60_000);
    expect(creditsForProduct(null, 'e7c75042-3c37-4f06-9c9d-2e4738f765e7')).toBe(250_000);

    // Custom or unknown products fallback to metadata
    expect(creditsForProduct({ id: 'custom-pack-99', metadata: { kind: 'credit_pack', credits_events: '50000' } })).toBe(50_000);
    expect(creditsForProduct({ id: '4a376252-688d-4cee-a98f-abc16834884d' })).toBeNull();
    expect(creditsForProduct({ id: 'x', metadata: { kind: 'subscription', credits_events: 5 } })).toBeNull();
    expect(findPackByProductId('18a27e56-8407-4cad-96ad-e5f833b3be71')?.pack).toBe('starter');
    expect(findPackByProductId(undefined)).toBeNull();
  });
});
