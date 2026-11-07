import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToastProvider } from '../components/ui/toast';
import { TouchableTooltip } from '../components/ui/tooltip';
import { toAuditEvent } from '../app/api/telemetry/_audit-event';
import { AGENT_MAX_ROWS, BLOCKED_EVENT_TYPE, UNKNOWN_AGENT } from '../app/api/usage/_constants';
import * as usageShared from '../app/api/usage/_shared';
import { parseHostFilter, type AgentSummary, type SiteSummary, type UsageEventItem } from '../app/api/usage/_shared';
import { AccessEventStream } from '../app/dashboard/components/gateway/AccessEventStream';
import { AgentsSummary } from '../app/dashboard/components/gateway/AgentsSummary';
import { COMPANY_TOKENS, companyForAgent, rowsFromEvents } from '../app/dashboard/components/gateway/agentSummary';
import { ACTIVE_SHIELDS, DOMAIN_EVENTS_LIMIT } from '../app/dashboard/components/gateway/constants';
import { DOMAIN_SELECT_ID, DomainSelector } from '../app/dashboard/components/gateway/DomainSelector';
import {
  AGENT_SUMMARY_LIMIT,
  buildAgentSummary,
  buildEventsView,
  buildScopedKpis,
  collectDomains,
  describeNoEvents,
  eventsStatusOf,
  filterEventsByDomain,
  normalizeDomain,
  readDomainParam,
  selectorOptions,
  withDomainParam,
  type DomainBreakdown,
  type ScopeInput,
} from '../app/dashboard/components/gateway/domains';
import { buildEventsCsv, domainFileSlug, formatLastSeen } from '../app/dashboard/components/gateway/format';
import { GatewayHeader } from '../app/dashboard/components/gateway/GatewayHeader';
import { GatewayMetricCards } from '../app/dashboard/components/gateway/GatewayMetricCards';
import { ShieldsGrid } from '../app/dashboard/components/gateway/ShieldsGrid';
import type { AgentTrafficEvent } from '../app/dashboard/components/gateway/types';
import { isBreakdownTruncated, selectBreakdown, type BreakdownState } from '../app/dashboard/components/gateway/useDomainBreakdown';
import { selectDomainEvents, type DomainEventsState } from '../app/dashboard/components/gateway/useDomainEvents';
import { EMPTY_METRICS } from '../hooks/useGatewayTelemetry';

const GATEWAY_DIR = path.resolve(__dirname, '../app/dashboard/components/gateway');

function render(node: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(node);
}

function event(overrides: Partial<AgentTrafficEvent> & Pick<AgentTrafficEvent, 'id'>): AgentTrafficEvent {
  return {
    time: '2026-10-09T12:00:00.000Z',
    timestamp: '2026-10-09T12:00:00.000Z',
    agent: 'GPTBot',
    provider: 'acme.io',
    targetPath: '/pricing',
    method: 'GET',
    status: 200,
    securityCheck: 'UA declared (unverified)',
    ...overrides,
  };
}

const EVENTS: AgentTrafficEvent[] = [
  event({ id: 'e1', agent: 'GPTBot', provider: 'acme.io', timestamp: '2026-10-09T12:05:00.000Z' }),
  event({ id: 'e2', agent: 'ClaudeBot', provider: 'www.acme.io', timestamp: '2026-10-09T12:04:00.000Z' }),
  event({ id: 'e3', agent: 'GPTBot', provider: 'acme.io', status: 403, timestamp: '2026-10-09T12:03:00.000Z' }),
  event({ id: 'e4', agent: 'PerplexityBot', provider: 'other.dev', timestamp: '2026-10-09T12:02:00.000Z' }),
  event({ id: 'e5', agent: 'GPTBot', provider: 'unknown host', timestamp: '2026-10-09T12:01:00.000Z' }),
];

function agent(overrides: Partial<AgentSummary> & Pick<AgentSummary, 'agent'>): AgentSummary {
  return { events: 1, units: 1, blocked: 0, last_seen: '2026-10-09T12:00:00.000Z', top_paths: [], ...overrides };
}

function site(host: string | null, events: number): SiteSummary {
  return { host, events, agents: 1, last_seen: '2026-10-09T12:00:00.000Z' };
}

function breakdown(overrides: Partial<DomainBreakdown> = {}): DomainBreakdown {
  return { host: 'acme.io', agents: [], sites: [], truncated: false, ...overrides };
}

function scope(overrides: Partial<ScopeInput> = {}): ScopeInput {
  return { domain: 'acme.io', breakdown: null, status: 'unavailable', events: EVENTS, eventsStatus: 'ready', signedIn: true, ...overrides };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('domain helpers', () => {
  it('normalizes hosts and pasted URLs to the form the SDK reports', () => {
    expect(normalizeDomain('Acme.IO')).toBe('acme.io');
    expect(normalizeDomain('https://www.Acme.io:8443/pricing?x=1#top')).toBe('www.acme.io');
    expect(normalizeDomain('acme.io.')).toBe('acme.io');
    expect(normalizeDomain('[2001:db8::7]')).toBe('[2001:db8::7]');
    expect(normalizeDomain('localhost')).toBe('localhost');
  });

  it('rejects anything that is not a host, including the placeholder for events without one', () => {
    for (const raw of [null, undefined, '', '   ', 'unknown host', 'a b.com', 'ac"me.io', '<script>', 'a'.repeat(254)]) {
      expect(normalizeDomain(raw), String(raw)).toBeNull();
    }
  });

  it('accepts and rejects the same hosts as the usage route filter', () => {
    for (const host of ['acme.io', 'www.acme.io', 'my-site_1.example.org', '203.0.113.7', '[2001:db8::7]', 'localhost']) {
      expect(parseHostFilter(host)).toEqual({ valid: true, host });
      expect(normalizeDomain(host)).toBe(host);
    }
    for (const host of ['unknown host', 'a b.com', 'ac"me.io', '<script>']) {
      expect(parseHostFilter(host)).toEqual({ valid: false });
      expect(normalizeDomain(host)).toBeNull();
    }
  });

  it('lists registered domains, hosts seen in events and hosts of the ledger once each, alphabetically', () => {
    const domains = collectDomains({
      registered: ['Acme.io', 'registered-only.com'],
      events: EVENTS,
      siteHosts: ['other.dev', 'ledger-only.net', null],
    });
    expect(domains).toEqual(['acme.io', 'ledger-only.net', 'other.dev', 'registered-only.com', 'www.acme.io']);
  });

  it('keeps www and the bare domain apart because the ledger stores the request host as it came', () => {
    expect(collectDomains({ events: EVENTS })).toEqual(expect.arrayContaining(['acme.io', 'www.acme.io']));
  });

  it('returns no domains when nothing reported one', () => {
    expect(collectDomains({})).toEqual([]);
    expect(collectDomains({ events: [event({ id: 'x', provider: 'unknown host' })], siteHosts: [null] })).toEqual([]);
  });

  it('keeps the selected domain in the selector even when nothing reported it yet', () => {
    expect(selectorOptions(['acme.io'], 'acme.io')).toEqual(['acme.io']);
    expect(selectorOptions(['b.io'], 'a.io')).toEqual(['a.io', 'b.io']);
    expect(selectorOptions(['acme.io'], null)).toEqual(['acme.io']);
  });
});

describe('domain filtering of events', () => {
  it('returns every event for all domains and a copy, not the input array', () => {
    const all = filterEventsByDomain(EVENTS, null);
    expect(all).toEqual(EVENTS);
    expect(all).not.toBe(EVENTS);
  });

  it('keeps only the events of that exact host', () => {
    expect(filterEventsByDomain(EVENTS, 'acme.io').map((e) => e.id)).toEqual(['e1', 'e3']);
    expect(filterEventsByDomain(EVENTS, 'www.acme.io').map((e) => e.id)).toEqual(['e2']);
    expect(filterEventsByDomain(EVENTS, 'other.dev').map((e) => e.id)).toEqual(['e4']);
  });

  it('returns nothing for a domain without events and never matches the unknown host placeholder', () => {
    expect(filterEventsByDomain(EVENTS, 'nobody.example')).toEqual([]);
    expect(filterEventsByDomain(EVENTS, 'unknown')).toEqual([]);
  });
});

describe('domain in the URL', () => {
  it('sets the param, keeps the other params and removes it again', () => {
    expect(withDomainParam('', 'acme.io')).toBe('?domain=acme.io');
    expect(withDomainParam('?tab=agents', 'acme.io')).toBe('?tab=agents&domain=acme.io');
    expect(withDomainParam('?domain=old.io&tab=agents', 'acme.io')).toBe('?domain=acme.io&tab=agents');
    expect(withDomainParam('?domain=acme.io', null)).toBe('');
    expect(withDomainParam('?domain=acme.io&tab=agents', null)).toBe('?tab=agents');
  });

  it('reads back what it wrote and ignores a param that is not a host', () => {
    expect(readDomainParam(withDomainParam('', '[2001:db8::7]'))).toBe('[2001:db8::7]');
    expect(readDomainParam('?domain=acme.io')).toBe('acme.io');
    expect(readDomainParam('')).toBeNull();
    expect(readDomainParam('?domain=')).toBeNull();
    expect(readDomainParam('?domain=%3Cscript%3E')).toBeNull();
  });
});

describe('KPIs of the selected domain', () => {
  it('leaves the organization totals alone for all domains', () => {
    expect(buildScopedKpis(scope({ domain: null }))).toBeNull();
  });

  it('counts the month from the ledger breakdown of that domain and says so', () => {
    const kpis = buildScopedKpis(
      scope({
        status: 'ready',
        breakdown: breakdown({ agents: [agent({ agent: 'GPTBot', events: 1200, blocked: 4 }), agent({ agent: 'ClaudeBot', events: 34, blocked: 1 })] }),
      }),
    );
    expect(kpis?.events).toEqual({ value: '1,234', footnote: 'This domain, this month' });
    expect(kpis?.blocked).toEqual({ value: '5', footnote: 'This domain, this month' });
  });

  it('marks a month count as a lower bound when the ledger scan was cut off', () => {
    const kpis = buildScopedKpis(
      scope({ status: 'ready', breakdown: breakdown({ truncated: true, agents: [agent({ agent: 'GPTBot', events: 5000 })] }) }),
    );
    expect(kpis?.events).toEqual({ value: '5,000+', footnote: 'This domain, this month, at least' });
  });

  it('does not append a plus to a zero, which would read like an error', () => {
    const kpis = buildScopedKpis(
      scope({ status: 'ready', breakdown: breakdown({ truncated: true, agents: [agent({ agent: 'GPTBot', events: 37, blocked: 0 })] }) }),
    );
    expect(kpis?.events.value).toBe('37+');
    expect(kpis?.blocked.value).toBe('0');
  });

  it('shows zero, not a loading state, for a domain the ledger has no events for', () => {
    const kpis = buildScopedKpis(scope({ domain: 'nobody.example', status: 'ready', breakdown: breakdown({ host: 'nobody.example' }) }));
    expect(kpis?.events.value).toBe('0');
    expect(kpis?.blocked.value).toBe('0');
  });

  it('does not measure latency per domain', () => {
    const kpis = buildScopedKpis(scope({ status: 'ready', breakdown: breakdown() }));
    expect(kpis?.latency).toEqual({ value: '—', footnote: 'Not measured per domain' });
  });

  it('shows a loading value while the breakdown loads, and ignores the breakdown of another domain', () => {
    expect(buildScopedKpis(scope({ status: 'loading' }))?.events.value).toBe('...');
    const stale = buildScopedKpis(
      scope({ status: 'ready', breakdown: breakdown({ host: 'other.dev', agents: [agent({ agent: 'GPTBot', events: 99 })] }) }),
    );
    expect(stale?.events.value).not.toBe('99');
  });

  it('falls back to the loaded events without implying a month count', () => {
    const kpis = buildScopedKpis(scope({ status: 'unavailable' }));
    expect(kpis?.events).toEqual({ value: '2', footnote: 'In the latest 5 events' });
    expect(kpis?.blocked).toEqual({ value: '1', footnote: 'In the latest 5 events' });
  });

  it('does not show zero activity when nothing could be loaded', () => {
    const guest = buildScopedKpis(scope({ signedIn: false, events: [], eventsStatus: 'ready' }));
    expect(guest?.events).toEqual({ value: '—', footnote: 'Sign in to see this domain' });
    expect(guest?.blocked.value).toBe('—');

    const failed = buildScopedKpis(scope({ events: [], eventsStatus: 'failed' }));
    expect(failed?.events).toEqual({ value: '—', footnote: 'Could not load this domain' });

    const loading = buildScopedKpis(scope({ events: [], eventsStatus: 'loading' }));
    expect(loading?.events).toEqual({ value: '...', footnote: 'Loading this domain' });
  });

  it('shows a real zero once the events answered and held nothing of the domain', () => {
    const kpis = buildScopedKpis(scope({ events: [], eventsStatus: 'ready' }));
    expect(kpis?.events).toEqual({ value: '0', footnote: 'In the latest 0 events' });
  });
});

describe('lower bound of a host filter', () => {
  it('keeps an exact count exact when only the unfiltered scan of the organization was cut off', () => {
    expect(isBreakdownTruncated({ truncated: true, sampled_rows: 12 }, 'acme.io')).toBe(false);
    expect(isBreakdownTruncated({ truncated: true, sampled_rows: AGENT_MAX_ROWS }, 'acme.io')).toBe(true);
    expect(isBreakdownTruncated({ truncated: false, sampled_rows: AGENT_MAX_ROWS }, 'acme.io')).toBe(false);
  });

  it('trusts the route for all domains, and stays cautious when the row count is missing', () => {
    expect(isBreakdownTruncated({ truncated: true, sampled_rows: 12 }, null)).toBe(true);
    expect(isBreakdownTruncated({ truncated: false, sampled_rows: 12 }, null)).toBe(false);
    expect(isBreakdownTruncated({ truncated: true, sampled_rows: undefined as unknown as number }, 'acme.io')).toBe(true);
  });

  it('uses the scan cap the agents route applies', () => {
    expect(AGENT_MAX_ROWS).toBe(usageShared.AGENT_MAX_ROWS);
    expect(BLOCKED_EVENT_TYPE).toBe(usageShared.BLOCKED_EVENT_TYPE);
    expect(UNKNOWN_AGENT).toBe(usageShared.UNKNOWN_AGENT);
  });
});

describe('per-agent summary', () => {
  it('lists the month agents of the domain with company, visits and last seen', () => {
    const summary = buildAgentSummary(
      scope({
        status: 'ready',
        breakdown: breakdown({
          agents: [
            agent({ agent: 'GPTBot', events: 40, last_seen: '2026-10-09T09:30:00.000Z' }),
            agent({ agent: 'my-internal-agent', events: 2, last_seen: null }),
          ],
        }),
      }),
    );
    expect(summary?.basis).toBe('month');
    expect(summary?.rows).toEqual([
      { agent: 'GPTBot', company: 'OpenAI', visits: 40, lastSeen: '2026-10-09T09:30:00.000Z' },
      { agent: 'my-internal-agent', company: null, visits: 2, lastSeen: null },
    ]);
  });

  it('keeps it compact and reports how many agents were left out', () => {
    const many = Array.from({ length: AGENT_SUMMARY_LIMIT + 3 }, (_, i) => agent({ agent: `agent-${i}`, events: 100 - i }));
    const summary = buildAgentSummary(scope({ status: 'ready', breakdown: breakdown({ agents: many }) }));
    expect(summary?.rows).toHaveLength(AGENT_SUMMARY_LIMIT);
    expect(summary?.totalAgents).toBe(AGENT_SUMMARY_LIMIT + 3);
  });

  it('has nothing to show yet while the breakdown or the events load', () => {
    expect(buildAgentSummary(scope({ status: 'loading' }))).toBeNull();
    expect(buildAgentSummary(scope({ events: [], eventsStatus: 'loading' }))).toBeNull();
  });

  it('says nothing could be loaded instead of listing no agents for guests and failed loads', () => {
    expect(buildAgentSummary(scope({ signedIn: false, events: [] }))).toMatchObject({ basis: 'unavailable', unavailableReason: 'signed-out', rows: [] });
    expect(buildAgentSummary(scope({ events: [], eventsStatus: 'failed' }))).toMatchObject({ basis: 'unavailable', unavailableReason: 'load-failed', rows: [] });
    expect(buildAgentSummary(scope({ domain: null, signedIn: false, events: [] }))?.basis).toBe('unavailable');
  });

  it('counts the agents of the domain from the loaded events when the breakdown is unavailable', () => {
    const summary = buildAgentSummary(scope({ status: 'unavailable' }));
    expect(summary?.basis).toBe('recent');
    expect(summary?.sampleSize).toBe(EVENTS.length);
    expect(summary?.rows).toEqual([{ agent: 'GPTBot', company: 'OpenAI', visits: 2, lastSeen: '2026-10-09T12:05:00.000Z' }]);
  });

  it('groups loaded events by agent, most visits first, with the newest timestamp as last seen', () => {
    const rows = rowsFromEvents(EVENTS);
    expect(rows.map((row) => [row.agent, row.visits])).toEqual([
      ['GPTBot', 3],
      ['ClaudeBot', 1],
      ['PerplexityBot', 1],
    ]);
    expect(rows[0]?.lastSeen).toBe('2026-10-09T12:05:00.000Z');
  });

  it('falls back to the clock time for events without a timestamp', () => {
    const rows = rowsFromEvents([event({ id: 'x', timestamp: undefined, time: '08:15:00 UTC' })]);
    expect(rows[0]?.lastSeen).toBe('08:15:00 UTC');
    expect(formatLastSeen('08:15:00 UTC')).toBe('08:15:00 UTC');
    expect(formatLastSeen('2026-10-09T08:15:42.000Z')).toBe('2026-10-09 08:15 UTC');
    expect(formatLastSeen(null)).toBe('-');
  });

  it('names the vendor only for known crawler tokens', () => {
    expect(companyForAgent('GPTBot')).toBe('OpenAI');
    expect(companyForAgent('Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)')).toBe('Anthropic');
    expect(companyForAgent('PerplexityBot')).toBe('Perplexity');
    expect(companyForAgent('MCP-Client')).toBeNull();
    expect(companyForAgent('unknown')).toBeNull();
    expect(companyForAgent('Mozilla/5.0 Safari')).toBeNull();
  });

  it('only maps tokens that the SDK detects as vendor crawlers', () => {
    const detector = readFileSync(path.resolve(__dirname, '../../../../packages/core/src/detect-agent.ts'), 'utf8').toLowerCase();
    for (const token of COMPANY_TOKENS) expect(detector, token).toContain(`'${token}'`);
  });
});

describe('breakdown state selection', () => {
  const settled: BreakdownState = {
    host: 'acme.io',
    breakdown: breakdown({ agents: [agent({ agent: 'GPTBot' })] }),
    sites: [site('acme.io', 1), site('other.dev', 2)],
    settled: true,
  };

  it('returns the breakdown of the host it was loaded for', () => {
    const result = selectBreakdown(settled, true, 'acme.io');
    expect(result.status).toBe('ready');
    expect(result.breakdown?.host).toBe('acme.io');
  });

  it('reports loading for another host but keeps the domain list so the selector does not collapse', () => {
    const result = selectBreakdown(settled, true, 'other.dev');
    expect(result.status).toBe('loading');
    expect(result.breakdown).toBeNull();
    expect(result.sites.map((s) => s.host)).toEqual(['acme.io', 'other.dev']);
  });

  it('reports unavailable when the load settled without data, and when disabled', () => {
    expect(selectBreakdown({ ...settled, breakdown: null }, true, 'acme.io').status).toBe('unavailable');
    expect(selectBreakdown(settled, false, 'acme.io')).toEqual({ breakdown: null, sites: [], status: 'unavailable' });
  });

  it('is loading before the first response', () => {
    expect(selectBreakdown({ host: null, breakdown: null, sites: [], settled: false }, true, null).status).toBe('loading');
  });
});

describe('events of the table and the CSV', () => {
  const latest = { events: EVENTS, loaded: true, failed: false };
  const hostEvents = [event({ id: 'h1', provider: 'other.dev' }), event({ id: 'h2', provider: 'other.dev' })];

  it('lists the latest events of every domain when none is selected', () => {
    const view = buildEventsView({ domain: null, signedIn: true, latest, hostFeed: null });
    expect(view).toMatchObject({ source: 'all', loading: false, loadFailed: false, loadedCount: EVENTS.length });
    expect(view.events).toHaveLength(EVENTS.length);
  });

  it('reads the host feed of a selected domain, so a domain missing from the latest events still has its rows', () => {
    const view = buildEventsView({ domain: 'other.dev', signedIn: true, latest: { ...latest, events: [] }, hostFeed: { events: hostEvents, loading: false, failed: false } });
    expect(view.source).toBe('host');
    expect(view.events.map((e) => e.id)).toEqual(['h1', 'h2']);
  });

  it('is loading, not empty, until the host feed answers', () => {
    const view = buildEventsView({ domain: 'other.dev', signedIn: true, latest, hostFeed: { events: null, loading: true, failed: false } });
    expect(view).toMatchObject({ source: 'host', loading: true, events: [] });
  });

  it('narrows the latest events when there is no host feed (platform view)', () => {
    const view = buildEventsView({ domain: 'acme.io', signedIn: true, latest, hostFeed: null });
    expect(view).toMatchObject({ source: 'latest', loadedCount: EVENTS.length });
    expect(view.events.map((e) => e.id)).toEqual(['e1', 'e3']);
  });

  it('does not treat the first load as an empty list, and does not list anything for guests', () => {
    expect(buildEventsView({ domain: null, signedIn: true, latest: { events: [], loaded: false, failed: false }, hostFeed: null }).loading).toBe(true);
    const guest = buildEventsView({ domain: 'acme.io', signedIn: false, latest, hostFeed: null });
    expect(guest).toMatchObject({ signedIn: false, loading: false, events: [] });
  });

  it('classifies the latest-events feed: loading until it answers, failed only when nothing was loaded', () => {
    expect(eventsStatusOf(false, false, 0)).toBe('loading');
    expect(eventsStatusOf(true, true, 0)).toBe('failed');
    expect(eventsStatusOf(true, true, 5)).toBe('ready');
    expect(eventsStatusOf(true, false, 0)).toBe('ready');
  });

  it('explains why there is nothing to export without claiming an absence it could not observe', () => {
    const base = { events: [], loading: false, loadFailed: false, signedIn: true, source: 'all' as const, loadedCount: 0 };
    expect(describeNoEvents({ ...base, signedIn: false }, null)).toBe('Sign in to see agent events.');
    expect(describeNoEvents({ ...base, loading: true }, null)).toBe('The events are still loading.');
    expect(describeNoEvents({ ...base, loadFailed: true }, 'acme.io')).toBe('The events could not be loaded.');
    expect(describeNoEvents(base, null)).toBe('No agent events have been recorded yet.');
    expect(describeNoEvents({ ...base, source: 'host' }, 'acme.io')).toBe('No agent events have been recorded for acme.io.');
    expect(describeNoEvents({ ...base, source: 'latest', loadedCount: 50 }, 'acme.io')).toBe('No agent events for acme.io in the latest 50 events.');
  });
});

describe('host feed state selection', () => {
  const settled: DomainEventsState = { host: 'acme.io', events: [event({ id: 'h1' })], failed: false, settled: true };

  it('loads nothing without a host', () => {
    expect(selectDomainEvents(settled, null)).toEqual({ events: null, loading: false, failed: false });
  });

  it('returns the events of the host they were loaded for', () => {
    expect(selectDomainEvents(settled, 'acme.io')).toEqual({ events: settled.events, loading: false, failed: false });
  });

  it('counts the events of another host, and the time before the first answer, as loading', () => {
    expect(selectDomainEvents(settled, 'other.dev')).toEqual({ events: null, loading: true, failed: false });
    expect(selectDomainEvents({ ...settled, settled: false }, 'acme.io').loading).toBe(true);
  });

  it('reports a failure and keeps the previous events of the same host', () => {
    expect(selectDomainEvents({ ...settled, failed: true }, 'acme.io')).toEqual({ events: settled.events, loading: false, failed: true });
    expect(selectDomainEvents({ host: 'acme.io', events: null, failed: true, settled: true }, 'acme.io')).toEqual({ events: null, loading: false, failed: true });
  });
});

describe('usage events become the rows of the table', () => {
  const item: UsageEventItem = {
    id: 'u1',
    created_at: '2026-10-09T12:34:56.000Z',
    event_type: 'agent_request',
    units: 1,
    agent_identifier: 'GPTBot',
    source: 'sdk',
    site_id: null,
    metadata: { path: '/pricing', method: 'POST', host: 'acme.io', status: null, reason: null, served_at: null },
  };

  it('maps a request and a blocked request the way the telemetry route lists them', () => {
    expect(toAuditEvent(item)).toEqual({
      id: 'u1',
      time: '2026-10-09T12:34:56.000Z',
      timestamp: '2026-10-09T12:34:56.000Z',
      agent: 'GPTBot',
      provider: 'acme.io',
      targetPath: '/pricing',
      method: 'POST',
      status: null,
      decision: 'allowed',
      identity: 'ua_declared',
      securityCheck: 'UA declared (unverified)',
    });
    expect(toAuditEvent({ ...item, event_type: BLOCKED_EVENT_TYPE })).toMatchObject({
      status: null,
      decision: 'blocked',
      identity: 'ua_declared',
      securityCheck: 'Blocked by policy',
    });
  });

  it('reports the upstream status the row recorded and never invents 200 or 403', () => {
    const withStatus = (status: number | null, eventType = 'agent_request') =>
      toAuditEvent({ ...item, event_type: eventType, metadata: { ...item.metadata, status } });

    expect(withStatus(502)).toMatchObject({ status: 502, decision: 'allowed' });
    expect(withStatus(403, BLOCKED_EVENT_TYPE)).toMatchObject({ status: 403, decision: 'blocked' });
    expect(withStatus(null).status).toBeNull();
    expect(withStatus(null, BLOCKED_EVENT_TYPE).status).toBeNull();
  });

  it('writes the time as full ISO 8601 in UTC', () => {
    expect(toAuditEvent({ ...item, created_at: '2026-10-09T12:34:56.123456+00:00' }).time).toBe('2026-10-09T12:34:56.123Z');
    expect(toAuditEvent({ ...item, created_at: '2026-10-09T09:34:56-03:00' }).time).toBe('2026-10-09T12:34:56.000Z');
  });

  it('exports no 200 for a row without metadata.status and the recorded status for one with it', () => {
    const exportRow = (status: number | null) => {
      const csv = buildEventsCsv({ events: [toAuditEvent({ ...item, metadata: { ...item.metadata, status } })], blockedByPolicy: 0, exportedAt: '2026-10-09T00:00:00.000Z' });
      return csv.split('\n').filter((line) => !line.startsWith('#'))[1].split(',');
    };

    const withoutStatus = exportRow(null);
    expect(withoutStatus[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(withoutStatus.slice(6, 9)).toEqual(['allowed', '—', 'UA declared (unverified)']);
    expect(withoutStatus.join(',')).not.toMatch(/\b200\b/);
    expect(exportRow(502).slice(6, 8)).toEqual(['allowed', '502']);
  });

  it('fills what the SDK did not report', () => {
    const bare = toAuditEvent({ ...item, agent_identifier: null, metadata: { path: null, method: null, host: null, status: null, reason: null, served_at: null } });
    expect(bare).toMatchObject({ agent: UNKNOWN_AGENT, provider: 'unknown host', targetPath: '/', method: 'GET' });
  });

  it('labels a Canary hit with how long after the fixture was served its URL was requested', () => {
    const canary = (servedAt: string | null, createdAt = '2026-10-09T12:34:56.000Z') =>
      toAuditEvent({
        ...item,
        created_at: createdAt,
        event_type: BLOCKED_EVENT_TYPE,
        agent_identifier: null,
        metadata: { path: '/.env', method: 'GET', host: 'acme.io', status: 401, reason: 'canary_triggered', served_at: servedAt },
      });

    expect(canary('2026-10-09T12:34:14.000Z')).toMatchObject({ decision: 'blocked', status: 401, securityCheck: 'Canary URL contactada (+42s)' });
    expect(canary('2026-10-09T12:27:56.000Z').securityCheck).toBe('Canary URL contactada (+7m)');
    expect(canary('2026-10-09T09:04:56.000Z').securityCheck).toBe('Canary URL contactada (+3h 30m)');
    expect(canary('2026-10-07T07:34:56.000Z').securityCheck).toBe('Canary URL contactada (+2d 5h)');
    expect(canary('2026-10-09T12:36:56.000Z').securityCheck).toBe('Canary URL contactada (+0s)');
    expect(canary(null).securityCheck).toBe('Canary URL contactada');
    expect(canary('not a date').securityCheck).toBe('Canary URL contactada');

    const csv = buildEventsCsv({ events: [canary('2026-10-09T12:34:14.000Z')], blockedByPolicy: 1, exportedAt: '2026-10-09T00:00:00.000Z' });
    const row = csv.split('\n').filter((line) => !line.startsWith('#'))[1].split(',');
    expect(row.slice(6, 9)).toEqual(['blocked', '401', 'Canary URL contactada (+42s)']);
  });

  it('keeps the policy label for a blocked event without a Canary reason', () => {
    const blocked = toAuditEvent({ ...item, event_type: BLOCKED_EVENT_TYPE, metadata: { ...item.metadata, reason: 'other', served_at: '2026-10-09T12:00:00.000Z' } });
    expect(blocked.securityCheck).toBe('Blocked by policy');
  });
});

describe('CSV export respects the selected domain', () => {
  const exportedAt = '2026-10-09T00:00:00.000Z';

  it('states the domain and counts blocked events of the file, not the organization month', () => {
    const csv = buildEventsCsv({ events: filterEventsByDomain(EVENTS, 'acme.io'), blockedByPolicy: 77, exportedAt, domain: 'acme.io' });
    expect(csv).toContain('# Domain: acme.io');
    expect(csv).toContain('# Events in this file: 2');
    expect(csv).toContain('# Blocked by policy in these events: 1');
    expect(csv).not.toContain('77');
    expect(csv).not.toContain('other.dev');
  });

  it('keeps the organization month count for all domains', () => {
    const csv = buildEventsCsv({ events: EVENTS, blockedByPolicy: 77, exportedAt });
    expect(csv).toContain('# Domain: all domains');
    expect(csv).toContain('# Blocked by policy this month: 77');
  });

  it('lists Decision and Upstream_Status columns and a full ISO timestamp for each event', () => {
    const csv = buildEventsCsv({ events: [event({ id: 'e1', status: 502, decision: 'allowed' })], blockedByPolicy: 0, exportedAt });
    const [header, row] = csv.split('\n').filter((line) => !line.startsWith('#'));

    expect(header).toBe('Timestamp,Event_ID,Agent,Host,HTTP_Method,Route,Decision,Upstream_Status,Policy');
    expect(row).toBe('2026-10-09T12:00:00.000Z,e1,GPTBot,acme.io,GET,/pricing,allowed,502,UA declared (unverified)');
  });

  it('exports the decision, not the status, as blocked or allowed', () => {
    const csv = buildEventsCsv({
      events: [event({ id: 'e1', status: 502, decision: 'allowed' }), event({ id: 'e2', status: null, decision: 'blocked' }), event({ id: 'e3', status: 403 })],
      blockedByPolicy: 0,
      exportedAt,
      domain: 'acme.io',
    });
    const rows = csv.split('\n').filter((line) => !line.startsWith('#')).slice(1);

    expect(rows.map((row) => row.split(',').slice(6, 8))).toEqual([['allowed', '502'], ['blocked', '—'], ['blocked', '403']]);
    expect(csv).toContain('# Blocked by policy in these events: 2');
  });

  it('keeps the file name free of characters that break it', () => {
    expect(domainFileSlug('acme.io')).toBe('acme.io');
    expect(domainFileSlug('[2001:db8::7]')).toBe('2001-db8-7');
  });
});

describe('SDK behaviors are collapsed by default', () => {
  it('renders one short row with the behavior names and the details hidden', () => {
    const html = render(createElement(ShieldsGrid, { shields: ACTIVE_SHIELDS }));
    const panelId = html.match(/aria-controls="([^"]+)"/)?.[1];

    expect(html).toContain('What the SDK does');
    expect(html).toContain('3 active · 1 default · 2 available');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-expanded="false"/);
    expect(panelId).toBeTruthy();
    expect(html).toMatch(new RegExp(`id="${panelId?.replace(/[:]/g, '\\:')}"[^>]*hidden`));
    expect(html).toContain('Show details');
    for (const shield of ACTIVE_SHIELDS) expect(html).toContain(shield.name);
  });

  it('opens the details when asked to, and then drops the chips', () => {
    const html = render(createElement(ShieldsGrid, { shields: ACTIVE_SHIELDS, defaultExpanded: true }));
    expect(html).toMatch(/aria-expanded="true"/);
    expect(html).toContain('Hide details');
    expect(html).not.toMatch(/aria-label="SDK behaviors"/);
    expect(html).not.toMatch(/<div id="[^"]+" hidden/);
    for (const shield of ACTIVE_SHIELDS) expect(html).toContain(shield.desc);
  });

  it('is rendered collapsed by the Telemetry tab', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_FEATURE_DEFCON', 'false');
    const { GatewayPanel } = await import('../app/dashboard/components/GatewayPanel');
    const html = render(
      createElement(ToastProvider, null, createElement(GatewayPanel, { metrics: EMPTY_METRICS, status: 'unknown', isLive: false, isLoading: false })),
    );
    expect(html).toContain('What the SDK does');
    expect(html).toMatch(/aria-expanded="false"/);
    expect(html).toContain(`id="${DOMAIN_SELECT_ID}"`);
    expect(html).toContain('Agents on all domains');
  });
});

describe('SDK behavior chips', () => {
  it('say in words whether each behavior is on or only available, not by dot colour alone', () => {
    const html = render(createElement(ShieldsGrid, { shields: ACTIVE_SHIELDS }));
    const chips = html.match(/<ul class="flex[^>]*aria-label="SDK behaviors">.*?<\/ul>/)?.[0] ?? '';
    expect(chips).toContain('Agent Detection<span class="text-slate-400">· active</span>');
    expect(chips).toContain('Policy: Observe<span class="text-slate-400">· default</span>');
    expect(chips).toContain('Policy: Block<span class="text-slate-400">· available</span>');
    expect(chips).toContain('Policy: Manifest<span class="text-slate-400">· available</span>');
  });

  it('does not count the options that are off as things the SDK does', () => {
    const html = render(createElement(ShieldsGrid, { shields: ACTIVE_SHIELDS }));
    expect(html).not.toMatch(/\d+ behaviors/);
  });

  it('keeps the keyboard focus ring of the toggle visible against the card', () => {
    const html = render(createElement(ShieldsGrid, { shields: ACTIVE_SHIELDS }));
    expect(html).toContain('focus-visible:ring-cyan-400');
    expect(html).not.toContain('ring-cyan-500/40');
  });

  it('does not say that agents asking for the manifest are blocked or left alone', () => {
    const block = ACTIVE_SHIELDS.find((shield) => shield.id === 'policy-block');
    const observe = ACTIVE_SHIELDS.find((shield) => shield.id === 'policy-observe');
    expect(block?.desc).toMatch(/except requests that ask for application\/agent\+json/);
    expect(observe?.desc).toMatch(/asks for the agent manifest/);
  });

  it('matches the order the SDK decides in: the manifest request wins before the block policy', () => {
    const source = readFileSync(path.resolve(__dirname, '../../../../packages/next/src/middleware.ts'), 'utf8');
    const decide = source.slice(source.indexOf('function decideAgentHandling'));
    expect(decide.indexOf("application/agent+json")).toBeGreaterThan(-1);
    expect(decide.indexOf("application/agent+json")).toBeLessThan(decide.indexOf("agentPolicy === 'block'"));
  });
});

describe('Telemetry components for the selected domain', () => {
  it('explains the tab in plain words without overclaiming', () => {
    const html = render(createElement(GatewayHeader, { status: 'unknown', isLive: false }));
    expect(html).toContain('See which AI agents');
    expect(html).toContain('GPTBot, ClaudeBot, PerplexityBot');
    expect(html).toContain('human visitors are never counted');
    expect(html).toContain('Agents that disguise themselves');
    expect(html).toContain('as browsers are not detected');
  });

  it('explains the gateway chip in a keyboard-reachable trigger instead of a native title', () => {
    const html = render(createElement(GatewayHeader, { status: 'unknown', isLive: false }));
    expect(html).toMatch(/role="button"[^>]*tabindex="0"|tabindex="0"[^>]*role="button"/);
    expect(html).toContain('Gateway: UNKNOWN');
    expect(html).not.toContain('title="Status reported');
  });

  it('renders a labelled domain selector with all domains first and the selected one chosen', () => {
    const html = render(createElement(DomainSelector, { domains: ['acme.io', 'other.dev'], selected: 'other.dev', onSelect: () => undefined }));
    expect(html).toContain(`for="${DOMAIN_SELECT_ID}"`);
    expect(html).toContain('>All domains</option>');
    expect(html.indexOf('All domains')).toBeLessThan(html.indexOf('acme.io'));
    expect(html).toMatch(/<option value="other\.dev" selected="">/);
  });

  it('does not promise a month basis it cannot know, and says so for platform admins', () => {
    const html = render(createElement(DomainSelector, { domains: ['acme.io'], selected: null, onSelect: () => undefined }));
    expect(html).not.toContain('current month');
    expect(html).toContain('Each section says which period its numbers cover.');
    expect(html).not.toContain('Platform view');

    const platform = render(createElement(DomainSelector, { domains: ['acme.io'], selected: null, onSelect: () => undefined, platform: true }));
    expect(platform).toContain('Platform view: domains and events of every organization');
  });

  it('tells where domains come from when there are none yet', () => {
    const html = render(createElement(DomainSelector, { domains: [], selected: null, onSelect: () => undefined }));
    expect(html).toContain('No domains yet');
    expect(html).toContain('Add Domain tab');
  });

  it('shows the domain figures and labels them instead of the organization totals', () => {
    const kpis = buildScopedKpis(scope({ status: 'ready', breakdown: breakdown({ agents: [agent({ agent: 'GPTBot', events: 12 })] }) }));
    const html = render(createElement(GatewayMetricCards, { metrics: { ...EMPTY_METRICS, total_requests: 90 }, isLoading: false, totalThreats: 0, scope: kpis }));
    expect(html).toContain('>12<');
    expect(html).not.toContain('>90<');
    expect(html).toContain('This domain, this month');
    expect(html).toContain('Not measured per domain');
    expect(html).not.toContain('Humans are never counted');
  });

  it('states the period of the all-domains figures, and only the scope for platform admins', () => {
    const org = render(createElement(GatewayMetricCards, { metrics: EMPTY_METRICS, isLoading: false, totalThreats: 0 }));
    expect(org.match(/All domains, this month/g)).toHaveLength(2);
    expect(org).not.toContain('All organizations');

    const platform = render(createElement(GatewayMetricCards, { metrics: EMPTY_METRICS, isLoading: false, totalThreats: 0, platform: true }));
    expect(platform.match(/All organizations/g)).toHaveLength(2);
    expect(platform).not.toContain('this month');
  });

  it('makes each KPI reachable and explainable from the keyboard', () => {
    const html = render(createElement(GatewayMetricCards, { metrics: EMPTY_METRICS, isLoading: false, totalThreats: 0 }));
    expect(html.match(/role="button"/g)).toHaveLength(3);
    expect(html.match(/tabindex="0"/g)).toHaveLength(3);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(3);
  });

  it('says what the blocked count covers without overstating the block policy', () => {
    expect(readFileSync(path.join(GATEWAY_DIR, 'GatewayMetricCards.tsx'), 'utf8')).toContain('Requests that ask for the agent manifest still receive it.');
  });

  it('names the domain in the empty events state and offers a way back to all domains', () => {
    const html = render(
      createElement(AccessEventStream, {
        events: [],
        loadFailed: false,
        isExporting: false,
        onExport: () => undefined,
        domain: 'nobody.example',
        loadedCount: 50,
        onClearDomain: () => undefined,
      }),
    );
    expect(html).toContain('No agent events for nobody.example in the latest 50 events.');
    expect(html).toContain('Show all domains');
    expect(html).toContain('0 of the latest 50 events');
    expect(html).not.toContain('No agent events recorded yet');
  });

  it('lists only the filtered events and says how many of the loaded ones they are', () => {
    const html = render(
      createElement(AccessEventStream, {
        events: filterEventsByDomain(EVENTS, 'other.dev'),
        loadFailed: false,
        isExporting: false,
        onExport: () => undefined,
        domain: 'other.dev',
        loadedCount: EVENTS.length,
      }),
    );
    expect(html).toContain('PerplexityBot');
    expect(html).not.toContain('ClaudeBot');
    expect(html).toContain('1 of the latest 5 events');
  });

  it('keeps the all-domains empty state as it was', () => {
    const html = render(createElement(AccessEventStream, { events: [], loadFailed: false, isExporting: false, onExport: () => undefined }));
    expect(html).toContain('No agent events recorded yet');
    expect(html).toContain('Latest 50, refreshed every few seconds');
    expect(html).not.toContain('Show all domains');
  });

  it('asks the host feed for the domain and says so, instead of blaming the latest events of every domain', () => {
    const html = render(
      createElement(AccessEventStream, {
        events: [],
        loadFailed: false,
        isExporting: false,
        onExport: () => undefined,
        domain: 'nobody.example',
        source: 'host',
        onClearDomain: () => undefined,
      }),
    );
    expect(html).toContain(`Latest ${DOMAIN_EVENTS_LIMIT} for nobody.example`);
    expect(html).toContain('No agent events recorded for nobody.example.');
    expect(html).not.toContain('in the latest');
    expect(html).not.toContain('older events of');
  });

  it('warns that older events of the domain may be missing when only the latest events of every domain are loaded', () => {
    const html = render(
      createElement(AccessEventStream, {
        events: [],
        loadFailed: false,
        isExporting: false,
        onExport: () => undefined,
        domain: 'nobody.example',
        source: 'latest',
        loadedCount: 50,
      }),
    );
    expect(html).toContain('Only the latest 50 events of every domain are loaded, so older events of nobody.example may not be listed.');
  });

  it('shows a loading, load-failed or sign-in state instead of the empty-domain state before an answer exists', () => {
    const base = { events: [], isExporting: false, onExport: () => undefined, domain: 'x.com', loadedCount: 0, onClearDomain: () => undefined };
    const loading = render(createElement(AccessEventStream, { ...base, loadFailed: false, loading: true }));
    expect(loading).toContain('Loading events...');
    expect(loading).not.toContain('No agent events for');
    expect(loading).not.toContain('Show all domains');

    const failed = render(createElement(AccessEventStream, { ...base, loadFailed: true }));
    expect(failed).toContain('could not be loaded');
    expect(failed).toContain('Nothing to list until the events load.');
    expect(failed).not.toContain('No agent events for');

    const guest = render(createElement(AccessEventStream, { ...base, loadFailed: false, signedIn: false }));
    expect(guest).toContain('Sign in to see agent events.');
    expect(guest).not.toContain('No agent events for');
  });

  it('renders the agent summary compactly and says agents are not verified', () => {
    const summary = buildAgentSummary(
      scope({ status: 'ready', breakdown: breakdown({ agents: [agent({ agent: 'GPTBot', events: 1234, last_seen: '2026-10-09T09:30:00.000Z' })] }) }),
    );
    const html = render(createElement(AgentsSummary, { summary, domain: 'acme.io' }));
    expect(html).toContain('Agents on acme.io');
    expect(html).toContain('GPTBot');
    expect(html).toContain('OpenAI');
    expect(html).toContain('1,234');
    expect(html).toContain('2026-10-09 09:30 UTC');
    expect(html).toContain('This month');
    expect(html).toContain('not verified');
  });

  it('says nothing could be loaded instead of recording no agents', () => {
    const guest = render(createElement(AgentsSummary, { summary: buildAgentSummary(scope({ signedIn: false, events: [] })), domain: 'acme.io' }));
    expect(guest).toContain('Sign in to see which agents visited acme.io.');
    expect(guest).not.toContain('No agents recorded');
    expect(guest).not.toContain('In the latest');

    const failed = render(createElement(AgentsSummary, { summary: buildAgentSummary(scope({ events: [], eventsStatus: 'failed' })), domain: null }));
    expect(failed).toContain('The agents of all domains could not be loaded. Retrying.');
    expect(failed).not.toContain('No agents recorded');
  });

  it('labels agent counts taken from loaded events as such, and handles loading and no agents', () => {
    const recent = render(createElement(AgentsSummary, { summary: buildAgentSummary(scope()), domain: 'acme.io' }));
    expect(recent).toContain('In the latest 5 events');
    expect(recent).not.toContain('>This month<');

    expect(render(createElement(AgentsSummary, { summary: null, domain: null }))).toContain('Loading agents');

    const none = render(createElement(AgentsSummary, { summary: buildAgentSummary(scope({ domain: 'nobody.example' })), domain: 'nobody.example' }));
    expect(none).toContain('No agents recorded for nobody.example yet.');
  });
});

describe('Telemetry tab for platform admins and guests', () => {
  async function renderPanel(props: Record<string, unknown>): Promise<string> {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_FEATURE_DEFCON', 'false');
    const { GatewayPanel } = await import('../app/dashboard/components/GatewayPanel');
    return render(
      createElement(ToastProvider, null, createElement(GatewayPanel, { metrics: EMPTY_METRICS, status: 'unknown', isLive: false, isLoading: false, ...props })),
    );
  }

  it('labels the platform scope instead of mixing it with the organization ledger', async () => {
    const html = await renderPanel({ telemetryScope: 'platform' });
    expect(html).toContain('Platform view: domains and events of every organization');
    expect(html).toContain('All organizations');
    expect(html).not.toContain('All domains, this month');
  });

  it('labels the organization scope with its period', async () => {
    const html = await renderPanel({ telemetryScope: 'organization' });
    expect(html).toContain('All domains, this month');
    expect(html).not.toContain('Platform view');
  });

  it('asks guests to sign in instead of reporting that no agents were recorded', async () => {
    const html = await renderPanel({ isAuthenticated: false });
    expect(html).toContain('Sign in to see agent events.');
    expect(html).toContain('Sign in to see which agents visited all domains.');
    expect(html).not.toContain('No agent events recorded yet');
    expect(html).not.toContain('No agents recorded');
  });

  it('does not call the table empty before the first events answer', async () => {
    const html = await renderPanel({});
    expect(html).toContain('Loading events...');
    expect(html).not.toContain('No agent events recorded yet');
  });
});

describe('tooltip trigger', () => {
  it('is a focusable button that reports whether its explanation is open', () => {
    const html = render(
      createElement(TouchableTooltip, { title: 'Agent Events', content: 'One event per request.', children: createElement('span', null, 'Trigger') }),
    );
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('One event per request.');
  });
});

describe('honesty qualifiers stay readable', () => {
  const QUALIFIER_FILES = ['GatewayHeader.tsx', 'MetricCard.tsx', 'AgentsSummary.tsx', 'AccessEventStream.tsx'];

  it.each(QUALIFIER_FILES)('%s does not set its small print in slate-500, which is about 4:1 on the card', (file) => {
    expect(readFileSync(path.join(GATEWAY_DIR, file), 'utf8')).not.toContain('text-slate-500');
  });

  it('keeps the card footnote at 12px or larger', () => {
    expect(readFileSync(path.join(GATEWAY_DIR, 'MetricCard.tsx'), 'utf8')).toMatch(/text-xs text-slate-400 font-mono">\{footnote\}/);
  });
});

describe('copy of the new Telemetry sources stays honest', () => {
  const FILES = [
    'AccessEventStream.tsx',
    'AgentsSummary.tsx',
    'DomainSelector.tsx',
    'GatewayHeader.tsx',
    'ShieldsGrid.tsx',
    'agentSummary.ts',
    'domains.ts',
    'useDomainEvents.ts',
  ];
  const FALSE_CLAIMS =
    /dual-door|fail-open|\bkya\b|passport|pentest|perimeter|\bvip\b|99\.999|ed25519|zero-trust|sovereign|all agents|every agent|verified agent|real-time|guarantee/i;

  it.each(FILES)('%s carries no legacy or overreaching claim', (file) => {
    const source = readFileSync(path.join(GATEWAY_DIR, file), 'utf8').replace(/Agents name themselves and are not verified/g, '');
    expect(source).not.toMatch(FALSE_CLAIMS);
  });

  it('never counts humans and never presents loaded events as the month', () => {
    const header = render(createElement(GatewayHeader, { status: 'unknown', isLive: false }));
    expect(header).not.toMatch(/human visitors (are|will be) counted/i);
    const fallback = buildScopedKpis(scope());
    expect(fallback?.events.footnote).toMatch(/^In the latest \d+ events$/);
    expect(fallback?.events.footnote).not.toMatch(/month/i);
  });
});
