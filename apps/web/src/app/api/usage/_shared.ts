import { AGENT_MAX_ROWS, BLOCKED_EVENT_TYPE, UNKNOWN_AGENT } from './_constants';

export { AGENT_MAX_ROWS, BLOCKED_EVENT_TYPE, UNKNOWN_AGENT };
export const USAGE_COLUMNS = 'id, created_at, event_type, units, agent_identifier, source, site_id, metadata';
export const DEFAULT_EVENTS_LIMIT = 50;
export const MAX_EVENTS_LIMIT = 200;
export const AGENT_PAGE_SIZE = 1000;
export const TOP_PATHS_PER_AGENT = 5;
/** PostgREST path to the request host stored by the SDK in the event metadata. */
export const HOST_COLUMN = 'metadata->>host';
export const MAX_HOST_LENGTH = 253;

export interface UsageEventItem {
  id: string;
  created_at: string;
  event_type: string;
  units: number;
  agent_identifier: string | null;
  source: string;
  site_id: string | null;
  /**
   * `status` is the upstream HTTP status the gateway recorded; null when the row carries none.
   * `reason` and `served_at` come only with Canary hits: why the event was recorded and when the fixture was served.
   */
  metadata: {
    path: string | null;
    method: string | null;
    host: string | null;
    status: number | null;
    reason: string | null;
    served_at: string | null;
  };
}

export interface UsageEventsResponse {
  events: UsageEventItem[];
  next_cursor: string | null;
}

export interface AgentPathCount {
  path: string;
  count: number;
}

export interface AgentSummary {
  agent: string;
  events: number;
  units: number;
  blocked: number;
  last_seen: string | null;
  top_paths: AgentPathCount[];
}

export interface SiteSummary {
  /** Request host of the events, or null for events recorded without one (the UI labels it "unknown"). */
  host: string | null;
  events: number;
  /** Distinct agent_identifier values; events without an identifier count as one "unknown" agent. */
  agents: number;
  last_seen: string | null;
}

export interface UsageAgentsResponse {
  period_month: string;
  agents: AgentSummary[];
  sites: SiteSummary[];
  sampled_rows: number;
  truncated: boolean;
}

export interface UsageCursor {
  createdAt: string;
  id: string;
}

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST_PATTERN = /^(?:[a-z0-9._-]+|\[[0-9a-f:.]+\])$/;

export type HostFilter = { valid: true; host: string | null } | { valid: false };

/**
 * Parses the optional `host` query param. Absent means no filter; present must have the form `normalizeHost`
 * in @stealthmark/core emits for metadata.host: 1 to 253 characters that are either lowercase `a-z 0-9 . _ -`
 * (hostname or IPv4, no port) or a bracketed IPv6 literal such as `[2001:db8::7]`.
 */
export function parseHostFilter(raw: string | null): HostFilter {
  if (raw === null) return { valid: true, host: null };
  if (raw.length === 0 || raw.length > MAX_HOST_LENGTH || !HOST_PATTERN.test(raw)) return { valid: false };
  return { valid: true, host: raw };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseUsageRow(raw: unknown): UsageEventItem | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asString(row.id);
  const createdAt = asString(row.created_at);
  if (!id || !createdAt) return null;
  const metadata = asRecord(row.metadata);
  return {
    id,
    created_at: createdAt,
    event_type: asString(row.event_type) ?? 'agent_request',
    units: typeof row.units === 'number' && Number.isFinite(row.units) ? row.units : 0,
    agent_identifier: asString(row.agent_identifier),
    source: asString(row.source) ?? 'api',
    site_id: asString(row.site_id),
    metadata: {
      path: asString(metadata?.path),
      method: asString(metadata?.method),
      host: asString(metadata?.host),
      status: asStatus(metadata?.status),
      reason: asString(metadata?.reason),
      served_at: asString(metadata?.served_at),
    },
  };
}

export function parseUsageRows(raw: unknown): UsageEventItem[] {
  if (!Array.isArray(raw)) return [];
  const items: UsageEventItem[] = [];
  for (const row of raw) {
    const item = parseUsageRow(row);
    if (item) items.push(item);
  }
  return items;
}

/** Returns the clamped page size, or null when the raw value is present but not a positive integer. */
export function parseLimit(raw: string | null): number | null {
  if (raw === null) return DEFAULT_EVENTS_LIMIT;
  if (!/^\d{1,6}$/.test(raw)) return null;
  const value = Number(raw);
  if (value < 1) return null;
  return Math.min(value, MAX_EVENTS_LIMIT);
}

export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}

/** Cursors are rebuilt into a PostgREST filter, so only a strict timestamp and uuid are accepted. */
export function decodeCursor(raw: string): UsageCursor | null {
  if (raw.length === 0 || raw.length > 200) return null;
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = decoded.indexOf('|');
  if (separator < 0) return null;
  const createdAt = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (!TIMESTAMP_PATTERN.test(createdAt) || !UUID_PATTERN.test(id)) return null;
  return { createdAt, id };
}

interface AgentAccumulator {
  events: number;
  units: number;
  blocked: number;
  lastSeen: string | null;
  lastSeenMs: number;
  paths: Map<string, number>;
}

function timestampMs(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/** Groups events by agent_identifier. `events` counts rows, `blocked` counts agent_blocked rows. */
export function aggregateAgents(items: readonly UsageEventItem[], topPaths: number = TOP_PATHS_PER_AGENT): AgentSummary[] {
  const byAgent = new Map<string, AgentAccumulator>();
  for (const item of items) {
    const key = item.agent_identifier?.trim() || UNKNOWN_AGENT;
    let acc = byAgent.get(key);
    if (!acc) {
      acc = { events: 0, units: 0, blocked: 0, lastSeen: null, lastSeenMs: -1, paths: new Map() };
      byAgent.set(key, acc);
    }
    acc.events += 1;
    acc.units += item.units;
    if (item.event_type === BLOCKED_EVENT_TYPE) acc.blocked += 1;
    const seenMs = timestampMs(item.created_at);
    if (seenMs > acc.lastSeenMs) {
      acc.lastSeenMs = seenMs;
      acc.lastSeen = item.created_at;
    }
    const path = item.metadata.path;
    if (path) acc.paths.set(path, (acc.paths.get(path) ?? 0) + 1);
  }

  const summaries: AgentSummary[] = [];
  for (const [agent, acc] of byAgent) {
    const top = [...acc.paths.entries()]
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
      .slice(0, topPaths);
    summaries.push({
      agent,
      events: acc.events,
      units: acc.units,
      blocked: acc.blocked,
      last_seen: acc.lastSeen,
      top_paths: top,
    });
  }
  return summaries.sort((a, b) => b.events - a.events || a.agent.localeCompare(b.agent));
}

interface SiteAccumulator {
  events: number;
  agents: Set<string>;
  lastSeen: string | null;
  lastSeenMs: number;
}

/** Groups events by request host. Events without a host are grouped under host null. */
export function aggregateSites(items: readonly UsageEventItem[]): SiteSummary[] {
  const bySite = new Map<string | null, SiteAccumulator>();
  for (const item of items) {
    const key = item.metadata.host;
    let acc = bySite.get(key);
    if (!acc) {
      acc = { events: 0, agents: new Set(), lastSeen: null, lastSeenMs: -1 };
      bySite.set(key, acc);
    }
    acc.events += 1;
    acc.agents.add(item.agent_identifier?.trim() || UNKNOWN_AGENT);
    const seenMs = timestampMs(item.created_at);
    if (seenMs > acc.lastSeenMs) {
      acc.lastSeenMs = seenMs;
      acc.lastSeen = item.created_at;
    }
  }

  const summaries: SiteSummary[] = [];
  for (const [host, acc] of bySite) {
    summaries.push({ host, events: acc.events, agents: acc.agents.size, last_seen: acc.lastSeen });
  }
  return summaries.sort((a, b) => {
    if (b.events !== a.events) return b.events - a.events;
    if (a.host === b.host) return 0;
    if (a.host === null) return 1;
    if (b.host === null) return -1;
    return a.host.localeCompare(b.host);
  });
}
