import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase/admin', () => ({ createSupabaseAdminClient: () => null }));

import { GET as auditGet } from '../app/api/scan/audit/route';
import { owaspGateFor } from '../lib/owasp-gates';

const GATEWAY_REPORT = {
  domain: 'acme.io',
  audited_at: '2026-10-26T00:00:00Z',
  summary: { counts: { pass: 1, warn: 0, fail: 1, info: 1, error: 0 }, by_section: {} },
  sections: {
    transport: [
      { id: 'hsts_configured', title: 'HSTS', status: 'fail', detail: 'No Strict-Transport-Security header.', recommendation: 'Send HSTS.' },
    ],
    dns: [{ id: 'exposed_ports_and_cves', title: 'Exposed ports and CVEs', status: 'pass', detail: 'No critical ports.' }],
    crawl_policy: [],
    ai_surface: [{ id: 'llms_txt', title: '/llms.txt', status: 'info', detail: 'No /llms.txt.' }],
    headers: [],
  },
  limitations: [],
};

describe('OWASP gates on the audit report', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tags each check with its gate, keeps it on the open finding with its fix and leaves checks outside OWASP untagged', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/api/v2/')) return Response.json(structuredClone(GATEWAY_REPORT));
      if (url.includes('/_next/mcp')) return new Response(null, { status: 404 });
      return new Response('<html></html>', { status: 200, headers: { 'x-stealthmark-shield': 'active', 'x-frame-options': 'DENY' } });
    }));
    const res = await auditGet(
      new Request('https://stealthmark.io/api/scan/audit?domain=acme.io&fresh=1', { headers: { 'x-forwarded-for': '203.0.113.9' } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    const hsts = body.sections.transport[0];
    expect(hsts.locked).not.toBe(true);
    expect(hsts.recommendation).toBe('Send HSTS.');
    expect(hsts.owaspGate).toEqual({
      code: 'A04:2025',
      gate: 4,
      label: { en: 'Gate 4: Cryptographic Failures', es: 'Puerta 4: Fallas Criptográficas' },
    });
    expect(body.sections.dns[0].owaspGate.code).toBe('A02:2025');
    expect(body.sections.ai_surface[0].owaspGate).toBeNull();
  });

  it('gives no gate to an id it does not know', () => {
    expect(owaspGateFor('constructor')).toBeNull();
    expect(owaspGateFor('')).toBeNull();
  });
});
