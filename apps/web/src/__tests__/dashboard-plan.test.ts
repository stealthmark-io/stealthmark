import { describe, expect, it } from 'vitest';
import { FREE_EVENT_CAP, buildUserPlan } from '../app/dashboard/views/dashboard-helpers';
import { DEFAULT_API_KEYS } from '../app/dashboard/views/dashboard-data';

const input = { isPaidPro: false, usedTransactions: 0 };

describe('buildUserPlan', () => {
  it('shows guests a sample, not a plan they could be on', () => {
    const plan = buildUserPlan({ ...input, isAuthenticated: false, effectiveTier: 'business' });
    expect(plan.planName).toBe('Guest demo');
    expect(plan.status).toBe('Sample data');
    expect(plan.maxTransactions).toBe(FREE_EVENT_CAP);
    expect(plan.priceMonthly).toBe(0);
    expect(JSON.stringify(plan)).not.toMatch(/Pro|Business|249|79/);
  });

  it.each([['free'], ['developer'], ['unknown-plan']])('calls the %s tier Free with the 250 event cap', (tier) => {
    const plan = buildUserPlan({ ...input, isAuthenticated: true, effectiveTier: tier });
    expect(plan.planName).toBe('Free');
    expect(plan.maxTransactions).toBe(250);
    expect(plan.portalUrl).toBe('/pricing');
  });

  it.each([['pro'], ['business']])('labels the archived %s tier as legacy and shows no price', (tier) => {
    const plan = buildUserPlan({ ...input, isAuthenticated: true, effectiveTier: tier });
    expect(plan.planName).toBe('Legacy plan');
    expect(plan.priceMonthly).toBe(0);
  });

  it.each([
    ['starter', 'Starter', 15000],
    ['growth', 'Growth', 60000],
    ['scale', 'Scale', 250000],
  ])('recognizes %s tier as %s with %i event cap', (tier, expectedName, expectedCap) => {
    const plan = buildUserPlan({ ...input, isAuthenticated: true, effectiveTier: tier });
    expect(plan.planName).toBe(expectedName);
    expect(plan.maxTransactions).toBe(expectedCap);
  });

  it('names Enterprise without inventing a price', () => {
    const plan = buildUserPlan({ ...input, isAuthenticated: true, effectiveTier: 'enterprise' });
    expect(plan.planName).toBe('Enterprise');
    expect(plan.priceMonthly).toBe(0);
  });

  it('sends legacy subscribers to the Polar portal and everyone else to pricing', () => {
    expect(buildUserPlan({ isAuthenticated: true, effectiveTier: 'pro', isPaidPro: true, usedTransactions: 0 }).portalUrl).toBe('https://polar.sh/stealthmark-sa/portal');
    expect(buildUserPlan({ ...input, isAuthenticated: true, effectiveTier: 'free' }).portalUrl).toBe('/pricing');
  });

  it('carries the events used through', () => {
    expect(buildUserPlan({ ...input, isAuthenticated: true, effectiveTier: 'free', usedTransactions: 1234 }).usedTransactions).toBe(1234);
  });
});

describe('guest sample keys', () => {
  it('carry only the SDK scope and are labeled as samples', () => {
    for (const key of DEFAULT_API_KEYS) {
      expect(key.scopes).toEqual(['usage:ingest']);
      expect(key.name.toLowerCase()).toContain('sample');
    }
  });
});
