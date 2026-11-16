import { sanitizeAndValidateDomain } from '@/lib/security/network-guard';
import { SAFE_OUTBOUND_ACCEPT_ENCODING } from '@stealthmark/core';
import {
  enrichWithInternetDbIfMissing,
  enrichWithV2ActiveShieldChecks,
  tagOwaspGates,
} from '@/lib/audit-enrichment';
import { gatewayInternalSecret } from '@/lib/auth';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { chargePaidKey, refundCharge, type ChargeResult } from '@/lib/credit-meter';
import { signBadge, verifyScanUnlockToken } from '@/lib/scan-unlock';
import { computeExecutiveScorecard, SCAN_CHECK_COUNT, type AuditReport } from '@/lib/readiness-report';
import {
  evaluateAndRecordDomainScanQuota,
  redactReportForFourthScanPaywall,
} from '@/lib/scan-quota';
import { FIX_PACK } from '@/lib/offer';
import { SITE_ORIGIN } from '@/lib/site';
import { clientIp, clientNetwork } from '@/lib/client-ip';
import { LEAD_EMAIL_RE } from '@/lib/lead-email';
import { classifyUserAgent, parseAttribution, parseScanTrigger, type ScanTrigger } from '@/lib/scan-telemetry';

const GATEWAY_URL =
  process.env.GATEWAY_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_GATEWAY_URL ||
  'https://gateway.stealthmark.io';

const CONSOLE_ORG_ID =
  process.env.STEALTHMARK_CONSOLE_ORG_ID ||
  'ecf26102-eff1-4a45-8bb4-630cba346b4a';

const VALID_DOMAIN_RE =
  /^(?:https?:\/\/)?([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}(?:\/.*)?$/;

const RATE_WINDOW_MS = 60_000;
const MAX_REQ_PER_WINDOW = 20;
const AUDIT_COST_CREDITS = 10;
const ipHits = new Map<string, { count: number; resetAt: number }>();
// Ceiling for the whole server: rotating networks must not flood usage_records with view rows.
const MAX_VIEW_ROWS_PER_MINUTE = 120;
let viewRows = { count: 0, resetAt: 0 };

function takeViewRowSlot(): boolean {
  const now = Date.now();
  if (viewRows.resetAt <= now) viewRows = { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (viewRows.count >= MAX_VIEW_ROWS_PER_MINUTE) return false;
  viewRows.count += 1;
  return true;
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  if (ipHits.size > 2000) {
    for (const [k, v] of ipHits) {
      if (v.resetAt <= now) ipHits.delete(k);
    }
  }
  const entry = ipHits.get(ip);
  if (!entry || entry.resetAt <= now) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_REQ_PER_WINDOW) return false;
  entry.count += 1;
  return true;
}

function classifyAuditViewer(userAgent: string, uaClass: string, unlocked: boolean): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('oai-searchbot')) return 'OAI-SearchBot';
  if (ua.includes('gptbot') || ua.includes('chatgpt')) return 'GPTBot';
  if (ua.includes('claudebot') || ua.includes('anthropic')) return 'ClaudeBot';
  if (ua.includes('perplexity')) return 'PerplexityBot';
  if (ua.includes('amazonbot')) return 'Amazonbot';
  if (uaClass === 'stealthmark') return 'OutboundAuditor';
  if (unlocked) return 'PaidAuditUnlock';
  return uaClass === 'browser' ? 'HumanFounder' : 'AutomatedClient';
}

async function recordScanViewTelemetry(
  cleanDomain: string,
  userAgent: string,
  unlocked: boolean,
  attribution: { ref: string | null; trigger: ScanTrigger | null }
): Promise<void> {
  const uaClass = classifyUserAgent(userAgent);
  const viewer = classifyAuditViewer(userAgent, uaClass, unlocked);
  if (viewer === 'OutboundAuditor') return;

  const supabase = createSupabaseAdminClient();
  if (!supabase || !takeViewRowSlot()) return;

  const safeDomain = cleanDomain
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .toLowerCase()
    .slice(0, 120);

  const recordedPath = unlocked
    ? `/scan?domain=${safeDomain}&unlocked=1`
    : `/scan?domain=${safeDomain}`;

  try {
    await supabase.from('usage_records').insert({
      org_id: CONSOLE_ORG_ID,
      event_type: 'agent_request',
      units: 1,
      source: 'sdk',
      agent_identifier: viewer,
      metadata: {
        path: recordedPath,
        method: 'GET',
        host: 'stealthmark.io',
        ua_class: uaClass,
        ref: attribution.ref,
        trigger: attribution.trigger,
      },
    } as never);
  } catch {
    // Non-blocking telemetry
  }
}

async function recordLeadEmailForTeaser(email: string, cleanDomain: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return;
  try {
    const { data: existing } = await supabase
      .from('scan_leads')
      .select('id')
      .eq('email', email)
      .eq('domain', cleanDomain)
      .limit(1)
      .maybeSingle();

    if (!existing) {
      await supabase.from('scan_leads').insert({
        email,
        domain: cleanDomain,
        source: 'scan_email_teaser',
        followup_sent: false,
        converted: false,
      } as never);
    }
  } catch {
    // Non-blocking
  }
}

/**
 * Deterministically picks up to 3 warn/fail/error findings for a domain, worst first, ties broken by
 * SHA-256(domain + check_id). The first two are the free teasers and the third is the email-gated one,
 * so scanning the same domain from any IP or email always reveals the exact same findings. The free
 * fix goes to the worst teaser that has a recommendation, since some checks ship without one.
 */
function pickDeterministicTeaserKeys(
  cleanDomain: string,
  sections: Record<string, unknown>
): { keys: string[]; freeFixKey: string | undefined } {
  const candidates: Array<{ key: string; severityRank: number; digest: string; hasFix: boolean }> = [];
  const normDomain = cleanDomain.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();

  for (const [secKey, items] of Object.entries(sections)) {
    if (!Array.isArray(items)) continue;
    items.forEach((item: Record<string, unknown>, idx: number) => {
      const st = String(item.status || 'info');
      if (st === 'fail' || st === 'warn' || st === 'error') {
        const checkId = String(item.id || `${secKey}_${idx}`);
        const digest = createHash('sha256')
          .update(`stealthmark_teaser_v1::${normDomain}::${secKey}::${checkId}`)
          .digest('hex');
        const severityRank = st === 'fail' ? 0 : st === 'warn' ? 1 : 2;
        candidates.push({
          key: `${secKey}:${idx}`,
          severityRank,
          digest,
          hasFix: typeof item.recommendation === 'string' && item.recommendation.trim() !== '',
        });
      }
    });
  }

  candidates.sort((a, b) => {
    if (a.severityRank !== b.severityRank) return a.severityRank - b.severityRank;
    return a.digest.localeCompare(b.digest);
  });

  const picked = candidates.slice(0, 3);
  return {
    keys: picked.map((c) => c.key),
    freeFixKey: picked.slice(0, 2).find((c) => c.hasFix)?.key,
  };
}

const LOCKED_RECOMMENDATION =
  `🔒 The copy-paste Cloudflare WAF rule, Cloudflare Worker, client-side RASP shield, live badge snippet and White-Label PDF come with the ${FIX_PACK.label} (${FIX_PACK.starterPriceLabel} USD one-time per domain).`;

/**
 * Builds a redacted finding from an allowlist so the detail, evidence, fix and check id never reach
 * a visitor who has not unlocked them. A Fix Pack finding keeps its title and OWASP gate: gateway
 * titles are static control names with no data from the domain, and naming the control is what
 * makes the pack worth buying. The email-gated finding stays anonymous so the reveal shows something new.
 */
function redactFinding(
  item: Record<string, unknown>,
  key: string,
  gate: 'email' | 'fix_pack'
): Record<string, unknown> {
  const base = { id: `locked_${key.replace(':', '_')}`, status: item.status, locked: true };
  if (gate === 'email') {
    return {
      ...base,
      emailGate: true,
      title: '🔒 3rd Live Exposure (Free with Work Email)',
      detail: '🔒 Enter your work email above to reveal this 3rd live exposure + enable passive port & CVE alerts (Free).',
    };
  }
  return {
    ...base,
    title: typeof item.title === 'string' && item.title ? item.title : 'Exposed Perimeter / AI-Surface Control',
    owaspGate: item.owaspGate ?? null,
    detail: `[🔒 REDACTED LIVE EVIDENCE & COPY-PASTE FIX — included with the ${FIX_PACK.label} (${FIX_PACK.starterPriceLabel} USD one-time per domain).]`,
  };
}

const AUDIT_CACHE_DIR = '/tmp/stealthmark_audit_cache_v5';
const AUDIT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const memAuditCache = new Map<string, { ts: number; rawData: Record<string, unknown> }>();

function readCachedRawAudit(cleanDomain: string): Record<string, unknown> | null {
  const key = cleanDomain.toLowerCase().replace(/[^a-z0-9.-]/g, '_');
  const now = Date.now();
  const mem = memAuditCache.get(key);
  if (mem && now - mem.ts < AUDIT_CACHE_TTL_MS) {
    return JSON.parse(JSON.stringify(mem.rawData));
  }
  try {
    const file = path.join(AUDIT_CACHE_DIR, `${key}.json`);
    if (fs.existsSync(file)) {
      const stat = fs.statSync(file);
      if (now - stat.mtimeMs < AUDIT_CACHE_TTL_MS) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
        memAuditCache.set(key, { ts: stat.mtimeMs, rawData: parsed });
        return JSON.parse(JSON.stringify(parsed));
      }
    }
  } catch {
    // non-blocking cache read
  }
  return null;
}

function writeCachedRawAudit(cleanDomain: string, rawData: Record<string, unknown>): void {
  const key = cleanDomain.toLowerCase().replace(/[^a-z0-9.-]/g, '_');
  const now = Date.now();
  const clone = JSON.parse(JSON.stringify(rawData));
  memAuditCache.set(key, { ts: now, rawData: clone });
  try {
    fs.mkdirSync(AUDIT_CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(AUDIT_CACHE_DIR, `${key}.json`), JSON.stringify(clone), 'utf-8');
  } catch {
    // non-blocking cache write
  }
}

/** The gateway redacts issues for callers without its internal secret; that shape must never be sold as a paid report. */
function hasGatewayLockedItems(data: Record<string, unknown>): boolean {
  if (!data || typeof data.sections !== 'object' || data.sections === null) return false;
  return Object.values(data.sections as Record<string, unknown>).some(
    (items) => Array.isArray(items) && (items as Array<Record<string, unknown> | null>).some((item) => item?.locked === true),
  );
}

function signedBadgeFor(cleanDomain: string, data: Record<string, unknown>): { grade: string; url: string } | null {
  const summary = data.summary as { counts?: unknown; by_section?: unknown } | undefined;
  if (!summary?.counts || !summary.by_section) return null;
  const { grade } = computeExecutiveScorecard(data as unknown as AuditReport);
  const issuedAt = Math.floor(Date.now() / 1000);
  const sig = signBadge(cleanDomain, grade, issuedAt);
  if (!sig) return null;
  const query = new URLSearchParams({ domain: cleanDomain, grade, t: String(issuedAt), sig });
  return { grade, url: `${SITE_ORIGIN}/api/scan/badge?${query.toString()}` };
}

export async function GET(request: Request) {
  // D-5: without a client IP the per-network limiter cannot work, so the request is refused.
  const ip = clientIp(request);

  if (!ip || !checkRateLimit(clientNetwork(ip))) {
    return NextResponse.json(
      { error: 'Too many scan requests from this IP. Please wait 60 seconds.' },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get('domain')?.trim();
  const validatedDomain = domain ? sanitizeAndValidateDomain(domain) : null;
  if (!domain || !validatedDomain || domain.length > 253 || !VALID_DOMAIN_RE.test(domain)) {
    return NextResponse.json(
      { error: 'Invalid or missing domain parameter.' },
      { status: 400 }
    );
  }

  // The email travels only in a header so it never lands in access logs or browser history.
  const rawEmail = (request.headers.get('x-lead-email') || '').trim().toLowerCase();
  const teaserUnlocked = LEAD_EMAIL_RE.test(rawEmail);

  const cleanDomain = domain.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  const domainUnlocked = verifyScanUnlockToken(request.headers.get('x-scan-unlock'), cleanDomain) !== null;

  const authHeader = request.headers.get('authorization') || '';
  const bearerKey = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null;

  let charge: ChargeResult | null = null;
  if (!domainUnlocked && bearerKey) {
    charge = await chargePaidKey(bearerKey, AUDIT_COST_CREDITS);
  }
  const unlocked = domainUnlocked || charge?.ok === true;
  const refundIfCharged = async () => {
    if (charge?.ok) await refundCharge(charge.orgId, charge.charged);
  };

  const userAgent = request.headers.get('user-agent') || '';
  const scanTrigger = parseScanTrigger(searchParams.get('trigger'));
  void recordScanViewTelemetry(cleanDomain, userAgent, unlocked, {
    ref: parseAttribution(searchParams.get('ref'), searchParams.get('utm_source')),
    trigger: scanTrigger,
  });
  if (teaserUnlocked && !unlocked) {
    void recordLeadEmailForTeaser(rawEmail, cleanDomain);
  }

  try {
    const forceFresh = searchParams.get('fresh') === '1' || scanTrigger === 'manual';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any = !forceFresh ? readCachedRawAudit(cleanDomain) : null;
    if (!data) {
      const res = await fetch(
        `${GATEWAY_URL.replace(/\/$/, '')}/api/v2/audit?domain=${encodeURIComponent(domain)}`,
        {
          headers: {
            Accept: 'application/json',
            'X-Forwarded-For': ip,
            'x-internal-secret': gatewayInternalSecret(),
            'Accept-Encoding': SAFE_OUTBOUND_ACCEPT_ENCODING,
          },
          cache: 'no-store',
        }
      );
      data = await res.json();
      if (!res.ok) {
        if (res.status >= 500) await refundIfCharged();
        return NextResponse.json(data, { status: res.status });
      }
      if (hasGatewayLockedItems(data as Record<string, unknown>)) {
        await refundIfCharged();
        console.error('scan/audit: gateway returned its public redacted report; GATEWAY_INTERNAL_SECRET does not match its INTERNAL_AUTH_SECRET');
        return NextResponse.json({ error: 'Audit connection failed.' }, { status: 502 });
      }

      await enrichWithInternetDbIfMissing(cleanDomain, data as Record<string, unknown>);
      await enrichWithV2ActiveShieldChecks(cleanDomain, data as Record<string, unknown>);
      tagOwaspGates(data as Record<string, unknown>);
      writeCachedRawAudit(cleanDomain, data as Record<string, unknown>);
    }
    const badge = signedBadgeFor(cleanDomain, data as Record<string, unknown>);

    const scLive = computeExecutiveScorecard(data as unknown as AuditReport);
    const countsLive = ((data.summary as { counts?: Record<string, number> })?.counts) || {};
    const totalChecksLive = Number(
      ((data.summary as { total_checks?: number })?.total_checks) || SCAN_CHECK_COUNT
    );
    const uaClassNow = classifyUserAgent(userAgent);
    const shouldCountHumanScan =
      uaClassNow === 'browser' &&
      scanTrigger !== 'email_reveal' &&
      scanTrigger !== 'checkout_return';

    const scanQuota = evaluateAndRecordDomainScanQuota({
      cleanDomain,
      unlocked,
      shouldCountScan: shouldCountHumanScan,
      forceIncrement: forceFresh,
      currentScore: scLive.score,
      currentGrade: scLive.grade,
      currentPasses: countsLive.pass || 0,
      currentIssues: (countsLive.warn || 0) + (countsLive.fail || 0) + (countsLive.error || 0),
      totalChecks: totalChecksLive,
    });

    if (scanQuota.quota_locked && !unlocked) {
      const lockedPayload = redactReportForFourthScanPaywall(
        data as Record<string, unknown>,
        scanQuota
      );
      return NextResponse.json({
        ...lockedPayload,
        unlocked: false,
        teaserUnlocked,
      });
    }

    data.scan_quota = scanQuota;
    data.quota_locked = false;

    const freeCommunityUnlocked = !scanQuota.quota_locked;
    if (!unlocked && !freeCommunityUnlocked && data && typeof data.sections === 'object' && data.sections !== null) {
      // PLG gate: the two worst findings are free (the worst one with its fix), the third needs a work
      // email, the rest need the Fix Pack.
      const {
        keys: [firstKey, secondKey, emailKey],
        freeFixKey,
      } = pickDeterministicTeaserKeys(cleanDomain, data.sections);
      const openKeys = new Set([firstKey, secondKey, teaserUnlocked ? emailKey : undefined]);
      for (const [secKey, items] of Object.entries(data.sections)) {
        if (!Array.isArray(items)) continue;
        data.sections[secKey] = items.map((item: Record<string, unknown>, idx: number) => {
          const st = String(item.status || 'info');
          const isIssue = st === 'warn' || st === 'fail' || st === 'error';
          if (!isIssue) {
            return {
              id: item.id,
              title: item.title,
              status: st,
              owaspGate: item.owaspGate ?? null,
              locked: false,
              detail: item.detail,
            };
          }
          const key = `${secKey}:${idx}`;
          if (key === freeFixKey) {
            return { ...item, evidence: undefined, locked: false, teaser: true, freeFix: true };
          }
          if (openKeys.has(key)) {
            return { ...item, recommendation: LOCKED_RECOMMENDATION, evidence: undefined, locked: false, teaser: true };
          }
          return redactFinding(item, key, key === emailKey ? 'email' : 'fix_pack');
        });
      }
    }

    const agentRemediationAndBounty = {
      protocol: 'stealthmark_a2a_bounty_v2',
      commission_rate: '30%',
      commission_payout_usd:
        'Recorded, not paid out automatically: 30% of each referred unlock',
      payout_networks: [],
      public_verification_certificate: `https://stealthmark.io/verify/${encodeURIComponent(cleanDomain)}`,
      live_badge_svg: `https://stealthmark.io/api/badge/${encodeURIComponent(cleanDomain)}.svg`,
      remediation_checkout_url: `https://stealthmark.io/scan?domain=${encodeURIComponent(cleanDomain)}&ref=<your_agent_id_or_0x_wallet>`,
      white_label_agency_arbitrage:
        'Agencies & freelance pentesters can resell the 3-Page White-Label A4 PDF + JA4 Worker + <3KB RASP to their clients.',
    };

    return NextResponse.json({
      ...data,
      unlocked: unlocked || !scanQuota.quota_locked,
      teaserUnlocked,
      badge,
      agent_remediation_and_bounty: agentRemediationAndBounty,
    });
  } catch {
    await refundIfCharged();
    return NextResponse.json(
      { error: 'Audit connection failed.' },
      { status: 502 }
    );
  }
}
