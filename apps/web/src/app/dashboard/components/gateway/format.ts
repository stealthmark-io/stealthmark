import { formatTokens, type GatewayMetrics } from "@/hooks/useGatewayTelemetry";
import { isBlockedEvent } from "./domains";
import type { AgentTrafficEvent } from "./types";

type MetricsInput = GatewayMetrics | null | undefined;

const EVENTS_CSV_HEADERS = [
  "Timestamp",
  "Event_ID",
  "Agent",
  "Host",
  "HTTP_Method",
  "Route",
  "Decision",
  "Upstream_Status",
  "Policy",
];

/** The upstream HTTP status of an event, or a dash when none was recorded. */
export function formatStatus(status: number | null): string {
  return status === null ? "—" : String(status);
}

export function sumThreats(metrics: MetricsInput): number {
  if (!metrics) return 0;
  return (
    (metrics.threats_blocked.policy_blocked ?? 0) +
    metrics.threats_blocked.semantic_injections +
    metrics.threats_blocked.spoofed_identities +
    metrics.threats_blocked.payload_bombs +
    metrics.threats_blocked.rate_limit_throttled
  );
}

export function formatClusterStatus(status: string | null | undefined): string {
  return status ? status.toUpperCase() : "UNKNOWN";
}

export function formatTotalRequests(metrics: MetricsInput, isLoading: boolean): string {
  if (metrics) return metrics.total_requests.toLocaleString();
  return isLoading ? "..." : "0";
}

export function formatLatencyP50(metrics: MetricsInput, isLoading: boolean): string {
  if (metrics) {
    return metrics.performance.latency_p50_ms > 0
      ? `${metrics.performance.latency_p50_ms.toFixed(1)}ms`
      : "—";
  }
  return isLoading ? "..." : "—";
}

export function formatTokensSaved(metrics: MetricsInput, isLoading: boolean): string {
  if (metrics) {
    return metrics.economic_impact.tokens_saved > 0
      ? formatTokens(metrics.economic_impact.tokens_saved)
      : "0";
  }
  return isLoading ? "..." : "0";
}

export function formatUsdSaved(metrics: MetricsInput): string {
  return metrics ? metrics.economic_impact.estimated_usd_saved.toFixed(2) : "0.00";
}

export function defconBadgeVariant(level: number): "danger" | "warning" | "info" | "success" {
  if (level === 1) return "danger";
  if (level <= 3) return "warning";
  if (level === 4) return "info";
  return "success";
}

export function defconTierClasses(level: number, isCurrent: boolean): string {
  if (!isCurrent) {
    return "bg-white/[0.02] border-white/5 opacity-60 hover:opacity-100 hover:bg-white/[0.05] hover:border-white/20";
  }
  if (level === 1) {
    return "bg-rose-500/15 border-rose-500/40 shadow-lg shadow-rose-950/40 scale-[1.02]";
  }
  if (level <= 3) {
    return "bg-amber-500/15 border-amber-500/40 shadow-lg shadow-amber-950/40 scale-[1.02]";
  }
  return "bg-emerald-500/10 border-emerald-500/30 shadow-lg shadow-emerald-950/30 scale-[1.02]";
}

export function defconDotClass(level: number): string {
  if (level === 1) return "bg-rose-400";
  if (level <= 3) return "bg-amber-400";
  return "bg-emerald-400";
}

const CSV_FORMULA_PREFIX = /^(?:[=+\-@|\t\r]|\s+[=+\-@|])/;

/**
 * Quotes a CSV cell and neutralizes spreadsheet formulas: text cells starting with =, +, -, @, tab or CR
 * get a leading single quote so Excel and Sheets read them as text. Numbers are never prefixed.
 */
export function escapeCsv(value: string | number): string {
  const text = String(value);
  const safe = typeof value === "string" && CSV_FORMULA_PREFIX.test(text) ? `'${text}` : text;
  if (safe.includes(",") || safe.includes('"') || safe.includes("\n") || safe.includes("\r")) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

interface EventsCsvInput {
  events: AgentTrafficEvent[];
  blockedByPolicy: number;
  exportedAt: string;
  /** Domain the events were filtered to; null or absent for all domains. */
  domain?: string | null;
}

export function buildEventsCsv({ events, blockedByPolicy, exportedAt, domain = null }: EventsCsvInput): string {
  const rows = events.map((evt) => [
    escapeCsv(evt.timestamp ?? evt.time),
    escapeCsv(evt.id),
    escapeCsv(evt.agent),
    escapeCsv(evt.provider),
    escapeCsv(evt.method),
    escapeCsv(evt.targetPath),
    escapeCsv(isBlockedEvent(evt) ? "blocked" : "allowed"),
    escapeCsv(formatStatus(evt.status)),
    escapeCsv(evt.securityCheck),
  ]);
  const blockedLine =
    domain === null
      ? `# Blocked by policy this month: ${blockedByPolicy}`
      : `# Blocked by policy in these events: ${events.filter(isBlockedEvent).length}`;

  return [
    `# StealthMark agent events (latest recorded events of your organization)`,
    `# Domain: ${domain === null ? "all domains" : escapeCsv(domain)}`,
    `# Exported: ${exportedAt}`,
    `# Events in this file: ${events.length}`,
    blockedLine,
    EVENTS_CSV_HEADERS.join(","),
    ...rows.map((r) => r.join(",")),
  ].join("\n");
}

/** File name part for a domain: keeps letters, digits, dots and hyphens so an IPv6 literal cannot break the name. */
export function domainFileSlug(domain: string): string {
  return domain.replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** "2026-10-09 14:22 UTC" for an ISO timestamp; anything else (a clock time, null) is shown as it is. */
export function formatLastSeen(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
