import { createHash, randomBytes } from 'node:crypto';

export interface GeneratedApiKey {
  key: string;
  keyHash: string;
  keyPrefix: string;
}

/**
 * Mirror of packages/shared/src/api-keys.ts, kept local because apps/web does not consume workspace
 * packages. The fixed vectors in __tests__/api-keys-contract.test.ts (identical in apps/api) fail
 * both suites if either copy drifts.
 * Format: `sk_live_` + 32 random hex characters (16 random bytes).
 */
export function generateApiKey(prefix = 'sk_live_'): GeneratedApiKey {
  const randomPart = randomBytes(16).toString('hex');
  const key = `${prefix}${randomPart}`;
  const keyHash = hashApiKey(key);
  const keyPrefix = `${prefix}${randomPart.slice(0, 4)}...${randomPart.slice(-4)}`;

  return { key, keyHash, keyPrefix };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
