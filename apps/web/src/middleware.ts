import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { withStealthMark } from '@stealthmark/next';
import type { Capability } from '@stealthmark/core';
import { AGENT_MANIFEST_HEADERS, AGENT_MANIFEST_PAYLOAD } from '@/lib/agent-manifest';
import { buildContentSecurityPolicy, cspEnvironment } from '@/lib/csp';
import { evaluateAgentBehavior, sanitizeAndNormalizeRequest } from '@/lib/security/october-shield';

type ManifestCapability = (typeof AGENT_MANIFEST_PAYLOAD.capabilities)[number];

function toSdkCapability(capability: ManifestCapability): Capability {
  return {
    id: capability.id,
    description: capability.description,
    method: capability.method,
    endpoint: capability.endpoint,
    inputSchema: { ...capability.input_schema },
    ...('pricing' in capability ? { pricing: capability.pricing } : {}),
  };
}

function asksForJsonOnRoot(request: NextRequest): boolean {
  const accept = request.headers.get('accept') ?? '';
  return request.nextUrl.pathname === '/' && accept.includes('application/json') && !accept.includes('text/html');
}

function siteMiddleware(request: NextRequest): NextResponse {
  const pathname = request.nextUrl.pathname.toLowerCase();
  // Hard perimeter separation: /admin, /login, /dashboard, and internal auth/admin APIs do NOT exist on public stealthmark.io
  if (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    pathname === '/console' ||
    pathname.startsWith('/console/') ||
    pathname === '/auth' ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/api/admin') ||
    pathname.startsWith('/api/founder') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/hitl')
  ) {
    return new NextResponse('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Robots-Tag': 'noindex, nofollow',
        'Cache-Control': 'no-store',
      },
    });
  }

  const rawPath = request.nextUrl.pathname + request.nextUrl.search;
  const rawHost = request.headers.get('host') ?? '';

  // Layer 1: Canonical NFKC / Null-byte / Double-Hex / Non-canonical IP / Cloud Metadata Guard
  const norm = sanitizeAndNormalizeRequest(rawPath, rawHost);
  if (norm.isBlocked) {
    return NextResponse.json(
      { error: 'Blocked by StealthMark Edge Shield', codes: norm.anomalies },
      { status: 400 }
    );
  }

  // Layer 2: Offensive Agent Botnet Signatures, Server Actions DoS & Inbound Brotli Guard
  const threat = evaluateAgentBehavior(norm.normalizedPath, request.headers);
  if (threat.classification === 'MALICIOUS_AGENT_BOTNET') {
    return NextResponse.json(
      { error: 'Autonomous offensive agent detected', signatures: threat.matchedSignatures },
      { status: 403 }
    );
  }

  if (asksForJsonOnRoot(request)) {
    return NextResponse.json(AGENT_MANIFEST_PAYLOAD, { status: 200, headers: AGENT_MANIFEST_HEADERS });
  }
  // Next.js reads the nonce from the request's CSP header and stamps it on the scripts it renders.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildContentSecurityPolicy(cspEnvironment(), nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  requestHeaders.set('x-stealthmark-canonical-path', norm.normalizedPath);
  requestHeaders.set('x-stealthmark-threat-score', String(threat.threatScore));
  if (norm.anomalies.length > 0 || threat.matchedSignatures.length > 0) {
    requestHeaders.set('x-stealthmark-flags', [...norm.anomalies, ...threat.matchedSignatures].join(','));
  }
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('Reporting-Endpoints', 'csp-endpoint="/api/csp-report"');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), clipboard-read=(), clipboard-write=(self), publickey-credentials-get=(self)'
  );
  response.headers.set('x-stealthmark-edge-shield', 'active; mode=oct2026-hardened');
  return response;
}

export default withStealthMark(siteMiddleware, {
  siteName: AGENT_MANIFEST_PAYLOAD.name,
  origin: AGENT_MANIFEST_PAYLOAD.origin,
  version: AGENT_MANIFEST_PAYLOAD.version,
  capabilities: AGENT_MANIFEST_PAYLOAD.capabilities.map(toSdkCapability),
  agentPolicy: 'observe',
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
