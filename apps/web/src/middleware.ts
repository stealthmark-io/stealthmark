import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { withStealthMark } from '@stealthmark/next';
import type { Capability } from '@stealthmark/core';
import { AGENT_MANIFEST_HEADERS, AGENT_MANIFEST_PAYLOAD } from '@/lib/agent-manifest';
import { clientIp, clientNetwork } from '@/lib/client-ip';
import { buildContentSecurityPolicy, cspEnvironment } from '@/lib/csp';
import {
  evaluateAgentBehavior,
  extractRawPathAndSearch,
  sanitizeAndNormalizeRequest,
  type NormalizationResult,
  type ThreatAssessment,
} from '@/lib/security/october-shield';

type ManifestCapability = (typeof AGENT_MANIFEST_PAYLOAD.capabilities)[number];

const SPOOFABLE_INTERNAL_HEADERS = [
  'x-nonce',
  'x-stealthmark-canonical-path',
  'x-stealthmark-threat-score',
  'x-stealthmark-flags',
  'x-forwarded-host',
  'x-real-ip',
] as const;

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

function sanitizeHeaderValue(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function sanitizeTelemetryPath(pathname: string): string {
  const withoutQuery = pathname.split('?')[0]?.split('#')[0] ?? '/';
  const cleaned = withoutQuery.replace(/[\x00-\x1f\x7f]/g, '');
  return (cleaned || '/').slice(0, 256);
}

function isClosedPerimeterSurface(pathname: string): boolean {
  return (
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
  );
}

interface EdgeShieldTelemetryEvent {
  ts: string;
  event: string;
  status: number;
  method: string;
  path: string;
  clientIp: string | null;
  clientNet: string | null;
  cfRay: string | null;
  cfCountry: string | null;
  ua: string | null;
  threatScore: number;
  codes: string[];
}

function emitEdgeShieldTelemetry(entry: EdgeShieldTelemetryEvent): void {
  console.log(JSON.stringify(entry));
}

interface PreparedEdgeContext {
  requestHeaders: Headers;
  norm: NormalizationResult;
  threat: ThreatAssessment;
  effectiveThreatScore: number;
  combinedCodes: string[];
}

const preparedContexts = new WeakMap<NextRequest, PreparedEdgeContext>();

function evaluateEdgePerimeter(request: NextRequest): NextResponse | PreparedEdgeContext {
  const resolvedIp = clientIp(request);
  const resolvedNet = resolvedIp ? clientNetwork(resolvedIp) : null;
  const cfRay = sanitizeHeaderValue(request.headers.get('cf-ray'), 64);
  const cfCountry = sanitizeHeaderValue(request.headers.get('cf-ipcountry'), 8);
  const ua = sanitizeHeaderValue(request.headers.get('user-agent'), 256);
  const safePath = sanitizeTelemetryPath(request.nextUrl.pathname);

  // Strip spoofable internal and proxy headers sent by the client before recomputing trusted values.
  const requestHeaders = new Headers(request.headers);
  for (const headerName of SPOOFABLE_INTERNAL_HEADERS) {
    requestHeaders.delete(headerName);
    try {
      request.headers.delete(headerName);
    } catch {
      // Request headers may be immutable in synthetic test stubs; requestHeaders carries the sanitized copy.
    }
  }

  const pathname = request.nextUrl.pathname.toLowerCase();
  // Hard perimeter separation: /admin, /login, /dashboard, and internal auth/admin APIs do NOT exist on public stealthmark.io
  if (isClosedPerimeterSurface(pathname)) {
    emitEdgeShieldTelemetry({
      ts: new Date().toISOString(),
      event: 'PERIMETER_TRAP_PROBE',
      status: 404,
      method: request.method,
      path: safePath,
      clientIp: resolvedIp,
      clientNet: resolvedNet,
      cfRay,
      cfCountry,
      ua,
      threatScore: 40,
      codes: ['PERIMETER_CLOSED_SURFACE'],
    });
    return new NextResponse('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Robots-Tag': 'noindex, nofollow',
        'Cache-Control': 'no-store',
      },
    });
  }

  const rawPath = request.url
    ? extractRawPathAndSearch(request.url)
    : request.nextUrl.pathname + request.nextUrl.search;
  const rawHost = requestHeaders.get('host') ?? '';

  // Layer 1: Canonical NFKC / Null-byte / Double & Triple Hex / Backslash / Non-canonical IP / Cloud Metadata Guard
  const norm = sanitizeAndNormalizeRequest(rawPath, rawHost);
  if (norm.isBlocked) {
    emitEdgeShieldTelemetry({
      ts: new Date().toISOString(),
      event: 'EDGE_SHIELD_LAYER1_BLOCK',
      status: 400,
      method: request.method,
      path: safePath,
      clientIp: resolvedIp,
      clientNet: resolvedNet,
      cfRay,
      cfCountry,
      ua,
      threatScore: 100,
      codes: norm.anomalies,
    });
    return NextResponse.json(
      { error: 'Blocked by StealthMark Edge Shield', codes: norm.anomalies },
      { status: 400 }
    );
  }

  const normalizedPathnameOnly = (norm.normalizedPath.split('?')[0] ?? '').toLowerCase();
  if (isClosedPerimeterSurface(normalizedPathnameOnly)) {
    emitEdgeShieldTelemetry({
      ts: new Date().toISOString(),
      event: 'PERIMETER_TRAP_PROBE',
      status: 404,
      method: request.method,
      path: sanitizeTelemetryPath(normalizedPathnameOnly),
      clientIp: resolvedIp,
      clientNet: resolvedNet,
      cfRay,
      cfCountry,
      ua,
      threatScore: 60,
      codes: [...norm.anomalies, 'PERIMETER_CLOSED_SURFACE'],
    });
    return new NextResponse('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Robots-Tag': 'noindex, nofollow',
        'Cache-Control': 'no-store',
      },
    });
  }

  // Layer 2: Offensive Agent Botnet Signatures, Server Actions DoS & Inbound Brotli Guard
  const threat = evaluateAgentBehavior(norm.normalizedPath, requestHeaders);
  const combinedCodes = [...norm.anomalies, ...threat.matchedSignatures];
  const effectiveThreatScore = Math.min(100, threat.threatScore + (norm.anomalies.length > 0 ? 45 : 0));

  if (threat.classification === 'MALICIOUS_AGENT_BOTNET') {
    emitEdgeShieldTelemetry({
      ts: new Date().toISOString(),
      event: 'EDGE_SHIELD_LAYER2_BLOCK',
      status: 403,
      method: request.method,
      path: safePath,
      clientIp: resolvedIp,
      clientNet: resolvedNet,
      cfRay,
      cfCountry,
      ua,
      threatScore: effectiveThreatScore,
      codes: combinedCodes,
    });
    return NextResponse.json(
      { error: 'Autonomous offensive agent detected', signatures: threat.matchedSignatures },
      { status: 403 }
    );
  }

  if (effectiveThreatScore >= 40) {
    emitEdgeShieldTelemetry({
      ts: new Date().toISOString(),
      event: 'EDGE_SHIELD_SUSPICIOUS_REQUEST',
      status: 200,
      method: request.method,
      path: safePath,
      clientIp: resolvedIp,
      clientNet: resolvedNet,
      cfRay,
      cfCountry,
      ua,
      threatScore: effectiveThreatScore,
      codes: combinedCodes,
    });
  }

  return {
    requestHeaders,
    norm,
    threat,
    effectiveThreatScore,
    combinedCodes,
  };
}

function siteMiddleware(request: NextRequest): NextResponse {
  const prepared = preparedContexts.get(request) ?? evaluateEdgePerimeter(request);
  if (prepared instanceof NextResponse) {
    return prepared;
  }

  const { requestHeaders, norm, effectiveThreatScore, combinedCodes } = prepared;

  if (asksForJsonOnRoot(request)) {
    return NextResponse.json(AGENT_MANIFEST_PAYLOAD, { status: 200, headers: AGENT_MANIFEST_HEADERS });
  }
  // Next.js reads the nonce from the request's CSP header and stamps it on the scripts it renders.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildContentSecurityPolicy(cspEnvironment(), nonce);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  requestHeaders.set('x-stealthmark-canonical-path', norm.normalizedPath);
  requestHeaders.set('x-stealthmark-threat-score', String(effectiveThreatScore));
  if (combinedCodes.length > 0) {
    requestHeaders.set('x-stealthmark-flags', combinedCodes.join(','));
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

const sdkMiddleware = withStealthMark(siteMiddleware, {
  siteName: AGENT_MANIFEST_PAYLOAD.name,
  origin: AGENT_MANIFEST_PAYLOAD.origin,
  version: AGENT_MANIFEST_PAYLOAD.version,
  capabilities: AGENT_MANIFEST_PAYLOAD.capabilities.map(toSdkCapability),
  agentPolicy: 'observe',
});

export default async function middleware(
  request: NextRequest,
  event?: Parameters<typeof sdkMiddleware>[1]
): Promise<Response | undefined> {
  const precheck = evaluateEdgePerimeter(request);
  if (precheck instanceof NextResponse) {
    return precheck;
  }
  preparedContexts.set(request, precheck);
  return sdkMiddleware(request, event);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
