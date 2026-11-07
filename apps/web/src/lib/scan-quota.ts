import fs from 'node:fs';
import path from 'node:path';
import { FIX_PACK, FREE_SCANS_PER_DOMAIN, UNLOCK_DAYS } from '@/lib/offer';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';

export const FREE_SCAN_LIMIT = FREE_SCANS_PER_DOMAIN;

const QUOTA_FILE_PATH =
  process.env.STEALTHMARK_SCAN_QUOTA_FILE ||
  '/var/cache/stealthmark-web/domain_scan_quota.json';

const DEDUP_WINDOW_MS = 8_000;

const QUOTA_PRICES = {
  unlimited_scans_price_usd: FIX_PACK.starterPriceUsd,
  full_report_price_usd: FIX_PACK.priceUsd,
  full_report_discounted_usd: FIX_PACK.discountedPriceUsd,
};

const EXEMPT_APEX_DOMAINS = new Set<string>([
  'stealthmark.io',
  'openai.com',
  'anthropic.com',
  'google.com',
  'cloudflare.com',
  'vercel.com',
  'example.com',
  'localhost',
]);

// Two-label public suffixes, including shared-hosting ones, so unrelated sites on the same suffix never share one quota.
const MULTI_PART_TLDS = new Set<string>([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'co.jp',
  'co.kr',
  'co.nz',
  'com.ar',
  'com.br',
  'com.mx',
  'com.co',
  'com.pe',
  'com.uy',
  'com.au',
  'net.au',
  'org.au',
  'co.in',
  'co.za',
  'com.sg',
  'com.tr',
  'com.cn',
  'com.tw',
  'com.hk',
  'vercel.app',
  'github.io',
  'netlify.app',
  'pages.dev',
  'herokuapp.com',
  'web.app',
  'firebaseapp.com',
  'onrender.com',
  'fly.dev',
  'railway.app',
  'azurewebsites.net',
]);

export interface DomainQuotaRecord {
  used: number;
  lastScanAtMs: number;
  lastScore: number;
  lastGrade: string;
  lastPasses: number;
  lastIssues: number;
}

export interface ScanQuotaStatus {
  free_limit: number;
  used: number;
  remaining: number;
  quota_locked: boolean;
  previous_score: number | null;
  previous_grade: string | null;
  score_changed: boolean;
  resolved_delta_hint: number;
  checks_evaluated: number;
  remediation_detected: boolean;
  unlimited_scans_price_usd: number;
  full_report_price_usd: number;
  full_report_discounted_usd: number;
}

let memoryQuotaStore: Record<string, DomainQuotaRecord> | null = null;

export function normalizeApexDomain(rawDomain: string): string {
  const host = rawDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');

  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;

  const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  if (MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) {
    return `${parts[parts.length - 3]}.${lastTwo}`;
  }
  return lastTwo;
}

export function isQuotaExemptDomain(cleanDomain: string): boolean {
  const apex = normalizeApexDomain(cleanDomain);
  return EXEMPT_APEX_DOMAINS.has(cleanDomain) || EXEMPT_APEX_DOMAINS.has(apex);
}

function loadStore(): Record<string, DomainQuotaRecord> {
  if (process.env.NODE_ENV === 'test') {
    if (!memoryQuotaStore) memoryQuotaStore = {};
    return memoryQuotaStore;
  }
  try {
    if (fs.existsSync(QUOTA_FILE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(QUOTA_FILE_PATH, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, DomainQuotaRecord>;
      }
    }
  } catch {
    // Fallback to the in-memory store if the disk cache isn't ready
  }
  if (!memoryQuotaStore) {
    memoryQuotaStore = {};
  }
  return memoryQuotaStore;
}

function saveStore(store: Record<string, DomainQuotaRecord>): void {
  memoryQuotaStore = store;
  if (process.env.NODE_ENV === 'test') return;
  try {
    const dir = path.dirname(QUOTA_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(QUOTA_FILE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch {
    // Non-fatal if cache directory is read-only
  }
}

export function resetQuotaStoreForTests(): void {
  memoryQuotaStore = {};
}

export function evaluateAndRecordDomainScanQuota(params: {
  cleanDomain: string;
  unlocked: boolean;
  shouldCountScan: boolean;
  forceIncrement?: boolean;
  currentScore: number;
  currentGrade: string;
  currentPasses: number;
  currentIssues: number;
  totalChecks: number;
  nowMs?: number;
}): ScanQuotaStatus {
  const {
    cleanDomain,
    unlocked,
    shouldCountScan,
    forceIncrement = false,
    currentScore,
    currentGrade,
    currentPasses,
    currentIssues,
    totalChecks,
    nowMs = Date.now(),
  } = params;

  if (unlocked || isQuotaExemptDomain(cleanDomain)) {
    return {
      free_limit: FREE_SCAN_LIMIT,
      used: 1,
      remaining: FREE_SCAN_LIMIT,
      quota_locked: false,
      previous_score: null,
      previous_grade: null,
      score_changed: false,
      resolved_delta_hint: 0,
      checks_evaluated: totalChecks || SCAN_CHECK_COUNT,
      remediation_detected: false,
      ...QUOTA_PRICES,
    };
  }

  const apex = normalizeApexDomain(cleanDomain);
  const store = loadStore();
  const prev = store[apex] || null;

  if (!shouldCountScan) {
    const usedNow = prev ? prev.used : 1;
    const lockedNow = usedNow > FREE_SCAN_LIMIT;
    return {
      free_limit: FREE_SCAN_LIMIT,
      used: usedNow,
      remaining: Math.max(0, FREE_SCAN_LIMIT - usedNow),
      quota_locked: lockedNow,
      previous_score: prev ? prev.lastScore : null,
      previous_grade: prev ? prev.lastGrade : null,
      score_changed: prev ? prev.lastScore !== currentScore || prev.lastIssues !== currentIssues : false,
      resolved_delta_hint: prev ? Math.max(0, prev.lastIssues - currentIssues) : 0,
      checks_evaluated: totalChecks || SCAN_CHECK_COUNT,
      remediation_detected: prev ? currentIssues < prev.lastIssues : false,
      ...QUOTA_PRICES,
    };
  }

  const withinDedup = prev && !forceIncrement && nowMs - prev.lastScanAtMs < DEDUP_WINDOW_MS;
  const nextUsed = prev ? (withinDedup ? prev.used : prev.used + 1) : 1;
  const quotaLocked = nextUsed > FREE_SCAN_LIMIT;

  const previousScore = prev ? prev.lastScore : null;
  const previousGrade = prev ? prev.lastGrade : null;
  const scoreChanged = prev ? prev.lastScore !== currentScore || prev.lastIssues !== currentIssues : false;
  const resolvedDeltaHint = prev ? Math.max(0, prev.lastIssues - currentIssues) : 0;

  // Keep the baseline from Scan #3 when Scan #4+ is locked so the user always sees their last unlocked baseline score
  store[apex] = {
    used: nextUsed,
    lastScanAtMs: nowMs,
    lastScore: quotaLocked && prev ? prev.lastScore : currentScore,
    lastGrade: quotaLocked && prev ? prev.lastGrade : currentGrade,
    lastPasses: quotaLocked && prev ? prev.lastPasses : currentPasses,
    lastIssues: quotaLocked && prev ? prev.lastIssues : currentIssues,
  };
  saveStore(store);

  return {
    free_limit: FREE_SCAN_LIMIT,
    used: nextUsed,
    remaining: Math.max(0, FREE_SCAN_LIMIT - nextUsed),
    quota_locked: quotaLocked,
    previous_score: previousScore,
    previous_grade: previousGrade,
    score_changed: scoreChanged,
    resolved_delta_hint: resolvedDeltaHint,
    checks_evaluated: totalChecks || SCAN_CHECK_COUNT,
    remediation_detected: prev ? currentIssues < prev.lastIssues : false,
    ...QUOTA_PRICES,
  };
}

/**
 * Redacts the 4th+ scan payload server-side (OWASP A04) so the developer cannot inspect
 * Chrome DevTools -> Network to see their new post-deploy score or remaining findings for free.
 */
export function redactReportForFourthScanPaywall(
  data: Record<string, unknown>,
  quota: ScanQuotaStatus
): Record<string, unknown> {
  const redactedSections: Record<string, Array<Record<string, unknown>>> = {};
  if (data.sections && typeof data.sections === 'object') {
    for (const [secKey, items] of Object.entries(data.sections as Record<string, unknown>)) {
      if (!Array.isArray(items)) continue;
      redactedSections[secKey] = items.slice(0, 3).map((item: Record<string, unknown>, idx: number) => ({
        id: `quota_locked_${secKey}_${idx}`,
        title: '🔒 Domain Quota Reached (20/20 Free Scans Used)',
        status: 'info',
        owaspGate: item.owaspGate ?? null,
        locked: true,
        quotaGate: true,
        detail: `New results for this domain are locked after ${FREE_SCAN_LIMIT} scans. Unlock the domain (${FIX_PACK.starterPriceLabel} USD one-time) to view updated check results.`,
      }));
    }
  }

  return {
    domain: data.domain,
    audited_at: data.audited_at || new Date().toISOString(),
    quota_locked: true,
    scan_quota: quota,
    summary: {
      counts: { pass: 0, warn: 0, fail: 0, info: 0, error: 0 },
      by_section: {},
      total_checks: quota.checks_evaluated,
    },
    sections: redactedSections,
    limitations: [
      `Free scan quota (${FREE_SCAN_LIMIT} of ${FREE_SCAN_LIMIT} scans) used for this domain.`,
      `Unlock the domain (${FIX_PACK.starterPriceLabel} USD one-time, includes unlimited re-scans for ${UNLOCK_DAYS} days) to reveal the updated score.`,
    ],
  };
}
