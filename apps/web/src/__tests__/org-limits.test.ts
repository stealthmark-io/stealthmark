import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

const state = vi.hoisted(() => ({
  client: null as unknown,
  session: null as { user: { id: string; orgId: string; email: string }; orgId: string } | null,
}));

vi.mock('../lib/supabase/admin', () => ({ createSupabaseAdminClient: () => state.client }));
vi.mock('../lib/session', () => ({ getOrgSession: async () => state.session }));

import { POST as keysPost } from '../app/api/keys/route';
import { POST as domainsPost } from '../app/api/domains/route';
import { MAX_ACTIVE_KEYS_PER_ORG, MAX_SITES_PER_ORG } from '../lib/org-limits';

const ORG_ID = '0b6a6f2e-4f7c-4d63-9d2a-3a1f9d2f7c11';
const OTHER_ORG = '5c1d9a0e-7a1f-4d63-8a2a-111111111111';

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('per-organization abuse guards', () => {
  let db: FakeSupabase;

  beforeEach(() => {
    db = new FakeSupabase();
    state.client = db;
    state.session = { user: { id: 'u1', orgId: ORG_ID, email: 'dev@acme.io' }, orgId: ORG_ID };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    state.client = null;
    state.session = null;
  });

  describe('POST /api/keys', () => {
    function seedKeys(org: string, active: number, revoked = 0): void {
      const rows = db.table('api_keys', { defaults: () => ({ id: crypto.randomUUID(), created_at: new Date().toISOString() }) });
      for (let index = 0; index < active; index += 1) rows.push({ id: crypto.randomUUID(), org_id: org, status: 'active' });
      for (let index = 0; index < revoked; index += 1) rows.push({ id: crypto.randomUUID(), org_id: org, status: 'revoked' });
    }

    it('creates a key while the organization is under the limit', async () => {
      seedKeys(ORG_ID, MAX_ACTIVE_KEYS_PER_ORG - 1);
      const res = await keysPost(post('https://stealthmark.io/api/keys', { name: 'CI' }));
      expect(res.status).toBe(200);
    });

    it('answers 409 key_limit_reached once the organization has the maximum of active keys', async () => {
      seedKeys(ORG_ID, MAX_ACTIVE_KEYS_PER_ORG);
      const res = await keysPost(post('https://stealthmark.io/api/keys', { name: 'One too many' }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'key_limit_reached', limit: MAX_ACTIVE_KEYS_PER_ORG });
    });

    it('does not count revoked keys or keys of other organizations', async () => {
      seedKeys(ORG_ID, 2, MAX_ACTIVE_KEYS_PER_ORG);
      seedKeys(OTHER_ORG, MAX_ACTIVE_KEYS_PER_ORG);
      const res = await keysPost(post('https://stealthmark.io/api/keys', { name: 'Still allowed' }));
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/domains', () => {
    function seedSites(org: string, count: number): void {
      const rows = db.table('registered_sites', {
        defaults: () => ({ id: crypto.randomUUID(), status: 'pending', dns_verified: false, created_at: new Date().toISOString() }),
        unique: [['domain']],
      });
      for (let index = 0; index < count; index += 1) {
        rows.push({ id: crypto.randomUUID(), org_id: org, domain: `site-${org.slice(0, 4)}-${index}.example.com`, status: 'pending', dns_verified: false, dns_verification_token: 't', created_at: new Date().toISOString() });
      }
      db.table('api_keys', { defaults: () => ({ id: crypto.randomUUID(), created_at: new Date().toISOString() }) });
    }

    it('registers a site while the organization is under the limit', async () => {
      seedSites(ORG_ID, MAX_SITES_PER_ORG - 1);
      const res = await domainsPost(post('https://stealthmark.io/api/domains', { domain: 'new-site.example.com' }));
      expect(res.status).toBe(201);
    });

    it('answers 409 site_limit_reached once the organization owns the maximum number of sites', async () => {
      seedSites(ORG_ID, MAX_SITES_PER_ORG);
      const res = await domainsPost(post('https://stealthmark.io/api/domains', { domain: 'one-too-many.example.com' }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'site_limit_reached', limit: MAX_SITES_PER_ORG });
    });

    it('still lets an organization re-submit a domain it already owns at the limit', async () => {
      seedSites(ORG_ID, MAX_SITES_PER_ORG);
      const res = await domainsPost(post('https://stealthmark.io/api/domains', { domain: `site-${ORG_ID.slice(0, 4)}-0.example.com` }));
      expect(res.status).toBe(201);
    });
  });
});
