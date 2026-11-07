import { describe, it, expect } from 'vitest';

describe('ROI & Token Savings Calculator Core Logic', () => {
  const TOKENS_PER_SCRAPE = 18000;
  const TOKENS_PER_GATEWAY = 182;
  const COST_PER_MILLION_TOKENS = 10; // $10 per 1M tokens average

  function calculateSavings(requests: number) {
    const scrapeTokens = requests * TOKENS_PER_SCRAPE;
    const gatewayTokens = requests * TOKENS_PER_GATEWAY;
    const tokensSaved = scrapeTokens - gatewayTokens;

    const scrapeCost = (scrapeTokens / 1000000) * COST_PER_MILLION_TOKENS;
    const gatewayCost = (gatewayTokens / 1000000) * COST_PER_MILLION_TOKENS;
    const monthlySavings = Math.max(0, scrapeCost - gatewayCost);
    const annualSavings = monthlySavings * 12;

    return {
      scrapeTokens,
      gatewayTokens,
      tokensSaved,
      monthlySavings,
      annualSavings,
      tokenReductionRatio: (tokensSaved / scrapeTokens) * 100,
    };
  }

  it('calculates ~99% token reduction ratio across all volumes', () => {
    const res250k = calculateSavings(250000);
    expect(res250k.tokenReductionRatio).toBeGreaterThan(98.9);
    expect(res250k.tokenReductionRatio).toBeLessThan(99.1);

    const res1M = calculateSavings(1000000);
    expect(res1M.tokenReductionRatio).toBeGreaterThan(98.9);
  });

  it('calculates exact monthly savings for 250,000 requests', () => {
    const res = calculateSavings(250000);
    // 250k * 18,000 = 4.5B tokens => $45,000 scrape cost
    // 250k * 182 = 45.5M tokens => $455 gateway cost
    // monthly savings: $44,545 USD
    expect(res.monthlySavings).toBe(44545);
    expect(res.annualSavings).toBe(44545 * 12);
  });

  it('handles minimum and maximum boundary values without crashing or negative values', () => {
    const min = calculateSavings(0);
    expect(min.monthlySavings).toBe(0);
    expect(min.annualSavings).toBe(0);

    const max = calculateSavings(10000000); // 10M requests
    expect(max.monthlySavings).toBeGreaterThan(1000);
  });
});
