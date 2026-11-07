import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { GatewayMetrics } from '../../hooks/useGatewayTelemetry';

const DEFAULT_GATEWAY_URL = 'https://gateway.stealthmark.io';

export interface GatewayPingFixture {
  latency_ms: number;
}

export interface GatewayDefconFixture {
  defcon_level: number;
}

/**
 * GET /api/v1/telemetry/metrics is read by two handlers with different shapes:
 * admin/metrics reads the flat totals, telemetry/metrics reads the nested `metrics` block.
 */
export interface GatewayTelemetryFixture {
  status: string;
  total_requests: number;
  threats_blocked: number;
  metrics: GatewayMetrics;
}

export interface GatewayFixtures {
  ping: GatewayPingFixture;
  defcon: GatewayDefconFixture;
  telemetry: GatewayTelemetryFixture;
}

export type GatewayOverrides = {
  [K in keyof GatewayFixtures]?: Partial<GatewayFixtures[K]>;
};

export interface GatewayCall {
  method: string;
  url: string;
}

export interface GatewayFetchMock {
  fetch: Mock<typeof fetch>;
  calls: GatewayCall[];
  strayCalls: GatewayCall[];
}

const THREATS = {
  semantic_injections: 812,
  spoofed_identities: 604,
  payload_bombs: 391,
  rate_limit_throttled: 310,
};

const TOTAL_REQUESTS = 158_204;
const TOTAL_THREATS =
  THREATS.semantic_injections +
  THREATS.spoofed_identities +
  THREATS.payload_bombs +
  THREATS.rate_limit_throttled;
const TOKENS_SAVED = 4_820_000;

export const GATEWAY_FIXTURES: GatewayFixtures = {
  ping: { latency_ms: 9.8 },
  defcon: { defcon_level: 5 },
  telemetry: {
    status: 'operational',
    total_requests: TOTAL_REQUESTS,
    threats_blocked: TOTAL_THREATS,
    metrics: {
      total_requests: TOTAL_REQUESTS,
      threats_blocked: THREATS,
      performance: {
        latency_p50_ms: 11.2,
        latency_p95_ms: 26.9,
        throughput_peak_rps: 118.4,
      },
      economic_impact: {
        tokens_saved: TOKENS_SAVED,
        bandwidth_saved_mb: 2048.5,
        estimated_usd_saved: Number(((TOKENS_SAVED / 1_000_000) * 3.0).toFixed(2)),
      },
    },
  },
};

function resolveGatewayBase(): string {
  return (process.env.NEXT_PUBLIC_GATEWAY_URL || DEFAULT_GATEWAY_URL).replace(/\/$/, '');
}

function describeCall(input: Parameters<typeof fetch>[0], init?: RequestInit): GatewayCall {
  if (typeof input === 'string') {
    return { method: (init?.method ?? 'GET').toUpperCase(), url: input };
  }
  if (input instanceof URL) {
    return { method: (init?.method ?? 'GET').toUpperCase(), url: input.href };
  }
  return { method: (init?.method ?? input.method).toUpperCase(), url: input.url };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Replaces global fetch so that only the gateway endpoints consumed by the web route
 * handlers are answered. Any other request is recorded in `strayCalls` and rejected with
 * an error naming the URL. Handlers that swallow fetch errors still leave a trace in
 * `strayCalls`, which tests assert to be empty before calling vi.unstubAllGlobals().
 */
export function installGatewayFetchMock(overrides: GatewayOverrides = {}): GatewayFetchMock {
  const fixtures: GatewayFixtures = {
    ping: { ...GATEWAY_FIXTURES.ping, ...overrides.ping },
    defcon: { ...GATEWAY_FIXTURES.defcon, ...overrides.defcon },
    telemetry: { ...GATEWAY_FIXTURES.telemetry, ...overrides.telemetry },
  };
  const calls: GatewayCall[] = [];
  const strayCalls: GatewayCall[] = [];

  const answer = (call: GatewayCall): Response | null => {
    const base = resolveGatewayBase();
    if (call.url === `${base}/api/v1/ping` && call.method === 'POST') {
      return jsonResponse(fixtures.ping);
    }
    if (call.url === `${base}/api/v1/telemetry/metrics` && call.method === 'GET') {
      return jsonResponse(fixtures.telemetry);
    }
    if (call.url === `${base}/api/v1/defcon` && call.method === 'GET') {
      return jsonResponse(fixtures.defcon);
    }
    if (call.url === `${base}/api/v1/defcon` && call.method === 'POST') {
      return jsonResponse({ success: true });
    }
    return null;
  };

  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const call = describeCall(input, init);
    const response = answer(call);
    if (response === null) {
      strayCalls.push(call);
      throw new Error(`Unexpected network call in unit test: ${call.method} ${call.url}`);
    }
    calls.push(call);
    return response;
  });

  vi.stubGlobal('fetch', fetchMock);
  return { fetch: fetchMock, calls, strayCalls };
}
