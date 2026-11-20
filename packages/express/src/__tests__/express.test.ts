import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  BROTLI_BLOCK_BODY,
  BROTLI_BLOCK_STATUS,
  SAFE_OUTBOUND_ACCEPT_ENCODING,
} from '@stealthmark/core';
import { stealthmarkExpress, type ExpressResponseLike } from '../express.js';
import { stealthmarkFastify, type FastifyReplyLike } from '../fastify.js';
import { negotiatedVary } from '../meter.js';

describe('@stealthmark/express — Express Middleware', () => {
  const config = {
    siteName: 'Acme Express API',
    origin: 'https://api.acme.com',
    capabilities: [
      { id: 'search', endpoint: '/api/search', method: 'GET' as const },
    ],
  };

  it('serves agent manifest on /.well-known/agent.json', () => {
    const middleware = stealthmarkExpress(config);
    const headers: Record<string, string> = {};
    let statusCode = 200;
    let body = '';

    const req = {
      path: '/.well-known/agent.json',
      headers: { host: 'api.acme.com' },
    };

    const res = {
      setHeader: vi.fn((k: string, v: string) => {
        headers[k.toLowerCase()] = v;
      }),
      status: vi.fn((code: number) => {
        statusCode = code;
        return res;
      }),
      send: vi.fn((b: string) => {
        body = b;
      }),
    };

    const next = vi.fn();

    middleware(req, res as unknown as ExpressResponseLike, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusCode).toBe(200);
    expect(headers['content-type']).toContain('application/agent+json');
    expect(headers['x-stealthmark-shield']).toBe('ACTIVE');
    expect(headers['x-stealthmark-agent-detected']).toBeUndefined();

    const parsed = JSON.parse(body);
    expect(parsed.name).toBe('Acme Express API');
    expect(parsed.capabilities).toHaveLength(1);
  });

  it('serves agent manifest on / with Accept: application/agent+json', () => {
    const middleware = stealthmarkExpress(config);
    const headers: Record<string, string> = {};
    let body = '';

    const req = {
      path: '/',
      headers: {
        host: 'api.acme.com',
        accept: 'application/agent+json',
      },
    };

    const res = {
      setHeader: vi.fn((k: string, v: string) => {
        headers[k.toLowerCase()] = v;
      }),
      status: vi.fn(() => res),
      send: vi.fn((b: string) => {
        body = b;
      }),
    };

    const next = vi.fn();

    middleware(req, res as unknown as ExpressResponseLike, next);

    expect(next).not.toHaveBeenCalled();
    expect(headers['content-type']).toContain('application/agent+json');
    expect(headers['x-stealthmark-agent-detected']).toBe('true');
  });

  it('passes through human requests with x-stealthmark-shield header', () => {
    const middleware = stealthmarkExpress(config);
    const headers: Record<string, string> = {};

    const req = {
      path: '/api/users',
      headers: {
        host: 'api.acme.com',
        accept: 'text/html,application/xhtml+xml',
      },
    };

    const res = {
      setHeader: vi.fn((k: string, v: string) => {
        headers[k.toLowerCase()] = v;
      }),
      status: vi.fn(() => res),
      send: vi.fn(),
    };

    const next = vi.fn();

    middleware(req, res as unknown as ExpressResponseLike, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(headers['x-stealthmark-shield']).toBe('ACTIVE');
  });
});

describe('@stealthmark/express — Fastify Plugin', () => {
  const config = {
    siteName: 'Fastify Microservice',
    origin: 'https://fastify.acme.com',
  };

  it('serves manifest on /.well-known/agent.json in Fastify', () => {
    const hook = stealthmarkFastify(config);
    const headers: Record<string, string> = {};
    let sentBody: unknown = null;

    const request = {
      url: '/.well-known/agent.json',
      hostname: 'fastify.acme.com',
      protocol: 'https',
      headers: {},
    };

    const reply = {
      header: vi.fn((k: string, v: string) => {
        headers[k.toLowerCase()] = v;
        return reply;
      }),
      code: vi.fn(() => reply),
      send: vi.fn((payload: unknown) => {
        sentBody = payload;
        return reply;
      }),
    };

    const done = vi.fn();

    hook(request, reply as unknown as FastifyReplyLike, done);

    expect(done).not.toHaveBeenCalled();
    expect(headers['content-type']).toContain('application/agent+json');
    expect(headers['x-stealthmark-agent-detected']).toBeUndefined();
    expect((sentBody as { name: string }).name).toBe('Fastify Microservice');
  });
});

describe('@stealthmark/express — usage metering', () => {
  const config = {
    siteName: 'Metered Express',
    apiKey: 'sk_live_test',
    usageEndpoint: 'https://api.test',
  };

  async function ingestedEvents(): Promise<Array<Record<string, unknown>>> {
    await vi.advanceTimersByTimeAsync(1000);
    return vi
      .mocked(fetch)
      .mock.calls.filter((call) => String(call[0]).endsWith('/v1/usage/ingest'))
      .flatMap((call) => (JSON.parse(String((call[1] as { body: string }).body)) as { events: Array<Record<string, unknown>> }).events);
  }

  function expressRes() {
    const res = {
      setHeader: vi.fn(),
      status: vi.fn(() => res),
      send: vi.fn(),
    };
    return res;
  }

  function fastifyReply() {
    const reply = {
      header: vi.fn(() => reply),
      code: vi.fn(() => reply),
      send: vi.fn(() => reply),
    };
    return reply;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"accepted":1,"rejected":0}', { status: 200 })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('express: records one agent_request for an agent on a normal path and passes through', async () => {
    const middleware = stealthmarkExpress(config);
    const next = vi.fn();
    middleware(
      { path: '/api/items', method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 GPTBot/1.0' } } as never,
      expressRes() as never,
      next
    );

    const events = await ingestedEvents();
    expect(next).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'agent_request',
      metadata: { path: '/api/items', method: 'POST' },
    });
  });

  it('express: records one agent_manifest when an agent fetches the manifest', async () => {
    const middleware = stealthmarkExpress(config);
    middleware(
      { path: '/.well-known/agent.json', headers: { 'x-stealthmark-agent': 'example-agent-v1' } } as never,
      expressRes() as never,
      vi.fn()
    );

    const events = await ingestedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event_type: 'agent_manifest', agent_identifier: 'example-agent-v1' });
  });

  it('express: records one event when an agent hits the root (observed and passed through)', async () => {
    const middleware = stealthmarkExpress(config);
    middleware(
      { path: '/', headers: { 'user-agent': 'ClaudeBot/1.0' } } as never,
      expressRes() as never,
      vi.fn()
    );

    expect(await ingestedEvents()).toHaveLength(1);
  });

  it('express: records nothing for human requests, including a manifest fetch', async () => {
    const middleware = stealthmarkExpress(config);
    const human = { 'user-agent': 'Mozilla/5.0 Chrome/126.0', accept: 'text/html' };
    middleware({ path: '/', headers: human } as never, expressRes() as never, vi.fn());
    middleware({ path: '/.well-known/agent.json', headers: human } as never, expressRes() as never, vi.fn());

    expect(await ingestedEvents()).toHaveLength(0);
  });

  it('fastify: records one agent_request for an agent and none for a human', async () => {
    const hook = stealthmarkFastify(config);
    const done = vi.fn();
    hook(
      { url: '/search?q=1', method: 'GET', headers: { 'user-agent': 'PerplexityBot/1.0' } } as never,
      fastifyReply() as never,
      done
    );
    hook(
      { url: '/search?q=1', method: 'GET', headers: { 'user-agent': 'Mozilla/5.0 Chrome/126.0', accept: 'text/html' } } as never,
      fastifyReply() as never,
      done
    );

    const events = await ingestedEvents();
    expect(done).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'agent_request',
      metadata: { path: '/search', method: 'GET' },
    });
  });

  it('fastify: records agent_manifest once for an agent manifest fetch', async () => {
    const hook = stealthmarkFastify(config);
    hook(
      { url: '/.well-known/ai-plugin.json', headers: { 'x-stealthmark-agent': 'example-agent-v1' } } as never,
      fastifyReply() as never,
      vi.fn()
    );

    const events = await ingestedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('agent_manifest');
  });

  describe('site attribution', () => {
    const SITE_ID = '3f1c2b4e-8a6d-4c1e-9b7a-0d5e6f7a8b9c';
    const ENV_SITE_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
    const attributed = { ...config, siteId: SITE_ID };
    const agent = { 'user-agent': 'Mozilla/5.0 GPTBot/1.0' };

    beforeEach(() => {
      vi.stubEnv('STEALTHMARK_SITE_ID', '');
    });

    it('express: tags the event with site_id and, with trustForwardedHost, the first x-forwarded-host, lowercased and without port', async () => {
      const middleware = stealthmarkExpress({ ...attributed, trustForwardedHost: true });
      middleware(
        {
          path: '/pricing',
          method: 'GET',
          headers: { ...agent, host: 'internal:3000', 'x-forwarded-host': 'Shop.Example.com:443, edge.proxy' },
        } as never,
        expressRes() as never,
        vi.fn()
      );

      const events = await ingestedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event_type: 'agent_request',
        site_id: SITE_ID,
        metadata: { path: '/pricing', method: 'GET', host: 'shop.example.com' },
      });
    });

    it('express: ignores a spoofed x-forwarded-host by default and records the host header', async () => {
      const middleware = stealthmarkExpress(attributed);
      middleware(
        { path: '/a', headers: { ...agent, host: 'Real.Example.com:3000', 'x-forwarded-host': 'attacker.test' } } as never,
        expressRes() as never,
        vi.fn()
      );
      middleware({ path: '/b', headers: { ...agent, 'x-forwarded-host': 'attacker.test' } } as never, expressRes() as never, vi.fn());

      const events = await ingestedEvents();
      expect(events).toHaveLength(2);
      expect(events[0].metadata).toEqual({ path: '/a', method: 'GET', host: 'real.example.com' });
      expect(events[1].metadata).toEqual({ path: '/b', method: 'GET' });
    });

    it('express: reads x-forwarded-host delivered as an array when trustForwardedHost is set', async () => {
      const middleware = stealthmarkExpress({ ...attributed, trustForwardedHost: true });
      middleware(
        { path: '/', headers: { ...agent, 'x-forwarded-host': ['Docs.Example.com', 'other.test'] } } as never,
        expressRes() as never,
        vi.fn()
      );

      expect((await ingestedEvents())[0]).toMatchObject({ metadata: { host: 'docs.example.com' } });
    });

    it('express: falls back to the host header and omits host when none is present', async () => {
      const middleware = stealthmarkExpress(config);
      middleware({ path: '/a', headers: { ...agent, host: 'Blog.Example.com:8080' } } as never, expressRes() as never, vi.fn());
      middleware({ path: '/b', headers: agent } as never, expressRes() as never, vi.fn());

      const events = await ingestedEvents();
      expect(events).toHaveLength(2);
      expect(events[0].metadata).toEqual({ path: '/a', method: 'GET', host: 'blog.example.com' });
      expect(events[1].metadata).toEqual({ path: '/b', method: 'GET' });
      expect(events[1]).not.toHaveProperty('site_id');
    });

    it('express: falls back to STEALTHMARK_SITE_ID', async () => {
      vi.stubEnv('STEALTHMARK_SITE_ID', ENV_SITE_ID);
      const middleware = stealthmarkExpress(config);
      middleware({ path: '/', headers: agent } as never, expressRes() as never, vi.fn());

      expect((await ingestedEvents())[0].site_id).toBe(ENV_SITE_ID);
    });

    it('express: tags agent_manifest events too', async () => {
      const middleware = stealthmarkExpress(attributed);
      middleware(
        { path: '/.well-known/agent.json', headers: { ...agent, host: 'shop.example.com' } } as never,
        expressRes() as never,
        vi.fn()
      );

      expect((await ingestedEvents())[0]).toMatchObject({
        event_type: 'agent_manifest',
        site_id: SITE_ID,
        metadata: { host: 'shop.example.com' },
      });
    });

    it('express: tags agent_blocked events with site_id and host', async () => {
      const middleware = stealthmarkExpress({ ...attributed, agentPolicy: 'block', trustForwardedHost: true });
      const res = expressRes();
      const next = vi.fn();
      middleware(
        { path: '/secret', method: 'POST', headers: { ...agent, 'x-forwarded-host': 'App.Example.com' } } as never,
        res as never,
        next
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
      const events = await ingestedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event_type: 'agent_blocked',
        site_id: SITE_ID,
        metadata: { path: '/secret', method: 'POST', host: 'app.example.com' },
      });
    });

    it('fastify: tags the event with site_id and the request host', async () => {
      const hook = stealthmarkFastify(attributed);
      hook(
        { url: '/search?q=1', method: 'GET', headers: { ...agent, host: 'API.Example.com:3000' } } as never,
        fastifyReply() as never,
        vi.fn()
      );

      const events = await ingestedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event_type: 'agent_request',
        site_id: SITE_ID,
        metadata: { path: '/search', method: 'GET', host: 'api.example.com' },
      });
    });

    it('fastify: ignores a spoofed x-forwarded-host by default and records the host header', async () => {
      const hook = stealthmarkFastify(attributed);
      hook(
        { url: '/a', headers: { ...agent, host: 'Real.Example.com:3000', 'x-forwarded-host': 'attacker.test' } } as never,
        fastifyReply() as never,
        vi.fn()
      );
      hook({ url: '/b', headers: { ...agent, 'x-forwarded-host': 'attacker.test' } } as never, fastifyReply() as never, vi.fn());

      const events = await ingestedEvents();
      expect(events).toHaveLength(2);
      expect(events[0].metadata).toEqual({ path: '/a', method: 'GET', host: 'real.example.com' });
      expect(events[1].metadata).toEqual({ path: '/b', method: 'GET' });
    });

    it('fastify: reads the first x-forwarded-host value when trustForwardedHost is set', async () => {
      const hook = stealthmarkFastify({ ...attributed, trustForwardedHost: true });
      hook(
        { url: '/', headers: { ...agent, host: 'internal:3000', 'x-forwarded-host': 'Shop.Example.com:443, edge.proxy' } } as never,
        fastifyReply() as never,
        vi.fn()
      );

      expect((await ingestedEvents())[0].metadata).toEqual({ path: '/', method: 'GET', host: 'shop.example.com' });
    });

    it('fastify: falls back to STEALTHMARK_SITE_ID', async () => {
      vi.stubEnv('STEALTHMARK_SITE_ID', ENV_SITE_ID);
      const hook = stealthmarkFastify(config);
      hook({ url: '/', headers: agent } as never, fastifyReply() as never, vi.fn());

      expect((await ingestedEvents())[0].site_id).toBe(ENV_SITE_ID);
    });

    it('fastify: tags agent_blocked events with site_id and host', async () => {
      const hook = stealthmarkFastify({ ...attributed, agentPolicy: 'block', trustForwardedHost: true });
      const reply = fastifyReply();
      const done = vi.fn();
      hook({ url: '/secret', method: 'GET', headers: { ...agent, 'x-forwarded-host': 'App.Example.com' } } as never, reply as never, done);

      expect(reply.code).toHaveBeenCalledWith(403);
      expect(done).not.toHaveBeenCalled();
      const events = await ingestedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event_type: 'agent_blocked',
        site_id: SITE_ID,
        metadata: { path: '/secret', method: 'GET', host: 'app.example.com' },
      });
    });
  });

  describe('per-client cap', () => {
    const capped = { ...config, maxAgentEventsPerClientPerHour: 1 };
    const headers = { 'user-agent': 'GPTBot/1.0' };

    async function eventTypes(): Promise<unknown[]> {
      return (await ingestedEvents()).map((event) => event.event_type);
    }

    it('express: keys the cap on req.ip', async () => {
      const middleware = stealthmarkExpress(capped);
      for (const ip of ['203.0.113.7', '203.0.113.7', '203.0.113.8']) {
        middleware({ path: '/a', headers, ip } as never, expressRes() as never, vi.fn());
      }

      expect(await eventTypes()).toEqual(['agent_request', 'agent_capped', 'agent_request']);
    });

    it('express: falls back to the socket address', async () => {
      const middleware = stealthmarkExpress(capped);
      for (const remoteAddress of ['203.0.113.7', '203.0.113.7', '203.0.113.8']) {
        middleware({ path: '/a', headers, socket: { remoteAddress } } as never, expressRes() as never, vi.fn());
      }

      expect(await eventTypes()).toEqual(['agent_request', 'agent_capped', 'agent_request']);
    });

    it('express: a forged X-Forwarded-For does not open a new bucket by default', async () => {
      const middleware = stealthmarkExpress(capped);
      for (const forged of ['198.51.100.1', '198.51.100.2']) {
        middleware(
          { path: '/a', headers: { ...headers, 'x-forwarded-for': forged }, ip: '203.0.113.7' } as never,
          expressRes() as never,
          vi.fn()
        );
      }

      expect(await eventTypes()).toEqual(['agent_request', 'agent_capped']);
    });

    it('express: uses the last X-Forwarded-For hop with trustForwardedFor', async () => {
      const middleware = stealthmarkExpress({ ...capped, trustForwardedFor: true });
      for (const forwarded of ['198.51.100.1, 203.0.113.7', '198.51.100.2, 203.0.113.7', '198.51.100.1, 203.0.113.8']) {
        middleware(
          { path: '/a', headers: { ...headers, 'x-forwarded-for': forwarded }, ip: '192.0.2.1' } as never,
          expressRes() as never,
          vi.fn()
        );
      }

      expect(await eventTypes()).toEqual(['agent_request', 'agent_capped', 'agent_request']);
    });

    it('fastify: keys the cap on request.ip', async () => {
      const hook = stealthmarkFastify(capped);
      for (const ip of ['203.0.113.7', '203.0.113.7', '203.0.113.8']) {
        hook({ url: '/a', method: 'GET', headers, ip } as never, fastifyReply() as never, vi.fn());
      }

      expect(await eventTypes()).toEqual(['agent_request', 'agent_capped', 'agent_request']);
    });
  });
});

describe('@stealthmark/express — agentPolicy "manifest"', () => {
  const config = { siteName: 'Manifest Policy', agentPolicy: 'manifest' as const };
  const agentHeaders = { 'user-agent': 'Mozilla/5.0 GPTBot/1.0', accept: 'text/html' };

  function run(path: string) {
    const headers: Record<string, string> = {};
    const res = {
      setHeader: vi.fn((k: string, v: string) => {
        headers[k.toLowerCase()] = v;
      }),
      status: vi.fn(() => res),
      send: vi.fn(),
    };
    const next = vi.fn();
    stealthmarkExpress(config)({ path, headers: agentHeaders }, res, next);
    return { headers, res, next };
  }

  it('serves the manifest to a detected agent on /', () => {
    const { headers, next } = run('/');
    expect(next).not.toHaveBeenCalled();
    expect(headers['content-type']).toContain('application/agent+json');
    expect(headers['x-stealthmark-agent-detected']).toBe('true');
  });

  it('only replaces the page on /: other paths pass through and are tagged', () => {
    const { headers, next } = run('/pricing');
    expect(next).toHaveBeenCalledTimes(1);
    expect(headers['content-type']).toBeUndefined();
    expect(headers['x-stealthmark-agent-detected']).toBe('true');
  });
});

describe('@stealthmark/express — caching of negotiated responses', () => {
  const agentHeaders = { 'user-agent': 'Mozilla/5.0 GPTBot/1.0', accept: 'text/html' };
  const VARY = 'Accept, User-Agent, x-stealthmark-agent';

  function runExpress(
    config: { siteName: string; agentPolicy?: 'observe' | 'manifest' | 'block' },
    path: string,
    headers: Record<string, string>,
    existingVary?: string
  ) {
    const sent: Record<string, string> = {};
    const res = {
      setHeader: vi.fn((k: string, v: string) => {
        sent[k.toLowerCase()] = v;
      }),
      getHeader: vi.fn((k: string) => (k.toLowerCase() === 'vary' ? existingVary : undefined)),
      status: vi.fn(() => res),
      send: vi.fn(),
    };
    const next = vi.fn();
    stealthmarkExpress(config)({ path, headers }, res, next);
    return { sent, res, next };
  }

  function runFastify(
    config: { siteName: string; agentPolicy?: 'observe' | 'manifest' | 'block' },
    url: string,
    headers: Record<string, string>
  ) {
    const sent: Record<string, string> = {};
    const reply = {
      header: vi.fn((k: string, v: string) => {
        sent[k.toLowerCase()] = v;
        return reply;
      }),
      code: vi.fn(() => reply),
      send: vi.fn(() => reply),
    };
    const done = vi.fn();
    stealthmarkFastify(config)({ url, headers }, reply as unknown as FastifyReplyLike, done);
    return { sent, reply, done };
  }

  it('express: a manifest served on / for Accept: application/agent+json is private and varies on the negotiating headers', () => {
    const { sent, next } = runExpress({ siteName: 'Cache' }, '/', { ...agentHeaders, accept: 'application/agent+json' });
    expect(next).not.toHaveBeenCalled();
    expect(sent['vary']).toBe(VARY);
    expect(sent['cache-control']).toBe('private, no-store');
  });

  it('express: agentPolicy "manifest" on / is private and varies', () => {
    const { sent } = runExpress({ siteName: 'Cache', agentPolicy: 'manifest' }, '/', agentHeaders);
    expect(sent['content-type']).toContain('application/agent+json');
    expect(sent['vary']).toBe(VARY);
    expect(sent['cache-control']).toBe('private, no-store');
  });

  it('express: the fixed manifest path sets neither Vary nor Cache-Control', () => {
    const { sent } = runExpress({ siteName: 'Cache' }, '/.well-known/agent.json', agentHeaders);
    expect(sent['vary']).toBeUndefined();
    expect(sent['cache-control']).toBeUndefined();
  });

  it('express: the block 403 is private and varies', () => {
    const { sent, res } = runExpress({ siteName: 'Cache', agentPolicy: 'block' }, '/pricing', agentHeaders);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(sent['vary']).toBe(VARY);
    expect(sent['cache-control']).toBe('private, no-store');
  });

  it('express: passes ordinary traffic through without touching Vary or Cache-Control', () => {
    const { sent, next } = runExpress({ siteName: 'Cache' }, '/pricing', agentHeaders);
    expect(next).toHaveBeenCalledTimes(1);
    expect(sent['vary']).toBeUndefined();
    expect(sent['cache-control']).toBeUndefined();
  });

  it('express: keeps a Vary value that earlier middleware already set', () => {
    const { sent } = runExpress({ siteName: 'Cache', agentPolicy: 'manifest' }, '/', agentHeaders, 'Accept-Encoding, Origin');
    expect(sent['vary']).toBe('Accept-Encoding, Origin, Accept, User-Agent, x-stealthmark-agent');
  });

  it('fastify: manifest on /, policy "manifest", and the block 403 are private and vary; the fixed path is not touched', () => {
    const negotiated = runFastify({ siteName: 'Cache' }, '/', { ...agentHeaders, accept: 'application/agent+json' });
    expect(negotiated.sent['vary']).toBe(VARY);
    expect(negotiated.sent['cache-control']).toBe('private, no-store');

    const policy = runFastify({ siteName: 'Cache', agentPolicy: 'manifest' }, '/', agentHeaders);
    expect(policy.sent['vary']).toBe(VARY);
    expect(policy.sent['cache-control']).toBe('private, no-store');

    const blocked = runFastify({ siteName: 'Cache', agentPolicy: 'block' }, '/pricing', agentHeaders);
    expect(blocked.reply.code).toHaveBeenCalledWith(403);
    expect(blocked.sent['vary']).toBe(VARY);
    expect(blocked.sent['cache-control']).toBe('private, no-store');

    const fixed = runFastify({ siteName: 'Cache' }, '/.well-known/agent.json', agentHeaders);
    expect(fixed.sent['vary']).toBeUndefined();
    expect(fixed.sent['cache-control']).toBeUndefined();
  });

  describe('negotiatedVary', () => {
    it('adds the negotiating headers to an empty Vary', () => {
      expect(negotiatedVary(undefined)).toBe(VARY);
    });

    it('does not duplicate headers already present, whatever their case, and accepts an array', () => {
      expect(negotiatedVary(['accept', 'Origin'])).toBe('accept, Origin, User-Agent, x-stealthmark-agent');
      expect(negotiatedVary('USER-AGENT')).toBe('USER-AGENT, Accept, x-stealthmark-agent');
    });

    it('leaves Vary: * as it is', () => {
      expect(negotiatedVary('*')).toBe('*');
    });
  });

  describe('CVE-2026-111497 inbound brotli payload guard', () => {
    const baseConfig = { siteName: 'BrotliGuardTest' };

    describe('Express', () => {
      it.each(['br', 'gzip, br', 'x-brotli'])(
        'blocks inbound brotli payload (%s) with 415 and does not invoke next()',
        (encoding) => {
          const sent: Record<string, string> = {};
          let statusCode = 0;
          let body = '';
          const res = {
            setHeader: vi.fn((k: string, v: string) => {
              sent[k.toLowerCase()] = v;
            }),
            status: vi.fn((code: number) => {
              statusCode = code;
              return res;
            }),
            send: vi.fn((b: string) => {
              body = b;
            }),
          };
          const next = vi.fn();
          const middleware = stealthmarkExpress(baseConfig);

          middleware(
            {
              path: '/api/upload',
              headers: {
                host: 'api.acme.com',
                'content-encoding': encoding,
              },
            },
            res as unknown as ExpressResponseLike,
            next
          );

          expect(next).not.toHaveBeenCalled();
          expect(statusCode).toBe(BROTLI_BLOCK_STATUS);
          expect(sent['content-type']).toBe('application/json; charset=utf-8');
          expect(sent['accept-encoding']).toBe(SAFE_OUTBOUND_ACCEPT_ENCODING);
          expect(sent['cache-control']).toBe('no-store');
          expect(JSON.parse(body)).toEqual(BROTLI_BLOCK_BODY);
        }
      );

      it('allows safe gzip encoding to pass normally to next()', () => {
        const sent: Record<string, string> = {};
        const res = {
          setHeader: vi.fn((k: string, v: string) => {
            sent[k.toLowerCase()] = v;
          }),
          status: vi.fn(() => res),
          send: vi.fn(),
        };
        const next = vi.fn();
        const middleware = stealthmarkExpress(baseConfig);

        middleware(
          {
            path: '/api/upload',
            headers: {
              host: 'api.acme.com',
              'content-encoding': 'gzip',
            },
          },
          res as unknown as ExpressResponseLike,
          next
        );

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalledWith(415);
      });
    });

    describe('Fastify', () => {
      it.each(['br', 'gzip, br', 'x-brotli'])(
        'blocks inbound brotli payload (%s) with 415 and does not invoke done()',
        (encoding) => {
          const sent: Record<string, string> = {};
          let statusCode = 0;
          let payloadSent: unknown = null;
          const reply = {
            header: vi.fn((k: string, v: string) => {
              sent[k.toLowerCase()] = v;
              return reply;
            }),
            code: vi.fn((code: number) => {
              statusCode = code;
              return reply;
            }),
            send: vi.fn((payload: unknown) => {
              payloadSent = payload;
              return reply;
            }),
          };
          const done = vi.fn();
          const hook = stealthmarkFastify(baseConfig);

          hook(
            {
              url: '/api/upload',
              headers: {
                host: 'api.acme.com',
                'content-encoding': encoding,
              },
            },
            reply as unknown as FastifyReplyLike,
            done
          );

          expect(done).not.toHaveBeenCalled();
          expect(statusCode).toBe(BROTLI_BLOCK_STATUS);
          expect(sent['content-type']).toBe('application/json; charset=utf-8');
          expect(sent['accept-encoding']).toBe(SAFE_OUTBOUND_ACCEPT_ENCODING);
          expect(sent['cache-control']).toBe('no-store');
          expect(payloadSent).toEqual(BROTLI_BLOCK_BODY);
        }
      );

      it('allows safe gzip encoding to pass normally to done()', () => {
        const sent: Record<string, string> = {};
        const reply = {
          header: vi.fn((k: string, v: string) => {
            sent[k.toLowerCase()] = v;
            return reply;
          }),
          code: vi.fn(() => reply),
          send: vi.fn(() => reply),
        };
        const done = vi.fn();
        const hook = stealthmarkFastify(baseConfig);

        hook(
          {
            url: '/api/upload',
            headers: {
              host: 'api.acme.com',
              'content-encoding': 'gzip',
            },
          },
          reply as unknown as FastifyReplyLike,
          done
        );

        expect(done).toHaveBeenCalledTimes(1);
        expect(reply.code).not.toHaveBeenCalledWith(415);
      });
    });
  });

  describe('CVE-2026-126755 parser differential & CVE-2026-76807 DNS rebinding guards', () => {
    it('normalizes percent-encoded and double-slashed manifest paths before routing in Express and Fastify', () => {
      for (const encodedPath of [
        '/%2ewell-known/agent%2ejson',
        '///.well-known//agent.json/',
        '/api/agent%2dmanifest',
      ]) {
        const expRes = runExpress({ siteName: 'Norm' }, encodedPath, {});
        expect(expRes.res.status).toHaveBeenCalledWith(200);
        expect(expRes.next).not.toHaveBeenCalled();

        const fastRes = runFastify({ siteName: 'Norm' }, encodedPath, {});
        expect(fastRes.reply.code).toHaveBeenCalledWith(200);
        expect(fastRes.done).not.toHaveBeenCalled();
      }
    });

    it('blocks NUL byte injection, malformed percent-encoding, and loopback DNS rebinding with 400', () => {
      for (const badPath of ['/api/data%00.json', '/api/%E0%A4%A']) {
        const expBad = runExpress({ siteName: 'Norm' }, badPath, {});
        expect(expBad.res.status).toHaveBeenCalledWith(400);
        expect(expBad.next).not.toHaveBeenCalled();

        const fastBad = runFastify({ siteName: 'Norm' }, badPath, {});
        expect(fastBad.reply.code).toHaveBeenCalledWith(400);
        expect(fastBad.done).not.toHaveBeenCalled();
      }

      const rebindHeaders = {
        host: '127.0.0.1:3001',
        origin: 'https://evil.attacker.invalid',
      };
      const expRebind = runExpress({ siteName: 'Norm' }, '/api/test', rebindHeaders);
      expect(expRebind.res.status).toHaveBeenCalledWith(400);
      expect(expRebind.next).not.toHaveBeenCalled();

      const fastRebind = runFastify({ siteName: 'Norm' }, '/api/test', rebindHeaders);
      expect(fastRebind.reply.code).toHaveBeenCalledWith(400);
      expect(fastRebind.done).not.toHaveBeenCalled();

      // Origin: null from a sandboxed iframe against loopback must also be rejected
      const nullOriginHeaders = { host: '127.0.0.1:3001', origin: 'null' };
      expect(runExpress({ siteName: 'Norm' }, '/api/test', nullOriginHeaders).res.status).toHaveBeenCalledWith(400);
      expect(runFastify({ siteName: 'Norm' }, '/api/test', nullOriginHeaders).reply.code).toHaveBeenCalledWith(400);

      // IPv6 loopback with Origin: null or foreign Origin
      const ipv6NullHeaders = { host: '[::1]:3001', origin: 'null' };
      expect(runExpress({ siteName: 'Norm' }, '/api/test', ipv6NullHeaders).res.status).toHaveBeenCalledWith(400);
      expect(runFastify({ siteName: 'Norm' }, '/api/test', ipv6NullHeaders).reply.code).toHaveBeenCalledWith(400);

      // Genuine DNS rebinding (attacker Host + matching attacker Origin) blocked when allowedHosts is configured
      const strictConfig = { siteName: 'Norm', allowedHosts: ['127.0.0.1:3001', 'localhost:3001', '[::1]:3001'] };
      const dnsRebindHeaders = { host: 'rebind.attacker.invalid:3001', origin: 'http://rebind.attacker.invalid:3001' };
      expect(runExpress(strictConfig, '/api/test', dnsRebindHeaders).res.status).toHaveBeenCalledWith(400);
      expect(runFastify(strictConfig, '/api/test', dnsRebindHeaders).reply.code).toHaveBeenCalledWith(400);

      // Missing Host fails closed when allowedHosts is configured
      expect(runExpress(strictConfig, '/api/test', {}).res.status).toHaveBeenCalledWith(400);
      expect(runFastify(strictConfig, '/api/test', {}).reply.code).toHaveBeenCalledWith(400);

      // Allowed host passes through normally (including bare IPv6 '::1' in allowedHosts)
      const allowedHeaders = { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3001' };
      const expOk = runExpress(strictConfig, '/api/test', allowedHeaders);
      expect(expOk.next).toHaveBeenCalledTimes(1);
      const fastOk = runFastify(strictConfig, '/api/test', allowedHeaders);
      expect(fastOk.done).toHaveBeenCalledTimes(1);

      const ipv6AllowCfg = { siteName: 'Norm', allowedHosts: ['::1'] };
      expect(runExpress(ipv6AllowCfg, '/api/test', { host: '[::1]:3001' }).next).toHaveBeenCalledTimes(1);
      expect(runFastify(ipv6AllowCfg, '/api/test', { host: '[::1]:3001' }).done).toHaveBeenCalledTimes(1);

      // Legitimate encoded percent literals (%25) must NOT trigger MALFORMED_URI_ENCODING
      for (const pctPath of ['/discounts/50%25-off', '/items/100%25']) {
        expect(runExpress({ siteName: 'Norm' }, pctPath, {}).next).toHaveBeenCalledTimes(1);
        expect(runFastify({ siteName: 'Norm' }, pctPath, {}).done).toHaveBeenCalledTimes(1);
      }

      // Non-canonical IPv4 and expanded/wildcard loopback variants must be blocked
      for (const badHost of ['2130706433', '127.1', '127.0.0.01', '127.0.0.0x1', '']) {
        expect(runExpress({ siteName: 'Norm' }, '/api/test', { host: badHost }).res.status).toHaveBeenCalledWith(400);
      }
      for (const loopbackHost of ['sub.localhost:3001', 'localhost.:3001', '[0:0:0:0:0:0:0:1]:3001', '[::ffff:127.0.0.1]:3001']) {
        expect(
          runExpress({ siteName: 'Norm' }, '/api/test', { host: loopbackHost, origin: 'https://evil.invalid' }).res.status
        ).toHaveBeenCalledWith(400);
      }
      // Duplicate Origin array cannot bypass loopback guard
      expect(
        runExpress({ siteName: 'Norm' }, '/api/test', {
          host: '127.0.0.1:3001',
          origin: ['http://localhost:3000/x', 'https://evil.invalid'] as unknown as string,
        }).res.status
      ).toHaveBeenCalledWith(400);
    });
  });
});
