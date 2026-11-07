import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';

const DEFAULT_PORTAL_URL = 'https://polar.sh/stealthmark-sa/portal';

export async function POST(_req: NextRequest) {
  try {
    let customerEmail: string | null = null;

    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const { data: { user } } = await supabase.auth.getUser();
      customerEmail = user?.email ?? null;
    }

    return NextResponse.json({
      success: true,
      url: process.env.POLAR_CUSTOMER_PORTAL_URL || DEFAULT_PORTAL_URL,
      customerEmail,
      provider: 'polar.sh',
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    console.error('[Billing Portal Session Error]:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'portal_session_failed' }, { status: 500 });
  }
}
