import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';
import { hashApiKey } from '../lib/api-keys';

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('../lib/supabase/admin', () => ({ createSupabaseAdminClient: () => state.client }));

import { GET, POST } from '../app/api/mcp/route';

const API_KEY = `sk_live_${'c3'.repeat(16)}`;
const UNKNOWN_KEY = `sk_live_${'d4'.repeat(16)}`;
const PUBLIC_TOOLS = ['stealthmark_audit_domain', 'stealthmark_shield_scan', 'stealthmark_issue_trust_receipt'];
const ALL_TOOLS = [...PUBLIC_TOOLS, 'stealthmark_generate_manifests', 'stealthmark_generate_edge_shield'];

function rpc(method: string, authorization?: string): NextRequest {
  return new NextRequest('https://stealthmark.io/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method,
      params: { name: 'stealthmark_generate_manifests', arguments: { domain: 'example.com' } },
    }),
  });
}

function discovery(authorization?: string): NextRequest {
  return new NextRequest('https://stealthmark.io/api/mcp', { headers: authorization ? { authorization } : {} });
}

function names(tools: Array<{ name: string }>): string[] {
  return tools.map((tool) => tool.name);
}

describe('MCP surface (v5.1.2)', () => {
  let db: FakeSupabase;

  beforeEach(() => {
    db = new FakeSupabase();
    db.table('api_keys').push({ org_id: 'org-mcp', key_hash: hashApiKey(API_KEY), status: 'active' });
    state.client = db;
  });

  afterEach(() => {
    state.client = null;
  });

  describe('without a key', () => {
    it('lists only the three public tools on GET discovery', async () => {
      const res = await GET(discovery());
      const body = await res.json();
      expect(body.surfaceScope).toBe('public_discovery_only');
      expect(names(body.tools)).toEqual(PUBLIC_TOOLS);
    });

    it('lists only the three public tools on tools/list', async () => {
      const res = await POST(rpc('tools/list'));
      expect(res.status).toBe(200);
      expect(names((await res.json()).result.tools)).toEqual(PUBLIC_TOOLS);
    });

    it('reports the public scope on initialize', async () => {
      const body = await (await POST(rpc('initialize'))).json();
      expect(body.result.serverInfo).toMatchObject({ version: '5.1.2', surfaceScope: 'public_discovery_only' });
    });

    it('answers tools/call with 401 and JSON-RPC code -32001', async () => {
      const res = await POST(rpc('tools/call'));
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ jsonrpc: '2.0', id: 7, error: { code: -32001 } });
    });
  });

  describe('with a key that does not authenticate', () => {
    it.each([
      ['a well-formed key that is not on file', `Bearer ${UNKNOWN_KEY}`],
      ['a token that is not an sk_live_ key', 'Bearer not-a-stealthmark-key'],
      ['a scheme other than Bearer', `Basic ${API_KEY}`],
    ])('rejects tools/call for %s', async (_case, authorization) => {
      const res = await POST(rpc('tools/call', authorization));
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe(-32001);
    });

    it('rejects a revoked key and keeps the privileged tools hidden', async () => {
      db.table('api_keys')[0].status = 'revoked';
      expect((await POST(rpc('tools/call', `Bearer ${API_KEY}`))).status).toBe(401);
      expect(names((await (await POST(rpc('tools/list', `Bearer ${API_KEY}`))).json()).result.tools)).toEqual(PUBLIC_TOOLS);
    });
  });

  describe('with an active key', () => {
    const authorization = `Bearer ${API_KEY}`;

    it('lists all five tools on GET discovery and tools/list', async () => {
      const discovered = await (await GET(discovery(authorization))).json();
      expect(discovered.surfaceScope).toBe('authenticated');
      expect(names(discovered.tools)).toEqual(ALL_TOOLS);

      const listed = await (await POST(rpc('tools/list', authorization))).json();
      expect(names(listed.result.tools)).toEqual(ALL_TOOLS);
    });

    it('accepts tools/call', async () => {
      const res = await POST(rpc('tools/call', authorization));
      expect(res.status).toBe(200);
      expect((await res.json()).result.tools).toEqual(ALL_TOOLS);
    });
  });

  describe('when key verification is unavailable', () => {
    beforeEach(() => {
      state.client = null;
    });

    it('answers tools/call with 503 instead of granting or denying access', async () => {
      const res = await POST(rpc('tools/call', `Bearer ${API_KEY}`));
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe(-32603);
    });

    it('still serves the public tools on tools/list', async () => {
      const res = await POST(rpc('tools/list', `Bearer ${API_KEY}`));
      expect(res.status).toBe(200);
      expect(names((await res.json()).result.tools)).toEqual(PUBLIC_TOOLS);
    });
  });
});
