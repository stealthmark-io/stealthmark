import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase';
import { hashApiKey } from '../lib/api-keys';

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('../lib/supabase/admin', () => ({ createSupabaseAdminClient: () => state.client }));

import { chargePaidKey, refundCharge } from '../lib/credit-meter';
import { POST as manifestsPost } from '../app/api/scan/manifests/route';
import { POST as edgeShieldPost } from '../app/api/scan/edge-shield/route';
import { GET as auditGet } from '../app/api/scan/audit/route';

const ORG_ID = '0b6a6f2e-4f7c-4d63-9d2a-3a1f9d2f7c11';
const API_KEY = `sk_live_${'a1'.repeat(16)}`;

function seed(db: FakeSupabase, org: { credit_balance_events: number; plan?: string; billing_mode?: string }) {
  db.table('api_keys').push({ org_id: ORG_ID, key_hash: hashApiKey(API_KEY), status: 'active' });
  const orgs = db.table('organizations');
  orgs.push({ id: ORG_ID, plan: org.plan ?? 'free', billing_mode: org.billing_mode ?? 'prepaid', credit_balance_events: org.credit_balance_events });
  return orgs[0];
}

function generatorRequest(path: string, body: unknown): Request {
  return new Request(`https://stealthmark.io${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}`, 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify(body),
  });
}

describe('credit meter (ARQ-01)', () => {
  let db: FakeSupabase;

  beforeEach(() => {
    db = new FakeSupabase();
    state.client = db;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    state.client = null;
  });

  it('lets exactly one of 20 concurrent requests spend a balance that covers a single charge', async () => {
    const org = seed(db, { credit_balance_events: 25 });
    const results = await Promise.all(Array.from({ length: 20 }, () => chargePaidKey(API_KEY, 25)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(org.credit_balance_events).toBe(0);
  });

  it('never charges more than the balance drop under concurrency', async () => {
    const org = seed(db, { credit_balance_events: 100 });
    const results = await Promise.all(Array.from({ length: 20 }, () => chargePaidKey(API_KEY, 10)));
    const charged = results.reduce((sum, r) => sum + (r.ok ? r.charged : 0), 0);
    expect(charged).toBe(100 - Number(org.credit_balance_events));
    expect(Number(org.credit_balance_events)).toBeGreaterThanOrEqual(0);
  });

  it('charges enterprise orgs nothing', async () => {
    const org = seed(db, { credit_balance_events: 0, billing_mode: 'enterprise' });
    await expect(chargePaidKey(API_KEY, 25)).resolves.toEqual({ ok: true, orgId: ORG_ID, charged: 0 });
    expect(org.credit_balance_events).toBe(0);
  });

  it('refuses a balance below the cost without touching it', async () => {
    const org = seed(db, { credit_balance_events: 24 });
    await expect(chargePaidKey(API_KEY, 25)).resolves.toEqual({ ok: false, reason: 'insufficient_credits' });
    expect(org.credit_balance_events).toBe(24);
  });

  it('rejects malformed or unknown keys and reports a missing database as unavailable', async () => {
    seed(db, { credit_balance_events: 100 });
    await expect(chargePaidKey('sk_live_short', 10)).resolves.toEqual({ ok: false, reason: 'invalid_key' });
    await expect(chargePaidKey(`sk_live_${'b2'.repeat(16)}`, 10)).resolves.toEqual({ ok: false, reason: 'invalid_key' });
    state.client = null;
    await expect(chargePaidKey(API_KEY, 10)).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('refunds a charge back onto the balance', async () => {
    const org = seed(db, { credit_balance_events: 50 });
    const charge = await chargePaidKey(API_KEY, 25);
    expect(charge.ok).toBe(true);
    await expect(refundCharge(ORG_ID, 25)).resolves.toBe(true);
    expect(org.credit_balance_events).toBe(50);
  });

  it('does not charge a generator call whose domain is invalid', async () => {
    const org = seed(db, { credit_balance_events: 100 });
    const res = await manifestsPost(generatorRequest('/api/scan/manifests', { domain: 'not a domain' }));
    expect(res.status).toBe(400);
    expect(org.credit_balance_events).toBe(100);
  });

  it('refunds a generator charge when the gateway answers 5xx or fails', async () => {
    const org = seed(db, { credit_balance_events: 100 });

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'upstream' }, { status: 503 })));
    const failed = await manifestsPost(generatorRequest('/api/scan/manifests', { domain: 'acme.io' }));
    expect(failed.status).toBe(503);
    expect(org.credit_balance_events).toBe(100);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const thrown = await edgeShieldPost(generatorRequest('/api/scan/edge-shield', { domain: 'acme.io' }));
    expect(thrown.status).toBe(502);
    expect(org.credit_balance_events).toBe(100);
  });

  it('refunds a generator charge on any gateway 4xx and reports a secret mismatch (404) as 502', async () => {
    const org = seed(db, { credit_balance_events: 100 });

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ detail: 'Not found' }, { status: 404 })));
    for (const [post, path] of [[manifestsPost, '/api/scan/manifests'], [edgeShieldPost, '/api/scan/edge-shield']] as const) {
      const res = await post(generatorRequest(path, { domain: 'acme.io' }));
      expect(res.status).toBe(502);
      expect(JSON.stringify(await res.json())).not.toMatch(/Not found/);
    }
    expect(org.credit_balance_events).toBe(100);

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'rate_limit_exceeded' }, { status: 429 })));
    const limited = await edgeShieldPost(generatorRequest('/api/scan/edge-shield', { domain: 'acme.io' }));
    expect(limited.status).toBe(429);
    expect(org.credit_balance_events).toBe(100);
  });

  it('refunds a paid audit and answers 502 when the gateway returns its redacted public report', async () => {
    const org = seed(db, { credit_balance_events: 100 });
    const locked = { id: 'locked_headers_0', status: 'warn', locked: true, title: 'Locked finding', detail: 'Unlock this finding' };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ summary: {}, sections: { headers: [locked] } }, { status: 200 })));
    const res = await auditGet(new Request('https://stealthmark.io/api/scan/audit?domain=acme.io&fresh=1', {
      headers: { Authorization: `Bearer ${API_KEY}`, 'x-forwarded-for': '203.0.113.9' },
    }));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toMatch(/locked_/);
    expect(org.credit_balance_events).toBe(100);
  });

  it('charges 25 credits for a successful generation and says so', async () => {
    const org = seed(db, { credit_balance_events: 100 });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ files: [] }, { status: 200 })));
    const res = await manifestsPost(generatorRequest('/api/scan/manifests', { domain: 'acme.io' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Charged-Credits')).toBe('25');
    expect(org.credit_balance_events).toBe(75);
  });

  it('answers 402 without an API key and never mentions the retired $0.99 pass', async () => {
    const res = await manifestsPost(new Request('https://stealthmark.io/api/scan/manifests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'acme.io' }),
    }));
    expect(res.status).toBe(402);
    expect(JSON.stringify(await res.json())).not.toMatch(/\$0\.99|Instant/);
  });

  it('names the public origin as the 402 resource, not the self-hosted request URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://stealthmark.io');
    for (const [post, path] of [[manifestsPost, '/api/scan/manifests'], [edgeShieldPost, '/api/scan/edge-shield']] as const) {
      const res = await post(new Request(`https://localhost:3000${path}?src=docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'acme.io' }),
      }));
      expect(res.status).toBe(402);
      const body = (await res.json()) as { accepts: { resource: string }[] };
      expect(body.accepts[0].resource).toBe(`https://stealthmark.io${path}?src=docs`);
    }
  });

  it('sends the gateway secret on every gateway call, since the gateway keeps paid output to callers that hold it', async () => {
    seed(db, { credit_balance_events: 100 });
    const secret = 'g'.repeat(40);
    vi.stubEnv('GATEWAY_INTERNAL_SECRET', secret);
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ files: [], sections: {} }, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await manifestsPost(generatorRequest('/api/scan/manifests', { domain: 'acme.io' }));
    await edgeShieldPost(generatorRequest('/api/scan/edge-shield', { domain: 'acme.io' }));
    await auditGet(new Request('https://stealthmark.io/api/scan/audit?domain=acme.io&fresh=1', { headers: { 'x-forwarded-for': '203.0.113.8' } }));

    const gatewayCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/v2/'));
    expect(gatewayCalls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/api/v2/generate/manifests',
      '/api/v2/generate/edge-shield',
      '/api/v2/audit',
    ]);
    for (const [, init] of gatewayCalls) {
      expect(new Headers(init?.headers).get('x-internal-secret')).toBe(secret);
    }
  });

  it('refuses an audit without a client IP (D-5)', async () => {
    const res = await auditGet(new Request('https://stealthmark.io/api/scan/audit?domain=acme.io&fresh=1'));
    expect(res.status).toBe(429);
  });
});
