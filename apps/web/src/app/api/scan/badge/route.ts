import { NextRequest, NextResponse } from 'next/server';
import { verifyBadgeSignature } from '@/lib/scan-unlock';
import { sanitizeAndValidateDomain } from '@/lib/security/network-guard';

const FONT = 'ui-monospace,SFMono-Regular,Menlo,monospace';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function gradeColor(grade: string): string {
  if (grade.startsWith('A')) return '#10B981';
  if (grade.startsWith('B')) return '#00D2FE';
  if (grade.startsWith('C')) return '#F59E0B';
  return '#F43F5E';
}

function renderBadge(label: string, ariaLabel: string, color: string, textColor: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="248" height="28" role="img" aria-label="${ariaLabel}">
  <rect width="142" height="28" rx="6" fill="#0B0F19"/>
  <rect x="138" width="110" height="28" rx="6" fill="${color}"/>
  <rect width="248" height="28" rx="6" fill="none" stroke="#1E293B" stroke-width="1"/>
  <text x="12" y="18" fill="#E2E8F0" font-family="${FONT}" font-size="11" font-weight="700">🛡️ STEALTHMARK</text>
  <text x="148" y="18" fill="${textColor}" font-family="${FONT}" font-size="11" font-weight="800">${label}</text>
</svg>`;
}

// Only a badge signed by /api/scan/audit shows a grade; anything else renders as unverified.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const domain = sanitizeAndValidateDomain(params.get('domain') || '');
  const grade = params.get('grade') || '';
  const issuedAt = params.get('t') || '';
  const signature = params.get('sig') || '';
  const verified = domain !== null && verifyBadgeSignature(domain, grade, issuedAt, signature);

  const svg = verified
    ? renderBadge(
        `${escapeXml(grade)} · ${escapeXml(domain.slice(0, 12))}`,
        `StealthMark Audit: grade ${escapeXml(grade)} for ${escapeXml(domain)}`,
        gradeColor(grade),
        '#060709'
      )
    : renderBadge('UNVERIFIED', 'StealthMark Audit: unverified badge', '#334155', '#E2E8F0');

  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': verified ? 'public, max-age=3600, s-maxage=3600' : 'public, max-age=60, s-maxage=60',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
