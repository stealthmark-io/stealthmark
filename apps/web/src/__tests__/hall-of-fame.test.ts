import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createClient } from '@supabase/supabase-js';
import { POST as claimPost } from '../app/api/leaderboard/claim/route';
import * as confirmRoute from '../app/api/leaderboard/confirm/route';
import * as removeRoute from '../app/api/leaderboard/remove/route';
import LeaderboardPage from '../app/leaderboard/page';
import ConfirmHallOfFamePage from '../app/leaderboard/confirm/page';
import RemoveHallOfFamePage from '../app/leaderboard/remove/page';
import { clientNetwork } from '../lib/client-ip';
import {
  emailMatchesDomain,
  issueHallOfFameClaimToken,
  issueHallOfFameRemoveToken,
  listHallOfFame,
  verifyHallOfFameClaimToken,
  verifyHallOfFameRemoveToken,
  type HallOfFameEntry,
} from '../lib/hall-of-fame';
import { signHallOfFameBody, type HallOfFameTokenPurpose } from '../lib/scan-unlock';

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

interface Call {
  method: string;
  args: unknown[];
}

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('../lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => state.client,
}));

const SECRET = 'hall-of-fame-test-secret-0123456789abcdef';
const DAY_MS = 24 * 60 * 60 * 1000;

function fakeSupabase(result: QueryResult) {
  const calls: Call[] = [];
  const builder: object = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') return (resolve: (value: QueryResult) => void) => resolve(result);
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
          return builder;
        };
      },
    },
  );
  state.client = {
    from(table: string) {
      calls.push({ method: 'from', args: [table] });
      return builder;
    },
    rpc(fn: string, params: unknown) {
      calls.push({ method: 'rpc', args: [fn, params] });
      return builder;
    },
  };
  return calls;
}

/** Signs any payload the way the site does, to build links in the shape older code issued. */
function signedToken(purpose: HallOfFameTokenPurpose, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `hof1.${body}.${signHallOfFameBody(purpose, body)}`;
}

const isoSecond = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString();

let domainCounter = 0;
const uniqueDomain = () => `hof-test-${++domainCounter}.com`;
let ipCounter = 0;
const uniqueIp = () => `203.0.113.${++ipCounter}`;

function claimRequest(body: unknown, ip: string | null = uniqueIp()): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (ip) headers['cf-connecting-ip'] = ip;
  return new Request('http://localhost/api/leaderboard/claim', { method: 'POST', headers, body: JSON.stringify(body) });
}

function formRequest(path: string, token: string, padding = 0): Request {
  const form = new FormData();
  form.set('token', token);
  if (padding) form.set('padding', 'x'.repeat(padding));
  return new Request(`http://localhost${path}`, { method: 'POST', body: form });
}

/**
 * A gateway report graded the way /scan grades it: 0 warnings is A+ (100), 1 is A (92), 2 is B (84).
 * `ports` is the status of the open-port check, or null when the report leaves it out.
 */
function gatewayReport(warns: number, options: { ports?: string | null; locked?: boolean } = {}) {
  const item = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, title: id, status, detail: '', ...extra });
  const dns = [item('caa_record', 'pass')];
  if (options.ports !== null) dns.push(item('exposed_ports_and_cves', options.ports ?? 'pass'));
  const headers = Array.from({ length: warns }, (_, i) => item(`header_${i}`, 'warn'));
  const transport = [item('https', 'pass', options.locked ? { locked: true } : {})];
  const counts = (pass: number, warn: number) => ({ pass, warn, fail: 0, info: 0, error: 0 });
  return {
    domain: 'ignored.example',
    audited_at: '2026-10-28T00:00:00Z',
    sections: { transport, dns, crawl_policy: [], ai_surface: [], headers },
    summary: {
      counts: counts(dns.length + transport.length, warns),
      by_section: { transport: counts(transport.length, 0), dns: counts(dns.length, 0), headers: counts(0, warns) },
    },
    limitations: [],
  };
}

interface SentEmail {
  from: string;
  to: string[];
  reply_to: string;
  subject: string;
  text: string;
}

function stubFetch(audit: () => Response, resendStatus = 200) {
  const sent: SentEmail[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/v2/audit?domain=')) return audit();
    if (url === 'https://api.resend.com/emails') {
      sent.push(JSON.parse(String(init?.body)) as SentEmail);
      return new Response('{}', { status: resendStatus });
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, sent };
}

const auditOf = (warns: number, options?: { ports?: string | null; locked?: boolean }) => () =>
  Response.json(gatewayReport(warns, options));

const entry = (domain: string, overrides: Partial<HallOfFameEntry> = {}): HallOfFameEntry => ({
  domain,
  grade: 'A+',
  score: 100,
  audited_at: '2026-10-28T10:00:00.000Z',
  ...overrides,
});
const STEALTHMARK_ENTRY: HallOfFameEntry = { domain: 'stealthmark.io', grade: 'A+', score: 100, audited_at: '2026-10-29T00:00:00.000Z' };

beforeEach(() => {
  vi.stubEnv('SCAN_UNLOCK_SECRET', SECRET);
  vi.stubEnv('RESEND_API_KEY', 're_test_key');
  fakeSupabase({ data: null, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  state.client = null;
});

describe('emailMatchesDomain', () => {
  it('accepts a role mailbox at the domain, ignoring a leading www. and case', () => {
    expect(emailMatchesDomain('security@example.com', 'example.com')).toBe(true);
    expect(emailMatchesDomain('Webmaster@Example.COM', 'example.com')).toBe(true);
    expect(emailMatchesDomain('admin@example.com', 'www.example.com')).toBe(true);
    expect(emailMatchesDomain('hostmaster@example.com', 'example.com')).toBe(true);
  });

  it('rejects any other mailbox at the domain, since anyone with an account there could read it', () => {
    expect(emailMatchesDomain('ops@example.com', 'example.com')).toBe(false);
    expect(emailMatchesDomain('security+hof@example.com', 'example.com')).toBe(false);
    expect(emailMatchesDomain('jane.doe@example.com', 'example.com')).toBe(false);
  });

  it('rejects another domain, a subdomain mailbox and malformed addresses', () => {
    expect(emailMatchesDomain('security@other.com', 'example.com')).toBe(false);
    expect(emailMatchesDomain('security@mail.example.com', 'example.com')).toBe(false);
    expect(emailMatchesDomain('not-an-email', 'example.com')).toBe(false);
  });

  it('rejects free mail providers, including a claim on the provider itself', () => {
    expect(emailMatchesDomain('admin@gmail.com', 'gmail.com')).toBe(false);
    expect(emailMatchesDomain('security@outlook.com', 'outlook.com')).toBe(false);
  });
});

describe('clientNetwork', () => {
  it('keys IPv4 on the address and IPv6 on its /64', () => {
    expect(clientNetwork('203.0.113.7')).toBe('203.0.113.7');
    expect(clientNetwork('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientNetwork('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(clientNetwork('2001:0DB8:0001:0002::abcd')).toBe('2001:db8:1:2::/64');
    expect(clientNetwork('2001:db8::1')).toBe('2001:db8:0:0::/64');
  });
});

describe('Hall of Fame tokens', () => {
  const now = Date.parse('2026-10-28T12:00:00.000Z');

  it('round-trips a claim and expires it after 24 hours', () => {
    const token = issueHallOfFameClaimToken(entry('example.com', { grade: 'A', score: 92 }), now);
    expect(token).toMatch(/^hof1\./);
    const valid = verifyHallOfFameClaimToken(token, now + DAY_MS - 1000);
    expect(valid).toEqual({
      status: 'valid',
      claim: { ...entry('example.com', { grade: 'A', score: 92 }), expiresAt: now + DAY_MS, issuedAt: now },
    });
    expect(verifyHallOfFameClaimToken(token, now + DAY_MS)).toEqual({ status: 'expired' });
  });

  it('rejects a tampered body, a foreign secret and a token of the other purpose', () => {
    const claim = issueHallOfFameClaimToken(entry('example.com'), now) ?? '';
    const [body, signature] = claim.slice('hof1.'.length).split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString('utf8')), dom: 'attacker.com' }),
    ).toString('base64url');
    expect(verifyHallOfFameClaimToken(`hof1.${forged}.${signature}`, now)).toEqual({ status: 'invalid' });

    const remove = issueHallOfFameRemoveToken('example.com');
    expect(verifyHallOfFameClaimToken(remove, now)).toEqual({ status: 'invalid' });
    expect(verifyHallOfFameRemoveToken(claim)).toBeNull();

    vi.stubEnv('SCAN_UNLOCK_SECRET', 'a-different-secret-0123456789abcdef0123');
    expect(verifyHallOfFameClaimToken(claim, now)).toEqual({ status: 'invalid' });
    expect(verifyHallOfFameRemoveToken(remove)).toBeNull();
  });

  it('round-trips a removal token with its issue time, and refuses invalid domains', () => {
    expect(verifyHallOfFameRemoveToken(issueHallOfFameRemoveToken('example.com', now + 999))).toEqual({
      domain: 'example.com',
      issuedAt: now,
    });
    expect(issueHallOfFameRemoveToken('Not A Domain')).toBeNull();
    expect(verifyHallOfFameRemoveToken('hof1.garbage.sig')).toBeNull();
    expect(verifyHallOfFameRemoveToken(null)).toBeNull();
  });

  it('accepts links issued before issue times were recorded, and refuses a malformed issue time', () => {
    const exp = now / 1000 + DAY_MS / 1000;
    const claim = { v: 1, dom: 'example.com', grade: 'A+', score: 100, at: entry('x.com').audited_at, exp };
    expect(verifyHallOfFameClaimToken(signedToken('hof_claim', claim), now)).toEqual({
      status: 'valid',
      claim: { ...entry('example.com'), expiresAt: now + DAY_MS, issuedAt: null },
    });
    expect(verifyHallOfFameRemoveToken(signedToken('hof_remove', { v: 1, dom: 'example.com' }))).toEqual({
      domain: 'example.com',
      issuedAt: null,
    });

    for (const iat of ['1761652800', null]) {
      expect(verifyHallOfFameClaimToken(signedToken('hof_claim', { ...claim, iat }), now)).toEqual({ status: 'invalid' });
      expect(verifyHallOfFameRemoveToken(signedToken('hof_remove', { v: 1, dom: 'example.com', iat }))).toBeNull();
    }
  });

  it('issues nothing while SCAN_UNLOCK_SECRET is unset or short', () => {
    vi.stubEnv('SCAN_UNLOCK_SECRET', '');
    expect(issueHallOfFameClaimToken(entry('example.com'), now)).toBeNull();
    vi.stubEnv('SCAN_UNLOCK_SECRET', 'short');
    expect(issueHallOfFameRemoveToken('example.com')).toBeNull();
  });
});

describe('POST /api/leaderboard/claim', () => {
  it('audits, then emails a confirmation from the team with confirm and remove links', async () => {
    const calls = fakeSupabase({ data: null, error: null });
    const domain = uniqueDomain();
    const ip = uniqueIp();
    const { fetchMock, sent } = stubFetch(auditOf(0));

    const res = await claimPost(claimRequest({ domain, email: `security@${domain}` }, ip));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, grade: 'A+', score: 100 });
    // The claim form opens only once the 20261029 migration, which adds this table, is applied.
    expect(calls[0]).toEqual({ method: 'from', args: ['hall_of_fame_removals'] });

    const auditCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/v2/audit'));
    const auditHeaders = new Headers(auditCall?.[1]?.headers);
    expect(String(auditCall?.[0])).toContain(`domain=${domain}`);
    expect(auditHeaders.get('x-forwarded-for')).toBe(ip);
    expect(auditHeaders.get('x-internal-secret')).toBeTruthy();

    expect(sent).toHaveLength(1);
    const [email] = sent;
    expect(email.from).toBe('StealthMark Security Team <security@stealthmark.io>');
    expect(email.reply_to).toBe('security@stealthmark.io');
    expect(email.to).toEqual([`security@${domain}`]);
    expect(email.text.trimEnd().endsWith('StealthMark Security Team\nhttps://stealthmark.io')).toBe(true);

    const confirm = /https:\/\/stealthmark\.io\/leaderboard\/confirm\?token=(\S+)/.exec(email.text);
    const remove = /https:\/\/stealthmark\.io\/leaderboard\/remove\?token=(\S+)/.exec(email.text);
    const claimToken = decodeURIComponent(confirm?.[1] ?? '');
    const check = verifyHallOfFameClaimToken(claimToken);
    expect(check.status).toBe('valid');
    if (check.status === 'valid') {
      expect(check.claim).toMatchObject({ domain, grade: 'A+', score: 100 });
      // Both links of one email carry the same issue time, so its removal link also cancels its confirmation link.
      expect(verifyHallOfFameRemoveToken(decodeURIComponent(remove?.[1] ?? ''))).toEqual({ domain, issuedAt: check.claim.issuedAt });
    }
    expect(email.text).toContain('(it also cancels the confirmation link above)');
    expect(email.text).toContain(`If a newer claim for ${domain} is confirmed, use the removal link in that claim's email instead.`);

    const tokenBody = Buffer.from(claimToken.slice('hof1.'.length).split('.')[0], 'base64url').toString('utf8');
    expect(tokenBody).not.toContain('@');
  });

  it('stamps both links with the time the audit finished, so a removal used during the audit does not cancel them', async () => {
    const T0 = Date.parse('2026-10-29T12:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0 + 100);
    const domain = uniqueDomain();
    const { sent } = stubFetch(() => {
      vi.setSystemTime(T0 + 1900);
      return Response.json(gatewayReport(0));
    });

    expect((await claimPost(claimRequest({ domain, email: `security@${domain}` }))).status).toBe(200);
    const link = (page: string) =>
      decodeURIComponent(new RegExp(`/leaderboard/${page}\\?token=(\\S+)`).exec(sent[0]?.text ?? '')?.[1] ?? '');
    const check = verifyHallOfFameClaimToken(link('confirm'));
    expect(check.status).toBe('valid');
    if (check.status === 'valid') expect(check.claim.issuedAt).toBe(T0 + 1000);
    expect(verifyHallOfFameRemoveToken(link('remove'))).toEqual({ domain, issuedAt: T0 + 1000 });
  });

  it('refuses a grade below A with the grade and score, and sends nothing', async () => {
    const domain = uniqueDomain();
    const { sent } = stubFetch(auditOf(2));
    const res = await claimPost(claimRequest({ domain, email: `security@${domain}` }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ grade: 'B', score: 84 });
    expect(sent).toHaveLength(0);
  });

  it('lists an A (one warning) the same way /scan grades it', async () => {
    const domain = uniqueDomain();
    stubFetch(auditOf(1));
    const res = await claimPost(claimRequest({ domain, email: `security@${domain}` }));
    expect(await res.json()).toEqual({ ok: true, grade: 'A', score: 92 });
  });

  it('rejects bad input and mismatched or free mail addresses before auditing', async () => {
    const { fetchMock } = stubFetch(auditOf(0));
    expect((await claimPost(claimRequest({ domain: 'localhost', email: 'ops@localhost' }))).status).toBe(400);
    expect((await claimPost(claimRequest({ domain: 'example.com' }))).status).toBe(400);
    expect((await claimPost(claimRequest({ domain: 'example.com', email: 'security@other.com' }))).status).toBe(422);
    expect((await claimPost(claimRequest({ domain: 'example.com', email: 'ops@example.com' }))).status).toBe(422);
    expect((await claimPost(claimRequest({ domain: 'gmail.com', email: 'admin@gmail.com' }))).status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 415 to anything but JSON, so a cross-site form cannot post a claim', async () => {
    const domain = uniqueDomain();
    const { fetchMock } = stubFetch(auditOf(0));
    const res = await claimPost(
      new Request('http://localhost/api/leaderboard/claim', {
        method: 'POST',
        headers: { 'content-type': 'text/plain', 'cf-connecting-ip': uniqueIp() },
        body: JSON.stringify({ domain, email: `security@${domain}` }),
      }),
    );
    expect(res.status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 413 to an oversized claim before auditing', async () => {
    const domain = uniqueDomain();
    const { fetchMock } = stubFetch(auditOf(0));
    const res = await claimPost(claimRequest({ domain, email: `security@${domain}`, pad: 'x'.repeat(4096) }));
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 429 without a client IP', async () => {
    const domain = uniqueDomain();
    const { fetchMock } = stubFetch(auditOf(0));
    const res = await claimPost(claimRequest({ domain, email: `security@${domain}` }, null));
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 503 and sends nothing while Resend, the secret or the 20261029 migration is missing', async () => {
    const domain = uniqueDomain();
    const body = { domain, email: `security@${domain}` };
    const { fetchMock } = stubFetch(auditOf(0));

    vi.stubEnv('RESEND_API_KEY', '');
    expect((await claimPost(claimRequest(body))).status).toBe(503);
    vi.stubEnv('RESEND_API_KEY', 're_test_key');

    vi.stubEnv('SCAN_UNLOCK_SECRET', '');
    expect((await claimPost(claimRequest(body))).status).toBe(503);
    vi.stubEnv('SCAN_UNLOCK_SECRET', SECRET);

    fakeSupabase({ data: null, error: { message: 'relation "public.hall_of_fame_removals" does not exist' } });
    expect((await claimPost(claimRequest(body))).status).toBe(503);

    state.client = null;
    expect((await claimPost(claimRequest(body))).status).toBe(503);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stays closed when the 20261029 migration is missing, which supabase-js reports only on a GET', async () => {
    const methods: string[] = [];
    const missingTable = {
      code: 'PGRST205',
      details: null,
      hint: null,
      message: "Could not find the table 'public.hall_of_fame_removals' in the schema cache",
    };
    state.client = createClient('https://project.supabase.co', 'service-role-test-key', {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        // PostgREST's answers for a missing table: a HEAD gets an empty 404, which supabase-js reads as a success.
        fetch: async (_input: string | URL | Request, init?: RequestInit) => {
          methods.push(init?.method ?? 'GET');
          return init?.method === 'HEAD' ? new Response(null, { status: 404 }) : Response.json(missingTable, { status: 404 });
        },
      },
    });
    const domain = uniqueDomain();
    const { fetchMock, sent } = stubFetch(auditOf(0));

    expect((await claimPost(claimRequest({ domain, email: `security@${domain}` }))).status).toBe(503);
    expect(methods).toEqual(['GET']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('refuses a redacted report, and one whose port and CVE check did not run', async () => {
    const domain = uniqueDomain();
    const body = { domain, email: `security@${domain}` };

    const locked = stubFetch(auditOf(0, { locked: true }));
    expect((await claimPost(claimRequest(body))).status).toBe(502);
    expect(locked.sent).toHaveLength(0);

    const notAssessed = stubFetch(auditOf(0, { ports: 'not_assessed' }));
    const res = await claimPost(claimRequest(body));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/could not be checked/);
    expect(notAssessed.sent).toHaveLength(0);

    const noPorts = stubFetch(auditOf(0, { ports: null }));
    expect((await claimPost(claimRequest(body))).status).toBe(422);
    expect(noPorts.sent).toHaveLength(0);

    stubFetch(auditOf(0));
    expect((await claimPost(claimRequest(body))).status).toBe(200);
  });

  it('passes a gateway 429 through and maps other gateway failures to 502', async () => {
    const domain = uniqueDomain();
    const body = { domain, email: `security@${domain}` };

    stubFetch(() => new Response('{}', { status: 429 }));
    expect((await claimPost(claimRequest(body))).status).toBe(429);

    stubFetch(() => new Response('oops', { status: 500 }));
    expect((await claimPost(claimRequest(body))).status).toBe(502);

    stubFetch(() => new Response('not json', { status: 200 }));
    expect((await claimPost(claimRequest(body))).status).toBe(502);
  });

  it('answers 502 when Resend fails, without spending the domain quota', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const domain = uniqueDomain();
    const body = { domain, email: `security@${domain}` };

    stubFetch(auditOf(0), 500);
    for (let i = 0; i < 3; i += 1) expect((await claimPost(claimRequest(body))).status).toBe(502);

    stubFetch(auditOf(0));
    expect((await claimPost(claimRequest(body))).status).toBe(200);
  });

  it('caps confirmation emails at 3 per domain per day', async () => {
    const domain = uniqueDomain();
    const body = { domain, email: `security@${domain}` };
    const { fetchMock, sent } = stubFetch(auditOf(0));

    for (let i = 0; i < 3; i += 1) expect((await claimPost(claimRequest(body))).status).toBe(200);
    const callsBefore = fetchMock.mock.calls.length;
    expect((await claimPost(claimRequest(body))).status).toBe(429);
    expect(fetchMock.mock.calls).toHaveLength(callsBefore);
    expect(sent).toHaveLength(3);
  });

  it('shares the daily domain quota between www. and the bare domain', async () => {
    const domain = uniqueDomain();
    const { sent } = stubFetch(auditOf(0));
    for (let i = 0; i < 3; i += 1) {
      expect((await claimPost(claimRequest({ domain: `www.${domain}`, email: `security@${domain}` }))).status).toBe(200);
    }
    expect((await claimPost(claimRequest({ domain, email: `security@${domain}` }))).status).toBe(429);
    expect(sent).toHaveLength(3);
  });

  it('gives the domain quota back when the grade is refused', async () => {
    const domain = uniqueDomain();
    const body = { domain, email: `security@${domain}` };
    stubFetch(auditOf(2));
    for (let i = 0; i < 3; i += 1) expect((await claimPost(claimRequest(body))).status).toBe(422);
    stubFetch(auditOf(0));
    expect((await claimPost(claimRequest(body))).status).toBe(200);
  });

  it('holds the domain cap against a parallel burst', async () => {
    const domain = uniqueDomain();
    const { sent } = stubFetch(auditOf(0));
    const statuses = await Promise.all(
      Array.from({ length: 5 }, () => claimPost(claimRequest({ domain, email: `security@${domain}` })).then((res) => res.status)),
    );
    expect(statuses.filter((status) => status === 200)).toHaveLength(3);
    expect(statuses.filter((status) => status === 429)).toHaveLength(2);
    expect(sent).toHaveLength(3);
  });

  it('caps claims per IPv6 /64, not per address', async () => {
    const { fetchMock } = stubFetch(auditOf(3));
    for (let i = 1; i <= 5; i += 1) {
      const domain = uniqueDomain();
      expect((await claimPost(claimRequest({ domain, email: `security@${domain}` }, `2001:db8:77:1::${i}`))).status).toBe(422);
    }
    const domain = uniqueDomain();
    const callsBefore = fetchMock.mock.calls.length;
    expect((await claimPost(claimRequest({ domain, email: `security@${domain}` }, '2001:db8:77:1:ffff::9'))).status).toBe(429);
    expect(fetchMock.mock.calls).toHaveLength(callsBefore);
  });

  it('caps confirmation emails at 30 per hour across all domains and networks', async () => {
    vi.resetModules();
    const { POST } = await import('../app/api/leaderboard/claim/route');
    const { sent } = stubFetch(auditOf(0));
    for (let i = 1; i <= 30; i += 1) {
      const domain = uniqueDomain();
      expect((await POST(claimRequest({ domain, email: `security@${domain}` }, `198.51.100.${i}`))).status).toBe(200);
    }
    const domain = uniqueDomain();
    const res = await POST(claimRequest({ domain, email: `security@${domain}` }, '198.51.100.31'));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/many claims right now/);
    expect(sent).toHaveLength(30);
  });

  it('caps claims at 5 per IP per hour, counting refused grades too', async () => {
    const ip = uniqueIp();
    const { fetchMock } = stubFetch(auditOf(3));

    for (let i = 0; i < 5; i += 1) {
      const domain = uniqueDomain();
      expect((await claimPost(claimRequest({ domain, email: `security@${domain}` }, ip))).status).toBe(422);
    }
    const domain = uniqueDomain();
    const callsBefore = fetchMock.mock.calls.length;
    expect((await claimPost(claimRequest({ domain, email: `security@${domain}` }, ip))).status).toBe(429);
    expect(fetchMock.mock.calls).toHaveLength(callsBefore);
  });
});

describe('POST /api/leaderboard/confirm', () => {
  it('has no GET handler, so a prefetched email link publishes nothing', () => {
    expect('GET' in confirmRoute).toBe(false);
    expect('GET' in removeRoute).toBe(false);
  });

  it('lists the signed audit result in one database call and redirects to the listing', async () => {
    const calls = fakeSupabase({ data: 'listed', error: null });
    const now = Date.now();
    const token = issueHallOfFameClaimToken(entry('example.com', { grade: 'A', score: 92 }), now) ?? '';

    const res = await confirmRoute.POST(formRequest('/api/leaderboard/confirm', token));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://stealthmark.io/leaderboard?listed=example.com');
    expect(calls.map((call) => call.method)).toEqual(['rpc', 'abortSignal']);
    expect(calls[0].args).toEqual([
      'hall_of_fame_confirm',
      {
        p_domain: 'example.com',
        p_grade: 'A',
        p_score: 92,
        p_audited_at: entry('x.com').audited_at,
        p_issued_at: isoSecond(now),
        p_claimed_at: isoSecond(now),
      },
    ]);
  });

  it('confirms a link issued before issue times were recorded as issued 24 hours before it expires', async () => {
    const calls = fakeSupabase({ data: 'listed', error: null });
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = signedToken('hof_claim', { v: 1, dom: 'example.com', grade: 'A+', score: 100, at: entry('x.com').audited_at, exp });

    const res = await confirmRoute.POST(formRequest('/api/leaderboard/confirm', token));
    expect(res.headers.get('location')).toBe('https://stealthmark.io/leaderboard?listed=example.com');
    expect(calls[0].args[1]).toMatchObject({ p_issued_at: new Date((exp - DAY_MS / 1000) * 1000).toISOString(), p_claimed_at: null });
  });

  it('redirects with claim=expired or claim=error and writes nothing for a bad token', async () => {
    const calls = fakeSupabase({ data: null, error: null });
    const expired = issueHallOfFameClaimToken(entry('example.com'), Date.now() - DAY_MS - 1000) ?? '';

    const expiredRes = await confirmRoute.POST(formRequest('/api/leaderboard/confirm', expired));
    expect(expiredRes.headers.get('location')).toBe('https://stealthmark.io/leaderboard?claim=expired');

    const remove = issueHallOfFameRemoveToken('example.com') ?? '';
    const wrongRes = await confirmRoute.POST(formRequest('/api/leaderboard/confirm', remove));
    expect(wrongRes.headers.get('location')).toBe('https://stealthmark.io/leaderboard?claim=error');

    const empty = await confirmRoute.POST(new Request('http://localhost/api/leaderboard/confirm', { method: 'POST' }));
    expect(empty.headers.get('location')).toBe('https://stealthmark.io/leaderboard?claim=error');
    expect(calls).toHaveLength(0);
  });

  it('redirects with claim=removed when the domain was taken off after the link was sent', async () => {
    const calls = fakeSupabase({ data: 'removed', error: null });
    const token = issueHallOfFameClaimToken(entry('example.com')) ?? '';
    const res = await confirmRoute.POST(formRequest('/api/leaderboard/confirm', token));
    expect(res.headers.get('location')).toBe('https://stealthmark.io/leaderboard?claim=removed');
    expect(calls.map((call) => call.method)).toEqual(['rpc', 'abortSignal']);
  });

  it('redirects with claim=error when the confirm call fails or answers anything else', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const token = issueHallOfFameClaimToken(entry('example.com')) ?? '';
    const confirm = async () =>
      (await confirmRoute.POST(formRequest('/api/leaderboard/confirm', token))).headers.get('location');

    fakeSupabase({ data: null, error: { message: 'boom' } });
    expect(await confirm()).toBe('https://stealthmark.io/leaderboard?claim=error');
    fakeSupabase({ data: 'unexpected', error: null });
    expect(await confirm()).toBe('https://stealthmark.io/leaderboard?claim=error');
    state.client = null;
    expect(await confirm()).toBe('https://stealthmark.io/leaderboard?claim=error');
  });

  it('refuses an oversized form even with a valid token, and writes nothing', async () => {
    const calls = fakeSupabase({ data: null, error: null });
    const token = issueHallOfFameClaimToken(entry('example.com')) ?? '';
    const res = await confirmRoute.POST(formRequest('/api/leaderboard/confirm', token, 5000));
    expect(res.headers.get('location')).toBe('https://stealthmark.io/leaderboard?claim=error');
    expect(calls).toHaveLength(0);
  });
});

describe('POST /api/leaderboard/remove', () => {
  it('removes the signed domain in one database call and redirects with removed=1', async () => {
    const calls = fakeSupabase({ data: 'removed', error: null });
    const now = Date.now();
    const token = issueHallOfFameRemoveToken('example.com', now) ?? '';
    const res = await removeRoute.POST(formRequest('/api/leaderboard/remove', token));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://stealthmark.io/leaderboard?removed=1');
    expect(calls.map((call) => call.method)).toEqual(['rpc', 'abortSignal']);
    expect(calls[0].args).toEqual(['hall_of_fame_remove', { p_domain: 'example.com', p_issued_at: isoSecond(now) }]);
  });

  it('redirects with removed=superseded when a newer claim was confirmed after the link was sent', async () => {
    fakeSupabase({ data: 'superseded', error: null });
    const res = await removeRoute.POST(formRequest('/api/leaderboard/remove', issueHallOfFameRemoveToken('example.com') ?? ''));
    expect(res.headers.get('location')).toBe('https://stealthmark.io/leaderboard?removed=superseded');
  });

  it('passes a link issued before issue times were recorded with no issue time', async () => {
    const calls = fakeSupabase({ data: 'removed', error: null });
    const res = await removeRoute.POST(formRequest('/api/leaderboard/remove', signedToken('hof_remove', { v: 1, dom: 'example.com' })));
    expect(res.headers.get('location')).toBe('https://stealthmark.io/leaderboard?removed=1');
    expect(calls[0].args).toEqual(['hall_of_fame_remove', { p_domain: 'example.com', p_issued_at: null }]);
  });

  it('refuses a claim token and reports a failed removal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls = fakeSupabase({ data: null, error: null });
    const claim = issueHallOfFameClaimToken(entry('example.com')) ?? '';
    const wrong = await removeRoute.POST(formRequest('/api/leaderboard/remove', claim));
    expect(wrong.headers.get('location')).toBe('https://stealthmark.io/leaderboard?removed=error');
    expect(calls).toHaveLength(0);

    const remove = async () =>
      (await removeRoute.POST(formRequest('/api/leaderboard/remove', issueHallOfFameRemoveToken('example.com') ?? ''))).headers.get(
        'location',
      );
    fakeSupabase({ data: null, error: { message: 'boom' } });
    expect(await remove()).toBe('https://stealthmark.io/leaderboard?removed=error');
    fakeSupabase({ data: 'unexpected', error: null });
    expect(await remove()).toBe('https://stealthmark.io/leaderboard?removed=error');
  });

  it('refuses an oversized form even with a valid token, and deletes nothing', async () => {
    const calls = fakeSupabase({ data: null, error: null });
    const token = issueHallOfFameRemoveToken('example.com') ?? '';
    const res = await removeRoute.POST(formRequest('/api/leaderboard/remove', token, 5000));
    expect(res.headers.get('location')).toBe('https://stealthmark.io/leaderboard?removed=error');
    expect(calls).toHaveLength(0);
  });
});

describe('listHallOfFame', () => {
  const now = Date.parse('2026-10-28T12:00:00.000Z');

  it('queries the last 90 days, best score first, drops malformed rows and adds the stealthmark.io entry the database lacks', async () => {
    const good = [entry('a.example.com'), entry('b.example.com', { grade: 'A', score: 92 })];
    const calls = fakeSupabase({
      data: [
        ...good,
        { ...entry('c.example.com'), grade: 'B' },
        { ...entry('d.example.com'), score: 101 },
        { ...entry('e.example.com'), score: 99.5 },
        { ...entry('e.example.com'), domain: 'Not A Domain' },
        { ...entry('f.example.com'), audited_at: 'yesterday' },
        null,
      ],
      error: null,
    });

    expect(await listHallOfFame(now)).toEqual([good[0], STEALTHMARK_ENTRY, good[1]]);
    expect(calls).toContainEqual({ method: 'gte', args: ['audited_at', new Date(now - 90 * DAY_MS).toISOString()] });
    expect(calls).toContainEqual({ method: 'order', args: ['score', { ascending: false }] });
    expect(calls).toContainEqual({ method: 'limit', args: [100] });
  });

  it('falls back to the stealthmark.io entry while Supabase or the table is missing', async () => {
    fakeSupabase({ data: null, error: { message: 'relation does not exist' } });
    expect(await listHallOfFame(now)).toEqual([STEALTHMARK_ENTRY]);
    state.client = null;
    expect(await listHallOfFame(now)).toEqual([STEALTHMARK_ENTRY]);
  });

  it('keeps the database row for stealthmark.io instead of adding a second one', async () => {
    const own = entry('stealthmark.io', { grade: 'A', score: 95 });
    fakeSupabase({ data: [own], error: null });
    expect(await listHallOfFame(now)).toEqual([own]);
  });
});

describe('/leaderboard page', () => {
  const render = async (search: Record<string, string>) =>
    renderToStaticMarkup(await LeaderboardPage({ searchParams: Promise.resolve(search) }));

  it('echoes listed= only for a domain that is actually on the list', async () => {
    fakeSupabase({ data: [entry('example.com')], error: null });
    expect(await render({ listed: 'example.com' })).toContain('example.com is now in the Hall of Fame.');

    const spoofed = await render({ listed: 'fake-bank.com' });
    expect(spoofed).not.toContain('fake-bank.com');
    expect(spoofed).toContain('Confirmation received.');
    expect(spoofed).not.toContain('could not be saved');
  });

  it('lists the stealthmark.io entry while the table is missing, and shows the published index edition', async () => {
    state.client = null;
    const html = await render({});
    expect(html).toContain('>stealthmark.io</td>');
    expect(html).not.toContain('The Hall of Fame opens soon');
    expect(html).not.toContain('The first edition is pending');
    expect(html).toContain('hand-picked by StealthMark from the Tranco list');
    expect(html).toContain('80 audited of 80 listed');
    expect(html).toContain('StealthMarkAuditor/2.0');
    expect(html).toContain('id="how-audits-run"');
  });

  it('explains a confirmation that came after a removal, and a removal link a newer claim replaced', async () => {
    fakeSupabase({ data: [], error: null });
    expect(await render({ claim: 'removed' })).toContain(
      'Nothing was listed: the domain was taken off the Hall of Fame after this confirmation link was sent.',
    );
    const superseded = await render({ removed: 'superseded' });
    expect(superseded).toContain('Nothing was removed: a newer claim for this domain was confirmed after this removal link was sent.');
    expect(superseded).toContain('Use the removal link in that claim&#x27;s email.');
    expect(superseded).toContain('If you do not have that email, write to security@stealthmark.io from an address at the domain.');
  });

  it('prefills the claim form only with a valid domain', async () => {
    expect(await render({ domain: 'Example.COM' })).toContain('value="example.com"');
    expect(await render({ domain: '"><script>alert(1)</script>' })).not.toContain('<script>alert(1)');
  });
});

describe('/leaderboard/confirm page', () => {
  it('shows the signed result with a POST form, and never writes on GET', async () => {
    const calls = fakeSupabase({ data: null, error: null });
    const token = issueHallOfFameClaimToken(entry('example.com', { grade: 'A', score: 92 })) ?? '';
    const html = renderToStaticMarkup(await ConfirmHallOfFamePage({ searchParams: Promise.resolve({ token }) }));
    expect(html).toContain('example.com');
    expect(html).toContain('takes it off at any time, until a newer claim for the domain is confirmed.');
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/leaderboard/confirm"');
    expect(calls).toHaveLength(0);
  });
});

describe('/leaderboard/remove page', () => {
  const render = async (token: string) =>
    renderToStaticMarkup(await RemoveHallOfFamePage({ searchParams: Promise.resolve({ token }) }));

  it('names the domain with a POST form, and never writes on GET', async () => {
    const calls = fakeSupabase({ data: null, error: null });
    const html = await render(issueHallOfFameRemoveToken('example.com') ?? '');
    expect(html).toContain('example.com</span> off the StealthMark Hall of Fame.');
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/leaderboard/remove"');
    expect(calls).toHaveLength(0);
  });

  it('shows no form for a link that does not verify', async () => {
    const html = await render('hof1.not-a-link.x');
    expect(html).toContain('This removal link is not valid.');
    expect(html).not.toContain('action="/api/leaderboard/remove"');
  });
});
