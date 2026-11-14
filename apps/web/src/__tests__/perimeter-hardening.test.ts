import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { NextFetchEvent } from 'next/server';
import middleware from '../middleware';

function makeRequest(url: string, headers: Record<string, string> = {}, method = 'GET'): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { host: 'stealthmark.io', ...headers },
  });
}

async function runMiddleware(req: NextRequest): Promise<Response> {
  const event = { waitUntil: () => {} } as unknown as NextFetchEvent;
  const res = await middleware(req, event);
  if (!res) throw new Error('Middleware returned no response');
  return res;
}

describe('Edge Shield anti-spoofing and structured observability', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('strips forged internal headers (x-stealthmark-flags, x-nonce, x-stealthmark-threat-score, x-stealthmark-canonical-path, x-forwarded-host, x-real-ip) before recomputing', async () => {
    const req = makeRequest('https://stealthmark.io/pricing', {
      accept: 'text/html',
      'user-agent': 'Mozilla/5.0 Chrome/126.0',
      'x-nonce': 'forged-nonce-value',
      'x-stealthmark-canonical-path': '/forged-canonical-path',
      'x-stealthmark-threat-score': '999',
      'x-stealthmark-flags': 'FORGED_BYPASS_FLAG',
      'x-forwarded-host': 'attacker.evil.example',
      'x-real-ip': '1.2.3.4',
    });

    const res = await runMiddleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-request-x-nonce')).not.toBe('forged-nonce-value');
    expect(res.headers.get('x-middleware-request-x-stealthmark-canonical-path')).toBe('/pricing');
    expect(res.headers.get('x-middleware-request-x-stealthmark-threat-score')).toBe('0');
    expect(res.headers.get('x-middleware-request-x-stealthmark-flags')).toBeNull();
    expect(res.headers.get('x-middleware-request-x-forwarded-host')).toBeNull();
    expect(res.headers.get('x-middleware-request-x-real-ip')).toBeNull();
  });

  it('emits structured JSON telemetry on Layer 1 (400), Layer 2 (403), suspicious (>=40) and perimeter trap (404) events without leaking Authorization or cookies', async () => {
    const secretHeaders = {
      'cf-connecting-ip': '203.0.113.44',
      'cf-ray': '8e99887766554433-EZE',
      'cf-ipcountry': 'AR',
      'user-agent': 'RedTeamScanner/2.1',
      authorization: 'Bearer sk_live_super_secret_token_do_not_leak',
      cookie: 'session_id=top_secret_cookie_value',
    };

    // 1. Layer 1 block (400): IPv6-mapped metadata SSRF + query secret
    const res400 = await runMiddleware(
      makeRequest(
        'https://stealthmark.io/api/proxy?url=http://[::ffff:169.254.169.254]/latest/meta-data/&token=secret_query_token',
        secretHeaders
      )
    );
    expect(res400.status).toBe(400);

    // 2. Layer 2 block (403): Autonomous botnet probe
    const res403 = await runMiddleware(
      makeRequest('https://stealthmark.io/_next/mcp/tools?api_key=leak_me', secretHeaders)
    );
    expect(res403.status).toBe(403);

    // 3. Perimeter trap probe (404): /admin with query secret
    const res404 = await runMiddleware(
      makeRequest('https://stealthmark.io/admin/tenants?secret=admin_query_secret', secretHeaders)
    );
    expect(res404.status).toBe(404);

    // 4. Suspicious request (threatScore >= 40, e.g. double encoding to benign path)
    const resSuspicious = await runMiddleware(
      makeRequest('https://stealthmark.io/%2570ricing?session=secret_qs', {
        ...secretHeaders,
        'sec-ch-ua': '"HeadlessChrome";v="124"',
      })
    );
    expect(resSuspicious.status).toBe(200);

    expect(logSpy).toHaveBeenCalledTimes(4);
    const rawLogs: string[] = logSpy.mock.calls.map((callArgs: unknown[]) => String(callArgs[0]));
    for (const raw of rawLogs) {
      expect(raw).not.toContain('sk_live_super_secret_token_do_not_leak');
      expect(raw).not.toContain('top_secret_cookie_value');
      expect(raw).not.toContain('secret_query_token');
      expect(raw).not.toContain('leak_me');
      expect(raw).not.toContain('admin_query_secret');
      expect(raw).not.toContain('secret_qs');
    }

    const parsed = rawLogs.map((line: string) => JSON.parse(line) as Record<string, unknown>);
    for (const entry of parsed) {
      expect(Object.keys(entry).sort()).toEqual(
        [
          'cfCountry',
          'cfRay',
          'clientIp',
          'clientNet',
          'codes',
          'event',
          'method',
          'path',
          'status',
          'threatScore',
          'ts',
          'ua',
        ].sort()
      );
      expect(entry.clientIp).toBe('203.0.113.44');
      expect(entry.clientNet).toBe('203.0.113.44');
      expect(entry.cfRay).toBe('8e99887766554433-EZE');
      expect(entry.cfCountry).toBe('AR');
      expect(entry.ua).toBe('RedTeamScanner/2.1');
      expect(entry.path).not.toContain('?');
    }

    expect(parsed[0]).toMatchObject({
      event: 'EDGE_SHIELD_LAYER1_BLOCK',
      status: 400,
      path: '/api/proxy',
      codes: expect.arrayContaining(['CLOUD_METADATA_SSRF_PROBE']),
    });
    expect(parsed[1]).toMatchObject({
      event: 'EDGE_SHIELD_LAYER2_BLOCK',
      status: 403,
      path: '/_next/mcp/tools',
      codes: expect.arrayContaining(['NEXTJS_MCP_LEAK_CVE_2026_94486']),
    });
    expect(parsed[2]).toMatchObject({
      event: 'PERIMETER_TRAP_PROBE',
      status: 404,
      path: '/admin/tenants',
      codes: ['PERIMETER_CLOSED_SURFACE'],
    });
    expect(parsed[3]).toMatchObject({
      event: 'EDGE_SHIELD_SUSPICIOUS_REQUEST',
      status: 200,
      threatScore: 45,
    });
  });
});
