import type { NextRequest } from 'next/server';
import { answerCanaryRequest } from '@/lib/canary-endpoint';

export const dynamic = 'force-dynamic';

// GET /api/telemetry/canary/<token>.git/... - the origin remote in the @stealthmark/next /.git/config fixture, to which
// git appends /info/refs?service=.... It answers 403 because a 401 makes git ask for a username and password.
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const [segment = ''] = (await params).path;
  return answerCanaryRequest(req, segment.replace(/\.git$/, '') || null, 403);
}
