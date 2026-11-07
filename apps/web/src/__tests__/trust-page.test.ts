import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TrustPage from '../app/trust/page';
import { metadata } from '../app/trust/layout';
import { SCAN_CHECK_COUNT } from '../lib/readiness-report';
import { FIX_PACK } from '../lib/offer';

const BANNED_TERMS: readonly string[] = [
  'bypass',
  'turnstile',
  'defcon',
  'kya passport',
  'hitl',
  'pentest',
  '99.999',
  'dual-door',
  'fail-open',
  'soc2 compliant',
  'orbital',
  'waf benchmark',
];

const fullHtml = renderToStaticMarkup(createElement(TrustPage)).toLowerCase();
const mainStart = fullHtml.indexOf('<main');
const mainEnd = fullHtml.indexOf('</main>');
const html = fullHtml.slice(mainStart, mainEnd);
const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('/trust page (page body, excluding shared Navbar and Footer)', () => {
  it('renders a main body', () => {
    expect(mainStart).toBeGreaterThan(-1);
    expect(mainEnd).toBeGreaterThan(mainStart);
  });

  it('contains none of the banned legacy terms', () => {
    for (const term of BANNED_TERMS) {
      expect(text, `banned term present: ${term}`).not.toContain(term);
    }
  });

  it('states what the engine does and its safety boundaries', () => {
    expect(text).toContain('what the engine does');
    expect(text).toContain(`executes ${SCAN_CHECK_COUNT} non-intrusive external checks`);
    expect(text).toContain('owasp top 10:2025');
    expect(text).toContain('strict safety boundaries');
    expect(text).toContain('never sends destructive, state-mutating, brute-force, or exploitation payloads');
  });

  it('states the data it inspects and the data it never touches', () => {
    expect(text).toContain('publicly returned http response headers');
    expect(text).toContain('shodan internetdb');
    expect(text).toContain('private customer pii');
  });

  it('documents the v5.1 edge code and the Fix Pack unlock price', () => {
    expect(text).toContain('cloudflare worker v5.1');
    expect(text).toContain(`unlocks the ${FIX_PACK.label.toLowerCase()} for a domain`);
    expect(text).toContain(`for ${FIX_PACK.starterPriceLabel} one-time`);
    expect(text).not.toContain('blackoctober');
  });

  it('states the scanner limits and quotes the check count the scanner runs', () => {
    expect(text).toContain('findings report the vector and masked pattern');
    expect(text).toContain('never requires installing agents, root certificates, or database credentials');
    expect([...new Set(text.match(/\d+-point/g))]).toEqual([`${SCAN_CHECK_COUNT}-point`]);
  });

  it('states the founding year in the footer for startup-program verifiers', () => {
    const fullText = fullHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    expect(fullText).toMatch(/founded in 2026 · © \d{4} stealthmark\./);
  });

  it('shows the security contact as copyable text without mailto', () => {
    expect(text).toContain('security@stealthmark.io');
    expect(html).not.toContain('mailto:');
  });

  it('advertises no npm install and only CLI commands the CLI implements', () => {
    expect(text).not.toContain('npm install');
    const cli = readFileSync(join(__dirname, '../../../../packages/cli/src/bin.ts'), 'utf8');
    expect(text).toContain('npx @stealthmark/cli doctor');
    for (const command of ['doctor', 'pdf-check']) {
      expect(text).toContain(command);
      expect(cli).toContain(`command === '${command}'`);
    }
    expect([...text.matchAll(/npx ([^\s`]+)/g)].map((m) => m[1])).toEqual(['@stealthmark/cli']);
  });

  it('uses honest SEO metadata', () => {
    const meta = JSON.stringify(metadata).toLowerCase();
    for (const term of BANNED_TERMS) expect(meta).not.toContain(term);
    expect(meta).not.toContain('soc 2');
  });
});
