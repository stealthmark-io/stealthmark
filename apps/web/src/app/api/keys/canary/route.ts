import { NextResponse } from 'next/server';
import { getOrgSession } from '../../../../lib/session';
import { issueCanaryKey } from '../../../../lib/canary';

// POST /api/keys/canary - Issues a Canary key for the session organization. Nothing is stored: the
// key is derived from CANARY_MASTER_SECRET, so this response is the only place it is ever shown.
export async function POST() {
  const session = await getOrgSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const key = issueCanaryKey(session.orgId);
  if (!key) return NextResponse.json({ error: 'canary_unavailable' }, { status: 503 });

  return NextResponse.json({ key }, { headers: { 'Cache-Control': 'no-store' } });
}
