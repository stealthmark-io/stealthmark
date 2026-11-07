import { after, NextResponse, type NextRequest } from 'next/server';
import { API_URL, internalAuthSecret } from '@/lib/auth';
import { readCanaryHit, type CanaryAnswerStatus, type CanaryHit } from '@/lib/canary';
import { clientIp } from '@/lib/client-ip';

const INGEST_TIMEOUT_MS = 5000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const MAX_TRACKED_IPS = 10_000;

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  if (rateLimitMap.size >= MAX_TRACKED_IPS) {
    for (const [key, entry] of rateLimitMap) if (entry.resetAt <= now) rateLimitMap.delete(key);
  }
  const entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt <= now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

async function recordHit(hit: CanaryHit): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/v1/usage/ingest?orgId=${encodeURIComponent(hit.org)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': internalAuthSecret() },
      body: JSON.stringify({ events: [hit.event] }),
      cache: 'no-store',
      signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
    });
    if (!res.ok) console.error(`[Canary] Usage ingest answered ${res.status}`);
  } catch (err: unknown) {
    console.error('[Canary] Usage ingest failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Shared by both Canary URL forms, which also share the per-IP rate limit. Valid, invalid and expired tokens get the
 * same answer, so it tells a client nothing; a valid token's hit is recorded after the response.
 */
export function answerCanaryRequest(req: NextRequest, token: string | null, status: CanaryAnswerStatus): NextResponse {
  const ip = clientIp(req);
  if (!ip || isRateLimited(ip)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Cache-Control': 'no-store' } });
  }

  const hit = token ? readCanaryHit(token, ip, Date.now(), status) : null;
  if (hit) after(() => recordHit(hit));

  return NextResponse.json(
    { error: 'invalid_client_secret', code: 'vault_locked' },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}
