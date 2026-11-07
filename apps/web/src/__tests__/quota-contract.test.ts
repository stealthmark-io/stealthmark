import { describe, expect, it } from 'vitest';
import { computeQuota } from '../lib/quota';

/**
 * Fixed vectors for the quota rule that exists twice: here (apps/web/src/lib/quota.ts, used by the console chip)
 * and in apps/api/src/services/quota.ts (used by ingestion and alerts). The cap, used and remaining values must
 * agree. The percent is where they differ on purpose: the API reports one decimal and can exceed 100, the console
 * floors it to an integer and stops at 100, so 7,999 of 10,000 reads 80 in the API and 79 in the console. The API
 * test file quota.test.ts asserts the same inputs.
 */
interface Vector {
  name: string;
  input: Parameters<typeof computeQuota>[0];
  shared: { cap: number | null; used: number; remaining: number | null };
  consolePercent: number;
  /** What apps/api/src/services/quota.ts reports for the same input, kept here as documentation of the gap. */
  apiPercent: number | null;
}

const VECTORS: readonly Vector[] = [
  {
    name: 'free plan over its cap',
    input: { billing_mode: 'free', monthly_event_cap: 100, credit_balance_events: 0, used: 120 },
    shared: { cap: 100, used: 120, remaining: 0 },
    consolePercent: 100,
    apiPercent: 120,
  },
  {
    name: 'credits: cap is used plus balance',
    input: { billing_mode: 'credits', monthly_event_cap: 10_000, credit_balance_events: 30, used: 70 },
    shared: { cap: 100, used: 70, remaining: 30 },
    consolePercent: 70,
    apiPercent: 70,
  },
  {
    name: 'enterprise has no cap and no percent',
    input: { billing_mode: 'enterprise', monthly_event_cap: 1000, credit_balance_events: 0, used: 900 },
    shared: { cap: null, used: 900, remaining: null },
    consolePercent: 0,
    apiPercent: null,
  },
  {
    name: 'free plan just under the 80 percent warning',
    input: { billing_mode: 'free', monthly_event_cap: 10_000, credit_balance_events: 0, used: 7_999 },
    shared: { cap: 10_000, used: 7_999, remaining: 2_001 },
    consolePercent: 79,
    apiPercent: 80,
  },
  {
    name: 'free plan half used',
    input: { billing_mode: 'free', monthly_event_cap: 10_000, credit_balance_events: 0, used: 5_000 },
    shared: { cap: 10_000, used: 5_000, remaining: 5_000 },
    consolePercent: 50,
    apiPercent: 50,
  },
];

describe('computeQuota contract with apps/api/src/services/quota.ts', () => {
  it.each(VECTORS)('$name', ({ input, shared, consolePercent }) => {
    const quota = computeQuota(input);
    expect({ cap: quota.cap, used: quota.used, remaining: quota.remaining }).toEqual(shared);
    expect(quota.percent).toBe(consolePercent);
  });
});
