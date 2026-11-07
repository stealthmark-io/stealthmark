import { NextResponse } from 'next/server';
import { gatewayInternalSecret, getAppUrl } from '@/lib/auth';
import { clientIp } from '@/lib/client-ip';
import { chargePaidKey, refundCharge } from '@/lib/credit-meter';
import { readBodyText } from '@/lib/request-body';
import {
  buildX402PaymentRequiredResponse,
  getIdempotentReplay,
  saveIdempotentReplay,
} from '@/lib/x402';

const GATEWAY_URL =
  process.env.GATEWAY_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_GATEWAY_URL ||
  'https://gateway.stealthmark.io';

const GENERATION_COST_CREDITS = 25;
const MAX_BODY_BYTES = 2 * 1024;

const VALID_DOMAIN_RE =
  /^(?:https?:\/\/)?([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}(?:\/.*)?$/;

export async function POST(request: Request) {
  const idempotencyKey = request.headers.get('idempotency-key');
  const replay = getIdempotentReplay(idempotencyKey, 'edge-shield');
  if (replay) return replay;

  const authHeader = request.headers.get('authorization') || '';
  const bearerKey = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null;

  const raw = await readBodyText(request, MAX_BODY_BYTES);
  if (raw === null) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }
  let body: { domain?: string } | null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const domain = body.domain?.trim();
  if (!domain || domain.length > 253 || !VALID_DOMAIN_RE.test(domain)) {
    return NextResponse.json(
      { error: 'Invalid or missing domain parameter.' },
      { status: 400 }
    );
  }

  const ip = clientIp(request) ?? 'unknown';

  // Charged only after the request is valid, so a malformed call never spends credits.
  const charge = await chargePaidKey(bearerKey, GENERATION_COST_CREDITS);
  if (!charge.ok) {
    if (charge.reason === 'unavailable' || charge.reason === 'conflict') {
      return NextResponse.json(
        { error: 'billing_unavailable', message: 'Credit check failed. Retry in a few seconds.' },
        { status: 503, headers: { 'Retry-After': '2' } }
      );
    }
    const { pathname, search } = new URL(request.url);
    return buildX402PaymentRequiredResponse(
      `${getAppUrl(request)}${pathname}${search}`,
      'Payment Required: Cloudflare Edge Worker & WAF rule generation costs 25 credits per generation from an API key with a credit balance. Credit packs start with Starter (15,000 credits).',
      GENERATION_COST_CREDITS
    );
  }

  try {
    const res = await fetch(
      `${GATEWAY_URL.replace(/\/$/, '')}/api/v2/generate/edge-shield`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Forwarded-For': ip,
          'x-internal-secret': gatewayInternalSecret(),
        },
        body: JSON.stringify({ domain }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      await refundCharge(charge.orgId, charge.charged);
      if (res.status === 404) {
        console.error('scan/edge-shield: gateway answered 404; GATEWAY_INTERNAL_SECRET does not match its INTERNAL_AUTH_SECRET');
        return NextResponse.json({ error: 'Edge shield generation failed.' }, { status: 502 });
      }
      return NextResponse.json(data, { status: res.status });
    }
    saveIdempotentReplay(idempotencyKey, 'edge-shield', res.status, data);
    return NextResponse.json(data, {
      status: res.status,
      headers: {
        'X-Idempotent-Replay': 'false',
        'X-Charged-Credits': String(charge.charged),
      },
    });
  } catch {
    await refundCharge(charge.orgId, charge.charged);
    return NextResponse.json(
      { error: 'Edge shield generation failed.' },
      { status: 502 }
    );
  }
}
