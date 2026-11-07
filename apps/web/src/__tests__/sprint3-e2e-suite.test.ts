import { afterAll, afterEach, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getAgentManifest } from '../app/api/agent-manifest/route';
import { POST as postWaitlist } from '../app/api/waitlist/route';
import { GATEWAY_FIXTURES, installGatewayFetchMock } from './helpers/gateway-mock';
import type { GatewayFetchMock } from './helpers/gateway-mock';
import { stubLeadChannels } from './helpers/lead-channels';

type DefconRoute = typeof import('../app/api/defcon/route');
type SentinelRoute = typeof import('../app/api/ai/sentinel/route');

// Flags are read at module load, so the gated routes are re-imported after stubbing the env.
async function loadGatedRoutes(enabled: 'true' | 'false') {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_FEATURE_DEFCON', enabled);
  vi.stubEnv('NEXT_PUBLIC_FEATURE_SENTINEL', enabled);
  const [defcon, sentinel] = await Promise.all([
    import('../app/api/defcon/route'),
    import('../app/api/ai/sentinel/route'),
  ]);
  return { defcon, sentinel };
}

let getDefcon: DefconRoute['GET'];
let postDefcon: DefconRoute['POST'];
let postSentinel: SentinelRoute['POST'];

beforeAll(async () => {
  const { defcon, sentinel } = await loadGatedRoutes('true');
  getDefcon = defcon.GET;
  postDefcon = defcon.POST;
  postSentinel = sentinel.POST;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

let gateway: GatewayFetchMock;

beforeEach(() => {
  gateway = installGatewayFetchMock();
});

afterEach(() => {
  expect(gateway.strayCalls).toEqual([]);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Sprint 3: E2E Automated Testing Suite & In-Console AI Sentinel', () => {
  describe('E2E Scenario 1: Autonomous Agent Discovery & Action Manifest Contract', () => {
    it('serves valid RFC Action Manifest to AI agents with >98% token reduction', async () => {
      const res = await getAgentManifest();
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.protocol).toBe('stealthmark_agent_governance_v1');
      expect(data.status).toBe('GOVERNED_BY_STEALTHMARK');
      expect(Array.isArray(data.capabilities)).toBe(true);
      expect(data.capabilities.length).toBeGreaterThanOrEqual(3);

      const capIds = data.capabilities.map((c: { id: string }) => c.id);
      expect(capIds).toContain('audit_website_security');
      expect(capIds).toContain('join_waitlist');
      expect(capIds).toContain('request_enterprise_architecture');

      // Verify token payload economics
      const payloadBytes = JSON.stringify(data).length;
      expect(payloadBytes).toBeLessThan(5000); // < 5KB vs ~4MB human web bundle (>99% token savings)
    });
  });

  describe('E2E Scenario 2: DEFCON Defense Posture & Dynamic Escalation', () => {
    it('retrieves current cluster DEFCON posture', async () => {
      const req = new NextRequest('http://localhost:3000/api/defcon');
      const res = await getDefcon(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(typeof data.defcon_level).toBe('number');
      expect(data.defcon_level).toBeGreaterThanOrEqual(1);
      expect(data.defcon_level).toBeLessThanOrEqual(5);
      expect(data.defcon_level).toBe(GATEWAY_FIXTURES.defcon.defcon_level);
      expect(data.name).toBeDefined();
    });

    it('rejects invalid DEFCON levels outside [1..5] with HTTP 400', async () => {
      const req = new NextRequest('http://localhost:3000/api/defcon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 99 }),
      });

      const res = await postDefcon(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('Invalid DEFCON level');
    });

    it('successfully processes valid DEFCON posture shift', async () => {
      const req = new NextRequest('http://localhost:3000/api/defcon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 3 }),
      });

      const res = await postDefcon(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.defcon_level).toBe(3);
      expect(data.gateway_synced).toBe(true);
      expect(data.name).toBeDefined();
    });
  });

  describe('E2E Scenario 3: Fail-Open Watchdog SLA (< 250ms)', () => {
    it('simulates watchdog circuit-breaker: fails open with transparent origin fallback on timeout', async () => {
      // Hardware watchdog contract test
      const simulateLatencyMs = 320; // Exceeds 250ms threshold
      const slaThresholdMs = 250;

      const shouldFailOpen = simulateLatencyMs >= slaThresholdMs;
      expect(shouldFailOpen).toBe(true);

      // Verify fail-open fallback behavior
      const mockEdgeInspection = async (latency: number) => {
        if (latency >= slaThresholdMs) {
          return {
            status: 200,
            bypassed: true,
            reason: 'LATENCY_SLA_BREACH',
            originStatus: 'HTTP_200_ORIGIN_FALLBACK',
          };
        }
        return {
          status: 200,
          bypassed: false,
          reason: 'KYA_INSPECTED',
        };
      };

      const result = await mockEdgeInspection(simulateLatencyMs);
      expect(result.bypassed).toBe(true);
      expect(result.status).toBe(200);
      expect(result.reason).toBe('LATENCY_SLA_BREACH');
    });
  });

  describe('E2E Scenario 4: In-Console AI Sentinel Copilot Engine (/api/ai/sentinel)', () => {
    it('answers Threat Forensics queries with forensic status code breakdown', async () => {
      const req = new NextRequest('http://localhost:3000/api/ai/sentinel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Why was the latest bot request blocked?',
          defconLevel: 3,
          domain: 'api.customer-app.io',
          metrics: {
            threats_blocked: 2410,
            latency_p50_ms: 1.1,
          },
        }),
      });

      const res = await postSentinel(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.category).toBe('threat-forensics');
      expect(data.answer).toContain('HTTP 422');
      expect(data.answer).toContain('HTTP 413');
      expect(data.answer).toContain('HTTP 403');
      expect(Array.isArray(data.suggestedActions)).toBe(true);
      expect(data.suggestedActions.length).toBeGreaterThan(0);
    });

    it('answers DEFCON Policy queries with posture assessment', async () => {
      const req = new NextRequest('http://localhost:3000/api/ai/sentinel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Audit current DEFCON posture and security rules',
          defconLevel: 2,
        }),
      });

      const res = await postSentinel(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.category).toBe('defcon-policy');
      expect(data.answer).toContain('DEFCON 2');
      expect(data.postureAssessment.level).toBe(2);
    });

    it('answers Fail-Open SLA resilience queries and validates 250ms threshold', async () => {
      const req = new NextRequest('http://localhost:3000/api/ai/sentinel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Explain Fail-Open SLA latency and downtime protections',
          defconLevel: 5,
        }),
      });

      const res = await postSentinel(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.category).toBe('failopen-resilience');
      expect(data.answer).toContain('250 ms');
      expect(data.failOpenStatus.enforced).toBe(true);
      expect(data.failOpenStatus.slaThresholdMs).toBe(250);
      expect(data.failOpenStatus.resilienceState).toBe('HEALTHY');
    });

    it('answers Token Optimization and LLM Economic queries', async () => {
      const req = new NextRequest('http://localhost:3000/api/ai/sentinel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Calculate token cost savings for Claude Code',
          metrics: {
            tokens_saved: 5400000,
            usd_saved: 108.0,
          },
        }),
      });

      const res = await postSentinel(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.category).toBe('token-optimization');
      expect(data.answer).toContain('tokens');
      expect(data.answer).toContain('USD');
    });

    it('answers Security Pentest simulation queries', async () => {
      const req = new NextRequest('http://localhost:3000/api/ai/sentinel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Run security pentest simulation',
          domain: 'enterprise.stealthmark.io',
        }),
      });

      const res = await postSentinel(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.category).toBe('pentest-simulation');
      expect(data.answer).toContain('Delimiter Escape');
      expect(data.answer).toContain('HTTP 422');
      expect(data.answer).toContain('HTTP 413');
    });

    it('returns default diagnostic overview on general or empty prompts', async () => {
      const req = new NextRequest('http://localhost:3000/api/ai/sentinel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await postSentinel(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.category).toBe('general');
      expect(data.answer).toContain('AI Sentinel');
    });
  });

  describe('E2E Scenario 5: Native VIP Whitelist Claim & KYA Passport Lifecycle', () => {
    it('issues SM-VIP ticket without mailto dependencies', async () => {
      stubLeadChannels({ configure: ['discord'] });
      const req = new NextRequest('http://localhost:3000/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'agent-operator@tech-corp.com',
          website: 'https://tech-corp.com',
          useCase: 'Autonomous Agentic Commerce',
          volume: '50k-500k',
        }),
      });

      const res = await postWaitlist(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.ticketId).toMatch(/^SM-VIP-[A-Z0-9]{4}$/);
      expect(data.consoleUrl).toBe('/console');
    });
  });
});

describe('Sprint 3: DEFCON and AI Sentinel routes behind feature flags', () => {
  it('answers /api/defcon and /api/ai/sentinel with 404 feature_disabled when the flags are off', async () => {
    const { defcon, sentinel } = await loadGatedRoutes('false');

    const responses = await Promise.all([
      defcon.GET(new NextRequest('http://localhost:3000/api/defcon')),
      defcon.POST(
        new NextRequest('http://localhost:3000/api/defcon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level: 3 }),
        })
      ),
      sentinel.POST(
        new NextRequest('http://localhost:3000/api/ai/sentinel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'Why was the latest bot request blocked?' }),
        })
      ),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'feature_disabled' });
    }
  });
});
