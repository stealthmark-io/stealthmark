import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';
import { endlessBodyRequest } from './helpers/chunked-body';
import { cookieStoreOf, newCookieJar, type CookieJar } from './helpers/cookie-store';

const state = vi.hoisted(() => ({
  client: null as unknown,
  adminCalls: 0,
  serverClient: null as unknown,
  serverCalls: 0,
  jar: null as unknown,
  session: null as { user: { id: string; orgId: string; email: string }; orgId: string } | null,
  admin: true,
  chargePaidKey: vi.fn(),
  refundCharge: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: async () => state.jar }));
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => {
    state.adminCalls += 1;
    return state.client;
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    state.serverCalls += 1;
    return state.serverClient;
  },
}));
vi.mock('@/lib/session', () => ({ getOrgSession: async () => state.session }));
vi.mock('@/lib/admin-auth', () => ({ isAuthorizedAdmin: async () => state.admin }));
vi.mock('@/lib/credit-meter', () => ({ chargePaidKey: state.chargePaidKey, refundCharge: state.refundCharge }));
vi.mock('@/lib/flags', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/flags')>();
  return { ...original, flags: { ...original.flags, hitl: true, defcon: true, sentinel: true } };
});

import { POST as syncPost } from '../app/api/auth/session/sync/route';
import { POST as domainsPost } from '../app/api/domains/route';
import { POST as keysPost } from '../app/api/keys/route';
import { POST as verifyKeyPost } from '../app/api/keys/verify/route';
import { POST as simulatePost } from '../app/api/hitl/simulate/route';
import { POST as rejectPost } from '../app/api/hitl/reject/route';
import { POST as approvePost } from '../app/api/hitl/approve/route';
import { POST as executePost } from '../app/api/hitl/execute/route';
import { POST as defconPost } from '../app/api/defcon/route';
import { POST as overridePlanPost } from '../app/api/admin/override-plan/route';
import { POST as edgeShieldPost } from '../app/api/scan/edge-shield/route';
import { POST as manifestsPost } from '../app/api/scan/manifests/route';
import { POST as subscribeAlertsPost } from '../app/api/scan/subscribe-alerts/route';
import { POST as sentinelPost } from '../app/api/ai/sentinel/route';
import { POST as pingPost } from '../app/api/telemetry/ping/route';
import { POST as mcpPost } from '../app/api/mcp/route';
import { POST as claimPost } from '../app/api/billing/crypto/claim/route';
import { SESSION_COOKIE_NAME } from '../lib/auth';
import { getAllHitlActions, resetHitlStoreForTesting } from '../lib/hitl-store';

const ORG_ID = '0b6a6f2e-4f7c-4d63-9d2a-3a1f9d2f7c11';

type Handler = (request: NextRequest) => Promise<Response>;

interface Case {
  path: string;
  post: Handler;
  cap: number;
  tooLarge: unknown;
  notObject: unknown;
  /** The answer to a body that is not JSON, when it differs from `notObject`. */
  notJson?: unknown;
  emptyBodyIsAccepted?: boolean;
}

const TOO_LARGE = { error: 'Payload too large' };
const NOT_OBJECT = { error: 'Invalid JSON body' };
const HITL_TOO_LARGE = { success: false, error: 'Payload too large' };
const HITL_NOT_OBJECT = { success: false, error: 'Invalid request payload' };

const CASES: Case[] = [
  { path: '/api/domains', post: domainsPost, cap: 4 * 1024, tooLarge: TOO_LARGE, notObject: NOT_OBJECT },
  {
    path: '/api/keys',
    post: keysPost,
    cap: 2 * 1024,
    tooLarge: { error: 'payload_too_large' },
    notObject: { error: 'invalid_json' },
  },
  {
    path: '/api/keys/verify',
    post: verifyKeyPost,
    cap: 2 * 1024,
    tooLarge: { valid: false, error: 'payload_too_large', message: 'Request body is too large.' },
    notObject: { valid: false, error: 'invalid_key_format', message: 'Invalid API key format.' },
  },
  { path: '/api/auth/session/sync', post: syncPost, cap: 8 * 1024, tooLarge: TOO_LARGE, notObject: NOT_OBJECT },
  { path: '/api/hitl/simulate', post: simulatePost, cap: 2 * 1024, tooLarge: HITL_TOO_LARGE, notObject: HITL_NOT_OBJECT },
  { path: '/api/hitl/reject', post: rejectPost, cap: 4 * 1024, tooLarge: HITL_TOO_LARGE, notObject: HITL_NOT_OBJECT },
  { path: '/api/hitl/approve', post: approvePost, cap: 4 * 1024, tooLarge: HITL_TOO_LARGE, notObject: HITL_NOT_OBJECT },
  { path: '/api/hitl/execute', post: executePost, cap: 16 * 1024, tooLarge: HITL_TOO_LARGE, notObject: HITL_NOT_OBJECT },
  { path: '/api/defcon', post: defconPost, cap: 2 * 1024, tooLarge: TOO_LARGE, notObject: NOT_OBJECT },
  { path: '/api/admin/override-plan', post: overridePlanPost, cap: 2 * 1024, tooLarge: TOO_LARGE, notObject: NOT_OBJECT },
  { path: '/api/scan/edge-shield', post: edgeShieldPost, cap: 2 * 1024, tooLarge: TOO_LARGE, notObject: NOT_OBJECT },
  { path: '/api/scan/manifests', post: manifestsPost, cap: 2 * 1024, tooLarge: TOO_LARGE, notObject: NOT_OBJECT },
  { path: '/api/scan/subscribe-alerts', post: subscribeAlertsPost, cap: 4 * 1024, tooLarge: TOO_LARGE, notObject: NOT_OBJECT },
  {
    path: '/api/ai/sentinel',
    post: sentinelPost,
    cap: 8 * 1024,
    tooLarge: { success: false, error: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' },
    notObject: { success: false, error: 'INVALID_REQUEST_BODY', message: 'Request body must be a JSON object.' },
  },
  {
    path: '/api/telemetry/ping',
    post: pingPost,
    cap: 2 * 1024,
    tooLarge: { error: 'payload_too_large' },
    notObject: { error: 'invalid_json' },
    emptyBodyIsAccepted: true,
  },
  {
    path: '/api/mcp',
    post: mcpPost,
    cap: 64 * 1024,
    tooLarge: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Payload too large' } },
    notObject: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } },
    notJson: { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
  },
  {
    path: '/api/billing/crypto/claim',
    post: claimPost,
    cap: 2 * 1024,
    tooLarge: { error: 'payload_too_large', message: 'Request body is too large.' },
    notObject: expect.objectContaining({ error: 'validation_error' }),
  },
];

let jar: CookieJar;
let fetchMock: Mock<typeof fetch>;
let hitlBefore: number;
let requests = 0;

function forwardedFor(): string {
  requests += 1;
  return `203.0.${(requests >> 8) & 255}.${requests & 255}`;
}

function request(path: string, body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://stealthmark.io${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor(), ...headers },
    body,
  });
}

function chunked(path: string) {
  const { request: raw, pulls } = endlessBodyRequest(`https://stealthmark.io${path}`, {
    'content-type': 'application/json',
    'x-forwarded-for': forwardedFor(),
  });
  return { request: new NextRequest(raw), pulls };
}

function paddedJson(bytes: number): string {
  const frame = JSON.stringify({ padding: '' }).length;
  return JSON.stringify({ padding: 'x'.repeat(bytes - frame) });
}

function expectNothingDone(): void {
  expect(state.adminCalls).toBe(0);
  expect(state.serverCalls).toBe(0);
  expect(state.chargePaidKey).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(jar.set).toHaveLength(0);
  expect(getAllHitlActions()).toHaveLength(hitlBefore);
}

beforeEach(() => {
  jar = newCookieJar();
  state.jar = cookieStoreOf(jar);
  const db = new FakeSupabase();
  db.table('api_keys', { defaults: () => ({ id: crypto.randomUUID(), created_at: new Date().toISOString() }) });
  state.client = db;
  state.adminCalls = 0;
  state.serverClient = null;
  state.serverCalls = 0;
  state.session = { user: { id: 'u1', orgId: ORG_ID, email: 'dev@acme.io' }, orgId: ORG_ID };
  state.admin = true;
  state.chargePaidKey.mockClear();
  state.refundCharge.mockClear();
  resetHitlStoreForTesting();
  hitlBefore = getAllHitlActions().length;
  fetchMock = vi.fn<typeof fetch>(async (input) => {
    const target = String(input);
    if (target.endsWith('/api/v1/ping')) return Response.json({ latency_ms: 4.2 });
    if (target.includes('/internal/auth/upsert-user')) {
      return Response.json({
        user: { id: 'usr-1', orgId: 'org-real', email: 'owner@stealthmark.io', name: null, avatarUrl: null, provider: 'google', role: 'owner' },
        organization: { id: 'org-real', name: 'Org', plan: 'free' },
      });
    }
    throw new Error(`unexpected fetch ${target}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each(CASES)('POST $path', ({ path, post: handler, cap, tooLarge, notObject, notJson, emptyBodyIsAccepted }) => {
  it(`answers 413 for a body of ${cap + 1} bytes and does nothing else`, async () => {
    const res = await handler(request(path, paddedJson(cap + 1)));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual(tooLarge);
    expectNothingDone();
  });

  it(`reads a body of exactly ${cap} bytes`, async () => {
    const res = await handler(request(path, paddedJson(cap)));
    expect(res.status).not.toBe(413);
  });

  it('stops pulling a chunked body without content-length once it passes the cap', async () => {
    const stream = chunked(path);
    const res = await handler(stream.request);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual(tooLarge);
    expect(stream.pulls()).toBeLessThan(cap / 4096 + 8);
    expectNothingDone();
  });

  it('answers 400 for JSON that is not an object and does nothing else', async () => {
    for (const body of ['null', '[]', '"text"', '7', 'true']) {
      const res = await handler(request(path, body));
      expect(res.status, body).toBe(400);
      expect(await res.json(), body).toEqual(notObject);
    }
    expectNothingDone();
  });

  it('answers 400 for a body that is not JSON and does nothing else', async () => {
    const bodies = emptyBodyIsAccepted ? ['not json', '{"a":'] : ['', 'not json', '{"a":'];
    for (const body of bodies) {
      const res = await handler(request(path, body));
      expect(res.status, body).toBe(400);
      expect(await res.json(), body).toEqual(notJson ?? notObject);
    }
    expectNothingDone();
  });
});

describe('guards that run before the body is read', () => {
  const sessionGuarded: Array<[string, Handler]> = [
    ['/api/domains', domainsPost],
    ['/api/keys', keysPost],
    ['/api/telemetry/ping', pingPost],
  ];

  it.each(sessionGuarded)('POST %s answers 401 without a session, even for an oversize body', async (path, handler) => {
    state.session = null;
    const res = await handler(request(path, paddedJson(64 * 1024)));
    expect(res.status).toBe(401);
    expect(state.adminCalls).toBe(0);
  });

  it('POST /api/admin/override-plan answers 401 to a non-admin, even for an oversize body', async () => {
    state.admin = false;
    const res = await overridePlanPost(request('/api/admin/override-plan', paddedJson(64 * 1024)));
    expect(res.status).toBe(401);
    expect(state.adminCalls).toBe(0);
  });

  it('POST /api/keys/verify answers 429 after 20 attempts from one address, even for an oversize body', async () => {
    const headers = { 'x-forwarded-for': '198.51.100.9' };
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect((await verifyKeyPost(request('/api/keys/verify', 'null', headers))).status).toBe(400);
    }
    const limited = await verifyKeyPost(request('/api/keys/verify', paddedJson(64 * 1024), headers));
    expect(limited.status).toBe(429);
    expect(state.adminCalls).toBe(0);
  });
});

describe('POST /api/auth/session/sync', () => {
  const SYNC = '/api/auth/session/sync';

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_SECRET', 'test-auth-secret-for-vitest-only-0123456789');
    vi.stubEnv('INTERNAL_AUTH_SECRET', 'test-internal-secret-for-vitest-only-0123456789');
    vi.stubEnv('STEALTHMARK_OWNER_EMAILS', '');
  });

  function signInAs(email: string, confirmedAt: string | null) {
    const getUser = vi.fn(async (accessToken: string) => ({
      data: {
        user:
          accessToken === 'token'
            ? {
                id: 'sb-user-1',
                email,
                email_confirmed_at: confirmedAt,
                app_metadata: { provider: 'google' },
                user_metadata: {},
              }
            : null,
      },
      error: null,
    }));
    state.serverClient = { auth: { getUser } };
    return getUser;
  }

  function upsertCalls(): number {
    return fetchMock.mock.calls.filter(([input]) => String(input).includes('/internal/auth/upsert-user')).length;
  }

  it('answers 400 when the access token is missing, empty or not a string, and never calls Supabase', async () => {
    const bodies = [{}, { accessToken: '' }, { accessToken: 7 }, { accessToken: ['token'] }, { accessToken: { value: 'token' } }];
    for (const body of bodies) {
      const res = await syncPost(request(SYNC, JSON.stringify(body)));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({ error: 'Missing access token for session sync' });
    }
    expect(state.serverCalls).toBe(0);
    expect(jar.set).toHaveLength(0);
  });

  it('answers 401 when Supabase does not recognise the access token', async () => {
    const getUser = signInAs('owner@stealthmark.io', '2026-10-01T00:00:00.000Z');
    const res = await syncPost(request(SYNC, JSON.stringify({ accessToken: 'forged' })));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid or expired Supabase token' });
    expect(getUser).toHaveBeenCalledWith('forged');
    expect(upsertCalls()).toBe(0);
    expect(jar.set).toHaveLength(0);
  });

  it('refuses a confirmed address outside the owner allowlist and provisions nothing', async () => {
    const getUser = signInAs('stranger@example.net', '2026-10-01T00:00:00.000Z');
    const res = await syncPost(request(SYNC, JSON.stringify({ accessToken: 'token' })));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'owner_access_only' });
    expect(getUser).toHaveBeenCalledWith('token');
    expect(upsertCalls()).toBe(0);
    expect(jar.set).toHaveLength(0);
  });

  it('refuses an address Supabase has not confirmed, even for an owner domain', async () => {
    signInAs('owner@stealthmark.io', null);
    const res = await syncPost(request(SYNC, JSON.stringify({ accessToken: 'token' })));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'email_not_verified' });
    expect(upsertCalls()).toBe(0);
    expect(jar.set).toHaveLength(0);
  });

  it('provisions the owner and sets the session cookie', async () => {
    signInAs('owner@stealthmark.io', '2026-10-01T00:00:00.000Z');
    const res = await syncPost(request(SYNC, JSON.stringify({ accessToken: 'token' })));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, user: { id: 'usr-1', orgId: 'org-real' } });
    expect(upsertCalls()).toBe(1);
    expect(jar.set).toHaveLength(1);
    expect(jar.set[0].name).toBe(SESSION_COOKIE_NAME);
    expect(jar.set[0].value.length).toBeGreaterThan(0);
    expect(jar.set[0].options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
  });
});

describe('POST /api/telemetry/ping', () => {
  function agentSent(): string | null {
    return new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('x-stealthmark-agent');
  }

  it('still pings the gateway as the default agent when the body is empty', async () => {
    const res = await pingPost(request('/api/telemetry/ping', ''));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, clusterStatus: 'operational' });
    expect(agentSent()).toBe('StealthMark Console');
  });

  it('forwards the agent name from a JSON object with non-printable characters removed', async () => {
    const res = await pingPost(request('/api/telemetry/ping', JSON.stringify({ agent: '  Acme CI\u0000  ' })));
    expect(res.status).toBe(200);
    expect(agentSent()).toBe('Acme CI');
  });
});
