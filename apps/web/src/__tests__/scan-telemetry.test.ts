import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { insertMock } = vi.hoisted(() => ({
  insertMock: vi.fn<(row: unknown) => Promise<{ error: null }>>(async () => ({ error: null })),
}));

vi.mock('../lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({ from: () => ({ insert: insertMock }) }),
}));

import { GET as auditGet } from '../app/api/scan/audit/route';
import { POST as engagedPost } from '../app/api/scan/engaged/route';
import { classifyUserAgent, parseAttribution, parseScanTrigger } from '../lib/scan-telemetry';

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const GATEWAY_REPORT = {
  domain: 'acme.io',
  audited_at: '2026-10-28T00:00:00Z',
  summary: { counts: { pass: 1, warn: 0, fail: 0, info: 0, error: 0 }, by_section: {} },
  sections: { dns: [{ id: 'exposed_ports_and_cves', title: 'Exposed ports and CVEs', status: 'pass', detail: 'No critical ports.' }] },
  limitations: [],
};

let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

async function audit(query: string, userAgent: string) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(structuredClone(GATEWAY_REPORT))));
  const res = await auditGet(
    new Request(`https://stealthmark.io/api/scan/audit?domain=acme.io${query}`, {
      headers: { 'x-forwarded-for': nextIp(), 'user-agent': userAgent },
    }),
  );
  expect(res.status).toBe(200);
}

function engaged(body: unknown, userAgent = BROWSER_UA, ip: string | null = nextIp()) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': userAgent };
  if (ip) headers['x-forwarded-for'] = ip;
  return engagedPost(
    new Request('https://stealthmark.io/api/scan/engaged', { method: 'POST', headers, body: JSON.stringify(body) }),
  );
}

type InsertedRow = { agent_identifier: string; source: string; metadata: Record<string, unknown> };
const lastInsert = () => insertMock.mock.calls.at(-1)?.[0] as InsertedRow;

describe('scan telemetry helpers', () => {
  it('classifies clients so only real browsers can count as human', () => {
    expect(classifyUserAgent(BROWSER_UA)).toBe('browser');
    expect(classifyUserAgent('')).toBe('empty');
    expect(classifyUserAgent('curl/8.5.0')).toBe('curl');
    expect(classifyUserAgent('python-requests/2.32.3')).toBe('script');
    expect(classifyUserAgent('Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/130.0 Safari/537.36')).toBe('headless');
    expect(classifyUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe('bot');
    expect(classifyUserAgent('StealthMarkOutboundFollowUp/1.0')).toBe('stealthmark');
    expect(classifyUserAgent('StealthMarkFollowUp/1.0')).toBe('stealthmark');
  });

  it('keeps only slug-shaped attribution and known triggers', () => {
    expect(parseAttribution('Outbound_FollowUp', null)).toBe('outbound_followup');
    expect(parseAttribution(null, 'outbound')).toBe('outbound');
    expect(parseAttribution('<script>', null)).toBeNull();
    expect(parseAttribution(null, null)).toBeNull();
    expect(parseScanTrigger('autorun')).toBe('autorun');
    expect(parseScanTrigger('email_reveal')).toBe('email_reveal');
    expect(parseScanTrigger('anything')).toBeNull();
    expect(parseScanTrigger(null)).toBeNull();
  });
});

describe('/api/scan/audit view telemetry', () => {
  beforeEach(() => insertMock.mockClear());
  afterEach(() => vi.unstubAllGlobals());

  it('records a browser view as HumanFounder with its client class, source and trigger', async () => {
    await audit('&utm_source=outbound&trigger=autorun', BROWSER_UA);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = lastInsert();
    expect(row.agent_identifier).toBe('HumanFounder');
    expect(row.source).toBe('sdk');
    expect(row.metadata).toMatchObject({ path: '/scan?domain=acme.io', ua_class: 'browser', ref: 'outbound', trigger: 'autorun' });
  });

  it('records curl and scripts as AutomatedClient, never HumanFounder', async () => {
    await audit('', 'curl/8.5.0');
    expect(lastInsert().agent_identifier).toBe('AutomatedClient');
    expect(lastInsert().metadata).toMatchObject({ ua_class: 'curl', ref: null, trigger: null });
    await audit('', '');
    expect(lastInsert().agent_identifier).toBe('AutomatedClient');
  });

  it('skips every StealthMark-owned client, not only StealthMarkOutbound', async () => {
    await audit('&ref=outbound_followup', 'StealthMarkFollowUp/1.0');
    await audit('', 'StealthMarkOutbound-Moltbook/1.0');
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('drops attribution and trigger values that are not allowlisted', async () => {
    await audit('&ref=%3Cimg%3E&trigger=evil', BROWSER_UA);
    expect(lastInsert().metadata).toMatchObject({ ref: null, trigger: null });
  });

  it('keys the scan limit on the IPv6 /64, so rotating addresses inside it does not reset it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(structuredClone(GATEWAY_REPORT))));
    const scan = (ip: string) =>
      auditGet(
        new Request('https://stealthmark.io/api/scan/audit?domain=acme.io', {
          headers: { 'x-forwarded-for': ip, 'user-agent': 'StealthMarkOutbound/1.0' },
        }),
      );
    for (let i = 1; i <= 20; i += 1) expect((await scan(`2001:db8:9:9::${i}`)).status).toBe(200);
    expect((await scan('2001:db8:9:9:ffff::1')).status).toBe(429);
    expect((await scan('2001:db8:9:a::1')).status).toBe(200);
  });

  it('caps view rows at 120 a minute across networks and still answers the scan', async () => {
    const later = Date.now() + 30 * 60_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    try {
      for (let i = 0; i < 120; i += 1) await audit('', BROWSER_UA);
      expect(insertMock).toHaveBeenCalledTimes(120);
      await audit('', BROWSER_UA);
      expect(insertMock).toHaveBeenCalledTimes(120);
    } finally {
      clock.mockRestore();
    }
  });
});

describe('/api/scan/engaged', () => {
  beforeEach(() => insertMock.mockClear());

  it('records one ScanEngaged event for a valid report view', async () => {
    const res = await engaged({ domain: 'https://Acme.io/pricing', action: 'findings_viewed', ref: 'outbound' });
    expect(res.status).toBe(204);
    const row = lastInsert();
    expect(row.agent_identifier).toBe('ScanEngaged');
    expect(row.source).toBe('sdk');
    expect(row.metadata).toMatchObject({ path: '/scan?domain=acme.io', method: 'POST', ua_class: 'browser', ref: 'outbound', action: 'findings_viewed' });
  });

  it('rejects unknown actions, bad domains and malformed bodies', async () => {
    expect((await engaged({ domain: 'acme.io', action: 'purchase' })).status).toBe(400);
    expect((await engaged({ domain: 'localhost', action: 'interaction' })).status).toBe(400);
    expect((await engaged('not-an-object')).status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('refuses a request without a client IP and skips StealthMark-owned clients', async () => {
    expect((await engaged({ domain: 'acme.io', action: 'interaction' }, BROWSER_UA, null)).status).toBe(429);
    expect((await engaged({ domain: 'acme.io', action: 'interaction' }, 'StealthMarkOutbound/1.0')).status).toBe(204);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('rate-limits one IP to 10 events a minute', async () => {
    const ip = nextIp();
    for (let i = 0; i < 10; i += 1) {
      expect((await engaged({ domain: 'acme.io', action: 'interaction' }, BROWSER_UA, ip)).status).toBe(204);
    }
    expect((await engaged({ domain: 'acme.io', action: 'interaction' }, BROWSER_UA, ip)).status).toBe(429);
  });

  it('keys the limit on the IPv6 /64, so rotating addresses inside it does not reset it', async () => {
    for (let i = 1; i <= 10; i += 1) {
      expect((await engaged({ domain: 'acme.io', action: 'interaction' }, BROWSER_UA, `2001:db8:5:6::${i}`)).status).toBe(204);
    }
    expect((await engaged({ domain: 'acme.io', action: 'interaction' }, BROWSER_UA, '2001:db8:5:6:ffff::1')).status).toBe(429);
    expect((await engaged({ domain: 'acme.io', action: 'interaction' }, BROWSER_UA, '2001:db8:5:7::1')).status).toBe(204);
  });

  it('caps the whole server at 60 events a minute across networks', async () => {
    const later = Date.now() + 10 * 60_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    try {
      for (let i = 0; i < 60; i += 1) {
        expect((await engaged({ domain: 'acme.io', action: 'interaction' })).status).toBe(204);
      }
      expect((await engaged({ domain: 'acme.io', action: 'interaction' })).status).toBe(429);
    } finally {
      clock.mockRestore();
    }
  });

  it('spends the server-wide slot only on events it records', async () => {
    const later = Date.now() + 20 * 60_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    try {
      for (let i = 0; i < 70; i += 1) {
        expect((await engaged({ domain: 'localhost', action: 'interaction' })).status).toBe(400);
      }
      expect((await engaged({ domain: 'acme.io', action: 'interaction' })).status).toBe(204);
      expect(insertMock).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });

  it('answers 415 to anything but JSON and 413 to an oversized event, and records neither', async () => {
    const plain = await engagedPost(
      new Request('https://stealthmark.io/api/scan/engaged', {
        method: 'POST',
        headers: { 'content-type': 'text/plain', 'user-agent': BROWSER_UA, 'x-forwarded-for': nextIp() },
        body: JSON.stringify({ domain: 'acme.io', action: 'interaction' }),
      }),
    );
    expect(plain.status).toBe(415);
    expect((await engaged({ domain: 'acme.io', action: 'interaction', pad: 'x'.repeat(4096) })).status).toBe(413);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
