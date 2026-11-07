import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { GET as verifyGet } from '../app/api/billing/polar/verify/route';
import { GET as badgeGet } from '../app/api/scan/badge/route';
import { issueScanUnlockToken, verifyScanUnlockToken, signBadge, verifyBadgeSignature } from '../lib/scan-unlock';
import { buildEdgeWorker } from '../lib/fix-pack-deliverables';
import { FIX_PACK } from '../lib/offer';
import { fakeLedger, unknownColumns } from './helpers/credit-orders';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const CHECKOUT_ID = 'chk_0123456789abcdef';
let ipCounter = 0;

function verifyRequest(query: string, ip: string | null = `10.0.0.${++ipCounter}`): NextRequest {
  const headers = ip ? { 'x-forwarded-for': ip } : undefined;
  return new NextRequest(`https://stealthmark.io/api/billing/polar/verify?${query}`, { headers });
}

const PAID = {
  status: 'succeeded',
  product_id: FIX_PACK.productId,
  metadata: { audited_domain: 'shop.example.com' },
};

const PAID_ORDER = { id: 'ord_1', checkout_id: CHECKOUT_ID, status: 'paid', refunded_amount: 0 };

function orderList(...items: Record<string, unknown>[]) {
  return { body: { items, pagination: { total_count: items.length, max_page: 1 } } };
}

function polarCheckout(
  body: Record<string, unknown>,
  status = 200,
  orders: { body: unknown; status?: number } = orderList(PAID_ORDER)
) {
  const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async (url) =>
    String(url).includes('/v1/orders/')
      ? new Response(JSON.stringify(orders.body), { status: orders.status ?? 200 })
      : new Response(JSON.stringify(body), { status })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function polarOrdersAnswer(answer: () => Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async (url) =>
      String(url).includes('/v1/orders/') ? answer() : new Response(JSON.stringify(PAID), { status: 200 })
    )
  );
}

describe('scan unlock token (smu1)', () => {
  beforeEach(() => vi.stubEnv('SCAN_UNLOCK_SECRET', SECRET));
  afterEach(() => vi.unstubAllEnvs());

  it('round-trips for the bound domain, normalised the same way audit does', () => {
    const token = issueScanUnlockToken({ checkoutId: CHECKOUT_ID, domain: 'Shop.Example.com', productId: 'p1' });
    expect(token).toMatch(/^smu1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(verifyScanUnlockToken(token, 'https://shop.example.com/pricing')?.dom).toBe('shop.example.com');
  });

  it('rejects another domain, a tampered payload, a forged signature and an expired token', () => {
    const now = Date.UTC(2026, 9, 23);
    const token = issueScanUnlockToken({ checkoutId: CHECKOUT_ID, domain: 'shop.example.com', productId: 'p1' }, now) ?? '';
    const [, body, sig] = token.split('.');

    expect(verifyScanUnlockToken(token, 'other.example.com', now)).toBeNull();

    const forgedBody = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), dom: 'other.example.com' })
    ).toString('base64url');
    expect(verifyScanUnlockToken(`smu1.${forgedBody}.${sig}`, 'other.example.com', now)).toBeNull();
    expect(verifyScanUnlockToken(`smu1.${body}.${sig.slice(0, -2)}AA`, 'shop.example.com', now)).toBeNull();
    expect(verifyScanUnlockToken(token, 'shop.example.com', now + 31 * 24 * 60 * 60 * 1000)).toBeNull();
  });

  it('fails closed without a secret of at least 32 characters', () => {
    vi.stubEnv('SCAN_UNLOCK_SECRET', 'short');
    expect(issueScanUnlockToken({ checkoutId: CHECKOUT_ID, domain: 'shop.example.com', productId: 'p1' })).toBeNull();
  });

  it('keeps badge and unlock signatures in separate namespaces', () => {
    const sig = signBadge('shop.example.com', 'A', 1700000000) ?? '';
    expect(verifyBadgeSignature('shop.example.com', 'A', '1700000000', sig)).toBe(true);
    expect(verifyBadgeSignature('shop.example.com', 'A+', '1700000000', sig)).toBe(false);
    expect(verifyScanUnlockToken(`smu1.e30.${sig}`, 'shop.example.com')).toBeNull();
  });
});

describe('GET /api/billing/polar/verify', () => {
  beforeEach(() => {
    vi.stubEnv('SCAN_UNLOCK_SECRET', SECRET);
    vi.stubEnv('POLAR_ACCESS_TOKEN', 'polar_test_token');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('issues a no-store token bound to the checkout metadata domain, not the query domain', async () => {
    const fetchMock = polarCheckout(PAID);
    const res = await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}&domain=attacker.example.org`));

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { domain: string; unlock_token: string; deliverables: { cloudflare_worker_code: string } };
    expect(body.domain).toBe('shop.example.com');
    expect(verifyScanUnlockToken(body.unlock_token, 'shop.example.com')).not.toBeNull();
    expect(verifyScanUnlockToken(body.unlock_token, 'attacker.example.org')).toBeNull();
    expect(body.deliverables.cloudflare_worker_code).toContain('const TARGET_DOMAIN = "shop.example.com";');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`https://api.polar.sh/v1/checkouts/${CHECKOUT_ID}`);
  });

  it('uses POLAR_API_BASE so Preview can run against the Polar sandbox', async () => {
    vi.stubEnv('POLAR_API_BASE', 'https://sandbox-api.polar.sh/');
    const fetchMock = polarCheckout(PAID);
    await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`https://sandbox-api.polar.sh/v1/checkouts/${CHECKOUT_ID}`);
  });

  it('answers 202 while the checkout is only confirmed, without looking up its orders', async () => {
    const fetchMock = polarCheckout({ ...PAID, status: 'confirmed' });
    const res = await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`));
    expect(res.status).toBe(202);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('answers 402 for a credit-pack checkout, an unpaid one or an unknown one, without looking up orders', async () => {
    let fetchMock = polarCheckout({ ...PAID, product_id: 'starter-product-id' });
    expect((await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`))).status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock = polarCheckout({ ...PAID, status: 'open' });
    expect((await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`))).status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock = polarCheckout({ detail: 'not found' }, 404);
    expect((await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`))).status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('looks up the order of a paid checkout with the same token', async () => {
    const fetchMock = polarCheckout(PAID);
    expect((await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`))).status).toBe(200);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`https://api.polar.sh/v1/orders/?checkout_id=${CHECKOUT_ID}&limit=10`);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer polar_test_token' },
      cache: 'no-store',
    });
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('answers 402 checkout_refunded for a refunded or voided order, but not for a partial refund', async () => {
    for (const status of ['refunded', 'void']) {
      polarCheckout(PAID, 200, orderList({ ...PAID_ORDER, status, refunded_amount: 2900 }));
      const res = await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`));
      expect(res.status).toBe(402);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(((await res.json()) as { error: string }).error).toBe('checkout_refunded');
    }

    polarCheckout(PAID, 200, orderList({ ...PAID_ORDER, status: 'partially_refunded', refunded_amount: 500 }));
    expect((await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`))).status).toBe(200);
  });

  it('refuses a refunded checkout whose id arrives in upper case or without hyphens', async () => {
    const uuid = '6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b';
    for (const checkoutId of [uuid.toUpperCase(), uuid.replace(/-/g, ''), uuid.toUpperCase().replace(/-/g, '')]) {
      polarCheckout(PAID, 200, orderList({ ...PAID_ORDER, checkout_id: uuid, status: 'refunded', refunded_amount: 2900 }));
      const res = await verifyGet(verifyRequest(`checkout_id=${checkoutId}`));
      expect(res.status).toBe(402);
      expect(((await res.json()) as { error: string }).error).toBe('checkout_refunded');
    }
  });

  it('refuses a checkout when any of its orders was refunded', async () => {
    const refunded = { ...PAID_ORDER, id: 'ord_2', status: 'refunded', refunded_amount: 2900 };
    for (const orders of [orderList(PAID_ORDER, refunded), orderList(refunded, PAID_ORDER)]) {
      polarCheckout(PAID, 200, orders);
      expect((await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`))).status).toBe(402);
    }
  });

  it('only counts orders of the checkout being redeemed', async () => {
    polarCheckout(PAID, 200, orderList({ ...PAID_ORDER, checkout_id: 'chk_another_checkout', status: 'refunded' }, PAID_ORDER));
    expect((await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`))).status).toBe(200);
  });

  it('answers 502 when the order lookup fails', async () => {
    polarCheckout(PAID, 200, { body: { detail: 'upstream error' }, status: 500 });
    const res = await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe('polar_unavailable');
  });

  it('answers 502 when the order lookup throws, times out or its body breaks off', async () => {
    const failures: (() => Promise<Response>)[] = [
      async () => {
        throw new TypeError('fetch failed');
      },
      async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      },
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError('terminated'));
            },
          }),
          { status: 200 }
        ),
    ];
    for (const answer of failures) {
      polarOrdersAnswer(answer);
      const res = await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`));
      expect(res.status).toBe(502);
      expect(((await res.json()) as { error: string }).error).toBe('polar_unavailable');
    }
  });

  it('stays open, with an alert, when the token cannot read orders or Polar returns no readable order', async () => {
    polarCheckout(PAID, 200, { body: { detail: 'insufficient_scope' }, status: 403 });
    expect((await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`))).status).toBe(200);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(expect.stringContaining('orders:read'));

    for (const orders of [orderList(), { body: { items: 'nope' } }, { body: null }]) {
      polarCheckout(PAID, 200, orders);
      expect((await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`))).status).toBe(200);
    }

    polarOrdersAnswer(async () => new Response('{', { status: 200 }));
    expect((await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`))).status).toBe(200);
  });

  it('answers 409 when a paid checkout carries no audited_domain', async () => {
    polarCheckout({ ...PAID, metadata: {} });
    const res = await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}&domain=shop.example.com`));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('domain_binding_missing');
  });

  it('answers 402 checkout_refunded before it checks the domain binding', async () => {
    polarCheckout({ ...PAID, metadata: {} }, 200, orderList({ ...PAID_ORDER, status: 'refunded', refunded_amount: 2900 }));
    const res = await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`));
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: string }).error).toBe('checkout_refunded');
  });

  it('answers 400 for a malformed domain or checkout id without calling Polar', async () => {
    const fetchMock = polarCheckout(PAID);
    expect((await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}&domain=a%0aevil`))).status).toBe(400);
    expect((await verifyGet(verifyRequest('checkout_id=../../admin'))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 503 without SCAN_UNLOCK_SECRET', async () => {
    vi.stubEnv('SCAN_UNLOCK_SECRET', '');
    const fetchMock = polarCheckout(PAID);
    expect((await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`))).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses requests without a client IP and rate-limits each IP', async () => {
    polarCheckout(PAID);
    expect((await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`, null))).status).toBe(429);

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`, '192.0.2.77'))).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('GET /api/billing/polar/verify: sale record and alert', () => {
  const TELEGRAM_URL = 'https://api.telegram.org/bottg-test-token/sendMessage';
  const REFERRED = {
    ...PAID,
    total_amount: 2450,
    customer_email: 'buyer@example.com',
    metadata: { audited_domain: 'shop.example.com', referrer_code: 'Partner_1' },
  };

  function telegramCalls(fetchMock: ReturnType<typeof polarCheckout>) {
    return fetchMock.mock.calls.filter(([url]) => String(url) === TELEGRAM_URL);
  }

  beforeEach(() => {
    vi.stubEnv('SCAN_UNLOCK_SECRET', SECRET);
    vi.stubEnv('POLAR_ACCESS_TOKEN', 'polar_test_token');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tg-test-token');
    vi.stubEnv('TELEGRAM_CHAT_ID', '42');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('records the sale in the real credit_orders columns and sends one alert with only chat_id and text', async () => {
    const ledger = fakeLedger();
    const fetchMock = polarCheckout(REFERRED);

    expect((await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`))).status).toBe(200);

    const row = ledger.insert.mock.calls[0]?.[0];
    expect(unknownColumns(row)).toEqual([]);
    expect(row).toMatchObject({
      polar_order_id: `polar_fixpack_${CHECKOUT_ID}`,
      amount_cents: 2450,
      tx_hash: CHECKOUT_ID,
      referrer_code: 'partner_1',
      commission_cents: 735,
    });
    const alerts = telegramCalls(fetchMock);
    expect(alerts).toHaveLength(1);
    const alert = JSON.parse(String(alerts[0]?.[1]?.body));
    expect(Object.keys(alert).sort()).toEqual(['chat_id', 'parse_mode', 'text']);
    expect(alert.chat_id).toBe('42');
  });

  it('names the domain, amount and checkout in the alert, and leaves the buyer email out', async () => {
    fakeLedger();
    const fetchMock = polarCheckout({ ...REFERRED, customer: { email: 'buyer@example.com' } });

    expect((await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`))).status).toBe(200);

    const { text } = JSON.parse(String(telegramCalls(fetchMock)[0]?.[1]?.body));
    expect(text).toContain('shop.example.com');
    expect(text).toContain('$24.50 USD');
    expect(text).toContain(CHECKOUT_ID);
    expect(text).not.toContain('buyer@example.com');
  });

  it('records and announces a paid checkout that carries no domain, then answers 409', async () => {
    const ledger = fakeLedger();
    const fetchMock = polarCheckout({ ...REFERRED, total_amount: 14900, metadata: {} });

    const res = await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('domain_binding_missing');
    expect(ledger.insert.mock.calls[0]?.[0]).toMatchObject({
      polar_order_id: `polar_fixpack_${CHECKOUT_ID}`,
      amount_cents: 14900,
    });
    const { text } = JSON.parse(String(telegramCalls(fetchMock)[0]?.[1]?.body));
    expect(text).toContain('sin dominio');
    expect(text).toContain('$149.00 USD');
  });

  it('sends no second alert when the checkout was already recorded', async () => {
    fakeLedger({ insertError: { code: '23505' } });
    const fetchMock = polarCheckout(REFERRED);

    expect((await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`))).status).toBe(200);
    expect(telegramCalls(fetchMock)).toHaveLength(0);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('still delivers a paid checkout when the insert fails, and logs only the error code', async () => {
    fakeLedger({ insertError: { code: '08006' } });
    const fetchMock = polarCheckout(REFERRED);

    expect((await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`))).status).toBe(200);
    expect(console.error).toHaveBeenCalledWith('[Fix Pack Verify] credit_orders insert failed: 08006');
    expect(telegramCalls(fetchMock)).toHaveLength(0);
  });

  it.each(['TELEGRAM_CHAT_ID', 'TELEGRAM_BOT_TOKEN'])('sends no alert without %s', async (name) => {
    vi.stubEnv(name, '');
    fakeLedger();
    const fetchMock = polarCheckout(REFERRED);

    expect((await verifyGet(verifyRequest(`checkout_id=${CHECKOUT_ID}`))).status).toBe(200);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('https://api.telegram.org/'))).toBe(false);
  });

  it('starts no subprocess and reads nothing from a home directory', () => {
    const source = readFileSync(new URL('../app/api/billing/polar/verify/route.ts', import.meta.url), 'utf8');
    for (const banned of ['child_process', 'spawn(', 'execFile', '/home/']) {
      expect(source).not.toContain(banned);
    }
  });
});

describe('GET /api/scan/badge (CRO-06)', () => {
  beforeEach(() => vi.stubEnv('SCAN_UNLOCK_SECRET', SECRET));
  afterEach(() => vi.unstubAllEnvs());

  async function badgeSvg(query: string): Promise<string> {
    return (await badgeGet(new NextRequest(`https://stealthmark.io/api/scan/badge?${query}`))).text();
  }

  it('shows the grade only when the audit signature matches', async () => {
    const sig = signBadge('acme.io', 'B', 1_790_000_000) ?? '';
    const signed = await badgeSvg(`domain=acme.io&grade=B&t=1790000000&sig=${sig}`);
    expect(signed).toContain('B · acme.io');
    expect(signed).not.toContain('UNVERIFIED');

    const forged = await badgeSvg(`domain=acme.io&grade=A%2B&t=1790000000&sig=${sig}`);
    expect(forged).toContain('UNVERIFIED');
    expect(forged).not.toContain('A+');
  });

  it('never reflects query input into the SVG without a valid signature', async () => {
    const svg = await badgeSvg('domain=%3Cscript%3E&grade=%3C%2Ftext%3E%3Cscript%3E');
    expect(svg).toContain('UNVERIFIED');
    expect(svg).not.toContain('<script>');
  });
});

describe('Fix Pack edge worker', () => {
  it('ships a short HSTS max-age without includeSubDomains or preload', () => {
    const worker = buildEdgeWorker('shop.example.com');
    expect(worker).toContain('"Strict-Transport-Security", "max-age=300"');
    expect(worker).not.toMatch(/includeSubDomains;|preload"/);
    expect(worker).toContain('StealthMark Security Team <security@stealthmark.io>');
    expect(worker).not.toMatch(/founder@/);
  });

  it('embeds a random fallback secret per download instead of one derived from the domain', () => {
    const fallbackSecret = (worker: string) => worker.match(/const FALLBACK_DOMAIN_SECRET = "([^"]*)";/)?.[1];
    const first = fallbackSecret(buildEdgeWorker('shop.example.com'));
    const second = fallbackSecret(buildEdgeWorker('shop.example.com'));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });
});
