import { NextRequest, NextResponse } from 'next/server';
import { getOrgSession } from '../../../lib/session';
import { isAuthorizedAdmin } from '../../../lib/admin-auth';

export const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };

export interface TelemetryAccess {
  orgId: string;
  /** Platform admins see every row; any other session only sees rows of its own organization. */
  isAdmin: boolean;
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
}

export function unavailable(): NextResponse {
  return NextResponse.json({ error: 'service_unavailable' }, { status: 503, headers: NO_STORE });
}

export async function resolveTelemetryAccess(req: NextRequest): Promise<TelemetryAccess | null> {
  const session = await getOrgSession();
  if (!session) return null;
  return { orgId: session.orgId, isAdmin: await isAuthorizedAdmin(req) };
}
