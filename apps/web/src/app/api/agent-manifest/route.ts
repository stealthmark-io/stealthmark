import { NextResponse } from 'next/server';
import { AGENT_MANIFEST_HEADERS, AGENT_MANIFEST_PAYLOAD } from '@/lib/agent-manifest';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(AGENT_MANIFEST_PAYLOAD, { status: 200, headers: AGENT_MANIFEST_HEADERS });
}
