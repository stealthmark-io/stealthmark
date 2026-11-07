import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToastProvider } from '../components/ui/toast';
import { ConsoleOnboardingWizard } from '../app/dashboard/components/ConsoleOnboardingWizard';
import { AccessEventStream } from '../app/dashboard/components/gateway/AccessEventStream';
import { GatewayHeader } from '../app/dashboard/components/gateway/GatewayHeader';
import { ShieldsGrid } from '../app/dashboard/components/gateway/ShieldsGrid';
import { ACTIVE_SHIELDS } from '../app/dashboard/components/gateway/constants';
import { buildEventsCsv, escapeCsv, formatClusterStatus, sumThreats } from '../app/dashboard/components/gateway/format';
import { EMPTY_METRICS, mergeMonotonicMetrics } from '../hooks/useGatewayTelemetry';

const GATEWAY_DIR = path.resolve(__dirname, '../app/dashboard/components/gateway');

function render(node: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(node);
}

async function loadGatewayPanel(defconFlag: 'true' | 'false') {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_FEATURE_DEFCON', defconFlag);
  const { GatewayPanel } = await import('../app/dashboard/components/GatewayPanel');
  return GatewayPanel;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Telemetry tab does not present unavailable surfaces', () => {
  it('hides the DEFCON controls and the hosted proxy wording while the DEFCON flag is off', async () => {
    const GatewayPanel = await loadGatewayPanel('false');
    const html = render(
      createElement(ToastProvider, null, createElement(GatewayPanel, { metrics: EMPTY_METRICS, status: 'unknown', isLive: false, isLoading: false })),
    );

    expect(html).not.toMatch(/DEFCON|Interactive Posture Control|hosted proxy|point your agent framework/i);
    expect(html).toContain('What the SDK does');
    expect(html).toContain('Agent Telemetry');
  });

  it('shows the DEFCON controls only when the flag is on', async () => {
    const GatewayPanel = await loadGatewayPanel('true');
    const html = render(
      createElement(ToastProvider, null, createElement(GatewayPanel, { metrics: EMPTY_METRICS, status: 'unknown', isLive: false, isLoading: false })),
    );
    expect(html).toMatch(/DEFCON/);
  });

  it('shows UNKNOWN, not OPERATIONAL, when the gateway reports no status', () => {
    expect(formatClusterStatus('')).toBe('UNKNOWN');
    expect(formatClusterStatus(undefined)).toBe('UNKNOWN');
    expect(formatClusterStatus('operational')).toBe('OPERATIONAL');

    const html = render(
      createElement(GatewayHeader, { status: 'unknown', isLive: false }),
    );
    expect(html).toContain('Gateway: UNKNOWN');
    expect(html).not.toMatch(/OPERATIONAL|Live Telemetry|animate-pulse/);
  });

  it('describes the shields block as SDK behavior', () => {
    const html = render(createElement(ShieldsGrid, { shields: ACTIVE_SHIELDS }));
    expect(html).toContain('What the SDK does');
    expect(html).not.toMatch(/hosted proxy|protections enabled/i);
  });

  it('keeps an empty stream honest and offers no simulated ping', () => {
    const html = render(createElement(AccessEventStream, { events: [], loadFailed: false, isExporting: false, onExport: () => undefined }));
    expect(html).toContain('No agent events recorded yet');
    expect(html).not.toMatch(/test ping|simulat|this gateway|point your agent framework/i);
  });

  it('tells the user when events could not be loaded instead of showing an empty list silently', () => {
    const html = render(createElement(AccessEventStream, { events: [], loadFailed: true, isExporting: false, onExport: () => undefined }));
    expect(html).toContain('could not be loaded');
  });

  it('never fabricates events from counters', () => {
    const files = readdirSync(GATEWAY_DIR);
    expect(files).not.toContain('telemetryEvents.ts');
    expect(files).not.toContain('useTestPing.ts');
    for (const file of files) {
      const source = readFileSync(path.join(GATEWAY_DIR, file), 'utf8');
      expect(source, file).not.toMatch(/Adversarial Buffer Bot|Prompt Injection Infiltrator|Spoofed Identity Crawler|High-Frequency Scraping Bot/);
    }
  });
});

describe('policy blocks are counted from the usage ledger', () => {
  it('adds policy_blocked to the threat total and keeps it monotonic', () => {
    const metrics = { ...EMPTY_METRICS, threats_blocked: { ...EMPTY_METRICS.threats_blocked, policy_blocked: 4 } };
    expect(sumThreats(metrics)).toBe(4);
    const merged = mergeMonotonicMetrics(metrics, { threats_blocked: { ...EMPTY_METRICS.threats_blocked, policy_blocked: 1 } });
    expect(merged.threats_blocked.policy_blocked).toBe(4);
  });

  it('exports only recorded fields, without DEFCON posture or token economics', () => {
    const csv = buildEventsCsv({
      events: [{ id: 'e1', time: '2026-10-09T12:00:00.000Z', agent: 'GPTBot', provider: 'acme.io', targetPath: '/pricing', method: 'GET', status: 200, securityCheck: 'UA declared (unverified)' }],
      blockedByPolicy: 0,
      exportedAt: '2026-10-09T00:00:00.000Z',
    });
    expect(csv).toContain('GPTBot');
    expect(csv).not.toMatch(/DEFCON|Cluster|Latency|Token/i);
  });

  it('neutralizes spreadsheet formulas in attacker-controlled agent identifiers', () => {
    const payloads = ['=HYPERLINK("http://x","y")', '=IMPORTXML("http://x","//a")', '+SUM(1,1)', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd'];
    const formulaCellStart = /(?:^|,)"?[=+\-@\t\r]/;
    for (const agent of payloads) {
      const csv = buildEventsCsv({
        events: [{ id: 'e1', time: '2026-10-09T12:00:00.000Z', agent, provider: 'acme.io', targetPath: '/pricing', method: 'GET', status: 200, securityCheck: 'UA declared (unverified)' }],
        blockedByPolicy: 0,
        exportedAt: '2026-10-09T00:00:00.000Z',
      });
      const dataRows = csv.slice(csv.indexOf('Timestamp,'));
      const body = dataRows.slice(dataRows.indexOf('\n') + 1);
      const leadingCells = '2026-10-09T12:00:00.000Z,e1,';
      expect(body).toContain(leadingCells);
      expect(body.startsWith(leadingCells)).toBe(true);
      expect(body.slice(leadingCells.length).startsWith(`'`) || body.slice(leadingCells.length).startsWith(`"'`)).toBe(true);
      expect(body.slice(leadingCells.length)).not.toMatch(formulaCellStart);
    }
    expect(escapeCsv('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
    expect(escapeCsv('=IMPORTXML(1)')).toBe("'=IMPORTXML(1)");
    expect(escapeCsv('+1')).toBe("'+1");
    expect(escapeCsv('-1')).toBe("'-1");
    expect(escapeCsv('@x')).toBe("'@x");
    expect(escapeCsv('\tx')).toBe("'\tx");
    expect(escapeCsv('\rx')).toBe("\"'\rx\"");
  });

  it('keeps benign cells and numbers untouched', () => {
    expect(escapeCsv('GPTBot')).toBe('GPTBot');
    expect(escapeCsv('a,b')).toBe('"a,b"');
    expect(escapeCsv(-5)).toBe('-5');
    expect(escapeCsv(12)).toBe('12');
  });
});

describe('Onboarding step 4 waits for a real agent event', () => {
  const baseProps = {
    onboardedDomain: 'acme.io',
    onDomainSubmit: () => undefined,
    hasApiKeys: true,
    onGenerateKey: async () => ({ ok: false as const, reason: 'not_signed_in' }),
  };

  it('is not complete and offers no ping button when no event was recorded', () => {
    const html = render(createElement(ConsoleOnboardingWizard, { ...baseProps, userRealRequests: 0 }));
    expect(html).toContain('Wait for an Agent Event');
    expect(html).toContain('curl -H');
    expect(html).toContain('https://acme.io/');
    expect(html).not.toMatch(/Send Test Ping|Test ping received/);
  });

  it('completes once the ledger has an event', () => {
    const html = render(createElement(ConsoleOnboardingWizard, { ...baseProps, userRealRequests: 3 }));
    expect(html).toMatch(/Agent event recorded|Setup Complete/);
    expect(html).not.toMatch(/Test ping received/);
  });

  it('keeps the dashboard actions free of a local request counter and empty catches', () => {
    const views = path.resolve(__dirname, '../app/dashboard/views');
    const actions = readFileSync(path.join(views, 'useDashboardActions.ts'), 'utf8');
    const state = readFileSync(path.join(views, 'useDashboardState.ts'), 'utf8');
    for (const source of [actions, state]) {
      expect(source).not.toMatch(/stealthmark_real_requests|handlePingDispatched|handleSendTestPing/);
      expect(source).not.toMatch(/catch\s*(\(\w*\))?\s*\{\s*\}/);
      expect(source).not.toMatch(/\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
    }
  });
});
