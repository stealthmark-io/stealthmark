import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '../../../lib/supabase/admin';
import { featureDisabledResponse, flags } from '@/lib/flags';
import { readBodyText } from '@/lib/request-body';

const MAX_BODY_BYTES = 2 * 1024;

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DEFCON_NAMES: Record<number, string> = {
  1: 'DEFCON 1 — Emergency Origin Lockdown',
  2: 'DEFCON 2 — High Readiness',
  3: 'DEFCON 3 — Elevated Surveillance',
  4: 'DEFCON 4 — Guarded Perimeter',
  5: 'DEFCON 5 — Normal Operations',
};

// GET /api/defcon - Retrieve active DEFCON posture from Supabase or Gateway
export async function GET(req: NextRequest) {
  if (!flags.defcon) return featureDisabledResponse();
  try {
    const supabase = createSupabaseAdminClient();
    let currentLevel = 5;

    // 1. Try to read active posture from Supabase PostgreSQL
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('policies')
          .select('defcon_level, name, status, updated_at')
          .eq('status', 'active')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data && typeof data.defcon_level === 'number') {
          currentLevel = data.defcon_level;
          return NextResponse.json({
            success: true,
            defcon_level: currentLevel,
            name: DEFCON_NAMES[currentLevel] || 'Normal Operations',
            source: 'supabase-policy',
            updated_at: data.updated_at,
          });
        }
      } catch (dbErr) {
        console.warn('[DEFCON API] Supabase read failed:', dbErr);
      }
    }

    // 2. Fallback to Gateway live state
    const gatewayUrl =
      process.env.NEXT_PUBLIC_GATEWAY_URL ||
      'https://gateway.stealthmark.io';

    try {
      const gRes = await fetch(`${gatewayUrl.replace(/\/$/, '')}/api/v1/defcon`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (gRes.ok) {
        const gData = await gRes.json();
        if (typeof gData.defcon_level === 'number') {
          currentLevel = gData.defcon_level;
        }
      }
    } catch {
      // Gateway unreachable, keep default
    }

    return NextResponse.json({
      success: true,
      defcon_level: currentLevel,
      name: DEFCON_NAMES[currentLevel] || 'Normal Operations',
      source: 'gateway-fallback',
    });
  } catch (err: unknown) {
    console.error('[DEFCON GET Error]:', err);
    return NextResponse.json({
      success: true,
      defcon_level: 5,
      name: DEFCON_NAMES[5],
      source: 'default',
    });
  }
}

// POST /api/defcon - Update active DEFCON posture across Supabase and Edge Gateway
export async function POST(req: NextRequest) {
  if (!flags.defcon) return featureDisabledResponse();
  try {
    const raw = await readBodyText(req, MAX_BODY_BYTES);
    if (raw === null) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    let body: { level?: unknown } | null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const rawLevel = Number(body.level);
    if (!rawLevel || rawLevel < 1 || rawLevel > 5) {
      return NextResponse.json(
        { error: 'Invalid DEFCON level. Must be an integer between 1 and 5.' },
        { status: 400 }
      );
    }

    const level = Math.floor(rawLevel);
    const policyName = DEFCON_NAMES[level] || `DEFCON ${level}`;
    const supabase = createSupabaseAdminClient();

    // 1. Persist to Supabase PostgreSQL policies table
    let dbPersisted = false;
    if (supabase) {
      try {
        const { error } = await supabase.from('policies').insert({
          name: policyName,
          defcon_level: level,
          status: 'active',
          rules_json: {
            tactical_shift_timestamp: new Date().toISOString(),
            enforced_by: 'StealthMark Security Console',
          },
        });
        if (!error) dbPersisted = true;
      } catch (dbErr) {
        console.warn('[DEFCON API] Could not write to policies table:', dbErr);
      }
    }

    // 2. Dispatch real posture shift to Cloud Run Gateway
    const gatewayUrl =
      process.env.NEXT_PUBLIC_GATEWAY_URL ||
      'https://gateway.stealthmark.io';

    let gatewaySynced = false;
    try {
      const gRes = await fetch(`${gatewayUrl.replace(/\/$/, '')}/api/v1/defcon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level }),
        cache: 'no-store',
      });
      if (gRes.ok) {
        gatewaySynced = true;
      }
    } catch (gErr) {
      console.warn('[DEFCON API] Gateway sync warning:', gErr);
    }

    return NextResponse.json({
      success: true,
      defcon_level: level,
      name: policyName,
      db_persisted: dbPersisted,
      gateway_synced: gatewaySynced,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    console.error('[DEFCON POST Error]:', err);
    return NextResponse.json(
      { error: (err instanceof Error && err.message) || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
