import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Canary keys and tokens for the `@stealthmark/next` dotfile fixture.
 *
 * StealthMark stores no per-organization key: each one is derived from CANARY_MASTER_SECRET, the
 * organization id and a key id, so the console can show it once and the verifier can derive it again.
 * Revoking a single key is not possible; rotating the master secret revokes every key.
 */

const KEY_PREFIX = 'smck1';
const MIN_MASTER_LENGTH = 32;
const TOKEN_TTL_SECONDS = 72 * 60 * 60;
const MAX_FUTURE_SKEW_SECONDS = 5 * 60;
const MAX_TOKEN_PATH_LENGTH = 128;
const MAX_HOST_LENGTH = 253;
const HOUR_MS = 60 * 60 * 1000;
export const MAX_CANARY_TOKEN_LENGTH = 1024;

const ORG_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KID_RE = /^[A-Za-z0-9_-]{8,32}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{16}$/;
const SIGNATURE_RE = /^[A-Za-z0-9_-]{43}$/;
const HOST_RE = /^[a-z0-9.:[\]-]+$/;

interface CanaryClaims {
  v: 1;
  kid: string;
  org: string;
  host: string;
  path: string;
  ts: number;
  nonce: string;
}

/** What the Canary URL answers: 401 on `?t=`, 403 on the git remote, where a 401 would make git ask for credentials. */
export type CanaryAnswerStatus = 401 | 403;

/** An `agent_blocked` event as POST /v1/usage/ingest accepts it. Blocked events never consume quota. */
export interface CanaryUsageEvent {
  event_id: string;
  event_type: 'agent_blocked';
  metadata: {
    path: string;
    host: string;
    method: 'GET';
    status: CanaryAnswerStatus;
    reason: 'canary_triggered';
    served_at: string;
    ip_hash: string;
  };
}

export interface CanaryHit {
  org: string;
  event: CanaryUsageEvent;
}

function masterSecret(): string | null {
  const secret = process.env.CANARY_MASTER_SECRET;
  return secret && secret.length >= MIN_MASTER_LENGTH ? secret : null;
}

export function isCanaryConfigured(): boolean {
  return masterSecret() !== null;
}

function deriveOrgKey(master: string, org: string, kid: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), `canary:v1:${org}:${kid}`, 32));
}

/** `smck1.<organization id>.<key id>.<base64url key>`, or null when the master secret is missing. */
export function issueCanaryKey(org: string): string | null {
  const master = masterSecret();
  if (!master || !ORG_RE.test(org)) return null;
  const kid = randomBytes(6).toString('base64url');
  return `${KEY_PREFIX}.${org}.${kid}.${deriveOrgKey(master, org, kid).toString('base64url')}`;
}

function isClaims(value: unknown): value is CanaryClaims {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return (
    c.v === 1 &&
    typeof c.kid === 'string' && KID_RE.test(c.kid) &&
    typeof c.org === 'string' && ORG_RE.test(c.org) &&
    typeof c.host === 'string' && c.host.length <= MAX_HOST_LENGTH && HOST_RE.test(c.host) &&
    typeof c.path === 'string' && c.path.startsWith('/') && c.path.length <= MAX_TOKEN_PATH_LENGTH &&
    typeof c.ts === 'number' && Number.isSafeInteger(c.ts) &&
    typeof c.nonce === 'string' && NONCE_RE.test(c.nonce)
  );
}

/**
 * A random-looking UUID (version 8) so the ingest stores one event per organization, client IP and hour.
 * Each fixture request mints a fresh token, so keying on the token would let one client fill the organization's
 * hourly allowance of blocked events with Canary hits.
 */
function canaryEventId(org: string, ipHash: string, now: number): string {
  const bytes = createHash('sha256').update(`${org}:${ipHash}:${Math.floor(now / HOUR_MS)}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The usage event for a request that carried a valid, unexpired token; null for anything else. */
export function readCanaryHit(
  token: string,
  ip: string,
  now: number = Date.now(),
  status: CanaryAnswerStatus = 401
): CanaryHit | null {
  const master = masterSecret();
  if (!master || token.length > MAX_CANARY_TOKEN_LENGTH) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined || !SIGNATURE_RE.test(signature)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isClaims(claims)) return null;

  const expected = createHmac('sha256', deriveOrgKey(master, claims.org, claims.kid)).update(payload).digest();
  if (!timingSafeEqual(Buffer.from(signature, 'base64url'), expected)) return null;

  const nowSeconds = Math.floor(now / 1000);
  if (claims.ts > nowSeconds + MAX_FUTURE_SKEW_SECONDS || nowSeconds - claims.ts > TOKEN_TTL_SECONDS) return null;

  const ipHash = createHmac('sha256', master).update(`ip:${ip}`).digest('hex').slice(0, 16);
  return {
    org: claims.org,
    event: {
      event_id: canaryEventId(claims.org, ipHash, now),
      event_type: 'agent_blocked',
      metadata: {
        path: claims.path,
        host: claims.host,
        method: 'GET',
        status,
        reason: 'canary_triggered',
        served_at: new Date(claims.ts * 1000).toISOString(),
        ip_hash: ipHash,
      },
    },
  };
}
