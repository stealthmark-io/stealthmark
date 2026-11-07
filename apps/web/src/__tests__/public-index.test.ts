import { describe, expect, it, vi } from 'vitest';
import publicIndexFile from '../data/public-index.json';
import { latestPublicIndexEdition, parsePublicIndex } from '../lib/public-index';
import {
  MIN_SCANNED_DOMAINS,
  PUBLIC_INDEX_CHECKS,
  REQUEST_SPACING_MS,
  addEdition,
  auditDomains,
  buildEdition,
  listSha256,
  newTallies,
  parseDomainList,
  tallyReport,
  validateRun,
} from '../../scripts/public-index.mjs';

const EXCLUDED_IDS = [
  'exposed_ports_and_cves',
  'dotfile_edge_shield',
  'git_exposure',
  'js_bundle_secrets',
  'paas_origin_and_ai_secret_shield',
  'cms_ecommerce_surface',
  'stealthmark_active',
  'tech_fingerprint',
  'source_map_exposure',
  'api_schema_exposure',
  'client_bundle_exposure',
  'sitemap_xml',
];

function fullReport(domain: string, status = 'pass') {
  const sections: Record<string, Array<Record<string, unknown>>> = {};
  for (const check of PUBLIC_INDEX_CHECKS) {
    (sections[check.section] ??= []).push({ id: check.id, title: `${domain} ${check.id}`, status, detail: `${domain} detail` });
  }
  sections.dns.push({ id: 'exposed_ports_and_cves', title: 'Ports', status: 'fail', detail: `${domain} has port 22 open` });
  return { domain, audited_at: '2026-10-28T00:00:00Z', sections };
}

const domains = Array.from({ length: MIN_SCANNED_DOMAINS }, (_, i) => `site${i}.example.com`);

function editionFor(names: string[], status = 'pass') {
  const tallies = newTallies();
  for (const name of names) tallyReport(tallies, fullReport(name, status));
  return buildEdition({
    edition: '2026-11',
    generatedAt: '2026-11-02T14:00:00.000Z',
    source: { name: 'Test list', url: 'https://example.com/list' },
    domains: names,
    audited: names,
    tallies,
  });
}

describe('public index script', () => {
  it('normalizes, dedupes and sorts the domain list, and reports the lines it skipped', () => {
    const { domains: parsed, rejected } = parseDomainList(
      '# source\nhttps://Acme.io/pricing\nacme.io\n\nlocalhost\n10.0.0.1\nbeta.example.org:8443 # note\n',
    );
    expect(parsed).toEqual(['acme.io', 'beta.example.org']);
    expect(rejected).toEqual(['localhost', '10.0.0.1']);
  });

  it('aggregates only the allowlisted passive checks and never writes a domain name', () => {
    const edition = editionFor(domains);
    const json = JSON.stringify(edition);
    for (const name of domains) expect(json).not.toContain(name);
    for (const id of EXCLUDED_IDS) expect(json).not.toContain(id);
    expect(edition.checks.map((check: { id: string }) => check.id)).toEqual(PUBLIC_INDEX_CHECKS.map((check) => check.id));
    for (const check of edition.checks) expect(check.pass).toBe(MIN_SCANNED_DOMAINS);
    expect(edition.source.list_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('counts a check that is absent or duplicated as missing', () => {
    const tallies = newTallies();
    const report = fullReport('acme.io', 'warn');
    report.sections.dns = report.sections.dns.filter((item) => item.id !== 'dmarc_record');
    report.sections.headers.push({ id: 'referrer_policy', title: 'dup', status: 'pass', detail: '' });
    tallyReport(tallies, report);
    expect(tallies.get('dmarc_record')).toMatchObject({ missing: 1, warn: 0 });
    expect(tallies.get('referrer_policy')).toMatchObject({ missing: 1, warn: 0, pass: 0 });
    expect(tallies.get('spf_record')).toMatchObject({ warn: 1, missing: 0 });
  });

  it('refuses an edition with too few scanned domains or a bad edition id', () => {
    expect(() => editionFor(domains.slice(0, MIN_SCANNED_DOMAINS - 1))).toThrow(/at least/);
    expect(() =>
      buildEdition({ edition: '2026-13', generatedAt: '', source: { name: 'x', url: 'https://x.io' }, domains, audited: domains, tallies: newTallies() }),
    ).toThrow(/YYYY-MM/);
    expect(() =>
      buildEdition({ edition: '2026-11', generatedAt: '', source: { name: 'x', url: 'https://x.io' }, domains, audited: domains.slice(1), tallies: newTallies() }),
    ).toThrow(/returned a report/);
  });

  it('checks the flags and the list size before the run sends a request', () => {
    const source = { name: 'Test list', url: 'https://example.com/list' };
    expect(() => validateRun({ edition: '2026-11', source, domains })).not.toThrow();
    expect(() => validateRun({ edition: undefined, source, domains })).toThrow(/YYYY-MM/);
    expect(() => validateRun({ edition: '2026-11', source: { ...source, name: 'x'.repeat(201) }, domains })).toThrow(/source-name/);
    expect(() => validateRun({ edition: '2026-11', source: { ...source, url: 'http://example.com' }, domains })).toThrow(/https/);
    expect(() => validateRun({ edition: '2026-11', source, domains: domains.slice(1) })).toThrow(/at least/);
  });

  it('hashes only the domains that returned a report', () => {
    const tallies = newTallies();
    const audited = domains.slice(0, MIN_SCANNED_DOMAINS);
    const requested = [...domains, 'down.example.com'];
    const edition = buildEdition({ edition: '2026-11', generatedAt: '', source: { name: 'x', url: 'https://x.io' }, domains: requested, audited, tallies });
    expect(edition.source.list_sha256).toBe(listSha256([...audited].sort()));
    expect(edition.source.list_sha256).not.toBe(listSha256(requested));
    expect(edition).toMatchObject({ domains_requested: requested.length, domains_scanned: audited.length });
  });

  it('never rewrites a published edition', () => {
    const file = addEdition({ schema: 1, editions: [] }, editionFor(domains));
    expect(() => addEdition(file, editionFor(domains))).toThrow(/already exists/);
  });

  it('spaces requests under the gateway limit and honors Retry-After on 429', async () => {
    const waits: number[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      calls += 1;
      if (calls === 2) return new Response('{}', { status: 429, headers: { 'Retry-After': '30' } });
      const domain = new URL(String(url)).searchParams.get('domain') ?? '';
      return Response.json(fullReport(domain));
    });
    const result = await auditDomains(['a.example.com', 'b.example.com'], {
      gatewayUrl: 'https://gateway.test/',
      secret: 'test-secret',
      fetchImpl,
      wait: async (ms: number) => {
        waits.push(ms);
      },
    });
    expect(result.audited).toEqual(['a.example.com', 'b.example.com']);
    expect(waits).toEqual([REQUEST_SPACING_MS, 30_000]);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://gateway.test/api/v2/audit?domain=a.example.com');
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get('x-internal-secret')).toBe('test-secret');
  });

  it('stops the run when the gateway hands back its redacted report', async () => {
    const redacted = fullReport('a.example.com');
    redacted.sections.dns[0] = { id: 'locked_1', title: 'Locked', status: 'warn', locked: true, detail: '' };
    await expect(
      auditDomains(['a.example.com'], {
        gatewayUrl: 'https://gateway.test',
        secret: 'wrong',
        fetchImpl: async () => Response.json(redacted),
        wait: async () => {},
      }),
    ).rejects.toThrow(/redacted/);
  });

  it('counts a domain without a report as not scanned', async () => {
    const result = await auditDomains(['a.example.com'], {
      gatewayUrl: 'https://gateway.test',
      secret: 's',
      fetchImpl: async () => Response.json({ error: 'Bad Request' }, { status: 400 }),
      wait: async () => {},
    });
    expect(result.audited).toEqual([]);
  });
});

describe('public index contract', () => {
  it('parses what the script writes', () => {
    const file = addEdition({ schema: 1, editions: [] }, editionFor(domains, 'warn'));
    const latest = latestPublicIndexEdition(file);
    expect(latest?.edition).toBe('2026-11');
    expect(latest?.checks[0]).toMatchObject({ warn: MIN_SCANNED_DOMAINS, pass: 0 });
  });

  it('rejects counts that do not add up to the scanned domains', () => {
    const file = addEdition({ schema: 1, editions: [] }, editionFor(domains));
    file.editions[0].checks[0].pass -= 1;
    expect(parsePublicIndex(file)).toBeNull();
  });

  it('ships a valid file whose newest edition is 2026-10', () => {
    expect(parsePublicIndex(publicIndexFile)).toHaveLength(1);
    expect(latestPublicIndexEdition()?.edition).toBe('2026-10');
  });
});
