import type { AgentSummary, SiteSummary } from "@/app/api/usage/_shared";
import { rowsFromAgentSummaries, rowsFromEvents, type AgentRow } from "./agentSummary";
import type { AgentTrafficEvent } from "./types";

export const ALL_DOMAINS_LABEL = "All domains";
export const DOMAIN_PARAM = "domain";

/** Rows shown in the per-agent summary before the rest is left to the Agents tab. */
export const AGENT_SUMMARY_LIMIT = 6;

const MAX_HOST_LENGTH = 253;
/** Same form as the request hosts the SDK stores: lowercase hostname or IPv4 without port, or a bracketed IPv6 literal. */
const HOST_PATTERN = /^(?:[a-z0-9._-]+|\[[0-9a-f:.]+\])$/;

/**
 * Reduces a hostname or pasted URL to the form the SDK reports (lowercase, no scheme, path, port or trailing dot).
 * Returns null when the result is not a valid host, which also rejects the "unknown host" placeholder.
 */
export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
  if (host.length === 0 || host.length > MAX_HOST_LENGTH || !HOST_PATTERN.test(host)) return null;
  return host;
}

interface DomainSources {
  /** Domains registered through Add Domain. */
  registered?: readonly string[];
  /** Events already loaded by the page; their provider is the request host. */
  events?: readonly AgentTrafficEvent[];
  /** Hosts of the organization's usage ledger this month. */
  siteHosts?: readonly (string | null)[];
}

/** Every domain the organization has, once each and in alphabetical order. */
export function collectDomains({ registered = [], events = [], siteHosts = [] }: DomainSources): string[] {
  const found = new Set<string>();
  const candidates = [...registered, ...events.map((event) => event.provider), ...siteHosts];
  for (const candidate of candidates) {
    const domain = normalizeDomain(candidate);
    if (domain) found.add(domain);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

/** Options of the selector: the known domains plus the selected one, which stays listed even when nothing reported it yet. */
export function selectorOptions(domains: readonly string[], selected: string | null): string[] {
  if (selected === null || domains.includes(selected)) return [...domains];
  return [...domains, selected].sort((a, b) => a.localeCompare(b));
}

/** Events of one domain (exact host match, like the usage routes), or every event when `domain` is null. */
export function filterEventsByDomain(events: readonly AgentTrafficEvent[], domain: string | null): AgentTrafficEvent[] {
  if (domain === null) return [...events];
  return events.filter((event) => normalizeDomain(event.provider) === domain);
}

export function isBlockedEvent(event: AgentTrafficEvent): boolean {
  if (event.decision) return event.decision === "blocked";
  return event.status !== null && event.status !== 200;
}

/** Search string of the console URL with the domain param set, or removed when `domain` is null. Other params are kept. */
export function withDomainParam(search: string, domain: string | null): string {
  const params = new URLSearchParams(search);
  if (domain === null) params.delete(DOMAIN_PARAM);
  else params.set(DOMAIN_PARAM, domain);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Domain stored in a console URL search string; null when absent or not a valid host. */
export function readDomainParam(search: string): string | null {
  return normalizeDomain(new URLSearchParams(search).get(DOMAIN_PARAM));
}

/** Month breakdown of the usage ledger for one host filter (null = every domain). */
export interface DomainBreakdown {
  host: string | null;
  agents: readonly AgentSummary[];
  sites: readonly SiteSummary[];
  /** The month had more events than the route scans, so counts are a lower bound. */
  truncated: boolean;
}

export type BreakdownStatus = "loading" | "ready" | "unavailable";

/** State of the latest-events feed: "failed" only when it failed before anything was loaded. */
export type EventsStatus = "loading" | "ready" | "failed";

export function eventsStatusOf(loaded: boolean, loadFailed: boolean, loadedCount: number): EventsStatus {
  if (!loaded) return "loading";
  return loadFailed && loadedCount === 0 ? "failed" : "ready";
}

export interface ScopeInput {
  domain: string | null;
  breakdown: DomainBreakdown | null;
  status: BreakdownStatus;
  /** Every event the page loaded, before the domain filter. */
  events: readonly AgentTrafficEvent[];
  /** Whether `events` answered; an empty list only means "no activity" when it is "ready". */
  eventsStatus: EventsStatus;
  /** Guests cannot load the organization's data, so an empty list says nothing about their activity. */
  signedIn: boolean;
}

export interface ScopedKpi {
  value: string;
  footnote: string;
}

export interface ScopedKpis {
  events: ScopedKpi;
  blocked: ScopedKpi;
  latency: ScopedKpi;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function breakdownFor(input: ScopeInput): DomainBreakdown | null {
  return input.status === "ready" && input.breakdown !== null && input.breakdown.host === input.domain
    ? input.breakdown
    : null;
}

function latestEventsLabel(count: number): string {
  return `In the latest ${formatCount(count)} events`;
}

/** "1,234+" for a lower bound; a zero stays "0" because "0+" reads like an error. */
function formatMonthCount(value: number, truncated: boolean): string {
  return truncated && value > 0 ? `${formatCount(value)}+` : formatCount(value);
}

function sameKpi(kpi: ScopedKpi, latency: ScopedKpi): ScopedKpis {
  return { events: kpi, blocked: kpi, latency };
}

/**
 * KPI values of the selected domain, or null for all domains (the cards then show the organization's ledger totals).
 * The month figures come from the usage ledger filtered by host. When that breakdown cannot be loaded, the numbers are
 * counted from the events the page has and the footnote says so.
 */
export function buildScopedKpis(input: ScopeInput): ScopedKpis | null {
  if (input.domain === null) return null;
  const latency: ScopedKpi = { value: "—", footnote: "Not measured per domain" };
  const breakdown = breakdownFor(input);

  if (breakdown) {
    const events = breakdown.agents.reduce((sum, agent) => sum + agent.events, 0);
    const blocked = breakdown.agents.reduce((sum, agent) => sum + agent.blocked, 0);
    const footnote = breakdown.truncated ? "This domain, this month, at least" : "This domain, this month";
    return {
      events: { value: formatMonthCount(events, breakdown.truncated), footnote },
      blocked: { value: formatMonthCount(blocked, breakdown.truncated), footnote },
      latency,
    };
  }

  const loading: ScopedKpi = { value: "...", footnote: "Loading this domain" };
  if (input.status === "loading") return sameKpi(loading, latency);
  if (!input.signedIn) return sameKpi({ value: "—", footnote: "Sign in to see this domain" }, latency);
  if (input.eventsStatus === "loading") return sameKpi(loading, latency);
  if (input.eventsStatus === "failed") return sameKpi({ value: "—", footnote: "Could not load this domain" }, latency);

  const scoped = filterEventsByDomain(input.events, input.domain);
  const footnote = latestEventsLabel(input.events.length);
  return {
    events: { value: formatCount(scoped.length), footnote },
    blocked: { value: formatCount(scoped.filter(isBlockedEvent).length), footnote },
    latency,
  };
}

export type SummaryUnavailableReason = "signed-out" | "load-failed";

export interface AgentSummaryView {
  /**
   * "month" rows come from the usage ledger, "recent" rows are counted from the loaded events and "unavailable" has
   * no rows because nothing could be loaded.
   */
  basis: "month" | "recent" | "unavailable";
  rows: AgentRow[];
  /** Number of agents before the list was cut to AGENT_SUMMARY_LIMIT. */
  totalAgents: number;
  truncated: boolean;
  /** Events the rows were counted from; only set for the "recent" basis. */
  sampleSize: number | null;
  /** Why there is nothing to show; only set for the "unavailable" basis. */
  unavailableReason: SummaryUnavailableReason | null;
}

function unavailableSummary(reason: SummaryUnavailableReason): AgentSummaryView {
  return { basis: "unavailable", rows: [], totalAgents: 0, truncated: false, sampleSize: null, unavailableReason: reason };
}

/** Per-agent summary of the selected scope; null while the month breakdown or the events are still loading. */
export function buildAgentSummary(input: ScopeInput): AgentSummaryView | null {
  const breakdown = breakdownFor(input);
  if (breakdown) {
    const rows = rowsFromAgentSummaries(breakdown.agents);
    return {
      basis: "month",
      rows: rows.slice(0, AGENT_SUMMARY_LIMIT),
      totalAgents: rows.length,
      truncated: breakdown.truncated,
      sampleSize: null,
      unavailableReason: null,
    };
  }
  if (input.status === "loading") return null;
  if (!input.signedIn) return unavailableSummary("signed-out");
  if (input.eventsStatus === "loading") return null;
  if (input.eventsStatus === "failed") return unavailableSummary("load-failed");

  const scoped = filterEventsByDomain(input.events, input.domain);
  const rows = rowsFromEvents(scoped);
  return {
    basis: "recent",
    rows: rows.slice(0, AGENT_SUMMARY_LIMIT),
    totalAgents: rows.length,
    truncated: false,
    sampleSize: input.events.length,
    unavailableReason: null,
  };
}

/** Where the events of the table came from. */
export type EventsSource =
  /** The latest events across every domain. */
  | "all"
  /** The latest events of the selected host, asked for from the host-filtered route. */
  | "host"
  /** The latest events across every domain, narrowed to the selected host in the browser. */
  | "latest";

export interface EventsView {
  events: AgentTrafficEvent[];
  /** The first answer has not arrived, so an empty list says nothing yet. */
  loading: boolean;
  /** The last request failed; `events` may still hold the previous answer. */
  loadFailed: boolean;
  signedIn: boolean;
  source: EventsSource;
  /** Events the list was narrowed from; only meaningful for the "latest" source. */
  loadedCount: number;
}

export interface EventsViewInput {
  domain: string | null;
  signedIn: boolean;
  /** The feed of the latest events across every domain. */
  latest: { events: readonly AgentTrafficEvent[]; loaded: boolean; failed: boolean };
  /** Feed of the selected host; null when it does not apply (no domain, guests, platform view). */
  hostFeed: { events: AgentTrafficEvent[] | null; loading: boolean; failed: boolean } | null;
}

/**
 * Events of the table and the CSV. A selected domain reads its own host-filtered feed when there is one, because the
 * latest events across every domain may hold none of that host's; otherwise the latest events are narrowed to it.
 */
export function buildEventsView({ domain, signedIn, latest, hostFeed }: EventsViewInput): EventsView {
  if (!signedIn) {
    return { events: [], loading: false, loadFailed: false, signedIn, source: domain === null ? "all" : "latest", loadedCount: 0 };
  }
  if (domain !== null && hostFeed) {
    const events = hostFeed.events ?? [];
    return { events, loading: hostFeed.loading, loadFailed: hostFeed.failed, signedIn, source: "host", loadedCount: events.length };
  }
  return {
    events: filterEventsByDomain(latest.events, domain),
    loading: !latest.loaded,
    loadFailed: latest.failed,
    signedIn,
    source: domain === null ? "all" : "latest",
    loadedCount: latest.events.length,
  };
}

/** Why there is nothing to list or export, in a sentence; never states an absence the page could not observe. */
export function describeNoEvents(view: EventsView, domain: string | null): string {
  if (!view.signedIn) return "Sign in to see agent events.";
  if (view.loading) return "The events are still loading.";
  if (view.loadFailed) return "The events could not be loaded.";
  if (domain === null) return "No agent events have been recorded yet.";
  if (view.source === "host") return `No agent events have been recorded for ${domain}.`;
  return `No agent events for ${domain} in the latest ${formatCount(view.loadedCount)} events.`;
}
