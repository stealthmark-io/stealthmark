'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface GatewayMetrics {
  total_requests: number;
  threats_blocked: {
    /** Agent requests the site policy answered with 403, counted from the usage ledger. */
    policy_blocked?: number;
    semantic_injections: number;
    spoofed_identities: number;
    payload_bombs: number;
    rate_limit_throttled: number;
  };
  performance: {
    latency_p50_ms: number;
    latency_p95_ms: number;
    throughput_peak_rps: number;
  };
  economic_impact: {
    tokens_saved: number;
    bandwidth_saved_mb: number;
    estimated_usd_saved: number;
  };
}

/** Whose events the metrics route counted: the session organization, or the whole platform for platform admins. */
export type TelemetryScope = 'organization' | 'platform';

export const EMPTY_METRICS: GatewayMetrics = {
  total_requests: 0,
  threats_blocked: {
    policy_blocked: 0,
    semantic_injections: 0,
    spoofed_identities: 0,
    payload_bombs: 0,
    rate_limit_throttled: 0,
  },
  performance: {
    latency_p50_ms: 0,
    latency_p95_ms: 0,
    throughput_peak_rps: 0,
  },
  economic_impact: {
    tokens_saved: 0,
    bandwidth_saved_mb: 0,
    estimated_usd_saved: 0,
  },
};

export const TELEMETRY_STORAGE_KEY = 'stealthmark_cumulative_telemetry_v1';

export function formatTokens(tokens: number): string {
  if (!tokens || tokens <= 0) return '0';
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return tokens.toLocaleString();
}

/**
 * Merges telemetry metrics monotonically.
 * Guarantees that cumulative metrics (requests, threats, tokens, savings) NEVER decrease or get wiped,
 * even when serverless containers restart, scale to zero, or load-balance across fresh instances.
 */
export function mergeMonotonicMetrics(
  prev: GatewayMetrics,
  incoming?: Partial<GatewayMetrics> | null
): GatewayMetrics {
  if (!incoming) return prev;
  const incThreats: Partial<GatewayMetrics['threats_blocked']> = incoming.threats_blocked ?? {};
  const prevThreats: Partial<GatewayMetrics['threats_blocked']> = prev.threats_blocked ?? {};
  const incPerf: Partial<GatewayMetrics['performance']> = incoming.performance ?? {};
  const prevPerf: Partial<GatewayMetrics['performance']> = prev.performance ?? {};
  const incEcon: Partial<GatewayMetrics['economic_impact']> = incoming.economic_impact ?? {};
  const prevEcon: Partial<GatewayMetrics['economic_impact']> = prev.economic_impact ?? {};

  const totalRequests = Math.max(prev.total_requests ?? 0, incoming.total_requests ?? 0);
  const policyBlocked = Math.max(prevThreats.policy_blocked ?? 0, incThreats.policy_blocked ?? 0);
  const semanticInjections = Math.max(prevThreats.semantic_injections ?? 0, incThreats.semantic_injections ?? 0);
  const spoofedIdentities = Math.max(prevThreats.spoofed_identities ?? 0, incThreats.spoofed_identities ?? 0);
  const payloadBombs = Math.max(prevThreats.payload_bombs ?? 0, incThreats.payload_bombs ?? 0);
  const rateLimitThrottled = Math.max(prevThreats.rate_limit_throttled ?? 0, incThreats.rate_limit_throttled ?? 0);
  const tokensSaved = Math.max(prevEcon.tokens_saved ?? 0, incEcon.tokens_saved ?? 0);
  const bandwidthSaved = Math.max(prevEcon.bandwidth_saved_mb ?? 0, incEcon.bandwidth_saved_mb ?? 0);
  const estimatedUsd = Math.max(
    prevEcon.estimated_usd_saved ?? 0,
    incEcon.estimated_usd_saved ?? 0,
    parseFloat(((tokensSaved / 1_000_000) * 3.0).toFixed(2))
  );

  return {
    total_requests: totalRequests,
    threats_blocked: {
      policy_blocked: policyBlocked,
      semantic_injections: semanticInjections,
      spoofed_identities: spoofedIdentities,
      payload_bombs: payloadBombs,
      rate_limit_throttled: rateLimitThrottled,
    },
    performance: {
      latency_p50_ms: incPerf.latency_p50_ms && incPerf.latency_p50_ms > 0 ? incPerf.latency_p50_ms : (prevPerf.latency_p50_ms || 0),
      latency_p95_ms: incPerf.latency_p95_ms && incPerf.latency_p95_ms > 0 ? incPerf.latency_p95_ms : (prevPerf.latency_p95_ms || 0),
      throughput_peak_rps: Math.max(prevPerf.throughput_peak_rps ?? 0, incPerf.throughput_peak_rps ?? 0),
    },
    economic_impact: {
      tokens_saved: tokensSaved,
      bandwidth_saved_mb: Number(bandwidthSaved.toFixed(2)),
      estimated_usd_saved: estimatedUsd,
    },
  };
}

export function loadCachedTelemetry(): GatewayMetrics | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TELEMETRY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.total_requests === 'number') {
      return parsed as GatewayMetrics;
    }
  } catch (error) {
    console.warn('[Telemetry] Ignoring unreadable cached metrics:', error instanceof Error ? error.name : 'unknown');
  }
  return null;
}

export function persistCachedTelemetry(metrics: GatewayMetrics): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(metrics));
  } catch (error) {
    console.warn('[Telemetry] Could not cache metrics locally:', error instanceof Error ? error.name : 'unknown');
  }
}

interface UseGatewayTelemetryOptions {
  pollIntervalMs?: number;
}

export function useGatewayTelemetry(options: number | UseGatewayTelemetryOptions = 3000) {
  const pollIntervalMs = typeof options === 'number' ? options : (options.pollIntervalMs ?? 3000);

  const [metrics, setMetricsState] = useState<GatewayMetrics>(() => loadCachedTelemetry() ?? EMPTY_METRICS);

  const [status, setStatus] = useState<string>('unknown');
  const [isLoading, setIsLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [scope, setScope] = useState<TelemetryScope | null>(null);

  // Monotonic setter exposed to consumers
  const setMetrics = useCallback((updater: GatewayMetrics | ((prev: GatewayMetrics) => GatewayMetrics)) => {
    setMetricsState((prev) => {
      const incoming = typeof updater === 'function' ? updater(prev) : updater;
      const merged = mergeMonotonicMetrics(prev, incoming);
      persistCachedTelemetry(merged);
      return merged;
    });
  }, []);

  const hasSyncedRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    async function fetchTelemetry() {
      try {
        const res = await fetch('/api/telemetry/metrics', {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });

        if (res.status === 401) {
          hasSyncedRef.current = false;
          if (isMounted) {
            persistCachedTelemetry(EMPTY_METRICS);
            setMetricsState(EMPTY_METRICS);
            setStatus('unknown');
            setIsLive(false);
            setScope(null);
          }
          return;
        }

        const body: { metrics?: Partial<GatewayMetrics>; status?: string; scope?: string } | null = res.ok
          ? await res.json()
          : null;
        if (isMounted && body && body.metrics) {
          const incoming: Partial<GatewayMetrics> = body.metrics;
          // The first response replaces whatever a previous account left in the local cache.
          const firstSync = !hasSyncedRef.current;
          hasSyncedRef.current = true;
          setMetricsState((prev) => {
            const merged = mergeMonotonicMetrics(firstSync ? EMPTY_METRICS : prev, incoming);
            persistCachedTelemetry(merged);
            return merged;
          });
          setStatus(body.status || 'unknown');
          setIsLive(true);
          setScope(body.scope === 'platform' || body.scope === 'organization' ? body.scope : null);
        }
      } catch (error) {
        console.warn('[Telemetry] Could not load metrics:', error instanceof Error ? error.name : 'unknown');
        if (isMounted) {
          setIsLive(false);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    fetchTelemetry();
    const timer = setInterval(fetchTelemetry, pollIntervalMs);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [pollIntervalMs]);

  return { metrics, status, isLoading, isLive, scope, setMetrics };
}

