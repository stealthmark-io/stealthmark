import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createSupabaseAdminClient } from '../../../lib/supabase/admin';
import { getOrgSession } from '../../../lib/session';
import { generateApiKey } from '../../../lib/api-keys';
import { MAX_SITES_PER_ORG } from '../../../lib/org-limits';
import { readBodyText } from '@/lib/request-body';

export interface DomainConnectPayload {
  domain: string;
  name?: string;
  capabilities?: string[];
}

interface RegisteredSiteRow {
  id: string;
  org_id: string;
  domain: string;
  status: string;
  dns_verified: boolean;
  dns_verification_token: string | null;
  created_at: string;
}

const HOSTNAME_PATTERN = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const UNIQUE_VIOLATION = '23505';
const SITE_COLUMNS = 'id, org_id, domain, status, dns_verified, dns_verification_token, created_at';
/** A claim that never proved DNS control stops blocking the domain after this long. */
const PENDING_CLAIM_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 4 * 1024;

function cleanDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

function verificationInstruction(domain: string, token: string | null) {
  return {
    recordType: 'TXT',
    host: `_stealthmark-verify.${domain}`,
    value: token,
  };
}

function isStalePendingClaim(site: RegisteredSiteRow, now = Date.now()): boolean {
  const createdAt = Date.parse(site.created_at);
  return site.status === 'pending' && !site.dns_verified && Number.isFinite(createdAt) && now - createdAt > PENDING_CLAIM_TTL_MS;
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

function unavailable(): NextResponse {
  return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
}

// GET /api/domains - Registered domain and organization of the session
export async function GET() {
  const session = await getOrgSession();
  if (!session) return unauthorized();

  try {
    const supabase = createSupabaseAdminClient();
    if (!supabase) return unavailable();

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, slug, domain, plan, billing_mode, monthly_event_cap, credit_balance_events, status, created_at')
      .eq('id', session.orgId)
      .maybeSingle();
    if (orgError) {
      console.error('[Domains GET] Organization lookup error:', orgError.message);
      return NextResponse.json({ error: 'failed_to_load_domain' }, { status: 500 });
    }

    const { data: sites, error: siteError } = await supabase
      .from('registered_sites')
      .select(SITE_COLUMNS)
      .eq('org_id', session.orgId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (siteError) {
      console.error('[Domains GET] Site lookup error:', siteError.message);
      return NextResponse.json({ error: 'failed_to_load_domain' }, { status: 500 });
    }

    const site = ((sites ?? []) as RegisteredSiteRow[])[0] ?? null;
    return NextResponse.json({
      domain: site?.domain ?? null,
      status: site?.status ?? null,
      verification: site && !site.dns_verified ? verificationInstruction(site.domain, site.dns_verification_token) : null,
      organization: org ?? null,
    });
  } catch (err: unknown) {
    console.error('[Domains GET Error]:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'failed_to_load_domain' }, { status: 500 });
  }
}

// POST /api/domains - Register a domain for the session organization as pending DNS verification
export async function POST(req: NextRequest) {
  const session = await getOrgSession();
  if (!session) return unauthorized();

  const raw = await readBodyText(req, MAX_BODY_BYTES);
  if (raw === null) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }
  let body: DomainConnectPayload | null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.domain !== 'string' || !body.domain.trim()) {
    return NextResponse.json({ error: 'Domain is required' }, { status: 400 });
  }

  const domain = cleanDomain(body.domain);
  if (!HOSTNAME_PATTERN.test(domain)) {
    return NextResponse.json({ error: 'Invalid domain' }, { status: 400 });
  }
  const displayName =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 100)
      : `${domain.split('.')[0].toUpperCase()} Operations`;

  try {
    const supabase = createSupabaseAdminClient();
    if (!supabase) return unavailable();

    const { data: existing, error: lookupError } = await supabase
      .from('registered_sites')
      .select(SITE_COLUMNS)
      .eq('domain', domain)
      .maybeSingle();
    if (lookupError) {
      console.error('[Domains POST] Site lookup error:', lookupError.message);
      return NextResponse.json({ error: 'failed_to_register_domain' }, { status: 500 });
    }

    let site = existing as RegisteredSiteRow | null;
    if (site && site.org_id !== session.orgId) {
      if (!isStalePendingClaim(site)) {
        return NextResponse.json({ error: 'domain_already_registered' }, { status: 409 });
      }
      const { error: releaseError } = await supabase
        .from('registered_sites')
        .delete()
        .eq('id', site.id)
        .eq('status', 'pending')
        .eq('dns_verified', false);
      if (releaseError) {
        console.error('[Domains POST] Stale claim release error:', releaseError.message);
        return NextResponse.json({ error: 'domain_already_registered' }, { status: 409 });
      }
      site = null;
    }

    if (!site) {
      const { count: ownedSites, error: countError } = await supabase
        .from('registered_sites')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', session.orgId);
      if (countError) {
        console.error('[Domains POST] Site count error:', countError.message);
        return NextResponse.json({ error: 'failed_to_register_domain' }, { status: 500 });
      }
      if ((ownedSites ?? 0) >= MAX_SITES_PER_ORG) {
        return NextResponse.json({ error: 'site_limit_reached', limit: MAX_SITES_PER_ORG }, { status: 409 });
      }

      const { data: inserted, error: insertError } = await supabase
        .from('registered_sites')
        .insert({
          org_id: session.orgId,
          domain,
          display_name: displayName,
          status: 'pending',
          dns_verified: false,
          dns_verification_token: `sm-verify-${crypto.randomBytes(16).toString('hex')}`,
          access_policy: 'open',
        })
        .select(SITE_COLUMNS)
        .single();
      if (insertError || !inserted) {
        const status = insertError?.code === UNIQUE_VIOLATION ? 409 : 500;
        console.error('[Domains POST] Site insert error:', insertError?.message);
        return NextResponse.json(
          { error: status === 409 ? 'domain_already_registered' : 'failed_to_register_domain' },
          { status },
        );
      }
      site = inserted as RegisteredSiteRow;
    }

    let createdApiKey: { key: string; keyPrefix: string } | null = null;
    const { data: activeKeys, error: keysError } = await supabase
      .from('api_keys')
      .select('id')
      .eq('org_id', session.orgId)
      .eq('status', 'active')
      .limit(1);
    if (keysError) {
      console.error('[Domains POST] API key lookup error:', keysError.message);
    } else if (!activeKeys || activeKeys.length === 0) {
      const { key, keyPrefix, keyHash } = generateApiKey();
      const { error: keyError } = await supabase.from('api_keys').insert({
        org_id: session.orgId,
        name: `${displayName} Gateway Agent`,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        scopes: ['usage:ingest'],
        rate_limit_rpm: 120,
        status: 'active',
      });
      if (keyError) {
        console.error('[Domains POST] API key insert error:', keyError.message);
      } else {
        createdApiKey = { key, keyPrefix };
      }
    }

    return NextResponse.json(
      {
        success: true,
        domain,
        organizationId: session.orgId,
        persistedInDatabase: true,
        status: site.status,
        verification: site.dns_verified ? null : verificationInstruction(domain, site.dns_verification_token),
        apiKey: createdApiKey,
        gateway: {
          proxyUrl: 'https://gateway.stealthmark.io',
          upstream: `https://${domain}`,
        },
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    console.error('[Domains POST Error]:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'failed_to_register_domain' }, { status: 500 });
  }
}
