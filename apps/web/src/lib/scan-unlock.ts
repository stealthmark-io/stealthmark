import { createHmac, timingSafeEqual } from 'node:crypto';
import { sanitizeAndValidateDomain } from '@/lib/security/network-guard';
import { UNLOCK_DAYS } from '@/lib/offer';

const TOKEN_PREFIX = 'smu1.';
const TOKEN_KEY_ID = 'k1';
const TOKEN_TTL_SECONDS = UNLOCK_DAYS * 24 * 60 * 60;
const MIN_SECRET_LENGTH = 32;

export interface ScanUnlockPayload {
  v: 1;
  kid: string;
  cid: string;
  dom: string;
  pid: string;
  exp: number;
}

function getSecret(): string | null {
  const secret = process.env.SCAN_UNLOCK_SECRET;
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

export function isScanUnlockConfigured(): boolean {
  return getSecret() !== null;
}

export type HallOfFameTokenPurpose = 'hof_claim' | 'hof_remove';

// Each purpose gets its own HMAC namespace so a badge signature can never pass as an unlock token.
function hmac(purpose: 'unlock' | 'badge' | HallOfFameTokenPurpose, body: string, secret: string): string {
  return createHmac('sha256', secret).update(`${purpose}.v1|${body}`).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function issueScanUnlockToken(
  input: { checkoutId: string; domain: string; productId: string },
  now: number = Date.now()
): string | null {
  const secret = getSecret();
  const dom = sanitizeAndValidateDomain(input.domain);
  if (!secret || !dom) return null;

  const payload: ScanUnlockPayload = {
    v: 1,
    kid: TOKEN_KEY_ID,
    cid: input.checkoutId,
    dom,
    pid: input.productId,
    exp: Math.floor(now / 1000) + TOKEN_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${TOKEN_PREFIX}${body}.${hmac('unlock', body, secret)}`;
}

function isPayload(value: unknown): value is ScanUnlockPayload {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    p.v === 1 &&
    typeof p.kid === 'string' &&
    typeof p.cid === 'string' &&
    typeof p.dom === 'string' &&
    typeof p.pid === 'string' &&
    typeof p.exp === 'number'
  );
}

export function verifyScanUnlockToken(
  token: string | null | undefined,
  domain: string,
  now: number = Date.now()
): ScanUnlockPayload | null {
  const secret = getSecret();
  if (!secret || !token || !token.startsWith(TOKEN_PREFIX)) return null;

  const parts = token.slice(TOKEN_PREFIX.length).split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!safeEqual(signature, hmac('unlock', body, secret))) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isPayload(payload) || payload.kid !== TOKEN_KEY_ID) return null;
  if (payload.exp * 1000 <= now) return null;
  if (payload.dom !== sanitizeAndValidateDomain(domain)) return null;
  return payload;
}

const BADGE_GRADE_RE = /^[A-F][+-]?$/;

export function signBadge(domain: string, grade: string, issuedAt: number): string | null {
  const secret = getSecret();
  const dom = sanitizeAndValidateDomain(domain);
  if (!secret || !dom || !BADGE_GRADE_RE.test(grade)) return null;
  return hmac('badge', `${dom}|${grade}|${issuedAt}`, secret);
}

export function verifyBadgeSignature(
  domain: string,
  grade: string,
  issuedAt: string,
  signature: string
): boolean {
  if (!/^\d{1,12}$/.test(issuedAt)) return false;
  const expected = signBadge(domain, grade, Number(issuedAt));
  return expected !== null && safeEqual(signature, expected);
}

/** Signs a Hall of Fame token body in its own namespace; null while SCAN_UNLOCK_SECRET is unset. */
export function signHallOfFameBody(purpose: HallOfFameTokenPurpose, body: string): string | null {
  const secret = getSecret();
  return secret ? hmac(purpose, body, secret) : null;
}

export function verifyHallOfFameBody(purpose: HallOfFameTokenPurpose, body: string, signature: string): boolean {
  const expected = signHallOfFameBody(purpose, body);
  return expected !== null && safeEqual(signature, expected);
}
