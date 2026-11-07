import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const BANNED_WORDS = ['bypass', 'turnstile', 'defcon', 'kya', 'hitl', 'passport', 'pentest', 'sla', '@gmail.com'];

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

describe('A2A Protocol & Machine Manifests (.well-known)', () => {
  const publicRoot = path.resolve(__dirname, '../../public');
  const publicDir = path.join(publicRoot, '.well-known');

  it('confirms agent.json is decommissioned and not present in static public assets', () => {
    const filePath = path.join(publicDir, 'agent.json');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('provides a valid ai-catalog.json conforming to discovery standards', () => {
    const filePath = path.join(publicDir, 'ai-catalog.json');
    expect(fs.existsSync(filePath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content).toBeDefined();
    expect(typeof content).toBe('object');
  });

  it('points the catalog at the public docs and the live API OpenAPI document', () => {
    const content = JSON.parse(fs.readFileSync(path.join(publicDir, 'ai-catalog.json'), 'utf-8')) as {
      resources: Array<{ type: string; url: string }>;
    };
    const urls = content.resources.map((resource) => resource.url);
    expect(urls).toContain('https://stealthmark.io/docs');
    expect(urls).toContain('https://api.stealthmark.io/v1/openapi.json');
    expect(urls.some((url) => url.includes('.run.app') || url.includes('mcp.stealthmark.io'))).toBe(false);
  });

  it('publishes security.txt with a contact, an expiry in the future and a policy', () => {
    const text = fs.readFileSync(path.join(publicDir, 'security.txt'), 'utf-8');
    expect(text).toMatch(/^Contact: .*security@stealthmark\.io/m);
    expect(text).toContain('Policy: https://stealthmark.io/trust');
    const expires = /^Expires: (.+)$/m.exec(text)?.[1];
    expect(expires).toBeDefined();
    expect(new Date(expires ?? '').getTime()).toBeGreaterThan(Date.now());
  });

  it('publishes an llms.txt that only points at pages and files that exist', () => {
    const text = fs.readFileSync(path.join(publicRoot, 'llms.txt'), 'utf-8');
    expect(text.startsWith('# StealthMark')).toBe(true);
    expect(text).toContain('StealthMark (founded in 2026)');
    expect(text).not.toMatch(/kya|passport|defcon|hitl|soc ?2|99\.999/i);
    for (const known of ['/docs', '/trust', '/pricing', '/.well-known/agent.json', '/.well-known/ai-catalog.json']) {
      expect(text).toContain(`https://stealthmark.io${known}`);
    }
    // The SDK repository is private since 09-10-2026: point agents at npm, never at GitHub.
    expect(text).toContain('https://www.npmjs.com/org/stealthmark');
    expect(text).not.toContain('github.com');
  });

  it('keeps every static machine-readable file free of retired claims and personal data', () => {
    const files = listFiles(publicDir);
    expect(files.length).toBeGreaterThanOrEqual(2);

    for (const file of files) {
      const text = fs.readFileSync(file, 'utf-8').toLowerCase();
      for (const banned of BANNED_WORDS) {
        expect(text.includes(banned), `${path.relative(publicRoot, file)} contains "${banned}"`).toBe(false);
      }
    }
  });
});
