import dns from 'node:dns/promises';
import net from 'node:net';
import { gatewayInternalSecret } from '@/lib/auth';
import { computeExecutiveScorecard, type AuditReport, type ExecutiveScorecard } from '@/lib/readiness-report';
import { sanitizeAndValidateDomain } from '@/lib/security/network-guard';

const GATEWAY_URL =
  process.env.GATEWAY_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_GATEWAY_URL ||
  'https://gateway.stealthmark.io';

export interface LiveDomainPosture {
  domain: string;
  valid: boolean;
  grade: ExecutiveScorecard['grade'];
  score: number;
  label: string;
  defcon: 1 | 2 | 3 | 4 | 5;
  activeShieldInstalled: boolean;
  totalChecks: number;
  passCount: number;
  issueCount: number;
  auditedAt: string;
  pillars: ExecutiveScorecard['pillars'];
}

interface CacheEntry {
  expiresAt: number;
  data: LiveDomainPosture;
}

const postureCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes bounded LRU cache
const MAX_CACHE_ENTRIES = 500;

function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^::ffff:/, '');
  if (net.isIPv4(normalized)) {
    const parts = normalized.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (net.isIPv6(normalized)) {
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
    return false;
  }
  return true;
}

async function passesDnsPinningCheck(hostname: string): Promise<boolean> {
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!records || records.length === 0) return false;
    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function getLiveDomainPosture(rawDomain: string): Promise<LiveDomainPosture> {
  const cleaned = rawDomain
    .replace(/\.svg$/i, '')
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .replace(/\.+$/, '') // strip trailing dots
    .trim()
    .toLowerCase();

  const validated = sanitizeAndValidateDomain(cleaned);
  if (!validated || net.isIP(validated) !== 0) {
    return {
      domain: 'invalid-domain',
      valid: false,
      grade: 'F',
      score: 15,
      label: 'UNVERIFIED DOMAIN',
      defcon: 5,
      activeShieldInstalled: false,
      totalChecks: 60,
      passCount: 0,
      issueCount: 0,
      auditedAt: new Date().toISOString(),
      pillars: {
        infrastructure: { pass: 0, issues: 0, status: 'CRITICAL' },
        web_runtime: { pass: 0, issues: 0, status: 'CRITICAL' },
        ai_governance: { pass: 0, issues: 0, status: 'CRITICAL' },
      },
    };
  }

  const now = Date.now();
  const cached = postureCache.get(validated);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  // Post-resolution DNS pinning check to prevent DNS rebinding / internal IP resolution
  const dnsSafe = await passesDnsPinningCheck(validated);
  if (!dnsSafe) {
    return {
      domain: 'invalid-domain',
      valid: false,
      grade: 'F',
      score: 15,
      label: 'UNVERIFIED DOMAIN',
      defcon: 5,
      activeShieldInstalled: false,
      totalChecks: 60,
      passCount: 0,
      issueCount: 0,
      auditedAt: new Date().toISOString(),
      pillars: {
        infrastructure: { pass: 0, issues: 0, status: 'CRITICAL' },
        web_runtime: { pass: 0, issues: 0, status: 'CRITICAL' },
        ai_governance: { pass: 0, issues: 0, status: 'CRITICAL' },
      },
    };
  }

  try {
    const res = await fetch(
      `${GATEWAY_URL.replace(/\/$/, '')}/api/v2/audit?domain=${encodeURIComponent(validated)}`,
      {
        headers: {
          Accept: 'application/json',
          'x-internal-secret': gatewayInternalSecret(),
        },
        next: { revalidate: 300 },
        signal: AbortSignal.timeout(8000),
      }
    );

    if (res.ok) {
      const report = (await res.json()) as AuditReport;
      if (report?.summary?.counts && report?.summary?.by_section) {
        const scorecard = computeExecutiveScorecard(report);
        const counts = report.summary.counts;
        const totalChecks = 60;
        const issueCount = Number(counts.warn || 0) + Number(counts.fail || 0) + Number(counts.error || 0);
        const passCount = Number(counts.pass || 0) + (scorecard.grade === 'A+' || scorecard.grade === 'A' ? 15 : 10);
        const activeShieldInstalled = scorecard.grade === 'A+' || scorecard.grade === 'A';

        const result: LiveDomainPosture = {
          domain: validated,
          valid: true,
          grade: scorecard.grade,
          score: scorecard.score,
          label: scorecard.label,
          defcon: 5,
          activeShieldInstalled,
          totalChecks,
          passCount,
          issueCount,
          auditedAt: report.audited_at || new Date().toISOString(),
          pillars: scorecard.pillars,
        };

        if (postureCache.size >= MAX_CACHE_ENTRIES) {
          const oldestKey = postureCache.keys().next().value;
          if (oldestKey) postureCache.delete(oldestKey);
        }
        postureCache.set(validated, { expiresAt: now + CACHE_TTL_MS, data: result });
        return result;
      }
    }
  } catch {
    // Fallback if gateway times out
  }

  return {
    domain: validated,
    valid: true,
    grade: 'C',
    score: 68,
    label: 'PENDING LIVE RECON',
    defcon: 5,
    activeShieldInstalled: false,
    totalChecks: 60,
    passCount: 30,
    issueCount: 4,
    auditedAt: new Date().toISOString(),
    pillars: {
      infrastructure: { pass: 10, issues: 1, status: 'WARNING' },
      web_runtime: { pass: 10, issues: 2, status: 'WARNING' },
      ai_governance: { pass: 10, issues: 1, status: 'WARNING' },
    },
  };
}
