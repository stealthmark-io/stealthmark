import { describe, it, expect } from 'vitest';
import { sanitizeAndNormalizeRequest } from '../october-shield.js';

describe('sanitizeAndNormalizeRequest: non-canonical IP detection', () => {
  it.each(['/products/007', '/blog/2026/01/hello', '/v1/items/05', '/docs/0x1f', '/orders/0012/invoice'])(
    'lets the ordinary path %s through',
    (path) => {
      const res = sanitizeAndNormalizeRequest(path, 'shop.example.com');
      expect(res.isBlocked).toBe(false);
      expect(res.anomalies).not.toContain('NON_CANONICAL_IP_FORMAT_SSRF');
    }
  );

  it.each(['0177.0.0.1', '0x7f000001', '0x7f.0.0.1:8080'])('blocks the octal or hex host %s', (host) => {
    const res = sanitizeAndNormalizeRequest('/', host);
    expect(res.isBlocked).toBe(true);
    expect(res.anomalies).toContain('NON_CANONICAL_IP_FORMAT_SSRF');
  });

  it.each(['/fetch?url=http://0177.0.0.1/admin', '/proxy/http%3A%2F%2F0x7f000001%2F', '/go?to=//0x7f.0.0.1:22'])(
    'blocks a path that carries an octal or hex URL: %s',
    (path) => {
      const res = sanitizeAndNormalizeRequest(path, 'shop.example.com');
      expect(res.isBlocked).toBe(true);
      expect(res.anomalies).toContain('NON_CANONICAL_IP_FORMAT_SSRF');
    }
  );
});
