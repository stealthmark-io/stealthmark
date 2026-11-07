import { describe, it, expect, vi } from 'vitest';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomBytes: vi.fn(() => Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')),
  };
});

import { generateApiKey, hashApiKey } from '../lib/api-keys';
import { resolveActiveApiKey, type ApiKeyWithSecret } from '../app/dashboard/views/dashboard-helpers';

const FIXED_KEY = 'sk_live_000102030405060708090a0b0c0d0e0f';
const FIXED_KEY_HASH = 'ce9baf6cf5e39d52066ca08ac5bbae24c03e50c1fae7192e0729e790b8810c90';
const HASH_VECTOR_KEY = 'sk_live_0123456789abcdef0123456789abcdef';
const HASH_VECTOR = '0dd9d97a3da0cbadcbce40a79d539c8a79745dae25b2c85bdefc9a44b219663e';

describe('API key format contract (mirrored by apps/api/src/__tests__/api-keys-contract.test.ts)', () => {
  it('produces the exact fixed vector for deterministic random bytes', () => {
    expect(generateApiKey()).toEqual({
      key: FIXED_KEY,
      keyHash: FIXED_KEY_HASH,
      keyPrefix: 'sk_live_0001...0e0f',
    });
  });

  it('uses the sk_live_ prefix, 40 characters and a lowercase hex body', () => {
    const { key } = generateApiKey();
    expect(key).toMatch(/^sk_live_[0-9a-f]{32}$/);
    expect(key).toHaveLength(40);
  });

  it('shapes keyPrefix as prefix + first 4 hex + "..." + last 4 hex', () => {
    expect(generateApiKey().keyPrefix).toMatch(/^sk_live_[0-9a-f]{4}\.\.\.[0-9a-f]{4}$/);
  });

  it('honours a custom prefix without changing the body or hash rule', () => {
    const custom = generateApiKey('sk_test_');
    expect(custom.key).toBe('sk_test_000102030405060708090a0b0c0d0e0f');
    expect(custom.keyPrefix).toBe('sk_test_0001...0e0f');
    expect(custom.keyHash).toBe(hashApiKey(custom.key));
  });

  it('hashes with SHA-256 hex against a fixed vector', () => {
    expect(hashApiKey(HASH_VECTOR_KEY)).toBe(HASH_VECTOR);
    expect(hashApiKey(HASH_VECTOR_KEY)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('resolveActiveApiKey never synthesizes a key', () => {
  const base: ApiKeyWithSecret = {
    id: 'k1',
    name: 'Production',
    keyPrefix: 'sk_live_0001...0e0f',
    scopes: ['*'],
    rateLimitRpm: 120,
    createdAt: '2026-09-30T00:00:00.000Z',
    lastUsedAt: null,
    status: 'active',
  };

  it('returns null when there are no keys', () => {
    expect(resolveActiveApiKey([])).toBeNull();
  });

  it('returns null when the console only knows key prefixes', () => {
    expect(resolveActiveApiKey([base])).toBeNull();
  });

  it('returns the raw key of an active key held in memory', () => {
    expect(resolveActiveApiKey([{ ...base, rawKey: FIXED_KEY }])).toBe(FIXED_KEY);
  });

  it('ignores the raw key of a revoked key', () => {
    expect(resolveActiveApiKey([{ ...base, rawKey: FIXED_KEY, status: 'revoked' }])).toBeNull();
  });
});
