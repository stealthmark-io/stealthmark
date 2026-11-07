import { NextResponse } from 'next/server';
import { enforceRateLimit, limitText } from '@/lib/lead-intake';
import { readBodyText } from '@/lib/request-body';

const MAX_REPORT_BYTES = 8 * 1024;
const REPORTS_PER_MINUTE = 60;

interface ViolationFields {
  directive: string;
  blocked: string;
  document: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readViolation(payload: unknown): ViolationFields | null {
  const root = asRecord(payload);
  if (!root) return null;
  const legacy = asRecord(root['csp-report']);
  const modern = Array.isArray(root) ? asRecord(root[0]) : null;
  const body = legacy ?? asRecord(modern?.body) ?? root;
  return {
    directive: limitText(body['violated-directive'] ?? body.effectiveDirective ?? body['effective-directive'], 80),
    blocked: limitText(body['blocked-uri'] ?? body.blockedURL, 200),
    document: limitText(body['document-uri'] ?? body.documentURL, 200),
  };
}

/** Receives Content-Security-Policy-Report-Only violation reports and writes one short line per report to the logs. */
export async function POST(request: Request) {
  const limited = enforceRateLimit(request, 'csp-report', REPORTS_PER_MINUTE, 60_000);
  if (limited) return limited;

  try {
    const raw = await readBodyText(request, MAX_REPORT_BYTES);
    if (raw === null) return new NextResponse(null, { status: 413 });
    const violation = readViolation(JSON.parse(raw));
    if (violation) {
      console.warn(`[CSP] ${violation.directive} blocked ${violation.blocked} on ${violation.document}`);
    }
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  return new NextResponse(null, { status: 204 });
}
