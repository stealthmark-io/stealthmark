import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuestBanner } from '../app/dashboard/views/GuestBanner';
import { GatewayMetricCards } from '../app/dashboard/components/gateway/GatewayMetricCards';
import { ConsoleOnboardingWizard } from '../app/dashboard/components/ConsoleOnboardingWizard';
import { OnboardingWizard } from '../app/dashboard/components/OnboardingWizard';
import { SettingsPanel } from '../app/dashboard/components/SettingsPanel';
import {
  ACTIVE_SHIELDS,
  DEFCON_LEVELS,
} from '../app/dashboard/components/gateway/constants';
import {
  DEFAULT_API_KEYS,
  DEFAULT_CAPABILITIES,
  STEALTHMARK_CAPABILITIES,
} from '../app/dashboard/views/dashboard-data';
import { AGENT_MANIFEST_PAYLOAD } from '../lib/agent-manifest';
import { EMPTY_METRICS } from '../hooks/useGatewayTelemetry';

const LEGACY_CLAIMS =
  /dual-door|fail-open|\bkya\b|passport|pentest|perimeter|priority whitelist|\bvip\b|99\.999|ed25519|zero-trust|sovereign gateway|\bflask\b|\bdjango\b|@stealthmark\/sdk|\bcname\b|under 2 minutes|under 30 seconds/i;

const SRC = path.resolve(__dirname, '..');
const OWNED_SOURCES = [
  'app/dashboard/components/gateway/GatewayMetricCards.tsx',
  'app/dashboard/components/gateway/constants.ts',
  'app/dashboard/components/SettingsPanel.tsx',
  'app/dashboard/views/dashboard-data.ts',
  'app/dashboard/views/GuestBanner.tsx',
  'app/dashboard/components/ConsoleOnboardingWizard.tsx',
  'app/dashboard/components/OnboardingWizard.tsx',
  'app/api/waitlist/route.ts',
];

function readSource(relative: string): string {
  return readFileSync(path.join(SRC, relative), 'utf8').replaceAll('SM-VIP', 'SM-REF');
}

describe('Console copy matches the product truth', () => {
  it.each(OWNED_SOURCES)('%s carries no legacy claim', (relative) => {
    expect(readSource(relative)).not.toMatch(LEGACY_CLAIMS);
  });

  it('labels guest data as demo data', () => {
    const html = renderToStaticMarkup(createElement(GuestBanner, { onSignIn: () => undefined }));
    expect(html).toContain('Demo data');
    expect(html).toContain('Guest Mode');
    expect(html).not.toMatch(LEGACY_CLAIMS);
  });

  it('renders the metric cards without legacy badges or unmeasured numbers', () => {
    const html = renderToStaticMarkup(
      createElement(GatewayMetricCards, { metrics: EMPTY_METRICS, isLoading: false, totalThreats: 0 }),
    );
    expect(html).toContain('Agent Events');
    expect(html).toContain('Blocked by Policy');
    expect(html).toContain('Median Latency (p50)');
    expect(html).not.toMatch(LEGACY_CLAIMS);
    expect(html).not.toMatch(/tokens saved|usd saved|98\.5%|99\.4%|sub-15ms|250ms/i);
  });

  it('renders the console wizards and settings without legacy claims', () => {
    const consoleWizard = renderToStaticMarkup(
      createElement(ConsoleOnboardingWizard, {
        onboardedDomain: '',
        onDomainSubmit: () => undefined,
        hasApiKeys: false,
        onGenerateKey: async () => ({ ok: false as const, reason: 'not_signed_in' }),
        userRealRequests: 0,
      }),
    );
    expect(consoleWizard).toContain('Quickstart: Connect Your Site');
    expect(consoleWizard).not.toMatch(LEGACY_CLAIMS);

    const addSite = renderToStaticMarkup(createElement(OnboardingWizard, { onComplete: () => undefined }));
    expect(addSite).toContain('Add Your Site');
    expect(addSite).not.toMatch(LEGACY_CLAIMS);

    const settings = renderToStaticMarkup(
      createElement(SettingsPanel, {
        user: null,
        isAuthenticated: false,
        userPlanTier: 'developer',
        userRealRequests: 0,
        maxTransactions: 10_000,
        domain: 'example.com',
      }),
    );
    expect(settings).toContain('Free plan');
    expect(settings).not.toMatch(LEGACY_CLAIMS);
    expect(settings).not.toMatch(/defcon/i);
  });

  it('keeps the always-on shields to shipped capabilities', () => {
    const shields = JSON.stringify(ACTIVE_SHIELDS);
    expect(shields).not.toMatch(LEGACY_CLAIMS);
    expect(ACTIVE_SHIELDS.map((s) => s.name)).toEqual(
      expect.arrayContaining(['Agent Detection', 'Event Recording', 'Policy: Observe', 'Policy: Manifest', 'Policy: Block']),
    );
  });

  it('keeps flag-gated DEFCON tiers free of passport and VIP wording', () => {
    const tiers = DEFCON_LEVELS.map((tier) => tier.desc).join(' ');
    expect(tiers).not.toMatch(LEGACY_CLAIMS);
  });

  it('describes the console demo data honestly', () => {
    const demo = JSON.stringify({ keys: DEFAULT_API_KEYS, capabilities: DEFAULT_CAPABILITIES });
    expect(demo).not.toMatch(LEGACY_CLAIMS);
    for (const key of DEFAULT_API_KEYS) expect(key.name).toMatch(/sample/i);
  });

  it('limits the stealthmark.io capabilities to routes the agent manifest publishes', () => {
    const published = new Set(AGENT_MANIFEST_PAYLOAD.capabilities.map((c) => new URL(c.endpoint).pathname));
    for (const cap of STEALTHMARK_CAPABILITIES.filter((c) => c.enabled)) {
      expect(published.has(cap.path)).toBe(true);
    }
  });
});

describe('describeKeyFailure', () => {
  it('reports status, route error and database code without anything sensitive', async () => {
    const { describeKeyFailure } = await import('../app/dashboard/views/useDashboardActions')
    expect(describeKeyFailure(500, 'failed_to_create_key', '42501')).toBe('HTTP 500 · failed_to_create_key · db 42501')
    expect(describeKeyFailure(401, 'unauthorized', null)).toBe('HTTP 401 · unauthorized')
    expect(describeKeyFailure(503, undefined, undefined)).toBe('HTTP 503')
  })
})
