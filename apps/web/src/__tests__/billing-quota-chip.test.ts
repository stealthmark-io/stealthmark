import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { QuotaResponse } from '../lib/quota';
import { BillingQuotaChip, QUOTA_EXCEEDED_COPY, QuotaChipView } from '../app/dashboard/components/BillingQuotaChip';

describe('BillingQuotaChip quota states', () => {
  function quotaOf(overrides: Partial<QuotaResponse>): QuotaResponse {
    return {
      cap: 10_000,
      used: 2_500,
      remaining: 7_500,
      percent: 25,
      mode: 'free',
      level: 'ok',
      period_month: '2026-09-01',
      alerts: { eighty_percent_sent_at: null, hundred_percent_sent_at: null },
      ...overrides,
    };
  }

  function render(quota: QuotaResponse | null, variant: 'compact' | 'expanded', state: { loading?: boolean; error?: string | null } = {}): string {
    return renderToStaticMarkup(
      createElement(QuotaChipView, {
        quota,
        loading: state.loading ?? false,
        error: state.error ?? null,
        variant,
        portalUrl: '/pricing',
      }),
    );
  }

  const warning = quotaOf({ used: 8_200, remaining: 1_800, percent: 82, level: 'warning' });
  const exceeded = quotaOf({ used: 10_000, remaining: 0, percent: 100, level: 'exceeded' });

  it('renders the ok state with the mode label and a neutral bar', () => {
    for (const variant of ['compact', 'expanded'] as const) {
      const html = render(quotaOf({}), variant);
      expect(html).toContain('Free');
      expect(html).toContain('2,500 / 10,000 events (25%)');
      expect(html).toContain('data-level="ok"');
      expect(html).toContain('aria-valuenow="25"');
      expect(html).not.toContain(QUOTA_EXCEEDED_COPY);
    }
  });

  it('renders the warning state in amber from 80%', () => {
    for (const variant of ['compact', 'expanded'] as const) {
      const html = render(warning, variant);
      expect(html).toContain('data-level="warning"');
      expect(html).toContain('text-amber-300');
      expect(html).toContain('8,200 / 10,000 events (82%)');
      expect(html).toContain('aria-valuenow="82"');
      expect(html).not.toContain(QUOTA_EXCEEDED_COPY);
    }
    expect(render(warning, 'expanded')).toContain('Near limit');
  });

  it('renders the exceeded state with the pause copy', () => {
    for (const variant of ['compact', 'expanded'] as const) {
      const html = render(exceeded, variant);
      expect(html).toContain('data-level="exceeded"');
      expect(html).toContain('text-red-300');
      expect(html).toContain('10,000 / 10,000 events (100%)');
      expect(html).toContain('aria-valuenow="100"');
      expect(html).toContain(QUOTA_EXCEEDED_COPY);
    }
    expect(QUOTA_EXCEEDED_COPY).toBe('Ingestion paused until next period or credits top-up. Your site keeps running.');
    expect(render(exceeded, 'expanded')).toContain('Paused');
  });

  it('labels credits and enterprise and picks the matching call to action', () => {
    const credits = render(quotaOf({ mode: 'credits', cap: 1_000, used: 100, remaining: 900, percent: 10 }), 'expanded');
    expect(credits).toContain('Credits');
    expect(credits).toContain('900 credit events left');
    expect(credits).toContain('Top up');

    const enterprise = render(quotaOf({ mode: 'enterprise', cap: null, remaining: null, percent: 0, used: 77 }), 'compact');
    expect(enterprise).toContain('Enterprise');
    expect(enterprise).toContain('77 events, no cap');
    expect(enterprise).not.toContain('role="progressbar"');
    expect(enterprise).toContain('Manage');

    expect(render(quotaOf({}), 'compact')).toContain('Upgrade');

    const scale = renderToStaticMarkup(
      createElement(QuotaChipView, {
        quota: quotaOf({ mode: 'credits', cap: 250_000, used: 549, remaining: 249_451, percent: 0 }),
        loading: false,
        error: null,
        variant: 'compact',
        portalUrl: '/pricing',
        planName: 'Scale',
      }),
    );
    expect(scale).toContain('Scale');
    expect(scale).toContain('549 / 250,000 events (0%)');
  });

  it('shows the reset date for free quotas', () => {
    expect(render(quotaOf({}), 'expanded')).toContain('resets Oct 1');
  });

  it('renders a loading skeleton while the first response is pending', () => {
    const html = render(null, 'compact', { loading: true });
    expect(html).toContain('data-testid="quota-skeleton"');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('Free');
  });

  it('keeps showing known quota data while a refresh is loading', () => {
    expect(render(warning, 'compact', { loading: true })).toContain('8,200 / 10,000 events (82%)');
  });

  it('renders a quiet error state with retry instead of invented numbers', () => {
    const html = renderToStaticMarkup(
      createElement(QuotaChipView, {
        quota: null,
        loading: false,
        error: 'quota_request_failed_503',
        onRetry: () => undefined,
        variant: 'compact',
        portalUrl: '/pricing',
      }),
    );
    expect(html).toContain('data-testid="quota-error"');
    expect(html).toContain('Quota unavailable');
    expect(html).toContain('Retry');
    expect(html).not.toContain('10,000');
  });
});

describe('BillingQuotaChip modes', () => {
  it('uses the live hook for a signed-in dashboard and starts in the loading state', () => {
    const html = renderToStaticMarkup(createElement(BillingQuotaChip, { liveQuota: true, isGuest: false }));
    expect(html).toContain('data-testid="quota-skeleton"');
    expect(html).not.toContain('Developer');
  });

  it('keeps the guest state unchanged even when live quota is requested', () => {
    const html = renderToStaticMarkup(
      createElement(BillingQuotaChip, { liveQuota: true, isGuest: true, usedTransactions: 0, maxTransactions: 10_000, planName: 'Developer' }),
    );
    expect(html).toContain('Developer');
    expect(html).toContain('0 / 10k txs');
    expect(html).toContain('Sign in to manage your plan or upgrade');
    expect(html).not.toContain('quota-skeleton');
  });

  it('keeps the legacy props working for callers that do not opt in to live quota', () => {
    const html = renderToStaticMarkup(
      createElement(BillingQuotaChip, { usedTransactions: 4_000, maxTransactions: 10_000, planName: 'Developer Plan' }),
    );
    expect(html).toContain('4,000 / 10k txs');
    expect(html).toContain('(40%)');
  });
});
