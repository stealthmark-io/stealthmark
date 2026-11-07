import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash, createHmac, randomBytes } from 'crypto';
import { NextRequest } from 'next/server';

interface QueryResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

type Resolver = (table: string, methods: string[], calls: RecordedCall[]) => QueryResult;

const state = vi.hoisted(() => ({
  client: null as unknown,
  session: null as { user: { id: string; orgId: string; email: string }; orgId: string } | null,
}));

vi.mock('../lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => state.client,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => state.client,
}));
vi.mock('../lib/session', () => ({
  getOrgSession: async () => state.session,
}));

import { POST as handlePolarWebhook } from '../app/api/webhooks/polar/route';
import { GET as keysGet, POST as keysPost, DELETE as keysDelete } from '../app/api/keys/route';
import { verifyStandardWebhook } from '../lib/polar-webhook';
import { FIX_PACK } from '../lib/offer';
import { endlessBodyRequest } from './helpers/chunked-body';

type RpcResolver = (fn: string, args: unknown) => QueryResult;

function createFakeSupabase(resolver: Resolver, rpcResolver: RpcResolver = () => ({ data: 0, error: null })) {
  const calls: RecordedCall[] = [];
  const client = {
    rpc(fn: string, args: unknown) {
      calls.push({ table: `rpc:${fn}`, method: 'rpc', args: [args] });
      return Promise.resolve(rpcResolver(fn, args));
    },
    from(table: string) {
      const methods: string[] = [];
      const builder: object = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === 'then') {
              return (resolve: (value: QueryResult) => void) => resolve(resolver(table, methods, calls));
            }
            return (...args: unknown[]) => {
              methods.push(prop);
              calls.push({ table, method: prop, args });
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  return { client, calls };
}

const SECRET_BYTES = randomBytes(32);
const SECRET = `whsec_${SECRET_BYTES.toString('base64')}`;

function sign(body: string, id: string, timestamp: string, key: Buffer = SECRET_BYTES): string {
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

function nowSeconds(offset = 0): string {
  return String(Math.floor(Date.now() / 1000) + offset);
}

function webhookRequest(body: string, headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost:3000/api/webhooks/polar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
}

function signedRequest(body: string, overrides: { id?: string; timestamp?: string; signature?: string } = {}) {
  const id = overrides.id ?? 'msg_test_1';
  const timestamp = overrides.timestamp ?? nowSeconds();
  return webhookRequest(body, {
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': overrides.signature ?? sign(body, id, timestamp),
  });
}

const ORG_ID = '0b6a6f2e-4f7c-4d63-9d2a-3a1f9d2f7c11';
const STARTER_PRODUCT_ID = '18a27e56-8407-4cad-96ad-e5f833b3be71';

function creditOrderBody(overrides: { type?: string; data?: Record<string, unknown> } = {}): string {
  return JSON.stringify({
    type: overrides.type ?? 'order.paid',
    data: {
      id: 'ord_credit_1',
      paid: true,
      status: 'paid',
      total_amount: 900,
      currency: 'usd',
      customer: { email: 'buyer@startup.com', external_id: ORG_ID },
      metadata: { org_id: ORG_ID, pack: 'starter' },
      product_id: STARTER_PRODUCT_ID,
      product: {
        id: STARTER_PRODUCT_ID,
        name: 'Starter credits',
        metadata: { kind: 'credit_pack', pack: 'starter', credits_events: '100000' },
      },
      ...overrides.data,
    },
  });
}

const proOrder = creditOrderBody();

function orgFound(table: string, methods: string[]): QueryResult {
  if (table === 'organizations' && methods.includes('select')) return { data: { id: ORG_ID }, error: null };
  return { data: null, error: null };
}

describe('verifyStandardWebhook', () => {
  const body = '{"type":"order.created"}';
  const base = { id: 'msg_1', timestamp: nowSeconds(), rawBody: body };

  it('accepts a valid whsec_ base64 signature', () => {
    expect(
      verifyStandardWebhook({ ...base, secret: SECRET, signatureHeader: sign(body, base.id, base.timestamp) }),
    ).toBe(true);
  });

  it('accepts when any space-separated v1 entry matches', () => {
    const header = `v1,${Buffer.alloc(32, 1).toString('base64')} ${sign(body, base.id, base.timestamp)}`;
    expect(verifyStandardWebhook({ ...base, secret: SECRET, signatureHeader: header })).toBe(true);
  });

  it('rejects a tampered body, wrong secret and non-v1 entries', () => {
    const valid = sign(body, base.id, base.timestamp);
    expect(verifyStandardWebhook({ ...base, rawBody: `${body} `, secret: SECRET, signatureHeader: valid })).toBe(false);
    expect(
      verifyStandardWebhook({ ...base, secret: `whsec_${randomBytes(32).toString('base64')}`, signatureHeader: valid }),
    ).toBe(false);
    expect(verifyStandardWebhook({ ...base, secret: SECRET, signatureHeader: valid.replace('v1,', 'v2,') })).toBe(false);
  });

  it('rejects timestamps more than 5 minutes old or in the future and non-numeric timestamps', () => {
    for (const offset of [-301, 301]) {
      const timestamp = nowSeconds(offset);
      expect(
        verifyStandardWebhook({ ...base, timestamp, secret: SECRET, signatureHeader: sign(body, base.id, timestamp) }),
      ).toBe(false);
    }
    expect(
      verifyStandardWebhook({ ...base, timestamp: 'abc', secret: SECRET, signatureHeader: sign(body, base.id, 'abc') }),
    ).toBe(false);
  });

  it('rejects when the secret is empty', () => {
    expect(
      verifyStandardWebhook({ ...base, secret: '', signatureHeader: sign(body, base.id, base.timestamp) }),
    ).toBe(false);
  });
});

describe('Polar Webhook Route (/api/webhooks/polar)', () => {
  beforeEach(() => {
    vi.stubEnv('POLAR_WEBHOOK_SECRET', SECRET);
    state.client = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('answers 500 webhook_not_configured when the secret is unset, without provisioning', async () => {
    vi.stubEnv('POLAR_WEBHOOK_SECRET', '');
    const fake = createFakeSupabase(() => ({ data: null, error: null }));
    state.client = fake.client;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await handlePolarWebhook(signedRequest(proOrder));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'webhook_not_configured' });
    expect(fake.calls).toHaveLength(0);
  });

  it('answers 401 for unsigned requests without touching the database', async () => {
    const fake = createFakeSupabase(() => ({ data: null, error: null }));
    state.client = fake.client;

    const res = await handlePolarWebhook(webhookRequest(proOrder, {}));
    expect(res.status).toBe(401);
    expect(fake.calls).toHaveLength(0);
  });

  it('answers 413 for a delivery over 1 MB without reading the rest or touching the database', async () => {
    const fake = createFakeSupabase(() => ({ data: null, error: null }));
    state.client = fake.client;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const endless = endlessBodyRequest('http://localhost:3000/api/webhooks/polar', { 'Content-Type': 'application/json' });

    const res = await handlePolarWebhook(new NextRequest(endless.request));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large' });
    expect(endless.pulls()).toBeLessThan(300);
    expect(fake.calls).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('answers 401 when any single signature header is missing', async () => {
    const id = 'msg_1';
    const timestamp = nowSeconds();
    const full = { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': sign(proOrder, id, timestamp) };
    for (const missing of Object.keys(full)) {
      const headers = { ...full } as Record<string, string>;
      delete headers[missing];
      const res = await handlePolarWebhook(webhookRequest(proOrder, headers));
      expect(res.status).toBe(401);
    }
  });

  it('answers 401 for an invalid signature', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const forged = sign(proOrder, 'msg_test_1', nowSeconds(), randomBytes(32));
    const res = await handlePolarWebhook(signedRequest(proOrder, { signature: forged }));
    expect(res.status).toBe(401);
  });

  it('answers 401 for the legacy hex digest scheme', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const legacy = createHmac('sha256', SECRET).update(proOrder).digest('hex');
    const res = await handlePolarWebhook(
      webhookRequest(proOrder, { 'webhook-signature': legacy, 'x-polar-signature': legacy }),
    );
    expect(res.status).toBe(401);
  });

  it('answers 401 for an expired timestamp even with a correct signature', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await handlePolarWebhook(signedRequest(proOrder, { timestamp: nowSeconds(-600) }));
    expect(res.status).toBe(401);
  });

  it('credits a paid credit pack order: records it in credit_orders, then adds 15000 credits', async () => {
    const fake = createFakeSupabase(orgFound, () => ({ data: 15_000, error: null }));
    state.client = fake.client;

    const res = await handlePolarWebhook(signedRequest(creditOrderBody()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, event: 'order.paid', credited: 15_000, balance: 15_000 });

    const insertIndex = fake.calls.findIndex((c) => c.table === 'credit_orders' && c.method === 'insert');
    const rpcIndex = fake.calls.findIndex((c) => c.method === 'rpc');
    expect(insertIndex).toBeGreaterThanOrEqual(0);
    expect(rpcIndex).toBeGreaterThan(insertIndex);
    expect(fake.calls[insertIndex].args[0]).toEqual({
      polar_order_id: 'ord_credit_1',
      org_id: ORG_ID,
      product_id: STARTER_PRODUCT_ID,
      credits_events: 15_000,
      amount_cents: 900,
      currency: 'usd',
    });
    expect(fake.calls[rpcIndex]).toMatchObject({ table: 'rpc:add_org_credits', args: [{ p_org_id: ORG_ID, p_credits: 15_000 }] });
  });

  it('falls back to the catalog credits when the product carries no metadata', async () => {
    const fake = createFakeSupabase(orgFound);
    state.client = fake.client;
    const body = creditOrderBody({ data: { product: { id: STARTER_PRODUCT_ID, name: 'Starter credits' } } });

    const res = await handlePolarWebhook(signedRequest(body));
    expect(res.status).toBe(200);
    expect(fake.calls.find((c) => c.method === 'rpc')?.args[0]).toEqual({ p_org_id: ORG_ID, p_credits: 15_000 });
  });

  it('answers 200 duplicate without crediting when the order was already recorded', async () => {
    const fake = createFakeSupabase((table, methods) =>
      table === 'credit_orders' && methods.includes('insert')
        ? { data: null, error: { message: 'duplicate key value', code: '23505' } }
        : orgFound(table, methods),
    );
    state.client = fake.client;

    const res = await handlePolarWebhook(signedRequest(creditOrderBody()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true });
    expect(fake.calls.some((c) => c.method === 'rpc')).toBe(false);
  });

  it('answers 202 unresolved with no credit when the organization cannot be matched', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = createFakeSupabase(() => ({ data: null, error: null }));
    state.client = fake.client;

    const res = await handlePolarWebhook(signedRequest(creditOrderBody()));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ unresolved: true });
    expect(warn).toHaveBeenCalled();
    expect(fake.calls.some((c) => c.method === 'insert' || c.method === 'rpc')).toBe(false);
  });

  it('resolves the organization from the customer email when no metadata or external id matches', async () => {
    const fake = createFakeSupabase((table, methods) =>
      table === 'users' && methods.includes('select') ? { data: { org_id: ORG_ID }, error: null } : { data: null, error: null },
    );
    state.client = fake.client;
    const body = creditOrderBody({ data: { metadata: {}, customer: { email: 'Buyer@Startup.com', external_id: null } } });

    const res = await handlePolarWebhook(signedRequest(body));
    expect(res.status).toBe(200);
    expect(fake.calls.filter((c) => c.method === 'eq' && c.args[0] === 'email').map((c) => c.args[1])).toEqual([
      'Buyer@Startup.com',
    ]);
    expect(fake.calls.find((c) => c.method === 'rpc')?.args[0]).toEqual({ p_org_id: ORG_ID, p_credits: 15_000 });
  });

  it('ignores order.created until the order is paid, and credits it once it is', async () => {
    const unpaid = createFakeSupabase(orgFound);
    state.client = unpaid.client;
    const pending = creditOrderBody({ type: 'order.created', data: { paid: false, status: 'pending' } });
    const ignored = await handlePolarWebhook(signedRequest(pending));
    expect(ignored.status).toBe(200);
    expect(unpaid.calls.some((c) => c.method === 'insert' || c.method === 'rpc')).toBe(false);

    const paid = createFakeSupabase(orgFound);
    state.client = paid.client;
    const credited = await handlePolarWebhook(signedRequest(creditOrderBody({ type: 'order.created' })));
    expect(credited.status).toBe(200);
    expect(paid.calls.filter((c) => c.method === 'rpc')).toHaveLength(1);
  });

  it('removes the order record and answers 500 when the credit top-up fails so Polar retries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = createFakeSupabase(orgFound, () => ({ data: null, error: { message: 'rpc down' } }));
    state.client = fake.client;

    const res = await handlePolarWebhook(signedRequest(creditOrderBody()));
    expect(res.status).toBe(500);
    expect(fake.calls.some((c) => c.table === 'credit_orders' && c.method === 'delete')).toBe(true);
  });

  it('keeps legacy subscription events as a no-op without crediting or reading billing_email', async () => {
    const fake = createFakeSupabase(() => ({ data: null, error: null }));
    state.client = fake.client;
    const legacy = (type: string) =>
      JSON.stringify({
        type,
        data: {
          id: 'sub_legacy_1',
          customer: { email: 'old@corp.ai' },
          product_id: 'ad05a29d-4556-4fc7-8307-219c35e81736',
          product: { id: 'ad05a29d-4556-4fc7-8307-219c35e81736', name: 'Business Gateway' },
        },
      });

    for (const type of ['subscription.active', 'subscription.updated', 'order.created']) {
      const res = await handlePolarWebhook(signedRequest(legacy(type)));
      expect(res.status).toBe(200);
    }
    expect(fake.calls).toHaveLength(0);
  });

  it('downgrades a legacy subscriber to developer on subscription.canceled', async () => {
    const fake = createFakeSupabase(() => ({ data: null, error: null }));
    state.client = fake.client;
    const body = JSON.stringify({
      type: 'subscription.canceled',
      data: { customer: { email: 'a@b.co' }, product_id: '4a376252-688d-4cee-a98f-abc16834884d' },
    });

    const res = await handlePolarWebhook(signedRequest(body));
    expect(res.status).toBe(200);
    const updates = fake.calls.filter((c) => c.method === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe('users');
    expect(updates[0].args[0]).toMatchObject({ plan: 'developer' });
    expect(fake.calls.some((c) => c.args[0] === 'billing_email' || c.table === 'organizations' && c.method === 'update')).toBe(false);
    expect(fake.calls.some((c) => c.method === 'rpc')).toBe(false);
  });

  it('answers 500 so Polar retries when the database lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.client = createFakeSupabase(() => ({ data: null, error: { message: 'boom' } })).client;

    const res = await handlePolarWebhook(signedRequest(proOrder));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'webhook_processing_failed' });
  });

  it('answers 400 for a correctly signed body that is not JSON', async () => {
    state.client = createFakeSupabase(() => ({ data: null, error: null })).client;
    const res = await handlePolarWebhook(signedRequest('not-json'));
    expect(res.status).toBe(400);
  });

  it('marks a paid Fix Pack order as converted for its audited domain without granting credits (D-1)', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const fake = createFakeSupabase(() => ({ data: null, error: null }));
    state.client = fake.client;
    const body = creditOrderBody({
      data: {
        product_id: FIX_PACK.productId,
        product: { id: FIX_PACK.productId, name: 'Fix & Forensic Pack', metadata: { credits_events: '15000' } },
        metadata: { audited_domain: 'Shop.Example.com', plan_tier: FIX_PACK.plan },
      },
    });

    const res = await handlePolarWebhook(signedRequest(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ fix_pack: true });
    const update = fake.calls.find((c) => c.table === 'scan_leads' && c.method === 'update');
    expect(update?.args[0]).toEqual({ converted: true });
    expect(fake.calls.find((c) => c.table === 'scan_leads' && c.method === 'eq')?.args).toEqual(['domain', 'shop.example.com']);
    expect(fake.calls.some((c) => c.method === 'rpc' || c.table === 'credit_orders')).toBe(false);
  });

  it('acknowledges a Fix Pack order even when scan_leads cannot be updated', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.client = createFakeSupabase(() => ({ data: null, error: { message: 'scan_leads down' } })).client;
    const body = creditOrderBody({
      data: { product_id: FIX_PACK.productId, product: { id: FIX_PACK.productId }, metadata: { audited_domain: 'shop.example.com' } },
    });

    const res = await handlePolarWebhook(signedRequest(body));
    expect(res.status).toBe(200);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('not marked as converted'));
  });

  it('raises an alert and provisions nothing for a paid order of an unmapped product', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = createFakeSupabase(orgFound);
    state.client = fake.client;
    const body = creditOrderBody({
      data: { product_id: 'unknown-product', product: { id: 'unknown-product', name: 'Mystery', metadata: {} } },
    });

    const res = await handlePolarWebhook(signedRequest(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ unmapped: true });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('ALERT: paid order ord_credit_1 for unmapped product unknown-product'));
    expect(fake.calls.some((c) => c.method === 'insert' || c.method === 'rpc')).toBe(false);
  });
});

describe('/api/keys Endpoint & Key Hashing Cryptography', () => {
  const ORG_ID = '11111111-1111-4111-8111-111111111111';
  const KEY_ID = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    state.client = null;
    state.session = { user: { id: 'user-1', orgId: ORG_ID, email: 'dev@acme.io' }, orgId: ORG_ID };
  });

  afterEach(() => {
    state.session = null;
    vi.restoreAllMocks();
  });

  it('rejects unauthenticated GET, POST and DELETE with 401 and no database access', async () => {
    state.session = null;
    const fake = createFakeSupabase(() => ({ data: [], error: null }));
    state.client = fake.client;

    const get = await keysGet(new NextRequest('http://localhost:3000/api/keys'));
    const post = await keysPost(
      new NextRequest('http://localhost:3000/api/keys', { method: 'POST', body: JSON.stringify({ name: 'x' }) }),
    );
    const del = await keysDelete(new NextRequest(`http://localhost:3000/api/keys?id=${KEY_ID}`, { method: 'DELETE' }));

    expect([get.status, post.status, del.status]).toEqual([401, 401, 401]);
    expect(fake.calls).toHaveLength(0);
  });

  it('mints an sk_live_ key whose stored hash is the SHA-256 of the returned key, bound to the session org', async () => {
    const fake = createFakeSupabase(() => ({ data: { id: KEY_ID, created_at: '2026-09-30T00:00:00Z' }, error: null }));
    state.client = fake.client;

    const res = await keysPost(
      new NextRequest('http://localhost:3000/api/keys', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test Autonomous Agent', scopes: ['usage:ingest'], rateLimitRpm: 120 }),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.key).toMatch(/^sk_live_[0-9a-f]{32}$/);
    expect(data.item.id).toBe(KEY_ID);
    expect(data.item.keyPrefix).toBe(`sk_live_${data.key.slice(8, 12)}...${data.key.slice(-4)}`);

    const insert = fake.calls.find((c) => c.method === 'insert');
    const row = insert?.args[0] as Record<string, unknown>;
    expect(row.key_hash).toBe(createHash('sha256').update(data.key).digest('hex'));
    expect(row.key_prefix).toBe(data.item.keyPrefix);
    expect(row.org_id).toBe(ORG_ID);
    expect(row.scopes).toEqual(['usage:ingest']);
    expect(JSON.stringify(row)).not.toContain(data.key);
  });

  it('defaults a new key to least privilege instead of the wildcard', async () => {
    const fake = createFakeSupabase(() => ({ data: { id: KEY_ID, created_at: '2026-09-30T00:00:00Z' }, error: null }));
    state.client = fake.client;
    const res = await keysPost(new NextRequest('http://localhost:3000/api/keys', { method: 'POST', body: JSON.stringify({ name: 'Default' }) }));
    expect(res.status).toBe(200);
    expect((await res.json()).item.scopes).toEqual(['usage:ingest']);
    const row = fake.calls.find((c) => c.method === 'insert')?.args[0] as Record<string, unknown>;
    expect(row.scopes).toEqual(['usage:ingest']);
  });

  it.each([['*'], ['admin'], ['platform:admin'], ['extract'], ['anything-else']])(
    'never mints a key with the scope %s',
    async (scope) => {
      const fake = createFakeSupabase(() => ({ data: { id: KEY_ID, created_at: '2026-09-30T00:00:00Z' }, error: null }));
      state.client = fake.client;
      const res = await keysPost(
        new NextRequest('http://localhost:3000/api/keys', { method: 'POST', body: JSON.stringify({ name: 'Escalate', scopes: ['usage:ingest', scope] }) }),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_scopes');
      expect(fake.calls.some((c) => c.method === 'insert')).toBe(false);
    },
  );

  it('rejects invalid scopes and rate limits with 400', async () => {
    state.client = createFakeSupabase(() => ({ data: null, error: null })).client;
    const bodies = [{ scopes: 'admin' }, { scopes: [] }, { rateLimitRpm: -1 }, { name: '' }];
    for (const body of bodies) {
      const res = await keysPost(
        new NextRequest('http://localhost:3000/api/keys', { method: 'POST', body: JSON.stringify(body) }),
      );
      expect(res.status).toBe(400);
    }
  });

  it('does not return a key when persistence fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.client = createFakeSupabase(() => ({ data: null, error: { message: 'fail' } })).client;
    const res = await keysPost(
      new NextRequest('http://localhost:3000/api/keys', { method: 'POST', body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('sk_live_');
  });

  it('lists only keys of the session org', async () => {
    const fake = createFakeSupabase(() => ({
      data: [
        {
          id: KEY_ID,
          name: 'k',
          key_prefix: 'sk_live_abc...wxyz',
          scopes: ['*'],
          rate_limit_rpm: 60,
          status: 'active',
          last_used_at: null,
          created_at: '2026-09-30T00:00:00Z',
        },
      ],
      error: null,
    }));
    state.client = fake.client;

    const res = await keysGet(new NextRequest('http://localhost:3000/api/keys'));
    expect(res.status).toBe(200);
    expect((await res.json()).keys).toHaveLength(1);
    expect(fake.calls.find((c) => c.method === 'eq')?.args).toEqual(['org_id', ORG_ID]);
  });

  it('revokes a key of the session org and scopes the update by org_id', async () => {
    const fake = createFakeSupabase(() => ({ data: [{ id: KEY_ID }], error: null }));
    state.client = fake.client;

    const res = await keysDelete(new NextRequest(`http://localhost:3000/api/keys?id=${KEY_ID}`, { method: 'DELETE' }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('revoked');
    const eqArgs = fake.calls.filter((c) => c.method === 'eq').map((c) => c.args);
    expect(eqArgs).toContainEqual(['id', KEY_ID]);
    expect(eqArgs).toContainEqual(['org_id', ORG_ID]);
  });

  it('answers 404 when the key belongs to another org or is not a UUID', async () => {
    state.client = createFakeSupabase(() => ({ data: [], error: null })).client;

    const other = await keysDelete(new NextRequest(`http://localhost:3000/api/keys?id=${KEY_ID}`, { method: 'DELETE' }));
    const malformed = await keysDelete(new NextRequest('http://localhost:3000/api/keys?id=key-123456', { method: 'DELETE' }));
    expect(other.status).toBe(404);
    expect(malformed.status).toBe(404);
  });

  it('rejects DELETE without key id', async () => {
    const res = await keysDelete(new NextRequest('http://localhost:3000/api/keys', { method: 'DELETE' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Missing key id');
  });
});
