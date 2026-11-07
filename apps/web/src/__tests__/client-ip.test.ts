import { describe, expect, it } from 'vitest';
import { clientIp } from '../lib/client-ip';

function request(headers: Record<string, string>): Request {
  return new Request('https://stealthmark.io/api/scan/audit', { headers });
}

describe('clientIp', () => {
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
});
