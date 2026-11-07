import { NextResponse } from 'next/server';
import { getOrgSession } from '../../../../lib/session';
import { readBodyText } from '@/lib/request-body';

export const dynamic = 'force-dynamic';

const MAX_AGENT_LENGTH = 64;
const MAX_BODY_BYTES = 2 * 1024;
const DEFAULT_AGENT = 'StealthMark Console';

interface GatewayPingBody {
  latency_ms?: number;
}

function sanitizeAgent(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_AGENT;
  const cleaned = raw.replace(/[^\x20-\x7E]/g, '').trim().slice(0, MAX_AGENT_LENGTH);
  return cleaned.length > 0 ? cleaned : DEFAULT_AGENT;
}

async function ping(agent: string) {
  const gatewayUrl =
    process.env.NEXT_PUBLIC_GATEWAY_URL ||
    'https://gateway.stealthmark.io';
  const startTime = Date.now();

  let reached = false;
  let latencyMs: number | null = null;
  try {
    const res = await fetch(`${gatewayUrl.replace(/\/$/, '')}/api/v1/ping`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Stealthmark-Agent': agent,
        'User-Agent': 'StealthMark-Console-Ping/1.0',
      },
      cache: 'no-store',
    });
    if (res.ok) {
      const body: GatewayPingBody = await res.json();
      reached = true;
      latencyMs = typeof body.latency_ms === 'number' && body.latency_ms > 0 ? body.latency_ms : Date.now() - startTime;
    }
  } catch {
    reached = false;
  }

  return NextResponse.json(
    {
      success: reached,
      timestamp: new Date().toISOString(),
      latencyMs,
      clusterStatus: reached ? 'operational' : 'unreachable',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

function rejected(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function unauthorized(): NextResponse {
  return rejected('unauthorized', 401);
}

export async function POST(req: Request) {
  const session = await getOrgSession();
  if (!session) return unauthorized();

  const raw = await readBodyText(req, MAX_BODY_BYTES);
  if (raw === null) return rejected('payload_too_large', 413);
  if (raw === '') return ping(DEFAULT_AGENT);
  let body: { agent?: unknown } | null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return rejected('invalid_json', 400);
  }
  return ping(sanitizeAgent(body.agent));
}

export async function GET() {
  const session = await getOrgSession();
  if (!session) return unauthorized();
  return ping(DEFAULT_AGENT);
}
