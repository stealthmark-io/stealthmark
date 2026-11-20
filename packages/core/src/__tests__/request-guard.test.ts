import { describe, it, expect } from 'vitest';
import {
  isHostOrOriginAnomalous,
  isLoopbackHost,
  isNonCanonicalIpHost,
  normalizeAllowedHosts,
  normalizeRequestPath,
} from '../request-guard.js';

describe('@stealthmark/core request-guard', () => {
  it('normalizes percent-encoded paths without false-positiving on %25 literals', () => {
    expect(normalizeRequestPath('/discounts/50%25-off')).toEqual({ pathOnly: '/discounts/50%-off', blocked: false });
    expect(normalizeRequestPath('/items/100%25')).toEqual({ pathOnly: '/items/100%', blocked: false });
    expect(normalizeRequestPath('/%2ewell-known/agent%2ejson')).toEqual({ pathOnly: '/.well-known/agent.json', blocked: false });
    expect(normalizeRequestPath('///.env')).toEqual({ pathOnly: '/.env', blocked: false });
    expect(normalizeRequestPath('/%2500')).toMatchObject({ blocked: true, anomaly: 'NULL_BYTE_INJECTION_CVE_2026_105482' });
    expect(normalizeRequestPath('/api/%ZZ')).toMatchObject({ blocked: true, anomaly: 'MALFORMED_URI_ENCODING' });
  });

  it('detects non-canonical IPs and all loopback variants', () => {
    for (const bad of ['2130706433', '127.1', '127.0.0.01', '127.0.0.0x1', '0177.0.0.1', '0x7f000001']) {
      expect(isNonCanonicalIpHost(bad)).toBe(true);
    }
    for (const lb of ['localhost', 'localhost.', 'sub.localhost', '127.0.0.1', '127.0.0.2', '[::1]', '[0:0:0:0:0:0:0:1]', '[::ffff:127.0.0.1]']) {
      expect(isLoopbackHost(lb)).toBe(true);
    }
    expect(isLoopbackHost('example.com')).toBe(false);
  });

  it('enforces allowedHosts (including bare IPv6) and rejects duplicate or malformed Origin', () => {
    const allow = normalizeAllowedHosts(['::1', 'app.example.com:443']);
    expect(isHostOrOriginAnomalous({ host: '[::1]:3000' }, allow)).toBe(false);
    expect(isHostOrOriginAnomalous({ host: 'app.example.com:443' }, allow)).toBe(false);
    expect(isHostOrOriginAnomalous({ host: 'evil.example' }, allow)).toBe(true);
    expect(isHostOrOriginAnomalous({ host: '127.0.0.1:3000', origin: ['http://localhost:3000, https://evil.example'] })).toBe(true);
  });
});
