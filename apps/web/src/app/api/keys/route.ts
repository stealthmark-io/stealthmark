import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '../../../lib/supabase/admin';
import { getOrgSession } from '../../../lib/session';
import { generateApiKey } from '../../../lib/api-keys';
import { parseScopes } from '../../../lib/key-scopes';
import { MAX_ACTIVE_KEYS_PER_ORG } from '../../../lib/org-limits';
import { readBodyText } from '@/lib/request-body';

export interface ApiKeyResponseItem {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  rateLimitRpm: number;
  createdAt: string;
  lastUsedAt: string | null;
  status: 'active' | 'revoked';
}

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[] | null;
  rate_limit_rpm: number | null;
  status: string;
  last_used_at: string | null;
  created_at: string;
}

interface CreateKeyBody {
  name?: unknown;
  scopes?: unknown;
  rateLimitRpm?: unknown;
}

const MAX_NAME_LENGTH = 100;
const MAX_RATE_LIMIT_RPM = 10000;
const MAX_BODY_BYTES = 2 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRateLimit(raw: unknown): number | null {
  if (raw === undefined) return 120;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > MAX_RATE_LIMIT_RPM) return null;
  return raw;
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

function unavailable(): NextResponse {
  return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
}

// GET /api/keys - List API keys of the session organization
export async function GET(_req: NextRequest) {
  const session = await getOrgSession();
  if (!session) return unauthorized();

  try {
    const supabase = createSupabaseAdminClient();
    if (!supabase) return unavailable();

    const { data, error } = await supabase
      .from('api_keys')
      .select('id, name, key_prefix, scopes, rate_limit_rpm, status, last_used_at, created_at')
      .eq('org_id', session.orgId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[API Keys GET] Supabase error:', error.message);
      return NextResponse.json({ error: 'failed_to_list_keys' }, { status: 500 });
    }

    const keys: ApiKeyResponseItem[] = ((data ?? []) as ApiKeyRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      keyPrefix: row.key_prefix,
      scopes: Array.isArray(row.scopes) ? row.scopes : [],
      rateLimitRpm: row.rate_limit_rpm || 120,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at || null,
      status: row.status === 'revoked' ? 'revoked' : 'active',
    }));

    return NextResponse.json({ keys });
  } catch (err: unknown) {
    console.error('[API Keys GET Error]:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'failed_to_list_keys' }, { status: 500 });
  }
}

// POST /api/keys - Create and persist a new API key for the session organization
export async function POST(req: NextRequest) {
  const session = await getOrgSession();
  if (!session) return unauthorized();

  const raw = await readBodyText(req, MAX_BODY_BYTES);
  if (raw === null) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }
  let body: CreateKeyBody | null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const name = body.name === undefined ? 'Production Gateway Agent' : body.name;
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
  }
  const scopes = parseScopes(body.scopes);
  if (!scopes) return NextResponse.json({ error: 'invalid_scopes' }, { status: 400 });
  const rateLimitRpm = parseRateLimit(body.rateLimitRpm);
  if (rateLimitRpm === null) return NextResponse.json({ error: 'invalid_rate_limit' }, { status: 400 });

  try {
    const supabase = createSupabaseAdminClient();
    if (!supabase) return unavailable();

    const { count: activeKeys, error: countError } = await supabase
      .from('api_keys')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', session.orgId)
      .eq('status', 'active');
    if (countError) {
      console.error('[API Keys POST] Active key count error:', countError.code, countError.message);
      return NextResponse.json({ error: 'failed_to_create_key', code: countError.code ?? null }, { status: 500 });
    }
    if ((activeKeys ?? 0) >= MAX_ACTIVE_KEYS_PER_ORG) {
      return NextResponse.json({ error: 'key_limit_reached', limit: MAX_ACTIVE_KEYS_PER_ORG }, { status: 409 });
    }

    const { key, keyPrefix, keyHash } = generateApiKey();
    const { data, error } = await supabase
      .from('api_keys')
      .insert({
        org_id: session.orgId,
        name: name.trim(),
        key_hash: keyHash,
        key_prefix: keyPrefix,
        scopes,
        rate_limit_rpm: rateLimitRpm,
        status: 'active',
      })
      .select('id, created_at')
      .single();

    if (error || !data) {
      console.error('[API Keys POST] Supabase insert error:', error?.code, error?.message);
      return NextResponse.json({ error: 'failed_to_create_key', code: error?.code ?? null }, { status: 500 });
    }

    const item: ApiKeyResponseItem = {
      id: data.id,
      name: name.trim(),
      keyPrefix,
      scopes,
      rateLimitRpm,
      createdAt: data.created_at,
      lastUsedAt: null,
      status: 'active',
    };

    return NextResponse.json({ success: true, key, item });
  } catch (err: unknown) {
    console.error('[API Keys POST Error]:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'failed_to_create_key' }, { status: 500 });
  }
}

// DELETE /api/keys?id=... - Revoke an API key owned by the session organization
export async function DELETE(req: NextRequest) {
  const session = await getOrgSession();
  if (!session) return unauthorized();

  const id = new URL(req.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing key id' }, { status: 400 });
  }

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    if (!supabase) return unavailable();

    const { data, error } = await supabase
      .from('api_keys')
      .update({ status: 'revoked' })
      .eq('id', id)
      .eq('org_id', session.orgId)
      .select('id');

    if (error) {
      console.error('[API Keys DELETE] Supabase update error:', error.message);
      return NextResponse.json({ error: 'failed_to_revoke_key' }, { status: 500 });
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, id, status: 'revoked' });
  } catch (err: unknown) {
    console.error('[API Keys DELETE Error]:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'failed_to_revoke_key' }, { status: 500 });
  }
}
