// ═══════════════════════════════════════════════════════════════════
// @stealthmark/core — Per-client cap on billable agent events
// Agent identification is self-declared, so one client repeating a crawler User-Agent could spend a site's
// events. The cap is counted in memory, per process: the client address never leaves the host.
// ═══════════════════════════════════════════════════════════════════

import type { UsageEvent } from './types.js';

export const DEFAULT_MAX_AGENT_EVENTS_PER_CLIENT_PER_HOUR = 600;
/** Requests without a usable client address share one bucket; its cap is the per-client cap times this. */
export const SHARED_BUCKET_MULTIPLIER = 10;
/** Events over the cap that a bucket still reports per window as zero-unit `agent_capped`; later ones are not sent. */
export const MAX_CAPPED_REPORTS_PER_WINDOW = 500;
/** Upper bound of the table. Clients that do not fit are counted in the shared bucket. */
export const MAX_TRACKED_CLIENTS = 10_000;

const WINDOW_MS = 3_600_000;
/** A full table is swept for ended windows at most this often, so a flood of new clients cannot force a sweep per request. */
const SWEEP_INTERVAL_MS = 60_000;

export type CapDecision = 'billable' | 'capped' | 'drop';

export interface ClientEventCap {
  /** Counts one billable event for the client and says how to meter it. */
  decide(clientAddress: string | undefined, now: number): CapDecision;
}

interface Bucket {
  windowStart: number;
  count: number;
}

function countInWindow(bucket: Bucket, now: number): number {
  if (now - bucket.windowStart >= WINDOW_MS) {
    bucket.windowStart = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  return bucket.count;
}

function decisionFor(count: number, limit: number): CapDecision {
  if (count <= limit) return 'billable';
  return count <= limit + MAX_CAPPED_REPORTS_PER_WINDOW ? 'capped' : 'drop';
}

/** The configured cap as a whole number. Anything that is not a finite number of at least 0 falls back to the default. */
export function resolveClientCapLimit(configured: number | undefined): number {
  const usable = typeof configured === 'number' && Number.isFinite(configured) && configured >= 0;
  return usable ? Math.floor(configured) : DEFAULT_MAX_AGENT_EVENTS_PER_CLIENT_PER_HOUR;
}

/** Creates the cap, or null when `maxPerClientPerHour` is 0 (cap off). */
export function createClientEventCap(maxPerClientPerHour: number): ClientEventCap | null {
  if (maxPerClientPerHour <= 0) return null;
  const clients = new Map<string, Bucket>();
  const shared: Bucket = { windowStart: 0, count: 0 };
  let nextSweepAt = 0;

  function sweepEndedWindows(now: number): void {
    if (now < nextSweepAt) return;
    nextSweepAt = now + SWEEP_INTERVAL_MS;
    for (const [address, bucket] of clients) {
      if (now - bucket.windowStart >= WINDOW_MS) clients.delete(address);
    }
  }

  function trackedBucket(address: string, now: number): Bucket | undefined {
    const known = clients.get(address);
    if (known) return known;
    if (clients.size >= MAX_TRACKED_CLIENTS) sweepEndedWindows(now);
    if (clients.size >= MAX_TRACKED_CLIENTS) return undefined;
    const created: Bucket = { windowStart: now, count: 0 };
    clients.set(address, created);
    return created;
  }

  return {
    decide(clientAddress, now) {
      const own = clientAddress === undefined ? undefined : trackedBucket(clientAddress, now);
      const limit = own ? maxPerClientPerHour : maxPerClientPerHour * SHARED_BUCKET_MULTIPLIER;
      return decisionFor(countInWindow(own ?? shared, now), limit);
    },
  };
}

function isBillable(event: UsageEvent): boolean {
  return event.event_type !== 'agent_blocked' && event.event_type !== 'agent_capped';
}

/**
 * Applies the cap to one event. Free events pass untouched. A billable event over the cap becomes a zero-unit
 * `agent_capped` event, and null once the window's report allowance is spent (nothing is sent for it).
 */
export function applyClientCap(
  cap: ClientEventCap,
  event: UsageEvent,
  clientAddress: string | undefined
): UsageEvent | null {
  if (!isBillable(event)) return event;
  const decision = cap.decide(clientAddress, Date.now());
  if (decision === 'billable') return event;
  return decision === 'capped' ? { ...event, event_type: 'agent_capped', units: 0 } : null;
}
