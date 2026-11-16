import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientIp, clientNetwork, isValidIpAddress } from '../lib/client-ip';

function request(headers: Record<string, string>): Request {
  return new Request('https://stealthmark.io/api/scan/audit', { headers });
}

describe('clientIp & proxy boundary hardening', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefers CF-Connecting-IP, which Cloudflare overwrites on every proxied request', () => {
    expect(clientIp(request({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1, 203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('takes the last X-Forwarded-For entry, so a client-supplied first entry cannot pick the rate-limit key', () => {
    expect(clientIp(request({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }))).toBe('203.0.113.7');
    expect(clientIp(request({ 'x-forwarded-for': ' 203.0.113.7 , ' }))).toBe('203.0.113.7');
  });

  it('never reads X-Real-IP and returns null when no proxy header names the client', () => {
    expect(clientIp(request({ 'x-real-ip': '1.2.3.4' }))).toBeNull();
    expect(clientIp(request({ 'x-forwarded-for': ' , ' }))).toBeNull();
  });

  it('rejects malformed or comma-joined multi-value CF-Connecting-IP spoofing', () => {
    expect(
      clientIp(
        request({
          'cf-connecting-ip': '1.2.3.4, 5.6.7.8',
          'x-forwarded-for': '1.2.3.4, 203.0.113.42',
        })
      )
    ).toBe('203.0.113.42');

    expect(clientIp(request({ 'cf-connecting-ip': '999.999.999.999' }))).toBeNull();
    expect(clientIp(request({ 'cf-connecting-ip': '0177.0.0.1' }))).toBeNull();
    expect(clientIp(request({ 'cf-connecting-ip': '203.0.113.7:8080' }))).toBeNull();
    expect(clientIp(request({ 'cf-connecting-ip': 'not-an-ip' }))).toBeNull();
    expect(clientIp(request({ 'x-forwarded-for': '1.2.3.4, invalid_ip_hop' }))).toBeNull();
  });

  it('accepts canonical IPv4 and IPv6 addresses and computes /64 network prefixes', () => {
    expect(isValidIpAddress('203.0.113.7')).toBe(true);
    expect(isValidIpAddress('2001:db8:abcd:0012:1:2:3:4')).toBe(true);
    expect(isValidIpAddress('2001:db8::1')).toBe(true);
    expect(isValidIpAddress('::ffff:203.0.113.7')).toBe(true);
    expect(isValidIpAddress('2001:db8::1::2')).toBe(false);
    expect(clientNetwork('2001:db8:abcd:0012:1:2:3:4')).toBe('2001:db8:abcd:12::/64');
  });

  it('requires a coherent CF-Ray header when TRUST_CLOUDFLARE_EDGE=true', () => {
    vi.stubEnv('TRUST_CLOUDFLARE_EDGE', 'true');

    // Spoofed CF-Connecting-IP without CF-Ray is ignored; falls back to trusted proxy hop
    expect(
      clientIp(
        request({
          'cf-connecting-ip': '198.51.100.200',
          'x-forwarded-for': '198.51.100.200, 203.0.113.55',
        })
      )
    ).toBe('203.0.113.55');

    // Coherent CF-Ray + valid CF-Connecting-IP is trusted
    expect(
      clientIp(
        request({
          'cf-connecting-ip': '198.51.100.200',
          'cf-ray': '8e1a2b3c4d5e6f70-EZE',
          'x-forwarded-for': '198.51.100.200, 172.16.0.2',
        })
      )
    ).toBe('198.51.100.200');
  });

  it('ignores CF-Connecting-IP completely when TRUST_CLOUDFLARE_EDGE=false (direct proxy mode)', () => {
    vi.stubEnv('TRUST_CLOUDFLARE_EDGE', 'false');

    expect(
      clientIp(
        request({
          'cf-connecting-ip': '198.51.100.200',
          'cf-ray': '8e1a2b3c4d5e6f70-EZE',
          'x-forwarded-for': '198.51.100.200, 203.0.113.88',
        })
      )
    ).toBe('203.0.113.88');
  });
});
