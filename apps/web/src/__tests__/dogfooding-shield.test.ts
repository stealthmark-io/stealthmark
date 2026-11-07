import { afterAll, afterEach, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getManifest } from '../app/api/agent-manifest/route';
import { AGENT_MANIFEST_PAYLOAD } from '../lib/agent-manifest';
import { POST as postWaitlist } from '../app/api/waitlist/route';
import fs from 'fs';
import path from 'path';
import { stubLeadChannels } from './helpers/lead-channels';

describe('Agent manifest and waitlist intake', () => {
  it('serves the agent governance manifest with honest headers', async () => {
    const res = await getManifest();
    expect(res.status).toBe(200);

    expect(res.headers.get('content-type')).toContain('application/agent+json');
    expect(res.headers.get('x-stealthmark-shield')).toBe('ACTIVE');
    expect(res.headers.get('x-stealthmark-route')).toBe('AGENT_MANIFEST');
    expect(res.headers.get('x-stealthmark-owner')).toBeNull();
    expect(res.headers.get('x-stealthmark-latency')).toBeNull();

    const data = await res.json();
    expect(data).toEqual(AGENT_MANIFEST_PAYLOAD);
    expect(data.protocol).toBe('stealthmark_agent_governance_v1');
    expect(data.agent_policy.rate_limit).toBeUndefined();
    expect(data.agent_policy.payload_limit).toBeUndefined();
    expect(Object.keys(data.agent_policy).sort()).toEqual(['conduct', 'identification']);

    const capIds = data.capabilities.map((c: { id: string }) => c.id);
    expect(capIds).toEqual(['audit_website_security', 'join_waitlist', 'request_enterprise_architecture', 'agent_affiliate_bounty_30pct']);

    const serialized = JSON.stringify(data).toLowerCase();
    for (const banned of ['bypass', 'turnstile', 'defcon', 'kya', 'hitl', 'passport', 'pentest', 'sla', '@gmail.com']) {
      expect(serialized).not.toContain(banned);
    }
  });

  it('has a single manifest source: no static copy and no $schema that points at a 404', () => {
    expect(fs.existsSync(path.resolve(__dirname, '../../public/agent-manifest.json'))).toBe(false);
    expect(AGENT_MANIFEST_PAYLOAD).not.toHaveProperty('$schema');
    expect(JSON.stringify(AGENT_MANIFEST_PAYLOAD)).not.toMatch(/if you hold one|agent id/i);
  });

  it('points every capability at stealthmark.io, and the audit at the GET route the scan page uses', async () => {
    for (const capability of AGENT_MANIFEST_PAYLOAD.capabilities) {
      expect(new URL(capability.endpoint).origin).toBe('https://stealthmark.io');
    }
    const audit = AGENT_MANIFEST_PAYLOAD.capabilities.find((capability) => capability.id === 'audit_website_security');
    expect(audit).toMatchObject({ method: 'GET', endpoint: 'https://stealthmark.io/api/scan/audit' });
    expect(Object.keys(audit?.input_schema ?? {})).toEqual(['domain']);
    const route = await import('../app/api/scan/audit/route');
    expect(typeof route.GET).toBe('function');
  });

  describe('Edge middleware running the @stealthmark/next SDK', () => {
    type SiteMiddleware = typeof import('../middleware').default;
    type UsageBatch = { events: Array<{ event_type?: string; agent_identifier?: string; metadata?: Record<string, string> }> };

    const USAGE_API_KEY = 'sk_test_dogfooding_placeholder';
    const fetchMock = vi.fn<typeof fetch>();
    let middleware: SiteMiddleware;
    let siteConfig: typeof import('../middleware').config;

    beforeAll(async () => {
      // The SDK reads STEALTHMARK_API_KEY once, when the middleware module loads.
      vi.stubEnv('STEALTHMARK_API_KEY', USAGE_API_KEY);
      vi.stubGlobal('fetch', fetchMock);
      const loaded = await import('../middleware');
      middleware = loaded.default;
      siteConfig = loaded.config;
    });

    afterAll(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    beforeEach(() => {
      fetchMock.mockReset();
      fetchMock.mockImplementation(async () => new Response(JSON.stringify({ accepted: 1 }), { status: 200 }));
    });

    const request = (pathname: string, headers: Record<string, string> = {}) =>
      new NextRequest(`https://stealthmark.io${pathname}`, { headers: { host: 'stealthmark.io', ...headers } });

    const run = async (req: NextRequest): Promise<Response> => {
      const pending: Promise<unknown>[] = [];
      const res = await middleware(req, {
        waitUntil: (promise) => {
          pending.push(promise);
        },
      });
      await Promise.all(pending);
      if (res === undefined) throw new Error('expected the middleware to return a response');
      return res;
    };

    const meteredEvents = (): UsageBatch['events'] =>
      fetchMock.mock.calls.flatMap(([, init]) => {
        if (typeof init?.body !== 'string') return [];
        const batch: UsageBatch = JSON.parse(init.body);
        return batch.events;
      });

    it('exports only the default middleware and the matcher config', async () => {
      const loaded = await import('../middleware');
      expect(Object.keys(loaded).sort()).toEqual(['config', 'default']);
    });

    it('applies the shield to /api but not to static assets', () => {
      const [matcher] = siteConfig.matcher;
      const pattern = new RegExp(`^${matcher}$`);
      for (const pathname of ['/', '/docs', '/.well-known/agent.json', '/.well-known/ai-plugin.json', '/api/agent-manifest', '/api/waitlist']) {
        expect(pattern.test(pathname)).toBe(true);
      }
      for (const pathname of ['/_next/static/chunk.js', '/_next/image', '/favicon.ico']) {
        expect(pattern.test(pathname)).toBe(false);
      }
    });

    it('answers /api/agent-manifest with the SDK manifest now that /api runs through the middleware', async () => {
      const res = await run(request('/api/agent-manifest'));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/agent+json; charset=utf-8');
      expect(res.headers.get('x-stealthmark-route')).toBe('DUAL_DOOR_AGENT_FASTPATH');
      const manifest = await res.json();
      expect(manifest.capabilities.map((c: { id: string }) => c.id)).toEqual(AGENT_MANIFEST_PAYLOAD.capabilities.map((c) => c.id));
    });

    it('answers the manifest paths with the SDK manifest built from the site capabilities', async () => {
      for (const pathname of ['/.well-known/agent.json', '/.well-known/ai-plugin.json']) {
        const res = await run(request(pathname));
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/agent+json; charset=utf-8');
        expect(res.headers.get('x-stealthmark-route')).toBe('DUAL_DOOR_AGENT_FASTPATH');
        expect(res.headers.get('x-stealthmark-shield')).toBe('ACTIVE');
        expect(res.headers.get('x-stealthmark-agent-policy')).toBe('observe');
        expect(res.headers.get('x-middleware-next')).toBeNull();

        const manifest = await res.json();
        expect(manifest.protocol).toBe('stealthmark_agent_governance_v1');
        expect(manifest.name).toBe(AGENT_MANIFEST_PAYLOAD.name);
        expect(manifest.origin).toBe(AGENT_MANIFEST_PAYLOAD.origin);
        expect(manifest.version).toBe(AGENT_MANIFEST_PAYLOAD.version);
        expect(manifest.agent_policy.mode).toBe('observe');
        expect(manifest).not.toHaveProperty('$schema');

        expect(manifest.capabilities).toHaveLength(AGENT_MANIFEST_PAYLOAD.capabilities.length);
        AGENT_MANIFEST_PAYLOAD.capabilities.forEach((capability, index) => {
          expect(manifest.capabilities[index]).toMatchObject({
            id: capability.id,
            description: capability.description,
            method: capability.method,
            endpoint: capability.endpoint,
            inputSchema: capability.input_schema,
          });
        });
        expect(manifest.capabilities[0].pricing).toBe('free');
        expect(manifest.capabilities[1].pricing).toBeUndefined();
      }
    });

    it('answers Accept: application/agent+json with the manifest on any path', async () => {
      const res = await run(request('/docs', { accept: 'application/agent+json' }));
      expect(res.status).toBe(200);
      expect(res.headers.get('x-stealthmark-route')).toBe('DUAL_DOOR_AGENT_FASTPATH');
      expect((await res.json()).protocol).toBe('stealthmark_agent_governance_v1');
    });

    it('answers the legacy JSON-only Accept on "/" with the full payload in place, without a rewrite, and only there', async () => {
      const root = await run(request('/', { accept: 'application/json' }));
      expect(root.status).toBe(200);
      expect(root.headers.get('x-middleware-rewrite')).toBeNull();
      expect(root.headers.get('content-type')).toContain('application/agent+json');
      expect(root.headers.get('x-stealthmark-route')).toBe('AGENT_MANIFEST');
      expect(root.headers.get('x-stealthmark-shield')).toBe('ACTIVE');
      expect(await root.json()).toEqual(AGENT_MANIFEST_PAYLOAD);

      const docs = await run(request('/docs', { accept: 'application/json' }));
      expect(docs.headers.get('x-middleware-rewrite')).toBeNull();
      expect(docs.headers.get('x-middleware-next')).toBe('1');

      const browser = await run(request('/', { accept: 'text/html,application/json' }));
      expect(browser.headers.get('x-middleware-rewrite')).toBeNull();
      expect(browser.headers.get('x-middleware-next')).toBe('1');
    });

    it('lets a GPTBot request to "/" through, tagged with its agent id', async () => {
      const res = await run(request('/', { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)' }));
      expect(res.headers.get('x-middleware-next')).toBe('1');
      expect(res.headers.get('x-stealthmark-route')).toBeNull();
      expect(res.headers.get('x-stealthmark-agent-detected')).toBe('true');
      expect(res.headers.get('x-stealthmark-agent-id')).toBe('GPTBot');
      expect(res.headers.get('x-stealthmark-shield')).toBe('ACTIVE');
      expect(res.headers.get('x-stealthmark-agent-policy')).toBe('observe');
    });

    it('lets agents that send x-stealthmark-agent read normal pages and tags the response', async () => {
      for (const pathname of ['/docs', '/enterprise/contact', '/robots.txt']) {
        const res = await run(request(pathname, { 'x-stealthmark-agent': 'agt_123' }));
        expect(res.headers.get('x-middleware-next')).toBe('1');
        expect(res.headers.get('x-stealthmark-route')).toBeNull();
        expect(res.headers.get('x-stealthmark-agent-detected')).toBe('true');
        expect(res.headers.get('x-stealthmark-agent-id')).toBe('agt_123');
        expect(res.headers.get('x-stealthmark-shield')).toBe('ACTIVE');
      }
    });

    it('tags known agent user agents without serving the manifest', async () => {
      const res = await run(request('/pricing', { 'user-agent': 'Mozilla/5.0 OpenAI-Operator/1.0' }));
      expect(res.headers.get('x-middleware-next')).toBe('1');
      expect(res.headers.get('x-stealthmark-agent-detected')).toBe('true');
      expect(res.headers.get('x-stealthmark-agent-id')).toBe('OpenAI-Operator');
    });

    it('passes human traffic through untouched except for the CSP, reporting, permissions, edge-shield, shield and policy headers, and meters nothing', async () => {
      const res = await run(request('/', { accept: 'text/html', 'user-agent': 'Mozilla/5.0 Chrome/126.0' }));
      // Next.js consumes the request-override headers and never sends them to the browser.
      const sent = [...res.headers.keys()].filter((name) => !name.startsWith('x-middleware-request-') && name !== 'x-middleware-override-headers');
      expect(sent.sort()).toEqual([
        'content-security-policy',
        'permissions-policy',
        'reporting-endpoints',
        'x-middleware-next',
        'x-stealthmark-agent-policy',
        'x-stealthmark-edge-shield',
        'x-stealthmark-shield',
      ]);
      expect(res.headers.get('reporting-endpoints')).toBe('csp-endpoint="/api/csp-report"');
      expect(res.headers.get('permissions-policy')).toContain('camera=(), microphone=(), geolocation=()');
      expect(res.headers.get('x-stealthmark-edge-shield')).toBe('active; mode=oct2026-hardened');
      expect(res.headers.get('x-middleware-next')).toBe('1');
      expect(res.headers.get('x-stealthmark-shield')).toBe('ACTIVE');
      expect(res.headers.get('x-stealthmark-agent-policy')).toBe('observe');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('gives each page request its own CSP nonce and hands it to Next.js through the request headers', async () => {
      const first = await run(request('/scan', { accept: 'text/html' }));
      const second = await run(request('/scan', { accept: 'text/html' }));
      const nonce = first.headers.get('x-middleware-request-x-nonce') ?? '';
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{16,}={0,2}$/);
      expect(second.headers.get('x-middleware-request-x-nonce')).not.toBe(nonce);

      const csp = first.headers.get('content-security-policy') ?? '';
      expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
      const scriptSrc = (/script-src ([^;]+)/.exec(csp)?.[1] ?? '').split(' ');
      expect(scriptSrc).toEqual(expect.arrayContaining([`'nonce-${nonce}'`, "'strict-dynamic'"]));
    });

    it('meters a GPTBot page request as an agent_request carrying metadata.host', async () => {
      const userAgent = 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)';
      await run(request('/pricing', { 'user-agent': userAgent }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe('https://api.stealthmark.io/v1/usage/ingest');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${USAGE_API_KEY}`);

      const events = meteredEvents();
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('agent_request');
      expect(events[0].agent_identifier).toBe('GPTBot');
      expect(events[0].metadata).toEqual({ path: '/pricing', method: 'GET', host: 'stealthmark.io' });
    });

    it('meters a manifest fetch by an agent as agent_manifest', async () => {
      await run(request('/.well-known/agent.json', { 'user-agent': 'ClaudeBot/1.0' }));

      const events = meteredEvents();
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('agent_manifest');
      expect(events[0].metadata).toEqual({ path: '/.well-known/agent.json', method: 'GET', host: 'stealthmark.io' });
    });

    it('tags the manifest response with the detection headers when an agent fetches it', async () => {
      const res = await run(request('/.well-known/agent.json', { 'user-agent': 'ClaudeBot/1.0' }));

      expect(res.headers.get('x-stealthmark-route')).toBe('DUAL_DOOR_AGENT_FASTPATH');
      expect(res.headers.get('x-stealthmark-agent-detected')).toBe('true');
      expect(res.headers.get('x-stealthmark-agent-id')).toBe('ClaudeBot');
    });

    it('leaves the detection headers off the manifest response for non-agent visitors', async () => {
      const res = await run(request('/.well-known/agent.json', { 'user-agent': 'Mozilla/5.0 Chrome/126.0' }));

      expect(res.headers.get('x-stealthmark-route')).toBe('DUAL_DOOR_AGENT_FASTPATH');
      expect(res.headers.get('x-stealthmark-agent-detected')).toBeNull();
      expect(res.headers.get('x-stealthmark-agent-id')).toBeNull();
    });

    it('sends only usage batches to the ingest endpoint and no other telemetry', async () => {
      await run(request('/pricing', { 'user-agent': 'GPTBot/1.2' }));
      await run(request('/.well-known/agent.json', { 'user-agent': 'ClaudeBot/1.0' }));
      await run(request('/', { accept: 'text/html', 'user-agent': 'Mozilla/5.0 Chrome/126.0' }));

      const urls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(url).toBe('https://api.stealthmark.io/v1/usage/ingest');
      }
    });

    it('reports the Host header, never a client-supplied X-Forwarded-Host', async () => {
      await run(request('/docs', { 'user-agent': 'PerplexityBot/1.0', 'x-forwarded-host': 'evil.example' }));

      expect(meteredEvents()[0].metadata?.host).toBe('stealthmark.io');
    });

    it('keeps the console, admin and login surfaces closed with a 404 (self-serve runs through /scan and /verify)', async () => {
      const closed = [
        '/admin', '/admin/tenants', '/ADMIN', '/console', '/console/x', '/login', '/dashboard', '/dashboard/keys',
        '/auth/callback', '/api/admin/override-plan', '/api/founder/stats', '/api/auth/otp/send', '/api/hitl/approve',
      ];
      for (const pathname of closed) {
        const res = await run(request(pathname));
        expect(res.status, pathname).toBe(404);
        expect(res.headers.get('x-robots-tag'), pathname).toBe('noindex, nofollow');
      }
      for (const pathname of ['/scan', '/verify/example.com', '/administrator-guide', '/dashboards']) {
        const res = await run(request(pathname));
        expect(res.status, pathname).not.toBe(404);
      }
    });
  });

  describe('Early access intake (/api/waitlist)', () => {
    beforeEach(() => {
      stubLeadChannels({ configure: ['discord'] });
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('rejects invalid or empty email payloads with HTTP 400', async () => {
      const req = new Request('https://stealthmark.io/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      });

      const res = await postWaitlist(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Please provide a valid developer email');
    });

    it('captures a valid operator email and issues a ticket', async () => {
      const req = new Request('https://stealthmark.io/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'autonomous.agent@operator.ai' }),
      });

      const res = await postWaitlist(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.status).toBe('EARLY_ACCESS_REGISTERED');
      expect(data.registered_email).toBe('autonomous.agent@operator.ai');
      expect(data.ticket_id).toMatch(/^SM-VIP-/);
      expect(JSON.stringify(data).toLowerCase()).not.toMatch(/kya|passport|whitelist|dual-door|@gmail\.com/);
    });
  });
});
