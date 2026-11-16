import { NextResponse } from 'next/server';
import { buildAgentCatalog } from '@/lib/agent-catalog';

export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json(buildAgentCatalog(), {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
