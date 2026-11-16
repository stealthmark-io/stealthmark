import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TlsProbeResult } from '../lib/security/tls-probe';

vi.mock('node:dns/promises', () => ({
  default: {
    lookup: async () => [{ address: '203.0.113.7', family: 4 }],
  },
  lookup: async () => [{ address: '203.0.113.7', family: 4 }],
}));

vi.mock('../lib/security/network-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/security/network-guard')>()),
  resolvesToPublicAddressesOnly: async () => true,
  resolveDomainIp: async () => '203.0.113.7',
}));

const GOOD_TLS: TlsProbeResult = {
  kind: 'ok',
  observation: {
    leaf: {
      subject: 'acme.io',
      keyType: 'ec',
      bits: 256,
      validTo: Date.parse('2099-01-01'),
      hasOcspUrl: true,
      hasEmbeddedSct: true,
    },
    chain: [
      {
        subject: 'Test CA',
        keyType: 'rsa',
        bits: 2048,
        validTo: Date.parse('2099-01-01'),
        hasOcspUrl: false,
        hasEmbeddedSct: false,
      },
    ],
    ocspStapled: true,
  },
};

vi.mock('../lib/security/tls-probe', () => ({
  probeTls: async () => GOOD_TLS,
}));

import { getLiveDomainPosture } from '../lib/live-domain-posture';
import { SCAN_CHECK_COUNT } from '../lib/readiness-report';

describe('getLiveDomainPosture v6 enrichment', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes('/api/v2/audit')) {
          return Response.json({
            domain: 'acme.io',
            audited_at: '2026-11-13T00:00:00Z',
            summary: { counts: { pass: 45 }, by_section: {} },
            sections: {
              transport: Array.from({ length: 10 }, (_, i) => ({
                id: `gw_t_${i}`,
                section: 'transport',
                title: `GW T ${i}`,
                status: 'pass',
                detail: 'ok',
              })),
              dns: [
                {
                  id: 'exposed_ports_and_cves',
                  section: 'dns',
                  title: 'Exposed ports',
                  status: 'pass',
                  detail: 'ok',
                },
                ...Array.from({ length: 9 }, (_, i) => ({
                  id: `gw_d_${i}`,
                  section: 'dns',
                  title: `GW D ${i}`,
                  status: 'pass',
                  detail: 'ok',
                })),
              ],
              crawl_policy: Array.from({ length: 10 }, (_, i) => ({
                id: `gw_c_${i}`,
                section: 'crawl_policy',
                title: `GW C ${i}`,
                status: 'pass',
                detail: 'ok',
              })),
              ai_surface: Array.from({ length: 5 }, (_, i) => ({
                id: `gw_a_${i}`,
                section: 'ai_surface',
                title: `GW A ${i}`,
                status: 'pass',
                detail: 'ok',
              })),
              headers: Array.from({ length: 10 }, (_, i) => ({
                id: `gw_h_${i}`,
                section: 'headers',
                title: `GW H ${i}`,
                status: 'pass',
                detail: 'ok',
              })),
            },
          });
        }
        if (url.startsWith('https://internetdb.shodan.io/')) {
          return new Response(null, { status: 404 });
        }
        const { pathname } = new URL(url);
        if (pathname !== '/') return new Response(null, { status: 404 });
        return new Response('<html></html>', {
          status: 200,
          headers: {
            'content-type': 'text/html',
            'permissions-policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=()',
            'content-security-policy':
              "default-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; report-uri /csp",
            'cross-origin-opener-policy': 'same-origin',
            'cross-origin-resource-policy': 'same-origin',
            'x-frame-options': 'DENY',
          },
        });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('enriches the 45-check gateway response with Active Shield v2 and v6 checks up to SCAN_CHECK_COUNT (116)', async () => {
    const posture = await getLiveDomainPosture('acme.io');
    expect(posture.valid).toBe(true);
    expect(posture.totalChecks).toBe(SCAN_CHECK_COUNT);
    expect(posture.passCount).toBeGreaterThan(45);
    expect(posture.issueCount).toBe(0);
    expect(['A+', 'A']).toContain(posture.grade);
  });
});
