import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EMAIL_TEMPLATES } from '../lib/email-templates';

const DESKS = [EMAIL_TEMPLATES.access, EMAIL_TEMPLATES.support, EMAIL_TEMPLATES.security];

describe('Contact desks', () => {
  it('defines the three desks the site advertises', () => {
    expect(Object.keys(EMAIL_TEMPLATES).sort()).toEqual(['access', 'security', 'support']);
  });

  it('configures the correct email addresses', () => {
    expect(EMAIL_TEMPLATES.access.address).toBe('access@stealthmark.io');
    expect(EMAIL_TEMPLATES.support.address).toBe('support@stealthmark.io');
    expect(EMAIL_TEMPLATES.security.address).toBe('security@stealthmark.io');
  });

  it('carries a subject and a structured body for each desk', () => {
    for (const desk of DESKS) {
      expect(desk.subject.length).toBeGreaterThan(10);
      expect(desk.body.length).toBeGreaterThan(50);
      expect(desk.body).toContain('---');
    }
  });

  it('exposes no mailto helper and makes no claim about hours, SLAs, DEFCON, WAF or compliance', () => {
    for (const desk of DESKS) {
      expect(desk).not.toHaveProperty('mailtoUrl');
      expect(`${desk.subject}\n${desk.body}`).not.toMatch(/24\/7|\bsla\b|defcon|\bwaf\b|soc ?2|hosted proxy|war room|hitl|priority whitelist/i);
    }
    const source = readFileSync(path.resolve(__dirname, '../lib/email-templates.ts'), 'utf8');
    expect(source).not.toContain('mailto:');
  });
});
