import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { AGENT_ENDPOINTS, AGENT_DOCUMENTS, buildAgentCatalog, MCP_SERVER, X402_PROVER_ENDPOINTS } from '../lib/agent-catalog';
import { PRIVILEGED_MCP_TOOLS, PUBLIC_MCP_TOOLS } from '../lib/mcp-tools';
import { GET as catalogGet } from '../app/agents.json/route';

const ALLOWED_HOSTS = new Set(['stealthmark.io', 'api.stealthmark.io', 'gateway.stealthmark.io']);
const publicRoot = path.resolve(__dirname, '../../public');

describe('agent catalog', () => {
  it('points every endpoint and document at a StealthMark host over https', () => {
    for (const entry of [...AGENT_ENDPOINTS, ...AGENT_DOCUMENTS]) {
      const url = new URL(entry.url.replace('{domain}', 'example.com'));
      expect(url.protocol, entry.id).toBe('https:');
      expect(ALLOWED_HOSTS.has(url.hostname), entry.url).toBe(true);
    }
  });

  it('uses unique ids', () => {
    const ids = [...AGENT_ENDPOINTS, ...AGENT_DOCUMENTS].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only names MCP tools that the MCP server exposes, and covers every one of them', () => {
    const served = new Set([...PUBLIC_MCP_TOOLS, ...PRIVILEGED_MCP_TOOLS].map((tool) => tool.name));
    const named = new Set(AGENT_ENDPOINTS.flatMap((entry) => (entry.mcpTool ? [entry.mcpTool] : [])));
    expect([...named].every((name) => served.has(name))).toBe(true);
    expect([...served].every((name) => named.has(name))).toBe(true);
    expect(MCP_SERVER.publicTools).toEqual(PUBLIC_MCP_TOOLS.map((tool) => tool.name));
  });

  it('sends the prompt-injection scan to the gateway, where it is served', () => {
    const shield = AGENT_ENDPOINTS.find((entry) => entry.id === 'shield_scan');
    expect(shield?.url).toBe('https://gateway.stealthmark.io/api/v2/shield/scan');
  });

  it('keeps every same-origin document it lists in public/ or as an app route', () => {
    const appRoot = path.resolve(__dirname, '../app');
    for (const doc of AGENT_DOCUMENTS) {
      const url = new URL(doc.url);
      if (url.hostname !== 'stealthmark.io') continue;
      const inPublic = fs.existsSync(path.join(publicRoot, url.pathname));
      const asRoute = fs.existsSync(path.join(appRoot, url.pathname, 'route.ts'));
      expect(inPublic || asRoute, doc.url).toBe(true);
    }
  });

  it('keeps the MCP manifest tool list equal to the tools the server exposes', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(publicRoot, '.well-known/mcp.json'), 'utf8')) as { tools: string[] };
    const served = [...PUBLIC_MCP_TOOLS, ...PRIVILEGED_MCP_TOOLS].map((tool) => tool.name).sort();
    expect([...manifest.tools].sort()).toEqual(served);
  });

  it('sends skill.md readers to the gateway for the shield scan and links the hub from llms.txt', () => {
    const skill = fs.readFileSync(path.join(publicRoot, 'skill.md'), 'utf8');
    expect(skill).toContain('https://gateway.stealthmark.io/api/v2/shield/scan');
    expect(skill).not.toContain('https://api.stealthmark.io/api/v2/shield/scan');
    const llms = fs.readFileSync(path.join(publicRoot, 'llms.txt'), 'utf8');
    expect(llms).toContain('https://stealthmark.io/agents');
    expect(llms).toContain('https://stealthmark.io/agents.json');
  });

  it('serves the catalog as cacheable, CORS-open JSON', async () => {
    const res = catalogGet();
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = await res.json();
    expect(body).toEqual(JSON.parse(JSON.stringify(buildAgentCatalog())));
    expect(body.mcp.url).toBe('https://stealthmark.io/api/mcp');
  });

  it('lists exactly 20 Z3 formal verification x402 prover endpoints on gateway.stealthmark.io', () => {
    expect(X402_PROVER_ENDPOINTS.length).toBe(20);
    const ids = X402_PROVER_ENDPOINTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(20);
    for (const prover of X402_PROVER_ENDPOINTS) {
      expect(prover.method).toBe('POST');
      expect(prover.access).toBe('x402');
      expect(prover.url).toMatch(/^https:\/\/gateway\.stealthmark\.io\/x402\//);
      expect(prover.rails).toContain('Base');
      expect(prover.rails).toContain('Solana');
      expect(prover.pricing).toMatch(/\$0\.0[2-5] via x402/);
    }
    const catalog = buildAgentCatalog();
    expect(catalog.x402Provers).toHaveLength(20);
  });
});
