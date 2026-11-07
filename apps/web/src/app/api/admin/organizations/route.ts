import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '../../../../lib/supabase/admin';
import { isAuthorizedAdmin } from '../../../../lib/admin-auth';

export interface AdminOrgItem {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  plan: string;
  status: string;
  /** Email of the organization owner; null when the organization has no owner row. */
  ownerEmail: string | null;
  createdAt: string;
  updatedAt: string | null;
}

interface OrganizationRow {
  id: string;
  name: string | null;
  slug: string | null;
  domain: string | null;
  plan: string | null;
  status: string | null;
  created_at: string;
  updated_at: string | null;
}

interface OwnerRow {
  org_id: string;
  email: string;
}

const NO_STORE = { 'Cache-Control': 'no-store' };

function failure(status: number, error: string): NextResponse {
  return NextResponse.json({ success: false, error, organizations: [] }, { status, headers: NO_STORE });
}

// GET /api/admin/organizations - Every organization with its plan and owner. Only rows that exist in the database.
export async function GET(req: NextRequest) {
  try {
    const isAuthorized = await isAuthorizedAdmin(req);
    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Unauthorized: Founder session or valid x-admin-key required' },
        { status: 401 }
      );
    }

    const adminSupabase = createSupabaseAdminClient();
    if (!adminSupabase) return failure(503, 'database_unavailable');

    const { data: orgRows, error } = await adminSupabase
      .from('organizations')
      .select('id, name, slug, domain, plan, status, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[Admin Organizations GET] organizations query failed:', error.message);
      return failure(502, 'organizations_query_failed');
    }
    const orgs = (orgRows ?? []) as OrganizationRow[];

    const owners = new Map<string, string>();
    if (orgs.length > 0) {
      const { data: ownerRows, error: ownersError } = await adminSupabase
        .from('users')
        .select('org_id, email')
        .eq('role', 'owner')
        .in('org_id', orgs.map((org) => org.id));
      if (ownersError) {
        console.error('[Admin Organizations GET] owners query failed:', ownersError.message);
        return failure(502, 'owners_query_failed');
      }
      for (const owner of (ownerRows ?? []) as OwnerRow[]) {
        if (!owners.has(owner.org_id)) owners.set(owner.org_id, owner.email);
      }
    }

    const organizations: AdminOrgItem[] = orgs.map((org) => ({
      id: org.id,
      name: org.name || org.slug || org.id,
      slug: org.slug || org.id,
      domain: org.domain,
      plan: org.plan || 'free',
      status: org.status || 'active',
      ownerEmail: owners.get(org.id) ?? null,
      createdAt: org.created_at,
      updatedAt: org.updated_at,
    }));

    return NextResponse.json({ success: true, organizations }, { headers: NO_STORE });
  } catch (err: unknown) {
    console.error('[Admin Organizations GET Error]:', err instanceof Error ? err.message : err);
    return failure(500, 'organizations_failed');
  }
}
