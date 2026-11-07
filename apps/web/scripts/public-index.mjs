#!/usr/bin/env node
// Builds one edition of the Public Index: aggregate counts of DNS, TLS, header and AI-surface checks over a
// public list of domains. The edition never names a domain; only the sha256 of the domains that returned a report.
//
//   GATEWAY_INTERNAL_SECRET=... node apps/web/scripts/public-index.mjs \
//     --domains list.txt --source-name "..." --source-url https://... --edition 2026-11 [--dry-run]
//
// --dry-run checks the flags, the list and the output file and prints the counts without sending a request.
//
// Every run against third-party domains needs the founder's explicit go-ahead.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const AUDITOR_USER_AGENT = 'StealthMarkAuditor/2.0 (+https://stealthmark.io/docs)';
export const RUNNER_USER_AGENT = 'StealthMarkOutbound-Index/1.0 (+https://stealthmark.io/leaderboard)';
export const MIN_SCANNED_DOMAINS = 50;
export const MAX_DOMAINS = 1000;
// Same limit the page's parser puts on text fields (src/lib/public-index.ts).
const MAX_SOURCE_NAME = 200;
// The gateway allows 10 audits per client IP per minute; 7 s apart keeps a run at about 8.
export const REQUEST_SPACING_MS = 7000;
const MAX_429_RETRIES = 2;

// Only passive hygiene checks. Ports, CVEs, dotfiles, secrets, source maps, CMS surface and leak probes stay out:
// an aggregate of those is still a map of where to look.
export const PUBLIC_INDEX_CHECKS = [
  { id: 'https_available', section: 'transport', label: 'HTTPS available' },
  { id: 'http_redirect', section: 'transport', label: 'HTTP redirects to HTTPS' },
  { id: 'hsts_configured', section: 'transport', label: 'HSTS header' },
  { id: 'tls_certificate_trust', section: 'transport', label: 'Trusted TLS certificate chain' },
  { id: 'caa_record', section: 'dns', label: 'CAA record' },
  { id: 'spf_record', section: 'dns', label: 'SPF record' },
  { id: 'dmarc_record', section: 'dns', label: 'DMARC policy' },
  { id: 'content_security_policy', section: 'headers', label: 'Content-Security-Policy' },
  { id: 'content_type_options', section: 'headers', label: 'X-Content-Type-Options' },
  { id: 'referrer_policy', section: 'headers', label: 'Referrer-Policy' },
  { id: 'framing_protection', section: 'headers', label: 'Clickjacking protection' },
  { id: 'robots_txt', section: 'crawl_policy', label: 'robots.txt' },
  { id: 'ai_agent_rules', section: 'crawl_policy', label: 'AI crawler rules in robots.txt' },
  { id: 'sitemap_declared', section: 'crawl_policy', label: 'Sitemap declared in robots.txt' },
  { id: 'llms_txt', section: 'ai_surface', label: '/llms.txt' },
  { id: 'agent_json', section: 'ai_surface', label: '/.well-known/agent.json' },
  { id: 'structured_data', section: 'ai_surface', label: 'Schema.org JSON-LD' },
  { id: 'ai_citation_metadata', section: 'ai_surface', label: 'AI citation metadata' },
];

export const STATUSES = ['pass', 'warn', 'fail', 'info', 'error', 'not_assessed'];

const FQDN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,24}$/;
const EDITION_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Same normalization as sanitizeAndValidateDomain, so a list entry audits the host /scan would audit. */
export function normalizeDomain(raw) {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
  if (!FQDN_RE.test(cleaned) || cleaned.endsWith('.local') || cleaned.endsWith('.internal')) return null;
  return cleaned;
}

/** One domain per line; blank lines and # comments are skipped. Returns the sorted unique list and the rejected lines. */
export function parseDomainList(text) {
  const domains = new Set();
  const rejected = [];
  for (const line of text.split(/\r?\n/)) {
    const entry = line.replace(/#.*$/, '').trim();
    if (!entry) continue;
    const domain = normalizeDomain(entry);
    if (domain) domains.add(domain);
    else rejected.push(entry);
  }
  return { domains: [...domains].sort(), rejected };
}

export function listSha256(domains) {
  return createHash('sha256').update(domains.join('\n')).digest('hex');
}

/** The gateway redacts issues for callers without its internal secret; aggregating that shape would undercount every issue. */
export function isRedactedReport(report) {
  const sections = report?.sections;
  if (!sections || typeof sections !== 'object') return false;
  return Object.values(sections).some((items) => Array.isArray(items) && items.some((item) => item?.locked === true));
}

function emptyCounts() {
  return { pass: 0, warn: 0, fail: 0, info: 0, error: 0, not_assessed: 0, missing: 0 };
}

/** Adds one full gateway report to the per-check tallies. A check absent, duplicated or with an unknown status counts as missing. */
export function tallyReport(tallies, report) {
  for (const check of PUBLIC_INDEX_CHECKS) {
    const items = report?.sections?.[check.section];
    const matches = Array.isArray(items) ? items.filter((item) => item?.id === check.id) : [];
    const status = matches.length === 1 ? matches[0].status : null;
    const counts = tallies.get(check.id);
    if (STATUSES.includes(status)) counts[status] += 1;
    else counts.missing += 1;
  }
}

export function newTallies() {
  return new Map(PUBLIC_INDEX_CHECKS.map((check) => [check.id, emptyCounts()]));
}

/** Everything a run can check before its first request, so a bad flag or a short list fails before a half-hour run. */
export function validateRun({ edition, source, domains }) {
  if (!EDITION_RE.test(edition ?? '')) throw new Error(`--edition must look like YYYY-MM, got "${edition}"`);
  if (!source.name || source.name.length > MAX_SOURCE_NAME) throw new Error(`--source-name must be 1-${MAX_SOURCE_NAME} characters.`);
  if (!/^https:\/\/\S+$/.test(source.url ?? '')) throw new Error('--source-url must be an https URL.');
  if (domains.length < MIN_SCANNED_DOMAINS) {
    throw new Error(`The list has ${domains.length} domains; an edition needs at least ${MIN_SCANNED_DOMAINS}.`);
  }
  if (domains.length > MAX_DOMAINS) throw new Error(`The list has ${domains.length} domains; the limit is ${MAX_DOMAINS}.`);
}

/** `audited` is the domains that returned a report: the published sha256 covers exactly the domains behind the counts. */
export function buildEdition({ edition, generatedAt, source, domains, audited, tallies }) {
  validateRun({ edition, source, domains });
  if (audited.length < MIN_SCANNED_DOMAINS) {
    throw new Error(`Only ${audited.length} domains returned a report; an edition needs at least ${MIN_SCANNED_DOMAINS}.`);
  }
  return {
    edition,
    generated_at: generatedAt,
    auditor: AUDITOR_USER_AGENT,
    source: { name: source.name, url: source.url, list_sha256: listSha256([...audited].sort()) },
    domains_requested: domains.length,
    domains_scanned: audited.length,
    checks: PUBLIC_INDEX_CHECKS.map((check) => ({ ...check, ...tallies.get(check.id) })),
  };
}

export function addEdition(file, edition) {
  if (file?.schema !== 1 || !Array.isArray(file.editions)) throw new Error('public-index.json is not schema 1.');
  if (file.editions.some((existing) => existing.edition === edition.edition)) {
    throw new Error(`Edition ${edition.edition} already exists; editions are never rewritten.`);
  }
  return { schema: 1, editions: [...file.editions, edition].sort((a, b) => a.edition.localeCompare(b.edition)) };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Audits each domain through the gateway, one at a time. Returns the tallies and the domains that returned a report.
 * Throws if the gateway hands back its redacted public report: the secret is wrong and every count would be off.
 */
export async function auditDomains(domains, { gatewayUrl, secret, fetchImpl = fetch, wait = sleep, log = () => {} }) {
  const tallies = newTallies();
  const audited = [];
  for (const [index, domain] of domains.entries()) {
    if (index > 0) await wait(REQUEST_SPACING_MS);
    let report = null;
    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt += 1) {
      let res;
      try {
        res = await fetchImpl(`${gatewayUrl.replace(/\/$/, '')}/api/v2/audit?domain=${encodeURIComponent(domain)}`, {
          headers: { Accept: 'application/json', 'User-Agent': RUNNER_USER_AGENT, 'x-internal-secret': secret },
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        break;
      }
      if (res.status === 429 && attempt < MAX_429_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await wait((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60) * 1000);
        continue;
      }
      if (res.ok) report = await res.json().catch(() => null);
      break;
    }
    if (report && isRedactedReport(report)) {
      throw new Error('The gateway returned its redacted public report: GATEWAY_INTERNAL_SECRET does not match.');
    }
    if (report?.sections) {
      tallyReport(tallies, report);
      audited.push(domain);
    }
    log(`[${index + 1}/${domains.length}] ${report?.sections ? 'ok' : 'no report'}`);
  }
  return { tallies, audited };
}

async function main() {
  const { values } = parseArgs({
    options: {
      domains: { type: 'string' },
      'source-name': { type: 'string' },
      'source-url': { type: 'string' },
      edition: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      out: { type: 'string', default: path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/data/public-index.json') },
    },
  });
  if (!values.domains) throw new Error('Required: --domains <file> --source-name <text> --source-url <https url> --edition YYYY-MM');
  const source = { name: values['source-name'], url: values['source-url'] };
  const { domains, rejected } = parseDomainList(readFileSync(values.domains, 'utf8'));
  if (rejected.length) console.error(`Skipped ${rejected.length} lines that are not domains.`);
  validateRun({ edition: values.edition, source, domains });

  const file = JSON.parse(readFileSync(values.out, 'utf8'));
  addEdition(file, { edition: values.edition });
  if (values['dry-run']) {
    console.error(`Dry run: edition ${values.edition}, ${domains.length} domains, about ${Math.ceil((domains.length * REQUEST_SPACING_MS) / 60_000)} min. No request sent.`);
    return;
  }

  const secret = process.env.GATEWAY_INTERNAL_SECRET;
  if (!secret) throw new Error('Set GATEWAY_INTERNAL_SECRET in the environment.');
  const gatewayUrl = process.env.PUBLIC_INDEX_GATEWAY_URL || 'https://gateway.stealthmark.io';
  const { tallies, audited } = await auditDomains(domains, { gatewayUrl, secret, log: (line) => console.error(line) });
  const edition = buildEdition({ edition: values.edition, generatedAt: new Date().toISOString(), source, domains, audited, tallies });
  writeFileSync(values.out, `${JSON.stringify(addEdition(file, edition), null, 2)}\n`);
  console.error(`Edition ${edition.edition}: ${audited.length}/${domains.length} domains scanned, written to ${values.out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
