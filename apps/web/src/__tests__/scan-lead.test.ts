import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase';
import { endlessBodyRequest } from './helpers/chunked-body';

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => state.client }));

import { POST } from '../app/api/scan/lead/route';

const LEAD_URL = 'https://stealthmark.io/api/scan/lead';

function lead(body: string, address: string): Request {
  return new Request(LEAD_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': address },
    body,
  });
}

let db: FakeSupabase;

beforeEach(() => {
  db = new FakeSupabase();
  db.table('scan_leads');
  db.table('usage_records');
  state.client = db;
});

describe('POST /api/scan/lead', () => {
  it('stops reading a chunked body once it passes 4 KB and saves nothing', async () => {
    const endless = endlessBodyRequest(LEAD_URL, { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.21' });
    const res = await POST(endless.request);
    expect(res.status).toBe(413);
    expect(endless.pulls()).toBeLessThan(16);
    expect(db.table('scan_leads')).toHaveLength(0);
    expect(db.table('usage_records')).toHaveLength(0);
  });

  it('answers 400 for a body that is not JSON', async () => {
    expect((await POST(lead('not json', '203.0.113.22'))).status).toBe(400);
  });

  it('answers 400 when the body is JSON null, an array or a bare value, and saves nothing', async () => {
    const bodies = ['null', '[]', '"lead@example.com"', '7', 'true'];
    for (const [i, body] of bodies.entries()) {
      const res = await POST(lead(body, `203.0.113.${30 + i}`));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
    }
    expect(db.table('scan_leads')).toHaveLength(0);
    expect(db.table('usage_records')).toHaveLength(0);
  });

  it('answers 400 instead of 500 when email or domain is not a string', async () => {
    const cases: Array<[unknown, string]> = [
      [{ email: 42, domain: 'example.com' }, 'Valid email is required'],
      [{ email: ['lead@example.com'] }, 'Valid email is required'],
      [{ email: { address: 'lead@example.com' } }, 'Valid email is required'],
      [{ email: 'lead@example.com', domain: 42 }, 'Invalid domain'],
      [{ email: 'lead@example.com', domain: ['example.com'] }, 'Invalid domain'],
      [{ email: 'lead@example.com', domain: { name: 'example.com' } }, 'Invalid domain'],
    ];
    for (const [i, [payload, error]] of cases.entries()) {
      const res = await POST(lead(JSON.stringify(payload), `203.0.113.${40 + i}`));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
    }
    expect(db.table('scan_leads')).toHaveLength(0);
    expect(db.table('usage_records')).toHaveLength(0);
  });

  it('saves a lead whose domain is null or whose source is not a string', async () => {
    const res = await POST(lead(JSON.stringify({ email: 'lead@example.com', domain: null, source: 7 }), '203.0.113.50'));
    expect(res.status).toBe(200);
    expect(db.table('scan_leads')).toMatchObject([{ email: 'lead@example.com', domain: 'unknown', source: 'scan_modal' }]);
  });

  it('still saves a small lead', async () => {
    const res = await POST(lead(JSON.stringify({ email: 'lead@example.com', domain: 'example.com', passes: 3, issues: 2 }), '203.0.113.23'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true });
    expect(db.table('scan_leads')).toMatchObject([{ email: 'lead@example.com', domain: 'example.com', passes: 3, issues: 2 }]);
  });
});
