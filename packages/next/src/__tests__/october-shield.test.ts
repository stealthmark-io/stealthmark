import { describe, it, expect } from 'vitest';
import {
  normalizeStructuralPath,
  sanitizeAndNormalizeRequest,
  validateMcpPayloadAndToken,
} from '../october-shield.js';

describe('sanitizeAndNormalizeRequest: non-canonical IP detection', () => {
  it.each(['/products/007', '/blog/2026/01/hello', '/v1/items/05', '/docs/0x1f', '/orders/0012/invoice'])(
    'lets the ordinary path %s through',
    (path) => {
      const res = sanitizeAndNormalizeRequest(path, 'shop.example.com');
      expect(res.isBlocked).toBe(false);
      expect(res.anomalies).not.toContain('NON_CANONICAL_IP_FORMAT_SSRF');
    }
  );

  it.each(['shop.example.com', 'localhost:3000', '127.0.0.1:3000', '[::1]:3000'])(
    'allows legitimate incoming Host header %s for ordinary paths',
    (host) => {
      const res = sanitizeAndNormalizeRequest('/orders/42', host);
      expect(res.isBlocked).toBe(false);
    }
  );

  it.each(['0177.0.0.1', '0x7f000001', '0x7f.0.0.1:8080', '127.0.0.0x1', '2130706433', '[::ffff:a9fe:a9fe]', '100.100.100.200'])(
    'blocks the non-canonical or metadata host %s',
    (host) => {
      const res = sanitizeAndNormalizeRequest('/', host);
      expect(res.isBlocked).toBe(true);
    }
  );

  it.each([
    '/fetch?url=http://0177.0.0.1/admin',
    '/proxy/http%3A%2F%2F0x7f000001%2F',
    '/go?to=//0x7f.0.0.1:22',
    '/fetch?url=http://[::ffff:a9fe:a9fe]/latest/meta-data/',
    '/fetch?url=http://2852039166/latest/meta-data/',
    '/fetch?url=http://100.100.100.200/latest/meta-data/',
    '/fetch?url=http://user:pass@0177.0.0.1/admin',
    '/fetch?url=http://127.0.0.0x1/admin',
  ])('blocks a path that carries an octal, hex, decimal, userinfo, or metadata URL: %s', (path) => {
    const res = sanitizeAndNormalizeRequest(path, 'shop.example.com');
    expect(res.isBlocked).toBe(true);
  });
});

describe('normalizeStructuralPath', () => {
  it('collapses UUIDs, ULIDs, >=16-char hex hashes, >=5-digit ints, and collection-noun ints to :id', () => {
    expect(normalizeStructuralPath('/users/550e8400-e29b-41d4-a716-446655440000/profile')).toBe(
      '/users/:id/profile'
    );
    expect(normalizeStructuralPath('/invoices/01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe('/invoices/:id');
    expect(normalizeStructuralPath('/tx/0123456789abcdef0123456789abcdef')).toBe('/tx/:id');
    expect(normalizeStructuralPath('/records/12345/details')).toBe('/records/:id/details');
    expect(normalizeStructuralPath('/orders/8491')).toBe('/orders/:id');
    expect(normalizeStructuralPath('/Pedidos/42/facturas/7')).toBe('/Pedidos/:id/facturas/:id');
  });

  it('strips full URLs, query strings, hashes, and empty segments while collapsing IDs', () => {
    expect(normalizeStructuralPath('/orders/42?foo=bar#baz')).toBe('/orders/:id');
    expect(normalizeStructuralPath('/orders//42')).toBe('/orders/:id');
    expect(normalizeStructuralPath('https://shop.example/orders/42?foo=bar#baz')).toBe('/orders/:id');
    expect(normalizeStructuralPath('/')).toBe('/');
    expect(normalizeStructuralPath('')).toBe('/');
  });

  it('preserves version prefixes and blog dates', () => {
    expect(normalizeStructuralPath('/v1/items')).toBe('/v1/items');
    expect(normalizeStructuralPath('/v2/products')).toBe('/v2/products');
    expect(normalizeStructuralPath('/v3/health')).toBe('/v3/health');
    expect(normalizeStructuralPath('/blog/2026/01/hello')).toBe('/blog/2026/01/hello');
  });
});

describe('validateMcpPayloadAndToken', () => {
  const AUD = 'https://stealthmark.io/api/mcp';
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const validHeader = b64({ alg: 'EdDSA', typ: 'JWT' });
  const validPayload = b64({ sub: 'agent-1', aud: AUD });

  it('rejects alg: none and malformed bearer tokens', () => {
    const algNone = `Bearer ${b64({ alg: 'none', typ: 'JWT' })}.${validPayload}.sig`;
    expect(validateMcpPayloadAndToken('{"jsonrpc":"2.0"}', algNone, { expectedAudience: AUD })).toEqual({
      valid: false,
      reason: 'MALFORMED_BEARER_TOKEN',
    });

    for (const bad of [
      'bearer not-a-jwt',
      'Bearer a.b',
      'Bearer a.b.c.d',
      'Bearer ',
      'Bearer a.b!.c',
      'Basic dXNlcjpwYXNz',
      `${validHeader}.${validPayload}.sig`,
    ]) {
      expect(validateMcpPayloadAndToken('{"jsonrpc":"2.0"}', bad, { expectedAudience: AUD })).toEqual({
        valid: false,
        reason: 'MALFORMED_BEARER_TOKEN',
      });
    }
  });

  it('validates aud claim as string or non-empty string array', () => {
    expect(
      validateMcpPayloadAndToken('{"jsonrpc":"2.0"}', `bearer ${validHeader}.${validPayload}.sig`, {
        expectedAudience: AUD,
      })
    ).toEqual({ valid: true });

    const arrayAudPayload = b64({ sub: 'agent-1', aud: ['https://other.test', AUD] });
    expect(
      validateMcpPayloadAndToken('{"jsonrpc":"2.0"}', `Bearer ${validHeader}.${arrayAudPayload}.sig`, {
        expectedAudience: AUD,
      })
    ).toEqual({ valid: true });

    const wrongAudPayload = b64({ sub: 'agent-1', aud: 'https://wrong.test' });
    expect(
      validateMcpPayloadAndToken('{"jsonrpc":"2.0"}', `Bearer ${validHeader}.${wrongAudPayload}.sig`, {
        expectedAudience: AUD,
      })
    ).toEqual({
      valid: false,
      reason: 'MCP_INVALID_TOKEN_AUDIENCE_CVE_2026_111771',
    });

    const missingAudPayload = b64({ sub: 'agent-1' });
    expect(
      validateMcpPayloadAndToken('{"jsonrpc":"2.0"}', `Bearer ${validHeader}.${missingAudPayload}.sig`, {
        expectedAudience: AUD,
      })
    ).toEqual({
      valid: false,
      reason: 'MCP_INVALID_TOKEN_AUDIENCE_CVE_2026_111771',
    });
  });

  it('blocks excessive numeric literals inside JSON arrays (CVE-2026-18401)', () => {
    const arrayPayload = JSON.stringify({ values: [1, 2] }).replace('2', '9'.repeat(64));
    expect(validateMcpPayloadAndToken(arrayPayload, null, { expectedAudience: AUD })).toEqual({
      valid: false,
      reason: 'JSON_ASYNC_PARSER_DOS_CVE_2026_18401',
    });
  });

  it('blocks private network, IPv6-mapped, CGNAT, userinfo, non-canonical, and escaped SSRF URLs unless disabled', () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://127.0.0.1:8080/admin',
      'http://localhost/internal',
      'http://localhost./internal',
      'http://10.0.0.5/secret',
      'http://192.168.1.10/status',
      'http://172.16.0.1/metrics',
      'http://0177.0.0.1/admin',
      'http://[::ffff:127.0.0.1]/admin',
      'http://[::ffff:7f00:1]/admin',
      'http://[::ffff:a9fe:a9fe]/latest/meta-data/',
      'http://[::127.0.0.1]/admin',
      'http://[fd0::254]/latest/meta-data/',
      'http://[fe8::1]/',
      'http://100.100.100.200/latest/meta-data/',
      'http://user:pass@shop.example/api',
      'http://user:pass@127.0.0.1/admin',
      'http://127.0.0.0x1/admin',
      'http://2130706433/admin',
      'http://2852039166/latest/meta-data/',
      'http://0xa9fea9fe/latest/meta-data/',
      '//127.0.0.1/admin',
    ]) {
      expect(
        validateMcpPayloadAndToken(JSON.stringify({ url }), null, { expectedAudience: AUD }),
        url
      ).toEqual({
        valid: false,
        reason: 'MCP_TOOL_INPUT_SSRF_BLOCKED',
      });
    }

    for (const rawJson of [
      '{"url":"http:\\/\\/127.0.0.1/admin"}',
      '{"url":"http:\\u002f\\u002f127.0.0.1/admin"}',
      '{"url":"http://local\\u0068ost/admin"}',
      '{"url":"http://metadata.google\\u002einternal/"}',
      '{"url":"http://\\u003127.0.0.1/admin"}',
    ]) {
      expect(validateMcpPayloadAndToken(rawJson, null, { expectedAudience: AUD }), rawJson).toEqual({
        valid: false,
        reason: 'MCP_TOOL_INPUT_SSRF_BLOCKED',
      });
    }

    expect(
      validateMcpPayloadAndToken(JSON.stringify({ url: 'https://shop.example/a//b', path: '///relative' }), null, {
        expectedAudience: AUD,
      })
    ).toEqual({ valid: true });

    expect(
      validateMcpPayloadAndToken(JSON.stringify({ url: 'http://127.0.0.1/local' }), null, {
        expectedAudience: AUD,
        blockPrivateNetworkUrls: false,
      })
    ).toEqual({ valid: true });
  });

  it('enforces tool schema SHA-256 pinning case-insensitively and rejects empty expected pins', () => {
    const pin = 'a'.repeat(64);
    expect(
      validateMcpPayloadAndToken('{"jsonrpc":"2.0"}', null, {
        expectedAudience: AUD,
        expectedSchemaSha256: pin,
        actualSchemaSha256: 'b'.repeat(64),
      })
    ).toEqual({
      valid: false,
      reason: 'MCP_TOOL_SCHEMA_PIN_MISMATCH',
    });

    expect(
      validateMcpPayloadAndToken('{"jsonrpc":"2.0"}', null, {
        expectedAudience: AUD,
        expectedSchemaSha256: '   ',
        actualSchemaSha256: '   ',
      })
    ).toEqual({
      valid: false,
      reason: 'MCP_TOOL_SCHEMA_PIN_MISMATCH',
    });

    expect(
      validateMcpPayloadAndToken('{"jsonrpc":"2.0"}', null, {
        expectedAudience: AUD,
        expectedSchemaSha256: ` ${pin.toUpperCase()} `,
        actualSchemaSha256: pin,
      })
    ).toEqual({ valid: true });
  });
});
