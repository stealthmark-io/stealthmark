import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '../../../../lib/supabase/admin';
import { isAuthorizedAdmin } from '../../../../lib/admin-auth';
import { readBodyText } from '@/lib/request-body';

const MAX_BODY_BYTES = 2 * 1024;

/** Plans an organization can hold today: the free tier and negotiated Enterprise contracts. Pro and Business are archived. */
const VALID_TIERS = ['free', 'enterprise'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    const isAuthorized = await isAuthorizedAdmin(req);
    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Unauthorized: Founder session or valid x-admin-key required' },
        { status: 401 }
      );
    }

    const raw = await readBodyText(req, MAX_BODY_BYTES);
    if (raw === null) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    let body: { organizationId?: unknown; planTier?: unknown } | null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { organizationId, planTier } = body;

    if (typeof organizationId !== 'string' || typeof planTier !== 'string' || !planTier) {
      return NextResponse.json({ error: 'Missing organizationId or planTier' }, { status: 400 });
    }
    if (!UUID_PATTERN.test(organizationId)) {
      return NextResponse.json({ error: 'organizationId must be a UUID' }, { status: 400 });
    }

    const cleanTier = planTier.toLowerCase().trim();
    if (!VALID_TIERS.includes(cleanTier)) {
      return NextResponse.json(
        { error: `Invalid plan tier. Must be one of: ${VALID_TIERS.join(', ')}` },
        { status: 400 }
      );
    }

    const adminSupabase = createSupabaseAdminClient();
    if (!adminSupabase) {
      return NextResponse.json({ error: 'database_unavailable' }, { status: 503 });
    }

    const { data, error } = await adminSupabase
      .from('organizations')
      .update({ plan: cleanTier, updated_at: new Date().toISOString() })
      .eq('id', organizationId)
      .select('id');
    if (error) {
      console.error('[Admin Override Plan] database update failed:', error.message);
      return NextResponse.json({ error: 'database_update_failed' }, { status: 502 });
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'organization_not_found' }, { status: 404 });
    }

    console.warn(`[Admin Plan Override] organization ${organizationId} set to ${cleanTier}`);

    return NextResponse.json({
      success: true,
      message: `Organization ${organizationId} is now on the ${cleanTier} plan.`,
      organizationId,
      newPlanTier: cleanTier,
      dbUpdated: true,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    console.error('[Admin Override Plan Error]:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'override_failed' }, { status: 500 });
  }
}
