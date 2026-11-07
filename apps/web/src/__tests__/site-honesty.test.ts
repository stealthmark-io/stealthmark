import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import EnterprisePage from '../app/enterprise/page';
import EnterpriseContactPage from '../app/enterprise/contact/page';
import PrivacyPage from '../app/privacy/page';
import TermsPage from '../app/terms/page';
import RefundPage from '../app/refund/page';
import { Footer, ENGLISH_ONLY_NOTE } from '../components/landing/Footer';
import { Navbar } from '../components/landing/Navbar';
import { StealthMarkLogo } from '../components/StealthMarkLogo';
import { BrandLogo } from '../components/BrandLogo';
import robots from '../app/robots';
import sitemap from '../app/sitemap';
import { LEAD_HONEYPOT_FIELD } from '../lib/lead-fields';
import { buildContentSecurityPolicy, CSP_REPORT_PATH } from '../lib/csp';
import { CRYPTO_WALLETS, FIX_PACK, FLEET_DEFENSE } from '../lib/offer';
import { ORGANIZATION_JSON_LD } from '../lib/site';
import { SCAN_CHECK_COUNT } from '../lib/readiness-report';
import { CHECKS_OUTSIDE_OWASP, OWASP_GATES } from '../lib/owasp-gates';
import { resetLeadRateLimits } from '../lib/lead-intake';
import { endlessBodyRequest } from './helpers/chunked-body';

const SRC = path.resolve(__dirname, '..');
const read = (relative: string) => readFileSync(path.join(SRC, relative), 'utf8');
const markup = (node: ReturnType<typeof createElement>) => renderToStaticMarkup(node);
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

const FALSE_CLAIMS =
  /99\.999|24\/7|war room|zero data retention|siem|< ?15 min|&lt; ?15 min|anycast|cname|enclave|\bkya\b|hitl|defcon|waf shield|\$200|2-hour|principal (solutions )?architect|soc 2 type|ed25519|http 402/i;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('/enterprise and /enterprise/contact', () => {
  it('carry no SOC 2, SLA, enclave or other listed false claim', () => {
    const html = markup(createElement(EnterprisePage));
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    expect(textOf(main)).not.toMatch(FALSE_CLAIMS);
    expect(main).not.toContain('href="/blueprint"');
    expect(textOf(main)).not.toMatch(/SOC 2|\bSLA\b/);
  });

  it('builds the plan table from the free recon, the Fix Pack and the custom scope, with no Pro or Business column', () => {
    const text = textOf(markup(createElement(EnterprisePage)));
    expect(text).toContain(`Free ${SCAN_CHECK_COUNT}-Point Recon`);
    expect(text).toContain(`${FIX_PACK.starterPriceLabel} one-time per domain`);
    expect(text).toContain('Custom Scope');
    expect(text).not.toMatch(/Business|Pro \/|1\.5M|10 Domains|Credit Card/);
  });

  it('presents the enterprise cybersecurity offer with its Red Team and Blue Team engagements', () => {
    const text = textOf(markup(createElement(EnterprisePage)));
    expect(text).toContain('Enterprise Cybersecurity');
    expect(text).toContain('Red Team');
    expect(text).toContain('Blue Team');
  });

  it('keeps the contact page free of false claims, mailto links and fabricated references', () => {
    const html = markup(createElement(EnterpriseContactPage));
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    expect(textOf(main)).not.toMatch(FALSE_CLAIMS);
    expect(main).not.toContain('mailto:');
    expect(main).toContain(`name="${LEAD_HONEYPOT_FIELD}"`);
    const source = read('app/enterprise/contact/page.tsx');
    expect(source).not.toMatch(/\bany\b\s*\)|: any\b|as any/);
    expect(source).not.toContain('Math.random');
  });
});

describe('shared footer and navbar', () => {
  const footer = markup(createElement(Footer));
  const navbar = markup(createElement(Navbar));

  it('drops the SLA badges, the static status line and the newsletter form', () => {
    const text = textOf(footer);
    expect(text).not.toMatch(/99\.999|24\/7|Operational|Gateway v1|Orbital|WAF Benchmark|Agentic Scanner|\bSLA\b/);
    expect(footer).not.toContain('/api/subscribe');
    expect(text).not.toMatch(/monthly report|Subscribed/i);
    expect(text).toContain('Trust &amp; Security');
  });

  it('points the docs links at /docs, never at a GitHub repository (the SDK repository is private)', () => {
    expect(footer).toContain('href="/docs"');
    expect(navbar).toContain('href="/docs"');
    expect(footer + navbar).not.toMatch(/github\.com\/(?!stealthmark-io["'\/])/i);
    expect(textOf(navbar)).not.toMatch(/SLA/);
  });

  it('uses absolute landing anchors so they work from every page', () => {
    for (const href of ['/#auditor', '/#security-matrix', '/#pricing', '/#forensic-audit']) expect(footer).toContain(`href="${href}"`);
    expect(footer).not.toMatch(/href="#/);
    expect(navbar).not.toMatch(/href="#/);
  });

  it('shows contact addresses as copy buttons, never as mailto links', () => {
    expect(footer).not.toContain('mailto:');
    expect(footer).toContain('aria-label="Copy support@stealthmark.io"');
    expect(footer).toContain('aria-label="Copy security@stealthmark.io"');
  });

  it('has an English-only note for Spanish and Portuguese and none for English', () => {
    expect(ENGLISH_ONLY_NOTE.es).toMatch(/inglés/);
    expect(ENGLISH_ONLY_NOTE.pt).toMatch(/inglês/);
    expect(footer).not.toMatch(/inglés|inglês/);
  });

  it('states the founding year next to the copyright', () => {
    expect(textOf(footer)).toMatch(/Founded in 2026 · © \d{4} StealthMark\./);
  });
});

describe('organization structured data', () => {
  it('describes StealthMark as a Schema.org Organization founded in 2026', () => {
    expect(ORGANIZATION_JSON_LD).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'StealthMark',
      url: 'https://stealthmark.io',
      foundingDate: '2026',
      sameAs: ['https://stealthmark.io'],
    });
  });

  it('is rendered as escaped JSON-LD by the root layout', () => {
    const layout = read('app/layout.tsx');
    expect(layout).toContain('type="application/ld+json"');
    expect(layout).toContain("JSON.stringify(ORGANIZATION_JSON_LD).replace(/</g, '\\\\u003c')");
  });
});

describe('legal pages', () => {
  const legal = { privacy: markup(createElement(PrivacyPage)), terms: markup(createElement(TermsPage)), refund: markup(createElement(RefundPage)) };

  it('contain no mailto links', () => {
    for (const [name, html] of Object.entries(legal)) expect(html, name).not.toContain('mailto:');
  });

  it('privacy names the hosting, database and payment processors, and makes no GDPR badge or DPO claim', () => {
    const text = textOf(legal.privacy);
    for (const processor of ['Google Cloud Platform (us-central1) &amp; Cloudflare', 'Supabase', 'Polar']) {
      expect(text, processor).toContain(processor);
    }
    expect(text).not.toMatch(/Data Protection Officer|Data Protection & GDPR|hashed authentication credentials|Last Updated: October 1/);
  });

  it('terms state the free recon with the scanner check count and make no claim that other hosts are unaffected', () => {
    const text = textOf(legal.terms);
    expect(text).toContain(`Free ${SCAN_CHECK_COUNT}-Point Perimeter Recon ($0)`);
    expect(text).not.toContain('are not counted or affected');
  });
});

describe('docs, landing and mascot copy', () => {
  it('docs document the real audit API, the CLI commands the CLI implements, the OWASP gates, the CSP header and the tiers', () => {
    const docs = read('app/docs/page.tsx');
    expect(docs).toContain('/api/scan/audit?domain=');
    expect(read('app/api/scan/audit/route.ts')).toContain('export async function GET');
    const cli = readFileSync(path.join(SRC, '../../../packages/cli/src/bin.ts'), 'utf8');
    const commands = [...docs.matchAll(/npx @stealthmark\/cli ([a-z-]+)/g)].map((m) => m[1]);
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) expect(cli, command).toContain(`command === '${command}'`);
    expect(docs).toContain('Audit API & CLI');
    expect(docs).toContain('OWASP Top 10:2025 Gates');
    expect(docs).toContain('Content-Security-Policy');
    expect(docs).toContain('Tiers & Pricing');
  });

  it('the roadmap lists capability enforcement instead of already published capabilities', () => {
    const copy = read('context/landingCopy.ts');
    expect(copy).toContain('Capability enforcement');
    expect(copy).not.toContain('Actions that agents can call on your site');
  });

  it('no console or landing copy claims humans are unchanged', () => {
    for (const file of ['context/LanguageContext.tsx', 'context/landingCopy.ts', 'app/trust/page.tsx', 'app/dashboard/components/gateway/constants.ts', 'app/dashboard/components/SettingsPanel.tsx']) {
      expect(read(file), file).not.toMatch(/Humans unchanged|Humans Unchanged|never counts or alters requests from human/i);
    }
  });

  it('the mascot has no hardcoded status badges and no themes for pages that do not exist', () => {
    const mascot = read('components/StealthMascot.tsx');
    expect(mascot).not.toMatch(/HYPER-VISION|100% HEALTHY|SPEC v2\.0|FLEET ESCROW|A2A MESH|PLAYGROUND LIVE/);
    expect(mascot).not.toMatch(/'\/os'|'\/network'|'\/playground'/);
  });
});

const WEB_ROOT = path.resolve(SRC, '..');
const TESTS_DIR = path.join(SRC, '__tests__');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return full === TESTS_DIR ? [] : sourceFiles(full);
    return /\.(ts|tsx|md)$/.test(entry.name) ? [full] : [];
  });
}

describe('one price per product', () => {
  /** Retired offers: the $49 / $24.50 Fix Pack, the Quick and Instant Passes, Fleet Defense at $149/mo, its $44.70 affiliate share, the discount codes and any monthly plan. */
  const RETIRED_OFFER =
    /\$49\b|\$24\.50|\$1\.99|\$44\.70|\$149\b|Instant (A2A )?Pass|Quick Pass|Fleet Defense|\bBLACKOCTOBER\b|\bOPENCOMMUNITY\b|\bFREE20\b|\bFTZKIH6N\b|Defense Grant|\$0 Free|DonationC|\$[1-9]\d*(?:\.\d+)?\s*\/\s*(?:mo|MO)\b/;
  /** Billing code still maps the retired plans; it is reviewed apart from the site copy. */
  const BILLING = ['src/app/api/billing/polar/checkout/route.ts', 'src/lib/crypto-verifier.ts'];
  /** Rendered by no page: drop their retired prices before wiring either back. */
  const UNRENDERED = ['src/components/landing/PricingGrid.tsx', 'src/components/scan/ScanReportView.tsx'];

  it('keeps the shipped prices, the trust receipt price and the payment networks', () => {
    expect(FIX_PACK).toMatchObject({ starterPriceUsd: 0.99, starterPriceLabel: '$0.99', label: 'Fix Pack' });
    expect(FLEET_DEFENSE).toMatchObject({ priceUsd: 0.99, plan: 'starter_pass' });
    expect(read('app/api/v2/trust-receipt/route.ts')).toContain("priceUsd: '9.00'");
    expect(Object.keys(CRYPTO_WALLETS)).toEqual(expect.arrayContaining(['eth', 'base', 'btc', 'solana', 'bsc', 'polygon', 'tron']));
  });

  it('no rendered source file advertises a retired price, plan or discount code', () => {
    const files = [...sourceFiles(SRC), path.join(WEB_ROOT, 'public/skill.md')].filter(
      (file) => ![...BILLING, ...UNRENDERED].includes(path.relative(WEB_ROOT, file)),
    );
    const hits = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) => (RETIRED_OFFER.test(line) ? [`${path.relative(WEB_ROOT, file)}:${index + 1}`] : [])),
    );
    expect(hits).toEqual([]);
  });

  it('no page renders the components that still carry retired prices', () => {
    const users = sourceFiles(SRC)
      .filter((file) => !UNRENDERED.includes(path.relative(WEB_ROOT, file)) && path.relative(SRC, file) !== path.join('components', 'landing', 'index.ts'))
      .filter((file) => /\b(?:PricingGrid|ScanReportView)\b/.test(readFileSync(file, 'utf8')));
    expect(users.map((file) => path.relative(WEB_ROOT, file))).toEqual([]);
  });

  it('the terms page lists the Fix Pack price with no retired product', () => {
    const text = textOf(markup(createElement(TermsPage)));
    expect(text).toContain(`${FIX_PACK.starterPriceLabel} USD one-time payment per domain`);
    expect(RETIRED_OFFER.test(text)).toBe(false);
  });
});

describe('scan check count', () => {
  const GATEWAY_DIR = path.resolve(WEB_ROOT, '../../infrastructure/gateway-lab/gateway');
  /** Fallback rows for an unreachable resolver or home page, and the StealthMark detection notice: none is a check. */
  const NOT_CHECKS = new Set(['dns_resolver', 'headers_inspection', 'stealthmark_active']);

  function pythonFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '__pycache__' ? [] : pythonFiles(full);
      return entry.name.endsWith('.py') ? [full] : [];
    });
  }

  function gatewayRowIds(): Set<string> {
    return new Set(
      pythonFiles(GATEWAY_DIR).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/\bid="([a-z0-9_]+)"/g)].map((m) => m[1])),
    );
  }

  /** Rows the audit route adds for a reachable site (Active Shield v2). */
  function webRowIds(): Set<string> {
    const route = read('app/api/scan/audit/route.ts');
    const body = route.slice(route.indexOf('async function enrichWithV2ActiveShieldChecks'), route.indexOf('function tagOwaspGates'));
    return new Set([...body.matchAll(/^\s*id: '([a-z0-9_]+)',/gm)].map((m) => m[1]));
  }

  it('runs the 60 checks v5.1.1 advertises', () => {
    expect(SCAN_CHECK_COUNT).toBe(60);
  });

  it('advertises the gateway checks plus the Active Shield v2 checks, and every literal count matches', () => {
    const ids = gatewayRowIds();
    for (const id of NOT_CHECKS) ids.delete(id);
    const web = webRowIds();
    expect([...web].filter((id) => ids.has(id))).toEqual([]);
    expect(ids.size + web.size).toBe(SCAN_CHECK_COUNT);
    const composition = `${ids.size} core + ${web.size} Active Shield v2 checks`;
    expect(read('lib/readiness-report.ts')).toContain(composition);

    // A literal count, as "23-point", "24 diagnostic findings" or "23 perimeter, CVE, DNS, and AI-surface checks", must match SCAN_CHECK_COUNT.
    const LITERAL_COUNT =
      /\b(\d+)-point\b|(?<![\w.:-])(\d+)\s+(?:[A-Za-z][\w/&-]*,?\s+){0,6}checks\b|(?<![\w.:-])(\d{2,})\s+(?:[A-Za-z][\w/&-]*\s+){0,3}findings\b/gi;
    const staleCounts = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          [...line.replace(composition, '').matchAll(LITERAL_COUNT)]
            .filter((m) => Number(m[1] ?? m[2] ?? m[3]) !== SCAN_CHECK_COUNT)
            .map((m) => `${path.relative(WEB_ROOT, file)}:${index + 1} ${m[0]}`),
        ),
    );
    expect(staleCounts).toEqual([]);

    for (const file of ['public/skill.md', 'public/.well-known/mcp.json']) {
      const counts = [...readFileSync(path.join(WEB_ROOT, file), 'utf8').matchAll(/\b(\d+)-point\b/gi)].map((m) => Number(m[1]));
      expect(counts.length, file).toBeGreaterThan(0);
      expect(counts.every((count) => count === SCAN_CHECK_COUNT), file).toBe(true);
    }
  });

  it('maps every gateway and Active Shield v2 row to one OWASP gate or to the list kept outside OWASP', () => {
    const mapped = [...OWASP_GATES.flatMap((gate) => gate.checks), ...CHECKS_OUTSIDE_OWASP];
    expect(new Set(mapped).size).toBe(mapped.length);
    expect([...mapped].sort()).toEqual([...gatewayRowIds(), ...webRowIds()].sort());
  });
});

describe('Fix Pack and edge generator copy', () => {
  const EDGE_OVERCLAIM = /\b0ms\b|virtual patch|edge waf|zero-day|anti-scanner shield|1-click (?:cloudflare )?(?:edge )?waf/gi;
  const FILES = [
    'src/app/scan/page.tsx',
    'src/components/scan/ScanReportView.tsx',
    'src/components/scan/WhiteLabelPdfReport.tsx',
    'src/components/landing/PricingGrid.tsx',
    'src/app/api/scan/audit/route.ts',
    'src/app/api/scan/subscribe-alerts/route.ts',
    'src/app/api/scan/edge-shield/route.ts',
    'src/app/api/mcp/route.ts',
    'src/lib/fix-pack-deliverables.ts',
    'src/components/landing/AuditorShowcase.tsx',
    'src/components/landing/DefconShieldCards.tsx',
    'public/skill.md',
    'public/.well-known/mcp.json',
  ];

  /** v5.1.1 copy reported for review: remove an entry once its claim is fixed. */
  const claims = (pattern: RegExp) =>
    FILES.flatMap((file) => [...readFileSync(path.resolve(SRC, '..', file), 'utf8').matchAll(pattern)].map((m) => `${file}: ${m[0]}`)).sort();

  it('adds no 0ms, virtual patch, zero-day or edge WAF claim beyond the v5.1.1 copy under review', () => {
    expect(claims(EDGE_OVERCLAIM)).toEqual([
      'src/lib/fix-pack-deliverables.ts: Zero-Day',
      'src/lib/fix-pack-deliverables.ts: Zero-Day',
    ]);
  });

  const SCAN_OVERCLAIM =
    /verified (?:nvd|cves?|shodan)|nvd\/shodan|active (?:shodan )?cves?|rce vector|origin ip leak check|fly\.io platform|\$22,500|ransomware downtime|incident response consultation|(?<!no )hsts preload|hsts >= ?1 year|a2a readiness|mcp capability descriptors|in 3 seconds/gi;

  it('adds no unsourced CVE, incident-cost, HSTS preload or non-running check claim beyond the v5.1.1 copy under review', () => {
    expect(claims(SCAN_OVERCLAIM)).toEqual(['src/app/api/scan/audit/route.ts: HSTS preload']);
  });
});

describe('inline SVG ids', () => {
  function duplicateIds(html: string): string[] {
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  }

  it('stay unique when the logo is rendered several times on one page', () => {
    const html = markup(
      createElement('div', null, createElement(StealthMarkLogo), createElement(StealthMarkLogo), createElement(BrandLogo, { id: 'nextjs' }), createElement(BrandLogo, { id: 'nextjs' })),
    );
    expect(html).toContain('sm-human-gate-');
    expect(duplicateIds(html)).toEqual([]);
  });
});

describe('crawler and discovery files', () => {
  it('robots allows public pages and keeps the console, admin, API and login out', () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    expect(rule.allow).toBe('/');
    expect(rule.disallow).toEqual(expect.arrayContaining(['/console', '/admin', '/api/', '/login']));
    expect(robots().sitemap).toBe('https://stealthmark.io/sitemap.xml');
  });

  it('sitemap lists the public pages only', () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual(expect.arrayContaining(['https://stealthmark.io', 'https://stealthmark.io/pricing', 'https://stealthmark.io/docs', 'https://stealthmark.io/trust', 'https://stealthmark.io/enterprise']));
    expect(urls.some((url) => /console|admin|login|api|dashboard/.test(url))).toBe(false);
  });

  it('gives each indexable page its own title and noindexes the console and login', () => {
    const titles = new Map<string, string>();
    for (const [route, file] of [
      ['/pricing', 'app/pricing/layout.tsx'],
      ['/docs', 'app/docs/layout.tsx'],
      ['/enterprise/contact', 'app/enterprise/contact/layout.tsx'],
      ['/enterprise', 'app/enterprise/page.tsx'],
      ['/trust', 'app/trust/layout.tsx'],
    ] as const) {
      const title = /title: '([^']+)'/.exec(read(file))?.[1];
      expect(title, route).toBeDefined();
      titles.set(route, String(title));
    }
    expect(new Set(titles.values()).size).toBe(titles.size);
    for (const file of ['app/login/layout.tsx', 'app/dashboard/layout.tsx']) {
      expect(read(file)).toContain('robots: { index: false, follow: false }');
    }
    expect(read('app/pricing/layout.tsx')).toContain("canonical: '/pricing'");
  });
});

describe('Content-Security-Policy (report only)', () => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
    NEXT_PUBLIC_API_URL: 'https://api.example.run.app/',
    NEXT_PUBLIC_GATEWAY_URL: 'not a url',
    NEXT_PUBLIC_GA_ID: undefined,
  };

  it('locks down frames, objects, bases and forms and reports to the collector', () => {
    const csp = buildContentSecurityPolicy(env);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain(`report-uri ${CSP_REPORT_PATH}`);
  });

  it('allows only the StealthMark API and gateway plus the configured API origins, and ignores malformed ones', () => {
    const connect = /connect-src ([^;]+)/.exec(buildContentSecurityPolicy(env))?.[1] ?? '';
    expect(connect.split(' ')).toEqual(["'self'", 'https://api.stealthmark.io', 'https://gateway.stealthmark.io', 'https://api.example.run.app']);
  });

  it('never allows Google Analytics origins, even with a measurement id', () => {
    for (const ga of [undefined, 'G-TEST']) expect(buildContentSecurityPolicy({ ...env, NEXT_PUBLIC_GA_ID: ga })).not.toMatch(/googletagmanager|google-analytics/);
  });

  it("carries the page nonce and 'strict-dynamic' in script-src, with no 'unsafe-inline'", () => {
    const scriptSrc = (csp: string) => (/script-src ([^;]+)/.exec(csp)?.[1] ?? '').split(' ');
    const paged = scriptSrc(buildContentSecurityPolicy(env, 'bm9uY2U='));
    expect(paged).toEqual(["'self'", "'nonce-bm9uY2U='", "'strict-dynamic'"]);
    // Same rule as csp_script_weakness in gateway/auditor/posture.py.
    const weak = (sources: string[]) => sources.includes("'unsafe-inline'") && !sources.some((s) => /^'(nonce|sha256|sha384|sha512)-/.test(s));
    expect(weak(paged)).toBe(false);
    expect(scriptSrc(buildContentSecurityPolicy(env))).not.toContain("'strict-dynamic'");
  });

  it('does not announce the framework in X-Powered-By', async () => {
    const config = (await import('../../next.config')).default;
    expect(config.poweredByHeader).toBe(false);
  });

  it('is enforced by next.config next to the other security headers, still reporting violations', async () => {
    const config = (await import('../../next.config')).default;
    const sets = await config.headers?.();
    const headers = (sets ?? []).flatMap((set) => set.headers);
    const names = headers.map((header) => header.key);
    expect(names).toContain('Content-Security-Policy');
    expect(names).not.toContain('Content-Security-Policy-Report-Only');
    expect(names).toContain('Strict-Transport-Security');
    const csp = headers.find((header) => header.key === 'Content-Security-Policy')?.value ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('report-uri /api/csp-report');
  });

  it('serves one manifest source: no rewrite to a static copy', async () => {
    const config = (await import('../../next.config')).default;
    const rewrites = await config.rewrites?.();
    const list = Array.isArray(rewrites) ? rewrites : (rewrites?.beforeFiles ?? []);
    expect(list.some((rewrite) => rewrite.destination === '/agent-manifest.json')).toBe(false);
  });
});

describe('POST /api/csp-report', () => {
  const report = (body: string, address = '203.0.113.50') =>
    new NextRequest('https://stealthmark.io/api/csp-report', { method: 'POST', headers: { 'x-forwarded-for': address }, body });

  it('logs one short line per violation and answers 204', async () => {
    resetLeadRateLimits();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { POST } = await import('../app/api/csp-report/route');
    const res = await POST(report(JSON.stringify({ 'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': 'https://evil.example/x.js', 'document-uri': 'https://stealthmark.io/' } })));
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('script-src blocked https://evil.example/x.js');
  });

  it('rejects malformed and oversized reports', async () => {
    resetLeadRateLimits();
    const { POST } = await import('../app/api/csp-report/route');
    expect((await POST(report('not json'))).status).toBe(400);
    expect((await POST(report('x'.repeat(10_000)))).status).toBe(413);
  });

  it('stops reading a chunked report once it passes 8 KB', async () => {
    resetLeadRateLimits();
    const { POST } = await import('../app/api/csp-report/route');
    const endless = endlessBodyRequest('https://stealthmark.io/api/csp-report', { 'x-forwarded-for': '203.0.113.51' });
    expect((await POST(endless.request)).status).toBe(413);
    expect(endless.pulls()).toBeLessThan(16);
  });

  it('limits reports per address', async () => {
    resetLeadRateLimits();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { POST } = await import('../app/api/csp-report/route');
    let last = 204;
    for (let index = 0; index < 61; index += 1) last = (await POST(report('{}', '198.51.100.77'))).status;
    expect(last).toBe(429);
  });
});
