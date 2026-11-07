import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  session: null as { user: { id: string; orgId: string; email: string }; orgId: string } | null,
}));

vi.mock('@/lib/session', () => ({
  getOrgSession: async () => state.session,
}));

import { GET as checkoutGet } from '../app/api/billing/checkout/route';
import { CREDIT_PACKS } from '../lib/polar-products';

const ORG_ID = '0b6a6f2e-4f7c-4d63-9d2a-3a1f9d2f7c11';
const SESSION = { user: { id: 'u1', orgId: ORG_ID, email: 'dev@startup.com' }, orgId: ORG_ID };

function request(pack?: string): NextRequest {
  const query = pack === undefined ? '' : `?pack=${pack}`;
  return new NextRequest(`https://stealthmark.io/api/billing/checkout${query}`);
}

describe('GET /api/billing/checkout', () => {
  beforeEach(() => {
    state.session = null;
    vi.stubEnv('POLAR_API_KEY', 'polar_test_token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('answers 400 for a missing or unknown pack', async () => {
    state.session = SESSION;
    expect((await checkoutGet(request())).status).toBe(400);
    expect((await checkoutGet(request('enterprise'))).status).toBe(400);
  });

  it.each(['starter', 'growth', 'scale'])('redirects signed-out visitors to a login that resumes the %s checkout, without calling Polar', async (pack) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await checkoutGet(request(pack));
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.pathname + location.search).toBe(`/login?next=${encodeURIComponent(`/api/billing/checkout?pack=${pack}`)}`);
    expect(location.searchParams.get('next')).toBe(`/api/billing/checkout?pack=${pack}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the login redirect to the public origin, not the self-hosted request URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://stealthmark.io');

    const res = await checkoutGet(new NextRequest('https://localhost:3000/api/billing/checkout?pack=growth'));
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location') ?? '').origin).toBe('https://stealthmark.io');
  });

  it('answers 503 when POLAR_API_KEY is not configured', async () => {
    state.session = SESSION;
    vi.stubEnv('POLAR_API_KEY', '');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await checkoutGet(request('growth'));
    expect(res.status).toBe(503);
  });

  it('creates an org-scoped Polar checkout and redirects to it', async () => {
    state.session = SESSION;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: 'https://buy.polar.sh/checkout/abc' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await checkoutGet(request('growth'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://buy.polar.sh/checkout/abc');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.polar.sh/v1/checkouts/');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer polar_test_token');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      products: ['310f8f11-b9f9-4442-8a52-4babbef16b95'],
      customer_email: 'dev@startup.com',
      external_customer_id: ORG_ID,
      metadata: { org_id: ORG_ID, pack: 'growth' },
      success_url: 'https://stealthmark.io/dashboard?credits=purchased',
    });
    expect(body).not.toHaveProperty('organization_id');
  });

  it('falls back to the static checkout link when Polar fails, errors or answers an unexpected URL', async () => {
    state.session = SESSION;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const scale = CREDIT_PACKS.find((p) => p.pack === 'scale');
    expect(scale).toBeDefined();

    const failures: Array<() => Promise<Response>> = [
      async () => new Response('nope', { status: 500 }),
      async () => {
        throw new Error('timeout');
      },
      async () => new Response(JSON.stringify({ url: 'https://evil.example.com/pay' }), { status: 201 }),
    ];
    for (const failure of failures) {
      vi.stubGlobal('fetch', vi.fn(failure));
      const res = await checkoutGet(request('scale'));
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(scale?.checkoutUrl);
    }
  });
});
