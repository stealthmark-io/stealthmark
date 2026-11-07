import type { NextRequest } from 'next/server';
import { answerCanaryRequest } from '@/lib/canary-endpoint';

export const dynamic = 'force-dynamic';

// GET /api/telemetry/canary?t=... - the URL inside the @stealthmark/next env fixture.
export async function GET(req: NextRequest) {
  return answerCanaryRequest(req, req.nextUrl.searchParams.get('t'), 401);
}
