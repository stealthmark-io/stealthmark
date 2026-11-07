import { describe, expect, it } from 'vitest';
import { safeNextPath } from '../lib/login-next';

describe('safeNextPath', () => {
  it.each([
    ['/pricing', '/pricing'],
    ['/api/billing/checkout?pack=starter', '/api/billing/checkout?pack=starter'],
    ['/console?tab=api-keys', '/console?tab=api-keys'],
  ])('keeps the same-origin path %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    'https://evil.example/',
    '//evil.example/path',
    '/\\evil.example',
    'javascript:alert(1)',
    'pricing',
    '',
    '/login?next=/pricing',
    '/api/auth/google',
    '/path\r\nSet-Cookie: a=b',
    `/${'a'.repeat(400)}`,
    '/..//evil.com',
    '/.//evil.com',
    '/%2e%2e//evil.com',
    '/.//evil.com?x=1',
  ])('rejects %j', (input) => {
    expect(safeNextPath(input)).toBeNull();
  });

  it('rejects missing values', () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
  });
});
