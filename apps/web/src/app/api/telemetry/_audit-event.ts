import { BLOCKED_EVENT_TYPE, UNKNOWN_AGENT } from '../usage/_constants';
import type { UsageEventItem } from '../usage/_shared';

export interface AuditEventItem {
  id: string;
  time: string;
  timestamp: string;
  agent: string;
  provider: string;
  targetPath: string;
  method: string;
  /** Upstream HTTP status recorded with the event; null when the row carries none. */
  status: number | null;
  decision: 'blocked' | 'allowed';
  /** The agent name is the User-Agent the request declared; nothing verifies it yet. */
  identity: 'ua_declared';
  securityCheck: string;
}

const CANARY_REASON = 'canary_triggered';

function formatLag(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** A Canary hit names how long after the fixture was served its URL was requested; other events keep the policy label. */
function securityCheckFor(item: UsageEventItem, blocked: boolean): string {
  if (item.metadata.reason === CANARY_REASON) {
    const lag = Date.parse(item.created_at) - Date.parse(item.metadata.served_at ?? '');
    return Number.isNaN(lag) ? 'Canary URL contactada' : `Canary URL contactada (+${formatLag(Math.max(0, lag))})`;
  }
  return blocked ? 'Blocked by policy' : 'UA declared (unverified)';
}

function formatIso(createdAt: string): string {
  const created = new Date(createdAt);
  return Number.isNaN(created.getTime()) ? createdAt : created.toISOString();
}

/** The row the Telemetry tab lists for one usage event; shared by the telemetry route and the console's host feed. */
export function toAuditEvent(item: UsageEventItem): AuditEventItem {
  const blocked = item.event_type === BLOCKED_EVENT_TYPE;
  const occurredAt = formatIso(item.created_at);
  return {
    id: item.id,
    time: occurredAt,
    timestamp: occurredAt,
    agent: item.agent_identifier ?? UNKNOWN_AGENT,
    provider: item.metadata.host ?? 'unknown host',
    targetPath: item.metadata.path ?? '/',
    method: item.metadata.method ?? 'GET',
    status: item.metadata.status,
    decision: blocked ? 'blocked' : 'allowed',
    identity: 'ua_declared',
    securityCheck: securityCheckFor(item, blocked),
  };
}
