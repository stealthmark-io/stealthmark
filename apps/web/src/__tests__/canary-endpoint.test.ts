import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { canaryFixtureBody, canaryGitConfigBody, createCanarySigner, mintCanaryToken } from '../../../../packages/next/src/canary';
import { issueCanaryKey, MAX_CANARY_TOKEN_LENGTH, readCanaryHit } from '../lib/canary';
import { GET } from '../app/api/telemetry/canary/route';
import { GET as gitRemoteGET } from '../app/api/telemetry/canary/[...path]/route';
import { POST as issueKey } from '../app/api/keys/canary/route';

const { scheduled, getOrgSession } = vi.hoisted(() => ({
  scheduled: [] as Array<() => unknown>,
  getOrgSession: vi.fn<() => Promise<{ orgId: string } | null>>(),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (task: () => unknown) => void scheduled.push(task) };
});

vi.mock('../lib/session', () => ({ getOrgSession }));

const ORG = randomUUID();
const HOST = 'shop.example.com';
const LOCKED = { error: 'invalid_client_secret', code: 'vault_locked' };
const GUID_V8_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function useMaster(): void {
  vi.stubEnv('CANARY_MASTER_SECRET', randomBytes(32).toString('hex'));
}

async function sdkToken(path = '/.env', now = Date.now(), org = ORG): Promise<string> {
  const signer = createCanarySigner(issueCanaryKey(org) ?? undefined);
  if (!signer) throw new Error('the issued key must parse in the SDK');
  return mintCanaryToken(signer, HOST, path, now);
}

function swapChar(value: string, index: number, pick: (position: number) => number): string {
  const at = index < 0 ? value.length + index : index;
  return value.slice(0, at) + BASE64URL[pick(BASE64URL.indexOf(value[at]))] + value.slice(at + 1);
}

function canaryRequest(token: string | null, ip: string | null = '203.0.113.7'): NextRequest {
  const url = new URL('https://stealthmark.io/api/telemetry/canary');
  if (token !== null) url.searchParams.set('t', token);
  return new NextRequest(url, { headers: ip ? { 'x-forwarded-for': ip } : {} });
}

/** The request `git fetch` sends for the origin remote of the SDK's /.git/config fixture. */
function gitFetch(token: string, ip: string) {
  const remote = canaryGitConfigBody(HOST, token).match(/^\turl = (.+)$/m)?.[1] ?? '';
  const url = new URL(`${remote}/info/refs?service=git-upload-pack`);
  const path = url.pathname.split('/').slice(4);
  return gitRemoteGET(new NextRequest(url, { headers: { 'x-forwarded-for': ip } }), { params: Promise.resolve({ path }) });
}

function gatewayPattern(file: string, name: string): RegExp {
  const source = readFileSync(fileURLToPath(new URL(`../../../../infrastructure/gateway-lab/gateway/${file}`, import.meta.url)), 'utf8');
  const pattern = source.match(new RegExp(`${name} = re\\.compile\\(\\s*r"\\(\\?m\\)(.+)"\\s*\\)`))?.[1];
  if (!pattern) throw new Error(`${name} not found in ${file}`);
  return new RegExp(pattern, 'm');
}

beforeEach(() => {
  scheduled.length = 0;
  useMaster();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Canary key issuance', () => {
  it('issues a key the SDK accepts, and none without a master secret or for a malformed org', () => {
    const key = issueCanaryKey(ORG);
    expect(key).toMatch(new RegExp(`^smck1\\.${ORG}\\.[A-Za-z0-9_-]{8}\\.[A-Za-z0-9_-]{43}$`));
    expect(createCanarySigner(key ?? undefined)).not.toBeNull();
    expect(issueCanaryKey(ORG)).not.toBe(key);
    expect(issueCanaryKey('not-a-uuid')).toBeNull();
    vi.stubEnv('CANARY_MASTER_SECRET', 'too-short');
    expect(issueCanaryKey(ORG)).toBeNull();
  });

  it('POST /api/keys/canary issues a key for the session organization only', async () => {
    getOrgSession.mockResolvedValueOnce(null);
    expect((await issueKey()).status).toBe(401);

    getOrgSession.mockResolvedValueOnce({ orgId: ORG });
    const res = await issueKey();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { key } = (await res.json()) as { key: string };
    expect(key.startsWith(`smck1.${ORG}.`)).toBe(true);

    vi.stubEnv('CANARY_MASTER_SECRET', '');
    getOrgSession.mockResolvedValueOnce({ orgId: ORG });
    const unavailable = await issueKey();
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: 'canary_unavailable' });
  });
});

describe('Canary token verification', () => {
  it('reads a token minted by @stealthmark/next into a zero-unit blocked event', async () => {
    const now = Date.UTC(2026, 9, 24, 12, 0, 0);
    const hit = readCanaryHit(await sdkToken('/.env.local', now), '203.0.113.7', now + 90_000);
    expect(hit?.org).toBe(ORG);
    expect(hit?.event).toMatchObject({
      event_type: 'agent_blocked',
      metadata: {
        path: '/.env.local',
        host: HOST,
        method: 'GET',
        status: 401,
        reason: 'canary_triggered',
        served_at: '2026-10-24T12:00:00.000Z',
      },
    });
    expect(hit?.event.event_id).toMatch(GUID_V8_RE);
    expect(hit?.event.metadata.ip_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(hit)).not.toContain('203.0.113.7');
  });

  it('keys the event id on the organization, the client IP and the hour, so fresh tokens do not add events', async () => {
    const now = Date.UTC(2026, 9, 24, 12, 0, 0);
    const first = readCanaryHit(await sdkToken('/.env', now), '203.0.113.7', now);
    const sameHour = readCanaryHit(await sdkToken('/.git/config', now), '203.0.113.7', now + 59 * 60_000);
    expect(sameHour?.event.event_id).toBe(first?.event.event_id);

    const otherIp = readCanaryHit(await sdkToken('/.env', now), '198.51.100.20', now);
    expect(otherIp?.event.event_id).not.toBe(first?.event.event_id);
    expect(otherIp?.event.metadata.ip_hash).not.toBe(first?.event.metadata.ip_hash);
    expect(readCanaryHit(await sdkToken('/.env', now), '203.0.113.7', now + 60 * 60_000)?.event.event_id).not.toBe(first?.event.event_id);
    expect(readCanaryHit(await sdkToken('/.env', now, randomUUID()), '203.0.113.7', now)?.event.event_id).not.toBe(first?.event.event_id);
  });

  it('rejects tampered, foreign, malformed and oversized tokens', async () => {
    const token = await sdkToken();
    const [payload, signature] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    const reencode = (patch: Record<string, unknown>) => Buffer.from(JSON.stringify({ ...claims, ...patch })).toString('base64url');

    const rejected = [
      `${payload}.${swapChar(signature, 0, (position) => (position + 1) % 64)}`,
      `${reencode({ path: '/.git/config' })}.${signature}`,
      `${reencode({ org: randomUUID() })}.${signature}`,
      `${payload}.${signature}.extra`,
      payload,
      `${payload}.`,
      `${'A'.repeat(MAX_CANARY_TOKEN_LENGTH)}.${signature}`,
      'not a token',
    ];
    for (const candidate of rejected) expect(readCanaryHit(candidate, '203.0.113.7')).toBeNull();
  });

  it('rejects a token signed under another master secret', async () => {
    const token = await sdkToken();
    useMaster();
    expect(readCanaryHit(token, '203.0.113.7')).toBeNull();
  });

  it('accepts a token for 72 hours and up to five minutes of clock skew', async () => {
    const now = Date.UTC(2026, 9, 24, 12, 0, 0);
    const token = await sdkToken('/.env', now);
    expect(readCanaryHit(token, '203.0.113.7', now + 72 * 3600_000)).not.toBeNull();
    expect(readCanaryHit(token, '203.0.113.7', now + 72 * 3600_000 + 1000)).toBeNull();
    expect(readCanaryHit(token, '203.0.113.7', now - 5 * 60_000)).not.toBeNull();
    expect(readCanaryHit(token, '203.0.113.7', now - 5 * 60_000 - 1000)).toBeNull();
  });

  it('accepts nothing without a master secret', async () => {
    const token = await sdkToken();
    vi.stubEnv('CANARY_MASTER_SECRET', '');
    expect(readCanaryHit(token, '203.0.113.7')).toBeNull();
  });
});

describe('Canary fixture in the gateway audit', () => {
  // The gateway reads only the first 2048 characters of each dotfile.
  it('matches the pattern the gateway uses to grade /.env as a Canary fixture instead of a leak', async () => {
    const body = canaryFixtureBody(HOST, await sdkToken()).slice(0, 2048);
    expect(gatewayPattern('routes/audit_v2.py', '_CANARY_FIXTURE_RE').test(body)).toBe(true);
  });

  it('matches the pattern the gateway uses to grade /.git/ as a Canary fixture instead of an exposed repository', async () => {
    const body = canaryGitConfigBody(HOST, await sdkToken('/.git/config')).slice(0, 2048);
    const pattern = gatewayPattern('auditor/exposure.py', '_CANARY_GIT_CONFIG_RE');
    expect(pattern.test(body)).toBe(true);
    expect(pattern.test(canaryFixtureBody(HOST, await sdkToken()))).toBe(false);
  });
});

describe('GET /api/telemetry/canary', () => {
  it('answers the same 401 to valid, invalid and missing tokens', async () => {
    const valid = await GET(canaryRequest(await sdkToken(), '192.0.2.10'));
    const invalid = await GET(canaryRequest('forged.token', '192.0.2.10'));
    const missing = await GET(canaryRequest(null, '192.0.2.10'));
    for (const res of [valid, invalid, missing]) {
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual(LOCKED);
    }
    expect(scheduled).toHaveLength(1);
  });

  it('records a valid hit after the response, through the internal usage ingest', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 24, 12, 30, 0));
    const token = await sdkToken('/.git/config');

    await GET(canaryRequest(token, '192.0.2.11'));
    expect(fetchMock).not.toHaveBeenCalled();
    await scheduled[0]();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/v1/usage/ingest\\?orgId=${ORG}$`));
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('x-internal-secret')).toBeTruthy();
    expect(JSON.parse(String(init.body))).toEqual({ events: [readCanaryHit(token, '192.0.2.11')?.event] });
  });

  it('logs and swallows an ingest failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connect ECONNREFUSED'); }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await GET(canaryRequest(await sdkToken(), '192.0.2.12'));
    await expect(Promise.resolve(scheduled[0]())).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledWith('[Canary] Usage ingest failed:', 'connect ECONNREFUSED');
  });

  it('refuses requests without a client IP and rate-limits each IP', async () => {
    expect((await GET(canaryRequest(await sdkToken(), null))).status).toBe(429);
    const statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) statuses.push((await GET(canaryRequest('forged.token', '192.0.2.13'))).status);
    expect(statuses.slice(0, 30).every((status) => status === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
    expect(scheduled).toHaveLength(0);
  });
});

describe('GET /api/telemetry/canary/<token>.git/...', () => {
  it('records the hit of a git fetch on the SDK remote and answers 403, so git asks for no credentials', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 24, 12, 30, 0));
    const token = await sdkToken('/.git/config');

    const valid = await gitFetch(token, '192.0.2.20');
    const forged = await gitFetch('forged.token', '192.0.2.20');
    for (const res of [valid, forged]) {
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual(LOCKED);
    }
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const event = readCanaryHit(token, '192.0.2.20', Date.now(), 403)?.event;
    expect(event?.metadata).toMatchObject({ path: '/.git/config', status: 403 });
    expect(JSON.parse(String(init.body))).toEqual({ events: [event] });
  });
});
