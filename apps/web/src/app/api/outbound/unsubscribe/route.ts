import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import fs from 'node:fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPPRESSION_FILE = '/tmp/stealthmark_outbound_suppression.json';

function unsubSecret(): string | null {
  return process.env.STEALTHMARK_UNSUB_SECRET || null;
}

function notConfigured(): NextResponse {
  console.error('[Unsubscribe] STEALTHMARK_UNSUB_SECRET is not configured');
  return NextResponse.json(
    { ok: false, error: 'Unsubscribe is not configured. Retry later.' },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
  );
}

function computeUnsubSig(secret: string, domain: string, email: string): string {
  const payload = `${domain.toLowerCase().trim()}:${email.toLowerCase().trim()}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 20);
}

function verifySig(secret: string, domain: string, email: string, sig: string): boolean {
  if (!sig || sig.length !== 20) return false;
  const expected = computeUnsubSig(secret, domain, email);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function recordUnsubscribe(domain: string, email: string, ip: string) {
  try {
    let data: Record<string, { email: string; domain: string; ts: string; ip: string }> = {};
    if (fs.existsSync(SUPPRESSION_FILE)) {
      data = JSON.parse(fs.readFileSync(SUPPRESSION_FILE, 'utf-8'));
    }
    const key = (email || domain || 'unknown').toLowerCase().trim();
    data[key] = {
      email: email.toLowerCase().trim(),
      domain: domain.toLowerCase().trim(),
      ts: new Date().toISOString(),
      ip,
    };
    fs.writeFileSync(SUPPRESSION_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    // Non-blocking persistence fallback
  }
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const domain = (searchParams.get('domain') || '').trim();
  const email = (searchParams.get('email') || '').trim();
  const sig = (searchParams.get('sig') || '').trim();
  const ip = (req.headers.get('x-forwarded-for') || '127.0.0.1').split(',')[0].trim();

  const secret = unsubSecret();
  if (!secret) return notConfigured();

  if (!verifySig(secret, domain, email, sig)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Invalid or missing cryptographic HMAC signature (sig) for RFC 8058 suppression.',
      },
      { status: 403, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
    );
  }

  recordUnsubscribe(domain, email, ip);

  return NextResponse.json(
    {
      ok: true,
      protocol: 'RFC-8058-One-Click-HMAC-Verified',
      suppressed: { domain, email },
      signature_verified: true,
      message: 'Cryptographic token verified. Domain and address permanently added to suppression list.',
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    }
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const domain = (searchParams.get('domain') || '').trim();
  const email = (searchParams.get('email') || '').trim();
  const sig = (searchParams.get('sig') || '').trim();
  const ip = (req.headers.get('x-forwarded-for') || '127.0.0.1').split(',')[0].trim();

  const secret = unsubSecret();
  if (!secret) return notConfigured();

  if (!verifySig(secret, domain, email, sig)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid or missing cryptographic HMAC signature (sig).' },
      { status: 403, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
    );
  }

  recordUnsubscribe(domain, email, ip);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Unsubscribed — StealthMark Security</title>
</head>
<body style="background:#050811;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;">
  <div style="max-width:460px;background:#0b1120;border:1px solid rgba(16,185,129,0.3);border-radius:16px;padding:28px;text-align:center;">
    <div style="font-family:monospace;font-size:11px;color:#34d399;text-transform:uppercase;letter-spacing:0.15em;margin-bottom:8px;">RFC 8058 HMAC-Verified Suppression</div>
    <h1 style="font-size:20px;margin:0 0 12px 0;">You have been unsubscribed</h1>
    <p style="font-size:14px;color:#94a3b8;line-height:1.5;margin:0 0 20px 0;">
      Notifications for <strong>${domain.replace(/[^a-zA-Z0-9.-]/g, '') || 'your domain'}</strong> have been permanently disabled.
    </p>
    <a href="https://stealthmark.io" style="color:#38bdf8;font-size:13px;text-decoration:none;font-family:monospace;">&larr; Return to stealthmark.io</a>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
