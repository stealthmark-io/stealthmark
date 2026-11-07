import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Hero } from '../components/landing/Hero';
import { ComparisonTable } from '../components/landing/ComparisonTable';
import { PricingGrid } from '../components/landing/PricingGrid';
import { ClaimWhitelistModal } from '../components/landing/ClaimWhitelistModal';
import { AgenticScanner } from '../components/landing/AgenticScanner';
import { MarqueeEcosystem } from '../components/landing/MarqueeEcosystem';
import { WhyNow } from '../components/landing/WhyNow';
import { Pillars } from '../components/landing/Pillars';
import { Roadmap } from '../components/landing/Roadmap';
import { InstallSection } from '../components/landing/InstallSection';
import { EcosystemGrid } from '../components/landing/EcosystemGrid';
import { Cta } from '../components/landing/Cta';
import {
  RoiCalculator,
  packCoverage,
  CREDIT_VALIDITY_MONTHS,
  FREE_MONTHLY_EVENTS,
} from '../components/landing/RoiCalculator';
import { DICTIONARIES, type Language } from '../context/LanguageContext';
import { CREDIT_PACKS, findPackById } from '../lib/polar-products';
import { SDK_NPM_URL } from '../lib/site';

const BANNED_TERMS: readonly string[] = [
  'bypass',
  'turnstile',
  'defcon',
  'kya',
  'hitl',
  'passport',
  'pentest',
  '99.999',
  'dual-door',
  'zero dom scraping',
  'cloudflare of',
];

const LEGACY_PRODUCT_TERMS: readonly string[] = [
  'dual door',
  'porta dupla',
  'doble puerta',
  'pasaporte',
  'passaporte',
  'human-in-the-loop',
  'cloudflare da',
  'cloudflare de',
];

function expectNoBannedTerms(label: string, text: string, terms: readonly string[] = BANNED_TERMS): void {
  const lower = text.toLowerCase();
  for (const term of terms) {
    expect(lower.includes(term), `${label} still contains "${term}"`).toBe(false);
  }
}

function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

function collectStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') {
    into.push(value);
  } else if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) collectStrings(child, into);
  }
  return into;
}

describe('landing copy tells the single-player story', () => {
  const surfaces: Record<string, string> = {
    Hero: renderToStaticMarkup(createElement(Hero)),
    ComparisonTable: renderToStaticMarkup(createElement(ComparisonTable)),
    PricingGrid: renderToStaticMarkup(createElement(PricingGrid)),
    WhyNow: renderToStaticMarkup(createElement(WhyNow)),
    Pillars: renderToStaticMarkup(createElement(Pillars)),
    Roadmap: renderToStaticMarkup(createElement(Roadmap)),
    InstallSection: renderToStaticMarkup(createElement(InstallSection)),
    EcosystemGrid: renderToStaticMarkup(createElement(EcosystemGrid)),
    Cta: renderToStaticMarkup(createElement(Cta)),
    ClaimWhitelistModal: renderToStaticMarkup(
      createElement(ClaimWhitelistModal, { isOpen: true, onClose: () => undefined })
    ),
  };

  for (const [name, html] of Object.entries(surfaces)) {
    it(`${name} has none of the retired product terms`, () => {
      expect(html.length).toBeGreaterThan(0);
      expectNoBannedTerms(name, html);
    });
  }

  it('the hero states the control-layer thesis, the CTAs and the four pillars in order', () => {
    const html = surfaces.Hero;
    const text = visibleText(html);
    expect(text).toContain("Your website wasn't built for AI agents.");
    expect(text).toContain('StealthMark was.');
    expect(text).toContain('The control layer between your website and AI agents.');
    expect(text).toContain('Two-line install · No DNS change · Same page for humans');
    expect(text).not.toContain('Humans unchanged');
    expect(html).not.toContain('democv');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/docs"');
    expect(text).toContain('Get your API key');
    expect(text).toContain('Read the docs');
    const order = ['Detect', 'Observe', 'Authorize', 'Manifest'].map((pill) => text.indexOf(pill));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).not.toContain('Monetize');
  });

  it('the new sections render the narrative from the product truth', () => {
    const whyNow = visibleText(surfaces.WhyNow);
    for (const expected of ['Traditional web', 'Human', 'Browser', 'Agentic web', 'AI agent', 'StealthMark policy', 'ChatGPT, Claude, Perplexity, custom bots']) {
      expect(whyNow).toContain(expected);
    }
    const pillars = visibleText(surfaces.Pillars);
    for (const expected of ['Detect', 'Observe', 'Authorize', 'Manifest', 'observe', 'manifest', 'block', 'default', 'Know Your Agent ladder', 'Declared', 'Verified', 'Signed', 'Shipped']) {
      expect(pillars).toContain(expected);
    }
    expect(pillars.match(/Roadmap/g)).toHaveLength(2);
  });

  it('every roadmap item is labeled Roadmap and carries no date', () => {
    const html = surfaces.Roadmap;
    const text = visibleText(html);
    for (const step of ['Identity', 'Capability enforcement', 'Payments']) {
      expect(text).toContain(step);
    }
    expect(text).toContain('Where this goes');
    const items = html.split('<li').slice(1);
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(visibleText(item)).toContain('Roadmap');
    }
    expect(text).not.toMatch(/\b(20\d\d|Q[1-4])\b/);
  });

  it('the install section previews withStealthMark with no npm or npx command', () => {
    const html = surfaces.InstallSection;
    const text = visibleText(html);
    expect(text).toContain('withStealthMark');
    expect(text).toContain('@stealthmark/next');
    expect(text).toContain('Available on npm: @stealthmark/next');
    expect(html).toContain(`href="${SDK_NPM_URL}"`);
    expect(text).toContain('Apache-2.0');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/docs"');
    expect(text.toLowerCase()).not.toContain('npx');
  });

  it('the new sections never advertise unshipped or unmeasured claims', () => {
    for (const name of ['Hero', 'WhyNow', 'Pillars', 'Roadmap', 'InstallSection', 'EcosystemGrid', 'Cta']) {
      const text = visibleText(surfaces[name]);
      expectNoBannedTerms(name, text);
      for (const forbidden of ['npm install', 'pip install', 'npx', '3 minutes', 'soc2', 'soc 2', 'python sdk', 'proxy']) {
        expect(text.toLowerCase().includes(forbidden), `${name} contains "${forbidden}"`).toBe(false);
      }
      expect(/\bpip\b/i.test(text), `${name} mentions pip`).toBe(false);
    }
  });

  it('the integrations grid lists only real integrations', () => {
    const text = visibleText(surfaces.EcosystemGrid);
    for (const real of ['Next.js', 'Express', 'Fastify', 'Vercel', 'Supabase', 'Polar']) {
      expect(text).toContain(real);
    }
    for (const fabricated of ['Cursor', 'Windsurf', 'Hermes', 'CrewAI', 'LangGraph', 'stealthmark connect']) {
      expect(text).not.toContain(fabricated);
    }
  });

  it('the comparison table covers the real alternatives and capabilities', () => {
    const html = surfaces.ComparisonTable;
    for (const expected of [
      'Grep your logs',
      'CDN bot rules',
      'Generic analytics',
      'Sees declared AI agents',
      'Per-agent view',
      'Observe / manifest / block policy',
      'Works on any host',
      'prepaid credits',
      'Apache-2.0 SDK',
    ]) {
      expect(html).toContain(expected);
    }
  });

  it('the comparison table invents no competitor numbers', () => {
    const digits = visibleText(surfaces.ComparisonTable).match(/\d[\d,.]*/g) ?? [];
    // 500 is the StealthMark cap of recorded blocked events per hour (MAX_BLOCKED_EVENTS_PER_ORG_PER_HOUR), not a competitor figure.
    expect([...digits].sort()).toEqual(['2.0', '250', '403', '500']);
  });

  it('the contact form is plain and makes no early access claim', () => {
    const html = surfaces.ClaimWhitelistModal;
    expect(html).toContain('Contact StealthMark');
    expect(html).not.toMatch(/early access/i);
    expect(html).not.toContain('VIP');
    expect(html).not.toContain('waiting queue');
  });

  it('credits are described as valid for 12 months, never as non-expiring', () => {
    const html = surfaces.PricingGrid;
    expect(html).toContain('valid for 12 months');
    expect(html.toLowerCase()).not.toContain('never expire');
    expect(html).not.toContain('Dual-Door');
  });
});

describe('landing sections behind the demo flag contain nothing fabricated', () => {
  it('the scanner is an explainer with no score, tier or customer-specific branch', () => {
    const html = renderToStaticMarkup(createElement(AgenticScanner));
    expect(html).toContain('x-stealthmark-agent-detected');
    expect(html).toContain('id="scanner"');
    expectNoBannedTerms('AgenticScanner', html);
    const text = visibleText(html);
    for (const fabricated of ['Agentic Native', 'agentic_score', 'democv', 'demodental', 'Tier 1', 'Tier 3', '98', '100%']) {
      expect(text).not.toContain(fabricated);
    }
  });

  it('the calculator shows only arithmetic on the public pack prices', () => {
    const html = renderToStaticMarkup(createElement(RoiCalculator));
    expectNoBannedTerms('RoiCalculator', html);
    const text = visibleText(html);
    for (const fabricated of ['18,000', '182', '98.9', '44,545', 'Zero hallucination', 'Token Compression']) {
      expect(text).not.toContain(fabricated);
    }
    for (const pack of CREDIT_PACKS) {
      expect(html).toContain(`data-testid="coverage-${pack.pack}"`);
    }
  });

  it('the marquee names no fabricated integrations and lists the agents the detector recognizes, the Next.js and Express adapters and what the scanner covers', () => {
    const html = renderToStaticMarkup(createElement(MarqueeEcosystem));
    expectNoBannedTerms('MarqueeEcosystem', html);
    for (const fabricated of ['Hermes', 'Cursor', 'Windsurf', 'Shopify', 'Stripe', 'Protected', 'MCP-Client']) {
      expect(html).not.toContain(fabricated);
    }
    for (const real of ['GPTBot', 'ClaudeBot', 'Perplexity', 'OAI-Search', 'Meta-ExternalAgent', 'Next.js App Router', 'Express &amp; Fastify', 'OWASP Top 10:2025', 'Shodan InternetDB', 'DMARC']) {
      expect(html).toContain(real);
    }
  });
});

describe('credit estimator arithmetic', () => {
  const starter = findPackById('starter');
  const scale = findPackById('scale');

  it('divides pack credits by monthly volume', () => {
    const coverage = packCoverage(15_000, starter);
    expect(coverage.months).toBe(1);
    expect(coverage.outlastsValidity).toBe(false);
    expect(coverage.usdPerMonth).toBe(9);
  });

  it('caps the effective cost at the 12 month validity window', () => {
    const coverage = packCoverage(10_000, scale);
    expect(coverage.months).toBe(25);
    expect(coverage.outlastsValidity).toBe(true);
    expect(coverage.usdPerMonth).toBeCloseTo(scale.priceUsd / CREDIT_VALIDITY_MONTHS, 10);
  });

  it('never divides by zero', () => {
    const coverage = packCoverage(0, starter);
    expect(Number.isFinite(coverage.months)).toBe(true);
    expect(Number.isFinite(coverage.usdPerMonth)).toBe(true);
  });

  it('matches the free tier allowance shown on the pricing grid', () => {
    expect(FREE_MONTHLY_EVENTS).toBe(250);
    expect(renderToStaticMarkup(createElement(PricingGrid))).toContain('250 agent events / month');
  });
});

describe('translations', () => {
  const languages: Language[] = ['en', 'es', 'pt'];

  for (const lang of languages) {
    it(`${lang} dictionary has none of the retired product terms or claims`, () => {
      const text = collectStrings(DICTIONARIES[lang]).join('\n');
      expectNoBannedTerms(`DICTIONARIES.${lang}`, text);
      expectNoBannedTerms(`DICTIONARIES.${lang}`, text, LEGACY_PRODUCT_TERMS);
      for (const claim of ['72 KB', '326 bytes', '99.1', '99,1', '182 tokens', 'never expire']) {
        expect(text.includes(claim), `DICTIONARIES.${lang} still contains "${claim}"`).toBe(false);
      }
    });
  }
});

describe('docs page', () => {
  const source = readFileSync(join(__dirname, '../app/docs/page.tsx'), 'utf8');

  it('documents the real scanner API and only CLI commands the CLI implements', () => {
    expect(source).toContain('/api/scan/audit?domain=example.com');
    expect(source).toContain('/api/v2/trust-receipt');
    const cli = readFileSync(join(__dirname, '../../../../packages/cli/src/bin.ts'), 'utf8');
    for (const command of ['doctor', 'pdf-check']) {
      expect(source).toContain(`@stealthmark/cli ${command}`);
      expect(cli).toContain(`command === '${command}'`);
    }
  });

  it('points the site origin at stealthmark.io and the SDK link at the docs, and claims no public repository, provenance or tarball', () => {
    const site = readFileSync(join(__dirname, '../lib/site.ts'), 'utf8');
    expect(site).toContain("SITE_ORIGIN = 'https://stealthmark.io'");
    expect(site).toContain("SDK_NPM_URL = 'https://stealthmark.io/docs'");
    expect(source).not.toMatch(/public SDK repository|provenance|github\.com/);
    expect(source).not.toContain('.tgz');
    expect(source).not.toContain('not published to npm');
  });

  it('the MCP panel does not present an unpublished npm package as installable', () => {
    const panel = readFileSync(join(__dirname, '../app/dashboard/components/McpPanel.tsx'), 'utf8');
    expect(panel).toContain('not published to npm yet');
    expect(panel).not.toContain('Zero-Install');
    expect(panel).not.toContain('Fastest Setup');
  });

  it('carries none of the retired sections, hosts or key prefixes', () => {
    expectNoBannedTerms('docs/page.tsx', source);
    expect(source).toContain('https://stealthmark.io/api/scan/audit');
    for (const dead of ['.run.app', 'sm_live_', 'intermiami', 'mcp-server', 'run-pentest', 'gateway/resolve']) {
      expect(source.includes(dead), `docs page still contains "${dead}"`).toBe(false);
    }
  });
});
