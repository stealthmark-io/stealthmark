import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase/admin', () => ({ createSupabaseAdminClient: () => null }));

import { GET as auditGet } from '../app/api/scan/audit/route';
import { normalizeApexDomain, resetQuotaStoreForTests } from '../lib/scan-quota';

type Item = Record<string, unknown>;

const GATEWAY_REPORT = {
  domain: 'acme.io',
  audited_at: '2026-10-28T00:00:00Z',
  summary: { counts: { pass: 1, warn: 3, fail: 2, info: 1, error: 0 }, by_section: {} },
  sections: {
    transport: [
      { id: 'hsts_configured', title: 'Secret HSTS title', status: 'fail', detail: 'Secret HSTS detail', recommendation: 'Send HSTS.', evidence: 'hsts-evidence' },
      { id: 'https_redirect', title: 'Secret redirect title', status: 'warn', detail: 'Secret redirect detail', recommendation: 'Redirect.', evidence: 'redirect-evidence' },
    ],
    dns: [
      { id: 'exposed_ports_and_cves', title: 'Exposed ports and CVEs', status: 'pass', detail: 'No critical ports.' },
      { id: 'dmarc_record', title: 'Secret DMARC title', status: 'fail', detail: 'Secret DMARC detail', recommendation: 'Publish DMARC.' },
    ],
    crawl_policy: [{ id: 'robots_txt', title: 'Secret robots title', status: 'warn', detail: 'Secret robots detail' }],
    ai_surface: [{ id: 'llms_txt', title: '/llms.txt', status: 'info', detail: 'No /llms.txt.' }],
    headers: [{ id: 'csp_header', title: 'Secret CSP title', status: 'warn', detail: 'Secret CSP detail', recommendation: 'Add CSP.' }],
  },
  limitations: [],
};

let ipCounter = 0;

async function audit(headers: Record<string, string> = {}, report: unknown = GATEWAY_REPORT) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/api/v2/')) return Response.json(structuredClone(report));
    if (url.includes('/_next/mcp')) return new Response(null, { status: 404 });
    return new Response('<html></html>', { status: 200, headers: { 'x-stealthmark-shield': 'active', 'x-frame-options': 'DENY' } });
  }));
  ipCounter += 1;
  const res = await auditGet(
    new Request('https://stealthmark.io/api/scan/audit?domain=acme.io&fresh=1', {
      headers: { 'x-forwarded-for': `203.0.113.${ipCounter}`, ...headers },
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { sections: Record<string, Item[]>; teaserUnlocked: boolean };
  return { body, items: Object.values(body.sections).flat() };
}

const isIssue = (item: Item) => item.status === 'fail' || item.status === 'warn' || item.status === 'error';

describe('scan paywall gating (full report free for the first 20 scans of a domain)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens every finding with its detail, evidence and fix, and gates none behind an email or the Fix Pack', async () => {
    const { items } = await audit();
    const issues = items.filter(isIssue);
    expect(issues.map((item) => item.id).sort()).toEqual(['csp_header', 'dmarc_record', 'hsts_configured', 'https_redirect', 'robots_txt']);

    const sources: Item[] = Object.values(GATEWAY_REPORT.sections).flat();
    for (const source of sources.filter(isIssue)) {
      const issue = issues.find((item) => item.id === source.id);
      expect(issue).toMatchObject(source);
      expect(issue?.locked).not.toBe(true);
      expect(issue).not.toHaveProperty('teaser');
      expect(issue).not.toHaveProperty('emailGate');
      expect(issue).not.toHaveProperty('freeFix');
    }
  });

  it('sends every finding with its OWASP gate, detail, evidence, fix and check id', async () => {
    const { body, items } = await audit();
    const json = JSON.stringify(body);
    for (const item of items.filter(isIssue)) expect(item).toHaveProperty('owaspGate');
    for (const item of Object.values(GATEWAY_REPORT.sections).flat()) {
      expect(json).toContain(item.detail);
      expect(json).toContain(`"${item.id}"`);
      if ('recommendation' in item) expect(json).toContain(item.recommendation);
    }
    expect(json).toContain('hsts-evidence');
    expect(json).toContain('redirect-evidence');
  });

  it('sends the title of every finding, with none held back for an email', async () => {
    const { items } = await audit();
    const shownTitles = new Set(items.map((item) => item.title));
    const hidden = Object.values(GATEWAY_REPORT.sections).flat().filter((item) => !shownTitles.has(item.title));
    expect(hidden).toHaveLength(0);
  });

  it('takes a valid work email without changing the open report', async () => {
    const anonymous = await audit();
    const { body, items } = await audit({ 'x-lead-email': 'secops@acme.io' });
    expect(body.teaserUnlocked).toBe(true);
    expect(items).toEqual(anonymous.items);
  });

  it('ignores an invalid email header', async () => {
    const { body, items } = await audit({ 'x-lead-email': 'not-an-email' });
    expect(body.teaserUnlocked).toBe(false);
    expect(items.filter((item) => item.locked === true)).toHaveLength(0);
  });

  it('picks the same findings for the same domain on every scan', async () => {
    const pick = (items: Item[]) => items.filter((item) => item.teaser === true || item.emailGate === true).map((item) => item.id);
    const first = await audit();
    const second = await audit();
    expect(pick(second.items)).toEqual(pick(first.items));
  });

  it('sends each finding its own fix, and none where the gateway has none', async () => {
    const report = structuredClone(GATEWAY_REPORT);
    delete (report.sections.transport[0] as { recommendation?: string }).recommendation;
    const { items } = await audit({}, report);
    expect(items.filter((item) => item.freeFix === true)).toHaveLength(0);
    expect(items.find((item) => item.id === 'hsts_configured')).not.toHaveProperty('recommendation');
    expect(items.find((item) => item.id === 'dmarc_record')?.recommendation).toBe('Publish DMARC.');
  });

  it('keeps pass and info checks open, the 15 web shield checks included', async () => {
    // Under Vitest the route adds the web shield checks only to reports of 20 rows or more, as the gateway's 45-row reports are.
    const report = structuredClone(GATEWAY_REPORT);
    const passing = Array.from({ length: 13 }, (_, i) => ({ id: `passing_check_${i}`, title: `Passing check ${i}`, status: 'pass', detail: 'Configured.' }));
    report.sections.dns.push(...passing);
    const { items } = await audit({}, report);
    const open = items.filter((item) => !isIssue(item));
    const shieldIds = ['clipboard_read_lock', 'hardware_sensor_isolation', 'csp_connect_src_exfil', 'csp_form_action_lock', 'session_cookie_aitm_resistance', 'aitm_reverse_proxy_telemetry', 'autofill_trap_rasp_posture', 'defcon_autonomous_response', 'tls_ja4_session_binding', 'webauthn_passkey_ror', 'indirect_prompt_injection_dom', 'pqc_hybrid_key_exchange', 'subdomain_takeover_cname', 'cross_origin_isolation_posture', 'nextjs_mcp_exposure'];
    expect(open.map((item) => item.id).sort()).toEqual([...shieldIds, 'exposed_ports_and_cves', 'llms_txt', ...passing.map((row) => row.id)].sort());
    expect(open.find((item) => item.id === 'llms_txt')).toMatchObject({ title: '/llms.txt', status: 'info' });
    for (const item of open) expect(item.locked).not.toBe(true);
  });
});

describe('radar alert confirmation email', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('is sent by the team address with a List-Unsubscribe header and no personal signature', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-resend-key');
    vi.resetModules();
    const sent: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ id: 'email_1' });
      }),
    );
    const { POST } = await import('../app/api/scan/subscribe-alerts/route');
    const res = await POST(
      new NextRequest('https://stealthmark.io/api/scan/subscribe-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'secops@acme.io', domain: 'acme.io', score: 72, grade: 'B', passes: 30, issues: 5 }),
      }),
    );
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].from).toBe('StealthMark Security Team <security@stealthmark.io>');
    expect(sent[0].headers).toEqual({ 'List-Unsubscribe': '<mailto:security@stealthmark.io?subject=unsubscribe>' });
    expect(String(sent[0].text)).not.toMatch(/\bAlex\b|founder@/);
  });
});

describe('scan page paywall copy', () => {
  const page = readFileSync(path.join(__dirname, '../app/scan/page.tsx'), 'utf8');

  it('no longer claims every finding is open', () => {
    expect(page).not.toMatch(/diagnostic findings are open below/i);
  });

  it('names the sender of the alert emails next to both email forms', () => {
    expect(page.match(/Alerts and one follow-up email come from StealthMark Security Team &lt;security@stealthmark\.io&gt;/g)).toHaveLength(2);
  });

  it('shows email form errors next to the forms, announced as alerts', () => {
    expect(page).not.toMatch(/setError\('(Enter a valid work email|Could not reveal)/);
    expect(page.match(/role="alert"[^>]*>\s*\{leadError\}/g)).toHaveLength(2);
  });
});

describe('domain scan quota', () => {
  const BROWSER_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const quotaOf = (body: unknown) => (body as { scan_quota: Record<string, unknown> }).scan_quota;
  const lockedOf = (body: unknown) => (body as { quota_locked?: boolean }).quota_locked;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allows 20 free browser scans and locks the 21st behind the $0.99 Fix Pack without leaking findings', async () => {
    resetQuotaStoreForTests();
    const browser = { 'user-agent': BROWSER_UA };
    const scans = [];
    for (let i = 0; i < 20; i++) scans.push(await audit(browser));
    for (const scan of scans) expect(lockedOf(scan.body)).toBe(false);
    expect(quotaOf(scans[0].body)).toMatchObject({ used: 1, previous_score: null, previous_grade: null, score_changed: false });
    expect(quotaOf(scans[19].body)).toMatchObject({
      used: 20,
      remaining: 0,
      score_changed: false,
      resolved_delta_hint: 0,
      remediation_detected: false,
    });

    const s21 = await audit(browser);
    expect(lockedOf(s21.body)).toBe(true);
    expect(quotaOf(s21.body)).toMatchObject({
      used: 21,
      remaining: 0,
      score_changed: false,
      remediation_detected: false,
      unlimited_scans_price_usd: 0.99,
      full_report_price_usd: 0,
    });
    const raw21 = JSON.stringify(s21.body);
    expect(raw21).not.toContain('Secret HSTS detail');
    expect(raw21).not.toContain('Secret DMARC detail');
    expect(s21.items.length).toBeGreaterThan(0);
    expect(s21.items.every((item) => item.status === 'info' && item.locked === true)).toBe(true);
  });

  it('does not count scripted clients, and ignores a client-sent quota header', async () => {
    resetQuotaStoreForTests();
    for (let i = 0; i < 4; i++) {
      const { body } = await audit({ 'user-agent': 'curl/8.7.1', 'x-enforce-scan-quota': '1' });
      expect(lockedOf(body)).toBe(false);
    }
    const first = await audit({ 'user-agent': BROWSER_UA });
    expect(quotaOf(first.body)).toMatchObject({ used: 1, previous_score: null });
  });

  it('gives each site on a shared-hosting suffix its own quota', () => {
    expect(normalizeApexDomain('foo.vercel.app')).toBe('foo.vercel.app');
    expect(normalizeApexDomain('https://www.shop.acme.co.uk/path')).toBe('acme.co.uk');
    expect(normalizeApexDomain('api.acme.io:8443')).toBe('acme.io');
  });
});
