import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase/admin', () => ({ createSupabaseAdminClient: () => null }));

import { GET as auditGet } from '../app/api/scan/audit/route';

function gatewayReport(dns: Array<Record<string, unknown>>) {
  return {
    domain: 'acme.io',
    audited_at: '2026-11-07T00:00:00Z',
    summary: { counts: { pass: 1, warn: 0, fail: 0, info: 1, error: 0 }, by_section: {} },
    sections: {
      transport: [{ id: 'hsts_configured', title: 'HSTS', status: 'pass', detail: 'HSTS set.' }],
      dns,
      crawl_policy: [],
      ai_surface: [],
      headers: [{ id: 'stealthmark_active', title: 'StealthMark Detection', status: 'info', detail: 'Shield headers seen.' }],
    },
    limitations: [],
  };
}

async function scan(report: ReturnType<typeof gatewayReport>, fetchSpy = vi.fn()) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    fetchSpy(url);
    if (url.includes('/api/v2/')) return Response.json(structuredClone(report));
    if (url.includes('internetdb.shodan.io')) return Response.json({ ports: [80, 443], vulns: ['CVE-2023-44487'] });
    if (url.includes('/_next/mcp')) return new Response(null, { status: 404 });
    return new Response('<html></html>', { status: 200 });
  }));
  const res = await auditGet(
    new Request('https://stealthmark.io/api/scan/audit?domain=acme.io&fresh=1', { headers: { 'x-forwarded-for': '203.0.113.9' } }),
  );
  expect(res.status).toBe(200);
  return res.json();
}

describe('scan grade on a Cloudflare-proxied domain', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not fail the domain for CVEs InternetDB lists on a shared Cloudflare edge IP', async () => {
    const fetchSpy = vi.fn();
    const body = await scan(
      gatewayReport([{ id: 'dns_records', title: 'DNS', status: 'pass', detail: 'A: 104.21.33.252' }]),
      fetchSpy,
    );
    const ports = body.sections.dns.find((c: { id: string }) => c.id === 'exposed_ports_and_cves');
    expect(ports.status).toBe('not_assessed');
    expect(ports.detail).toContain('Cloudflare');
    expect(ports.detail).not.toContain('CVE-');
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('internetdb.shodan.io'))).toBe(false);
  });

  it('still reports InternetDB CVEs for an origin IP outside Cloudflare', async () => {
    const body = await scan(gatewayReport([{ id: 'dns_records', title: 'DNS', status: 'pass', detail: 'A: 93.184.216.34' }]));
    const ports = body.sections.dns.find((c: { id: string }) => c.id === 'exposed_ports_and_cves');
    expect(ports.status).toBe('fail');
    expect(ports.detail).toContain('CVE-2023-44487');
  });

  it('leaves the StealthMark detection row out of the evaluated check count', async () => {
    const body = await scan(gatewayReport([{ id: 'dns_records', title: 'DNS', status: 'pass', detail: 'A: 104.21.33.252' }]));
    const rows = Object.values(body.sections as Record<string, unknown[]>).reduce((n, items) => n + items.length, 0);
    expect(body.summary.total_checks).toBe(rows - 1);
  });
});
