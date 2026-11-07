import { NextRequest, NextResponse } from 'next/server';
import { clientIp } from '@/lib/client-ip';
import { getLiveDomainPosture } from '@/lib/live-domain-posture';

const RATE_WINDOW_MS = 60_000;
const MAX_BADGE_REQ_PER_MIN = 30;
const badgeIpHits = new Map<string, { count: number; resetAt: number }>();

function checkBadgeRateLimit(ip: string): boolean {
  const now = Date.now();
  if (badgeIpHits.size > 2000) {
    for (const [k, v] of badgeIpHits) {
      if (v.resetAt <= now) badgeIpHits.delete(k);
    }
  }
  const entry = badgeIpHits.get(ip);
  if (!entry || entry.resetAt <= now) {
    badgeIpHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_BADGE_REQ_PER_MIN) return false;
  entry.count += 1;
  return true;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ domain: string }> }
) {
  const ip = clientIp(req) || '0.0.0.0';
  if (!checkBadgeRateLimit(ip)) {
    return new NextResponse('Rate limit exceeded', {
      status: 429,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
    });
  }

  const { domain } = await context.params;
  const state = await getLiveDomainPosture(domain || '');

  const badgeColors: Record<string, { hex: string; bg: string }> = {
    'A+': { hex: '#10b981', bg: '#064e3b' },
    'A':  { hex: '#22c55e', bg: '#14532d' },
    'B':  { hex: '#38bdf8', bg: '#0c4a6e' },
    'C':  { hex: '#f59e0b', bg: '#451a03' },
    'D':  { hex: '#ef4444', bg: '#450a0a' },
    'F':  { hex: '#dc2626', bg: '#450a0a' },
  };

  const palette = badgeColors[state.grade] || badgeColors['C'];
  const statusLabel = !state.valid
    ? 'UNVERIFIED'
    : state.activeShieldInstalled
    ? `GRADE ${state.grade} · SHIELD ON`
    : `GRADE ${state.grade} · PASSIVE`;

  const safeDomain = escapeXml(state.domain);
  const safeLabel = escapeXml(statusLabel);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="32" viewBox="0 0 256 32" fill="none" role="img" aria-label="StealthMark Security Status for ${safeDomain}: ${safeLabel}">
  <title>StealthMark Verified Security: ${safeDomain} (${safeLabel})</title>
  <defs>
    <linearGradient id="sm-bg" x1="0" y1="0" x2="256" y2="32" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#0B0F19"/>
      <stop offset="100%" stop-color="#111827"/>
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="255" height="31" rx="6" fill="url(#sm-bg)" stroke="#1E293B"/>
  <circle cx="14" cy="16" r="3.5" fill="${palette.hex}">
    <animate attributeName="opacity" values="1;0.35;1" dur="2.2s" repeatCount="indefinite"/>
  </circle>
  <text x="24" y="20" fill="#F8FAFC" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="11" font-weight="700" letter-spacing="0.06em">STEALTHMARK</text>
  <line x1="118" y1="6" x2="118" y2="26" stroke="#1E293B" stroke-width="1"/>
  <rect x="124" y="5" width="126" height="22" rx="4" fill="${palette.bg}" fill-opacity="0.65" stroke="${palette.hex}" stroke-opacity="0.45"/>
  <text x="187" y="19.5" text-anchor="middle" fill="${palette.hex}" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="10.5" font-weight="700" letter-spacing="0.04em">${safeLabel}</text>
</svg>`;

  const cacheHeader = state.valid
    ? 'public, max-age=180, s-maxage=300, stale-while-revalidate=300'
    : 'no-store, no-cache, must-revalidate';

  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': cacheHeader,
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'X-StealthMark-Domain': safeDomain,
      'X-StealthMark-Grade': state.valid ? state.grade : 'UNVERIFIED',
    },
  });
}
