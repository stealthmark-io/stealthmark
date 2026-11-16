import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GET } from '../app/llms.txt/route';
import { SCAN_CHECK_COUNT, SCAN_MEASURED_COUNT, SCAN_NOT_ASSESSED_COUNT } from '../lib/readiness-report';
import { X402_PROVER_ENDPOINTS } from '../lib/agent-catalog';

describe('GET /llms.txt route handler', () => {
  it('serves dynamic llms.txt with correct content-type and cache headers', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');

    const text = await res.text();
    expect(text).toContain(`${SCAN_CHECK_COUNT}-point`);
    expect(text).toContain(`${SCAN_MEASURED_COUNT} external / ${SCAN_NOT_ASSESSED_COUNT} internal`);
  });

  it('lists all core URLs and the 30% A2A affiliate bounty', async () => {
    const res = await GET();
    const text = await res.text();
    const coreUrls = [
      'https://stealthmark.io/scan',
      'https://stealthmark.io/agents',
      'https://stealthmark.io/agents.json',
      'https://stealthmark.io/.well-known/mcp.json',
      'https://stealthmark.io/api/mcp',
      'https://stealthmark.io/leaderboard',
      'https://stealthmark.io/trust',
    ];

    for (const url of coreUrls) {
      expect(text).toContain(url);
    }

    expect(text).toContain('30% revenue share');
    expect(text).toContain('?ref=');
  });

  it('lists all 20 Z3 formal verification x402 prover endpoints', async () => {
    const res = await GET();
    const text = await res.text();
    expect(X402_PROVER_ENDPOINTS.length).toBe(20);

    for (const ep of X402_PROVER_ENDPOINTS) {
      expect(text).toContain(ep.url);
      expect(text).toContain(ep.priceUsd);
      expect(text).toContain(ep.name);
    }
  });

  it('keeps public/llms.txt in sync with route output', async () => {
    const publicFile = path.resolve(__dirname, '../../public/llms.txt');
    const diskContent = fs.readFileSync(publicFile, 'utf-8').trim();
    const res = await GET();
    const dynamicContent = (await res.text()).trim();
    expect(diskContent).toBe(dynamicContent);
  });
});
