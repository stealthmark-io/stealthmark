import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';

const fsState = vi.hoisted(() => ({
  appendFile: vi.fn<(path: string, data: string) => Promise<void>>(async () => undefined),
}));

vi.mock('fs/promises', () => ({ appendFile: fsState.appendFile }));

import { GET as checkoutGet } from '../app/api/billing/polar/checkout/route';
import { CybersecurityAuditTiers } from '../components/landing/CybersecurityAuditTiers';
import { FIX_PACK, FLEET_DEFENSE } from '../lib/offer';

const CHECKOUT_ID = 'chk_test_1234';
const POLAR_URL = `https://buy.polar.sh/checkout/${CHECKOUT_ID}`;
const POLAR_CHECKOUTS_URL = 'https://api.polar.sh/v1/checkouts/';
const TELEGRAM_URL = 'https://api.telegram.org/bottg-test-token/sendMessage';
const LOG_FILE = '/var/cache/stealthmark-web/polar_checkout_attempts.jsonl';

type FetchMock = ReturnType<typeof stubFetch>;

function stubFetch() {
  const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async (url) =>
    String(url).startsWith('https://api.telegram.org/')
      ? new Response('{}', { status: 200 })
      : new Response(JSON.stringify({ id: CHECKOUT_ID, url: POLAR_URL }), { status: 201 })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function checkoutRequest(query: string, headers?: Record<string, string>): NextRequest {
  return new NextRequest(`https://stealthmark.io/api/billing/polar/checkout?${query}`, { headers });
}

// The log line and the Telegram notice are sent after the redirect is returned, so a started checkout is awaited until it has logged.
async function startCheckout(query: string, headers?: Record<string, string>) {
  const fetchMock = stubFetch();
  const res = await checkoutGet(checkoutRequest(query, headers));
  if (res.status === 303) {
    await vi.waitFor(() => expect(console.log).toHaveBeenCalledWith('[POLAR_CHECKOUT_INITIATED]', expect.any(String)));
  }
  return { res, fetchMock };
}

function polarBody(fetchMock: FetchMock): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([url]) => String(url) === POLAR_CHECKOUTS_URL);
  expect(call).toBeDefined();
  return JSON.parse(String(call?.[1]?.body));
}

function telegramCalls(fetchMock: FetchMock) {
  return fetchMock.mock.calls.filter(([url]) => String(url).startsWith('https://api.telegram.org/'));
}

function telegramNotice(fetchMock: FetchMock): { chat_id: string; text: string } {
  const calls = telegramCalls(fetchMock);
  expect(calls).toHaveLength(1);
  expect(String(calls[0]?.[0])).toBe(TELEGRAM_URL);
  return JSON.parse(String(calls[0]?.[1]?.body));
}

function loggedRow(): Record<string, unknown> {
  expect(fsState.appendFile).toHaveBeenCalledTimes(1);
  const [file, data] = fsState.appendFile.mock.calls[0] ?? [];
  expect(file).toBe(LOG_FILE);
  expect(data?.endsWith('\n')).toBe(true);
  return JSON.parse(String(data));
}

const DOMAINS: (string | null)[] = [null, 'shop.example.com'];
const PLAN_ROWS = [
  { plan: FIX_PACK.plan, productId: FIX_PACK.productId, discounted: true },
  { plan: 'fix_pack_49', productId: FIX_PACK.productId, discounted: true },
  { plan: 'starter_pass', productId: FIX_PACK.starterProductId, discounted: false },
  { plan: FLEET_DEFENSE.plan, productId: FLEET_DEFENSE.productId, discounted: false },
].flatMap((row) => DOMAINS.map((domain) => ({ ...row, domain })));

const BOT_VISITS: { visit: string; headers: Record<string, string> }[] = [
  { visit: 'a link scanner', headers: { 'user-agent': 'Slackbot-LinkExpanding 1.0' } },
  { visit: 'a browser prefetch', headers: { purpose: 'prefetch' } },
];

beforeEach(() => {
  fsState.appendFile.mockClear();
  vi.stubEnv('POLAR_ACCESS_TOKEN', 'polar_test_token');
  vi.stubEnv('POLAR_API_KEY', '');
  vi.stubEnv('POLAR_API_BASE', '');
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tg-test-token');
  vi.stubEnv('TELEGRAM_CHAT_ID', '42');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/billing/polar/checkout: customer domain', () => {
  it('starts a Fleet checkout without a domain bound to nothing, and still redirects to Polar', async () => {
    const { res, fetchMock } = await startCheckout(`plan=${FLEET_DEFENSE.plan}`);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(POLAR_URL);
    const body = polarBody(fetchMock);
    expect(body.metadata).toEqual({ plan_tier: FLEET_DEFENSE.plan });
    expect(body.success_url).toBe('https://stealthmark.io/scan?checkout_id={CHECKOUT_ID}');
  });

  it('keeps binding the lower-cased domain, referrer and email when the visitor gives them', async () => {
    const { fetchMock } = await startCheckout(`plan=${FIX_PACK.plan}&domain=Shop.Example.com&ref=Partner_1&email=Buyer@Example.com`);

    const body = polarBody(fetchMock);
    expect(body.metadata).toEqual({ audited_domain: 'shop.example.com', plan_tier: FIX_PACK.plan, referrer_code: 'partner_1' });
    expect(body).toMatchObject({
      customer_email: 'buyer@example.com',
      success_url: 'https://stealthmark.io/scan?domain=shop.example.com&checkout_id={CHECKOUT_ID}',
    });
  });

  it.each(PLAN_ROWS)('gives $plan the product and discount of its plan when the domain is $domain', async ({ plan, productId, discounted, domain }) => {
    const { res, fetchMock } = await startCheckout(`plan=${plan}${domain ? `&domain=${domain}` : ''}`);

    expect(res.status).toBe(303);
    const body = polarBody(fetchMock);
    expect(body.products).toEqual([productId]);
    expect(body.discount_id).toBe(discounted ? FIX_PACK.discountId : undefined);
  });

  it('treats an empty domain= as no domain', async () => {
    const { res, fetchMock } = await startCheckout(`plan=${FLEET_DEFENSE.plan}&domain=`);

    expect(res.status).toBe(303);
    const body = polarBody(fetchMock);
    expect(body.metadata).toEqual({ plan_tier: FLEET_DEFENSE.plan });
    expect(body.success_url).toBe('https://stealthmark.io/scan?checkout_id={CHECKOUT_ID}');
  });

  it.each(['localhost', '10.0.0.1'])('answers 400 for the invalid domain %s without calling Polar', async (domain) => {
    const { res, fetchMock } = await startCheckout(`plan=${FLEET_DEFENSE.plan}&domain=${domain}`);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_domain' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(BOT_VISITS)('sends $visit back to /scan without a Polar checkout or a made-up domain', async ({ headers }) => {
    const bare = await startCheckout(`plan=${FLEET_DEFENSE.plan}`, headers);
    expect(bare.res.status).toBe(302);
    expect(bare.res.headers.get('location')).toBe('https://stealthmark.io/scan');
    expect(bare.fetchMock).not.toHaveBeenCalled();

    const bound = await startCheckout(`plan=${FLEET_DEFENSE.plan}&domain=shop.example.com`, headers);
    expect(bound.res.status).toBe(302);
    expect(bound.res.headers.get('location')).toBe('https://stealthmark.io/scan?domain=shop.example.com');
    expect(bound.fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/billing/polar/checkout: log and Telegram notice', () => {
  it('logs the plan and a missing domain as null, with no buyer email, address or user agent', async () => {
    await startCheckout(`plan=${FLEET_DEFENSE.plan}&email=buyer@example.com`, {
      'cf-connecting-ip': '203.0.113.9',
      'x-forwarded-for': '203.0.113.9',
      'user-agent': 'Mozilla/5.0 (Macintosh) TestBrowser/1.0',
    });

    expect(loggedRow()).toEqual({
      ts: expect.any(String),
      event: 'polar_checkout_initiated',
      domain: null,
      plan: FLEET_DEFENSE.plan,
      amount_cents: 99,
      checkout_id: CHECKOUT_ID,
      checkout_url: POLAR_URL,
    });
    const persisted = String(fsState.appendFile.mock.calls[0]?.[1]);
    const printed = String(vi.mocked(console.log).mock.calls.find(([tag]) => tag === '[POLAR_CHECKOUT_INITIATED]')?.[1]);
    for (const text of [persisted, printed]) {
      for (const personal of ['buyer@example.com', '203.0.113.9', 'TestBrowser']) {
        expect(text).not.toContain(personal);
      }
    }
  });

  it('tells Telegram that a checkout without a domain started, with neither the buyer email nor a made-up domain', async () => {
    const { fetchMock } = await startCheckout(`plan=${FLEET_DEFENSE.plan}&email=buyer@example.com`);

    const notice = telegramNotice(fetchMock);
    expect(notice.chat_id).toBe('42');
    expect(notice.text).toContain('sin dominio');
    expect(notice.text).toContain(FLEET_DEFENSE.plan);
    expect(notice.text).toContain('$0.99 USD');
    expect(notice.text).toContain(CHECKOUT_ID);
    expect(notice.text).not.toContain('stealthmark.io');
    expect(notice.text).not.toContain('buyer@example.com');
  });

  it('notifies a checkout for stealthmark.io like any other', async () => {
    const { fetchMock } = await startCheckout(`plan=${FIX_PACK.plan}&domain=stealthmark.io`);

    const notice = telegramNotice(fetchMock);
    expect(notice.text).toContain('stealthmark.io');
    expect(notice.text).toContain(CHECKOUT_ID);
    expect(loggedRow()).toMatchObject({ domain: 'stealthmark.io', plan: FIX_PACK.plan });
  });

  it.each(['TELEGRAM_CHAT_ID', 'TELEGRAM_BOT_TOKEN'])('sends no notice without %s, and the buyer still reaches Polar', async (name) => {
    vi.stubEnv(name, '');

    const { res, fetchMock } = await startCheckout(`plan=${FLEET_DEFENSE.plan}`);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(POLAR_URL);
    expect(telegramCalls(fetchMock)).toHaveLength(0);
    expect(loggedRow()).toMatchObject({ domain: null, plan: FLEET_DEFENSE.plan });
  });
});

describe('CybersecurityAuditTiers: Fix Pack CTA', () => {
  it('sends the Fix Pack to /scan, where each domain unlocks, with no checkout link', () => {
    const html = renderToStaticMarkup(createElement(CybersecurityAuditTiers));
    const checkoutLinks = [...html.matchAll(/href="([^"]*\/api\/billing\/polar\/checkout[^"]*)"/g)].map((match) => match[1]);

    expect(checkoutLinks).toEqual([]);
    expect(html).toContain('href="/scan"');
  });
});
