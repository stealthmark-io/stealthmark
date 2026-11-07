'use client';

import React, { useState, useEffect, useRef, useTransition, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Shield,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Download,
  FileText,
  Printer,
  ArrowRight,
  ExternalLink,
  Globe,
  Radio,
  RefreshCw,
  Copy,
  Check,
  Lock,
  Zap,
  CircleMinus,
} from 'lucide-react';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CodeBlock } from '@/components/ui/code-block';
import { ScanUnlockModal } from '@/components/scan/ScanUnlockModal';
import { WhiteLabelPdfReport } from '@/components/scan/WhiteLabelPdfReport';
import { EnterpriseForensicCard } from '@/components/landing/EnterpriseForensicCard';
import { SDK_NPM_URL } from '@/lib/site';
import { DONATION_OPTIONS, FIX_PACK, FREE_SCANS_PER_DOMAIN, UNLOCK_DAYS } from '@/lib/offer';
import { LEAD_EMAIL_RE } from '@/lib/lead-email';
import { parseAttribution, type ScanTrigger } from '@/lib/scan-telemetry';
import { unlockCheckoutId, withoutCheckoutParams } from '@/lib/checkout-return';
import {
  AuditReport,
  AuditCheckItem,
  SCAN_CHECK_COUNT,
  SECTION_TITLES,
  generateMarkdownReport,
  downloadFile,
  computeExecutiveScorecard,
  buildAiFixPrompt,
  statusLabel,
} from '@/lib/readiness-report';

interface ScanQuotaInfo {
  free_limit: number;
  used: number;
  remaining: number;
  quota_locked: boolean;
  previous_score: number | null;
  previous_grade: string | null;
  score_changed: boolean;
  resolved_delta_hint: number;
  checks_evaluated: number;
}

type ScanReport = AuditReport & {
  unlocked?: boolean;
  teaserUnlocked?: boolean;
  quota_locked?: boolean;
  scan_quota?: ScanQuotaInfo;
  badge?: { grade: string; url: string } | null;
};

interface FixPackDeliverables {
  cloudflare_visual_waf_rule: string;
  cloudflare_worker_code: string;
  client_rasp_shield_js?: string;
  live_badge_html?: string;
}

interface StoredUnlock {
  token: string;
  deliverables: FixPackDeliverables | null;
}

const UNLOCK_STORAGE_PREFIX = 'stealthmark_unlock:';
const VERIFY_BACKOFF_MS = [0, 2000, 4000, 8000, 16000];

// Where this visit came from (`?ref=` or `?utm_source=`, else the stored referral), for scan telemetry.
// Browser-only: called from effects and event handlers.
function scanAttributionRef(): string | null {
  const params = new URLSearchParams(window.location.search);
  return parseAttribution(params.get('ref'), params.get('utm_source')) ?? localStorage.getItem('stealthmark_ref');
}

// Mirrors the server's sanitizeAndValidateDomain normalization; the server stays the authority on the token.
// Bare host of a domain or URL the visitor typed or linked (`?domain=` or `?url=`).
function targetHost(target: string): string {
  return target
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '');
}

function unlockStorageKey(target: string): string {
  return `${UNLOCK_STORAGE_PREFIX}${targetHost(target)}`;
}

function parseDeliverables(value: unknown): FixPackDeliverables | null {
  if (!value || typeof value !== 'object') return null;
  const { cloudflare_visual_waf_rule, cloudflare_worker_code, client_rasp_shield_js, live_badge_html } = value as Record<string, unknown>;
  return typeof cloudflare_visual_waf_rule === 'string' && typeof cloudflare_worker_code === 'string'
    ? {
        cloudflare_visual_waf_rule,
        cloudflare_worker_code,
        ...(typeof client_rasp_shield_js === 'string' ? { client_rasp_shield_js } : {}),
        ...(typeof live_badge_html === 'string' ? { live_badge_html } : {}),
      }
    : null;
}

function readStoredUnlock(target: string): StoredUnlock | null {
  try {
    const raw = localStorage.getItem(unlockStorageKey(target));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { token, deliverables } = parsed as Record<string, unknown>;
    return typeof token === 'string' ? { token, deliverables: parseDeliverables(deliverables) } : null;
  } catch {
    return null;
  }
}

function storeUnlock(domain: string, unlock: StoredUnlock): void {
  try {
    localStorage.setItem(unlockStorageKey(domain), JSON.stringify(unlock));
  } catch {
    // Storage can be blocked (private mode); the unlock then lasts for this page view only.
  }
}

function forgetUnlock(target: string): void {
  try {
    localStorage.removeItem(unlockStorageKey(target));
  } catch {
    // Storage is blocked, so nothing was persisted.
  }
}

async function generatorErrorMessage(res: Response): Promise<string> {
  if (res.status === 402) {
    return `Generating the Edge Worker and WAF rule uses 25 credits from a paid API key with a balance. The ${FIX_PACK.label} (${FIX_PACK.starterPriceLabel} per domain) is a separate unlock.`;
  }
  const data: unknown = await res.json().catch(() => null);
  const message =
    data && typeof data === 'object' ? (data as Record<string, unknown>).message ?? (data as Record<string, unknown>).error : null;
  return typeof message === 'string' && message ? `${message} (HTTP ${res.status})` : `Generation failed (HTTP ${res.status}). Try again.`;
}

const QUICK_TARGETS = ['stealthmark.io', 'openai.com', 'anthropic.com', 'google.com', 'cloudflare.com', 'vercel.com'];

const NEXT_CODE_SAMPLE = `// middleware.ts — StealthMark October 2026 4-Layer Edge Shield
import { withStealthMark, sanitizeAndNormalizeRequest, evaluateAgentBehavior } from "@stealthmark/next";

export default withStealthMark(middleware, {
  siteName: "Production Perimeter",
  dotfiles: "block", // Enforces 403 on /.env, /.git, and October 2026 CVE probes
});`;

function ScanPageContent() {
  const searchParams = useSearchParams();
  const [domainInput, setDomainInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'issues' | 'passes'>('all');
  const [copiedCode, setCopiedCode] = useState(false);
  const [activeApiKey, setActiveApiKey] = useState<string | null>(null);
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);
  const [leadEmail, setLeadEmail] = useState('');
  const [teaserUnlocked, setTeaserUnlocked] = useState(false);
  const [revealingEmail, setRevealingEmail] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [copiedBadge, setCopiedBadge] = useState(false);
  const [generatingManifests, setGeneratingManifests] = useState(false);
  const [generatedArtifacts, setGeneratedArtifacts] = useState<{
    llms_txt: string;
    agent_json: Record<string, unknown>;
  } | null>(null);
  const [generatingEdgeShield, setGeneratingEdgeShield] = useState(false);
  const [generatedEdgeShield, setGeneratedEdgeShield] = useState<{
    cloudflare_worker_js: string;
    cloudflare_waf_expression: string;
    dmarc_dns_record: string;
  } | null>(null);
  const [generatorError, setGeneratorError] = useState<string | null>(null);
  const [fixPackDeliverables, setFixPackDeliverables] = useState<FixPackDeliverables | null>(null);
  const [unlockNotice, setUnlockNotice] = useState<string | null>(null);
  const findingsRef = useRef<HTMLDivElement>(null);
  const engagedDomainRef = useRef<string | null>(null);
  const renewedUnlockHostsRef = useRef<Set<string>>(new Set());
  const latestAuditHostRef = useRef<string | null>(null);
  const reportDomain = report?.domain;

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('stealthmark_api_key');
      if (stored && /^sk_live_[0-9a-fA-F]{32}$/.test(stored)) {
        fetch('/api/keys/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: stored }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data?.valid) {
              setActiveApiKey(stored);
            } else {
              localStorage.removeItem('stealthmark_api_key');
            }
          })
          .catch(() => {
            // Keep offline resilience if verify endpoint is unreachable
          });
      } else if (stored) {
        localStorage.removeItem('stealthmark_api_key');
      }
    }
  }, []);

  useEffect(() => {
    const refQuery = searchParams.get('ref');
    if (refQuery && typeof window !== 'undefined' && /^[a-zA-Z0-9_.-]{2,64}$/.test(refQuery.trim())) {
      localStorage.setItem('stealthmark_ref', refQuery.trim().toLowerCase());
    }
    const emailQuery = searchParams.get('email');
    if (emailQuery && emailQuery.includes('@') && !leadEmail) {
      setLeadEmail(emailQuery.trim().toLowerCase());
    }
    const checkoutId = searchParams.get('checkout_id') || searchParams.get('session_id');
    const rawTarget = searchParams.get('domain') || searchParams.get('url');
    const domainQuery = rawTarget ? targetHost(rawTarget) || null : null;
    if (checkoutId) {
      if (domainQuery) setDomainInput(domainQuery);
      void redeemFixPackCheckout(checkoutId, domainQuery);
    } else if (domainQuery && !report && !loading) {
      setDomainInput(domainQuery);
      runAudit(domainQuery, undefined, undefined, 'autorun');
    }
  }, [searchParams]);

  // Sends one engagement event per report once the visitor scrolls the findings into view or
  // touches the page. Mail link scanners fetch /scan but do neither, so they never send it.
  useEffect(() => {
    if (!reportDomain || engagedDomainRef.current === reportDomain) return;
    const onInteraction = () => sendEngaged('interaction');
    const onScroll = () => {
      const findings = findingsRef.current;
      if (findings && findings.getBoundingClientRect().top < window.innerHeight) sendEngaged('findings_viewed');
    };
    function stopListening() {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointerdown', onInteraction);
      window.removeEventListener('keydown', onInteraction);
    }
    function sendEngaged(action: 'findings_viewed' | 'interaction') {
      if (engagedDomainRef.current === reportDomain) return;
      engagedDomainRef.current = reportDomain ?? null;
      stopListening();
      void fetch('/api/scan/engaged', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: reportDomain, action, ref: scanAttributionRef() }),
        keepalive: true,
      }).catch(() => {
        // Non-blocking telemetry
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointerdown', onInteraction);
    window.addEventListener('keydown', onInteraction);
    return stopListening;
  }, [reportDomain]);

  const isUnlocked = report?.unlocked === true;

  function auditUrl(domain: string, trigger: ScanTrigger): string {
    const ref = scanAttributionRef();
    return `/api/scan/audit?domain=${encodeURIComponent(domain)}&trigger=${trigger}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`;
  }

  // Exchanges a paid Fix Pack checkout for the domain-bound unlock token. Polar can report the
  // checkout as `confirmed` (202) for a few seconds before it succeeds, hence the backoff. A renewal passes the
  // audited target whose stored token the audit refused; that token stays stored unless the checkout can never redeem.
  async function redeemFixPackCheckout(checkoutId: string, domainQuery: string | null, renewTarget?: string) {
    const renewHost = renewTarget === undefined ? null : targetHost(renewTarget);
    const query = `checkout_id=${encodeURIComponent(checkoutId)}${domainQuery ? `&domain=${encodeURIComponent(domainQuery)}` : ''}`;
    setUnlockNotice(renewHost !== null ? `Renewing your Fix Pack unlock for ${renewHost}…` : 'Confirming your Fix Pack payment…');
    for (const delayMs of VERIFY_BACKOFF_MS) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      let res: Response;
      try {
        res = await fetch(`/api/billing/polar/verify?${query}`);
      } catch {
        continue;
      }
      if (res.status === 202) continue;

      const data: unknown = await res.json().catch(() => null);
      const body = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      if (res.ok && body.verified === true && typeof body.unlock_token === 'string' && typeof body.domain === 'string') {
        const deliverables = parseDeliverables(body.deliverables);
        storeUnlock(body.domain, { token: body.unlock_token, deliverables });
        setUnlockNotice(null);
        if (renewHost !== null) {
          // runAudit shows the deliverables once the audit accepts the new token. A visitor who has scanned another
          // domain since then stays on it and gets the renewed unlock the next time they scan this one.
          if (latestAuditHostRef.current === renewHost) {
            setDomainInput(body.domain);
            runAudit(body.domain, undefined, undefined, 'checkout_return');
          }
          return;
        }
        setFixPackDeliverables(deliverables);
        setDomainInput(body.domain);
        runAudit(body.domain, undefined, undefined, 'checkout_return');
        // The pack is stored now, so the checkout id leaves the address bar, history and copied links. runAudit has
        // already set loading, so the searchParams effect does not start a second scan for the cleaned URL.
        const cleanHref = withoutCheckoutParams(window.location.href);
        if (cleanHref) window.history.replaceState(null, '', cleanHref);
        return;
      }
      // A renewal that fails for a reason that can pass (Polar down, rate limit) keeps the stored token, the only copy
      // of its checkout id. 400, 402 and 409 mean this checkout can never unlock the pack again, so its token goes,
      // but not a token from another checkout that a different tab stored for this host meanwhile.
      if (renewTarget !== undefined) {
        if (res.status !== 400 && res.status !== 402 && res.status !== 409) break;
        const stored = readStoredUnlock(renewTarget);
        if (stored && unlockCheckoutId(stored.token) === checkoutId) forgetUnlock(renewTarget);
      }
      setUnlockNotice(
        typeof body.message === 'string'
          ? body.message
          : `We could not confirm this payment (HTTP ${res.status}). Contact security@stealthmark.io with your Polar receipt.`
      );
      return;
    }
    setUnlockNotice(
      renewHost !== null
        ? `We could not renew your Fix Pack unlock for ${renewHost} yet. Reload this page in a minute to try again.`
        : 'Your payment is still being confirmed. Reload this page in a minute to finish unlocking.'
    );
  }

  async function runAudit(target: string, overrideKey?: string, overrideEmail?: string, trigger: ScanTrigger = 'manual') {
    const trimmed = target.trim();
    if (!trimmed) {
      setError('Please enter a domain or URL.');
      return;
    }
    setError(null);
    setLoading(true);
    latestAuditHostRef.current = targetHost(trimmed);

    try {
      const keyToUse =
        overrideKey ||
        activeApiKey ||
        (typeof window !== 'undefined' ? localStorage.getItem('stealthmark_api_key') : null);
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (keyToUse) {
        headers['Authorization'] = `Bearer ${keyToUse}`;
      }
      const emailToUse =
        overrideEmail ||
        leadEmail ||
        (typeof window !== 'undefined' ? localStorage.getItem('stealthmark_lead_email') || '' : '');
      if (emailToUse.trim()) {
        headers['x-lead-email'] = emailToUse.trim();
      }
      const storedUnlock = typeof window !== 'undefined' ? readStoredUnlock(trimmed) : null;
      if (storedUnlock) {
        headers['X-Scan-Unlock'] = storedUnlock.token;
      }
      const res = await fetch(auditUrl(trimmed, trigger), { headers });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }

      if (storedUnlock && data.unlocked !== true) {
        // An expired or re-keyed token is redeemed again from its checkout, which the server re-checks with Polar.
        // Once per host and page view, so a token the audit keeps refusing cannot loop.
        const host = targetHost(trimmed);
        const checkoutId = unlockCheckoutId(storedUnlock.token);
        if (!checkoutId) {
          forgetUnlock(trimmed);
        } else if (!renewedUnlockHostsRef.current.has(host)) {
          renewedUnlockHostsRef.current.add(host);
          void redeemFixPackCheckout(checkoutId, null, trimmed);
        }
      }
      setFixPackDeliverables(storedUnlock && data.unlocked === true ? storedUnlock.deliverables : null);
      setReport(data);
      if (data.teaserUnlocked) setTeaserUnlocked(true);
      if (data.quota_locked) setIsUnlockModalOpen(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Audit connection failed.';
      setError(msg);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  // Re-reads the report with the lead email only, never the API key, so revealing the 3rd finding
  // spends no credits. The report on screen stays as it was if the reveal fails.
  async function revealEmailFinding(domain: string, email: string) {
    setRevealingEmail(true);
    try {
      const res = await fetch(auditUrl(domain, 'email_reveal'), {
        headers: { Accept: 'application/json', 'x-lead-email': email },
      }).catch(() => null);
      const data: ScanReport | null = res?.ok ? await res.json().catch(() => null) : null;
      if (data?.teaserUnlocked === true) {
        setReport(data);
        setTeaserUnlocked(true);
        setLeadError(null);
        return;
      }
      setLeadError('Could not reveal the 3rd finding. Try again in a moment.');
    } finally {
      setRevealingEmail(false);
    }
  }

  // Shared by the banner form and the inline form on the email-gated card.
  function submitLeadEmail(current: ScanReport) {
    const clean = leadEmail.trim().toLowerCase();
    if (!LEAD_EMAIL_RE.test(clean)) {
      setLeadError('Enter a valid work email to activate alerts.');
      return;
    }
    setLeadError(null);
    if (typeof window !== 'undefined') {
      localStorage.setItem('stealthmark_lead_email', clean);
    }
    const scNow = computeExecutiveScorecard(current);
    // Subscribe first: the audit call also records the lead, and the alert
    // route skips its confirmation email when a lead for the pair already exists.
    void fetch('/api/scan/subscribe-alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: clean,
        domain: current.domain,
        score: scNow.score,
        grade: scNow.grade,
        passes: current.summary.counts.pass || 0,
        issues: (current.summary.counts.warn || 0) + (current.summary.counts.fail || 0),
      }),
    })
      .catch(() => null)
      .then(() => revealEmailFinding(current.domain, clean));
  }

  function handleExportJson() {
    if (!isUnlocked) {
      setIsUnlockModalOpen(true);
      return;
    }
    if (!report) return;
    const jsonStr = JSON.stringify(report, null, 2);
    downloadFile(`${report.domain}-readiness-audit.json`, jsonStr, 'application/json');
  }

  function handleExportMarkdown() {
    if (!isUnlocked) {
      setIsUnlockModalOpen(true);
      return;
    }
    if (!report) return;
    const md = generateMarkdownReport(report);
    downloadFile(`${report.domain}-readiness-audit.md`, md, 'text/markdown');
  }

  function handlePrint() {
    if (!isUnlocked) {
      setIsUnlockModalOpen(true);
      return;
    }
    window.print();
  }

  // Generators spend 25 credits from an API key; the Fix Pack alone does not cover them (D-1).
  async function handleGenerateManifests() {
    if (!activeApiKey) {
      setIsUnlockModalOpen(true);
      return;
    }
    if (!report) return;
    setGeneratingManifests(true);
    setGeneratorError(null);
    try {
      const res = await fetch('/api/scan/manifests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeApiKey}`,
        },
        body: JSON.stringify({ domain: report.domain }),
      });
      if (!res.ok) {
        setGeneratorError(await generatorErrorMessage(res));
        return;
      }
      const data = await res.json();
      if (data?.artifacts) {
        setGeneratedArtifacts(data.artifacts);
      } else {
        setGeneratorError('The manifest generator returned no files. Try again.');
      }
    } catch {
      setGeneratorError('Could not reach the manifest generator. Check your connection and try again.');
    } finally {
      setGeneratingManifests(false);
    }
  }

  async function handleGenerateEdgeShield() {
    if (!activeApiKey) {
      setIsUnlockModalOpen(true);
      return;
    }
    if (!report) return;
    setGeneratingEdgeShield(true);
    setGeneratorError(null);
    try {
      const res = await fetch('/api/scan/edge-shield', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeApiKey}`,
        },
        body: JSON.stringify({ domain: report.domain }),
      });
      if (!res.ok) {
        setGeneratorError(await generatorErrorMessage(res));
        return;
      }
      const data = await res.json();
      if (data?.cloudflare_worker_js) {
        setGeneratedEdgeShield(data);
      } else {
        setGeneratorError('The Edge Shield generator returned no Worker. Try again.');
      }
    } catch {
      setGeneratorError('Could not reach the Edge Shield generator. Check your connection and try again.');
    } finally {
      setGeneratingEdgeShield(false);
    }
  }

  const statusIcons = {
    pass: <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />,
    warn: <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />,
    fail: <XCircle className="w-4 h-4 text-rose-400 shrink-0" />,
    info: <Info className="w-4 h-4 text-cyan-400 shrink-0" />,
    error: <XCircle className="w-4 h-4 text-purple-400 shrink-0" />,
    not_assessed: <CircleMinus className="w-4 h-4 text-slate-400 shrink-0" />,
  };

  const statusBadgeVariant = {
    pass: 'success' as const,
    warn: 'warning' as const,
    fail: 'danger' as const,
    info: 'info' as const,
    error: 'purple' as const,
    not_assessed: 'neutral' as const,
  };

  // Filter items in active view
  const currentSections = report
    ? activeTab === 'all'
      ? Object.entries(report.sections)
      : Object.entries(report.sections).filter(([key]) => key === activeTab)
    : [];

  return (
    <div className="min-h-screen bg-[#060709] text-slate-100 flex flex-col selection:bg-cyan-500/30 selection:text-white relative bg-grid-pattern overflow-x-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] ambient-glow-purple pointer-events-none print:hidden" />
      <div className="absolute top-60 left-1/4 w-[600px] h-[300px] ambient-glow-cyan pointer-events-none print:hidden" />

      <div className="print:hidden">
        <Navbar />
      </div>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-10 sm:py-16 space-y-10 relative z-10 print:hidden">
        {/* Page Hero */}
        <div className="text-center max-w-3xl mx-auto space-y-4 print:hidden">
          <Badge variant="danger" className="uppercase font-mono text-[10px] tracking-wider bg-red-500/10 text-red-300 border-red-500/30">
            <Radio className="w-3.5 h-3.5 mr-1.5 text-red-400 animate-pulse" />
            Red Team Recon &middot; {SCAN_CHECK_COUNT}-Point Passive Perimeter &amp; CVE Auditor
          </Badge>
          <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
            {SCAN_CHECK_COUNT}-Point Passive Perimeter &amp;{' '}
            <span className="grad-text-cyan">CVE-2026 Security Audit</span>
          </h1>
          <p className="text-sm sm:text-base text-slate-400 leading-relaxed max-w-2xl mx-auto">
            Non-intrusive external reconnaissance across {SCAN_CHECK_COUNT} security controls: OWASP Top 10:2025 gates,
            Shodan InternetDB exposed ports &amp; CVEs, TLS/eMudhra CA trust, DNS/DMARC, JS bundle secret leaks, and
            2026 edge CVE signatures.
          </p>

          {/* Search Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runAudit(domainInput);
            }}
            className="pt-4 max-w-xl mx-auto"
          >
            <div className="relative flex items-center">
              <input
                type="text"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                placeholder="example.com or https://example.com"
                className="w-full pl-11 pr-28 py-3.5 rounded-2xl bg-white/[0.04] border border-white/10 hover:border-white/20 focus:border-cyan-400/60 focus:bg-white/[0.06] text-sm text-white placeholder:text-slate-500 font-mono transition shadow-2xl focus:outline-none"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-4 pointer-events-none" />
              <Button
                type="submit"
                variant="gradient"
                size="sm"
                disabled={loading}
                className="absolute right-2 text-xs font-semibold px-4 cursor-pointer"
              >
                {loading ? 'Scanning...' : 'Audit'}
              </Button>
            </div>

            {/* Quick target pills */}
            <div className="flex flex-wrap items-center justify-center gap-2 pt-3 text-xs text-slate-500 font-mono">
              <span>Try:</span>
              {QUICK_TARGETS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setDomainInput(t);
                    runAudit(t);
                  }}
                  className="px-2.5 py-0.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] text-slate-400 hover:text-cyan-300 border border-white/5 transition cursor-pointer"
                >
                  {t}
                </button>
              ))}
            </div>
          </form>

          {error && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs max-w-xl mx-auto">
              {error}
            </div>
          )}

          {unlockNotice && (
            <div
              role="status"
              className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/25 text-cyan-200 text-xs max-w-xl mx-auto"
            >
              {unlockNotice}
            </div>
          )}
        </div>

        {/* Empty state: show informative summary about what the audit checks */}
        {!report && !loading && (
          <div className="space-y-12 pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bento-card p-5 rounded-2xl space-y-2 border border-white/10">
                <div className="text-xs font-mono uppercase text-cyan-400 font-bold">1. Transport</div>
                <h3 className="text-base font-bold text-white">TLS &amp; HTTP Enforcement</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Checks that port 80 redirects to HTTPS, verifies TLS 1.3/1.2 availability, and verifies HSTS headers.
                </p>
              </div>

              <div className="bento-card p-5 rounded-2xl space-y-2 border border-white/10">
                <div className="text-xs font-mono uppercase text-indigo-400 font-bold">2. DNS</div>
                <h3 className="text-base font-bold text-white">Resolution &amp; Redundancy</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Queries public A, AAAA, CAA and TXT records. Flags single points of failure in nameservers.
                </p>
              </div>

              <div className="bento-card p-5 rounded-2xl space-y-2 border border-white/10">
                <div className="text-xs font-mono uppercase text-violet-400 font-bold">3. Policy</div>
                <h3 className="text-base font-bold text-white">Robots.txt &amp; Crawlers</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Parses declared rules for GPTBot, ClaudeBot, PerplexityBot and CCBot. Highlights conflicting wildcards.
                </p>
              </div>

              <div className="bento-card p-5 rounded-2xl space-y-2 border border-white/10">
                <div className="text-xs font-mono uppercase text-amber-400 font-bold">4. AI Surface &amp; Integrity</div>
                <h3 className="text-base font-bold text-white">Discovery &amp; Prompt-Injection Scan</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Verifies /llms.txt, .well-known/agent.json, sitemap.xml canonical locales, JSON-LD schema, and scans AI context files for prompt-injection and invisible Unicode smuggling.
                </p>
              </div>
            </div>

            {/* Fix & Forensic Pack: one-time, bound to one domain (D-1) */}
            <div className="bento-card p-6 sm:p-8 rounded-2xl border border-indigo-500/25 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-mono uppercase text-emerald-400 font-bold">
                    {FIX_PACK.label} · {FIX_PACK.starterPriceLabel} USD one-time per domain
                  </div>
                  <h3 className="text-xl sm:text-2xl font-bold text-white">
                    White-Label PDF Report, Cloudflare WAF Rule &amp; Worker
                  </h3>
                  <p className="text-xs text-slate-400 max-w-2xl">
                    The audit and its full report are free for the first {FREE_SCANS_PER_DOMAIN} scans of each domain. The {FIX_PACK.label} unlocks one domain: the ready-to-paste Cloudflare WAF rule, the Cloudflare Worker, the client-side RASP shield script, a live badge snippet and the 3-page White-Label A4 PDF Report, plus unlimited re-scans for {UNLOCK_DAYS} days. Pay once by card on Polar or with {DONATION_OPTIONS.stablecoinAmount} on-chain (<strong className="text-emerald-300">{FIX_PACK.starterPriceLabel} USD</strong>, no subscription).
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {domainInput.trim() ? (
                    <a
                      href={`/api/billing/polar/checkout?plan=starter_pass&domain=${encodeURIComponent(domainInput.trim())}`}
                      className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition shadow-lg shadow-blue-600/25"
                    >
                      Unlock the {FIX_PACK.label} ({FIX_PACK.starterPriceLabel})
                    </a>
                  ) : (
                    <span
                      aria-disabled="true"
                      title="Enter the domain to audit first: the Fix Pack is bound to it."
                      className="px-4 py-2 rounded-xl bg-blue-600/30 text-slate-300 text-xs font-bold cursor-not-allowed"
                    >
                      Enter a domain to unlock ({FIX_PACK.starterPriceLabel})
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-2">
                  <div className="text-[11px] font-mono text-cyan-400 font-semibold">
                    CLOUDFLARE WAF &amp; WORKER
                  </div>
                  <div className="text-sm font-bold text-white">
                    Wirefilter Rules &amp; Security Header Worker
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Blocks /.env, /.git, inbound Brotli RCE payloads (CVE-2026-111497), PHP2Shell probes (CVE-2026-109618), and injects strict HSTS, CSP Nonces, and CORP headers at the edge.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-2">
                  <div className="text-[11px] font-mono text-sky-400 font-semibold">
                    CLIENT-SIDE SHIELD &amp; BADGE
                  </div>
                  <div className="text-sm font-bold text-white">
                    RASP Shield Script &amp; Live Badge Snippet
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    A client-side script under 3KB that locks the page to your domain and traps hidden-field autofill scraping, plus a live badge snippet for your README or site.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-2">
                  <div className="text-[11px] font-mono text-amber-400 font-semibold">
                    EXECUTIVE &amp; TECHNICAL PDF
                  </div>
                  <div className="text-sm font-bold text-white">
                    3-Page White-Label A4 Security Report
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Export a board-ready A4 PDF report with your Executive Security Grade (A+ to F), OWASP Top 10:2025 compliance matrix, and prioritized remediation steps.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Report View */}
        {report && (
          <div className="space-y-8 animate-in fade-in duration-300">
            {/* Free Scan Quota Banner (Scans 1-3) or 4th Scan Hard Paywall Card */}
            {report.quota_locked ? (
              <div className="p-6 sm:p-8 rounded-2xl bg-gradient-to-br from-rose-950/60 via-slate-950 to-cyan-950/50 border-2 border-amber-500/60 shadow-2xl space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-300 text-xs font-mono font-bold uppercase">
                    <Lock className="w-3.5 h-3.5" />
                    Scan #{report.scan_quota?.used || FREE_SCANS_PER_DOMAIN + 1} Locked &middot; {FREE_SCANS_PER_DOMAIN} of {FREE_SCANS_PER_DOMAIN} Free Scans Used for {report.domain}
                  </span>
                  <span className="text-xs font-mono text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 rounded-full">
                    {report.scan_quota?.checks_evaluated || SCAN_CHECK_COUNT}/{SCAN_CHECK_COUNT} Controls Evaluated Just Now
                  </span>
                </div>

                <div className="space-y-2">
                  <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                    New results for <span className="text-cyan-300">{report.domain}</span> are locked
                  </h2>
                  <p className="text-sm text-slate-300 leading-relaxed max-w-3xl">
                    We just ran Scan #{report.scan_quota?.used || FREE_SCANS_PER_DOMAIN + 1} across your live perimeter{' '}
                    {report.scan_quota?.score_changed
                      ? 'and the results differ from your last free scan.'
                      : 'and the results match your last free scan.'}{' '}
                    The audit stays free, and you have used all {FREE_SCANS_PER_DOMAIN} free scans for <strong>{report.domain}</strong>. Unlock the domain for <strong>{FIX_PACK.starterPriceLabel} USD</strong> one-time to see the new results, re-scan without limits for {UNLOCK_DAYS} days while you ship your fixes, and get the {FIX_PACK.label} files.
                  </p>
                </div>

                {/* Score Transition Teaser Box */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl bg-black/60 border border-white/15">
                  <div className="p-3 rounded-lg bg-white/[0.03] border border-white/10">
                    <div className="text-[11px] font-mono uppercase text-slate-400">Previous Score (Scan #{FREE_SCANS_PER_DOMAIN})</div>
                    <div className="text-2xl font-black text-amber-300 font-mono mt-1">
                      {report.scan_quota?.previous_score ?? '—'}/100{' '}
                      <span className="text-sm text-slate-400">(Grade {report.scan_quota?.previous_grade ?? '—'})</span>
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-cyan-950/30 border border-cyan-500/30">
                    <div className="text-[11px] font-mono uppercase text-cyan-300">New Score (Scan #{report.scan_quota?.used || 4})</div>
                    <div className="text-2xl font-black text-white font-mono mt-1 flex items-center gap-2">
                      <span className="blur-[5px] select-none">••/100</span>
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-400/40">
                        LOCKED
                      </span>
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-emerald-950/25 border border-emerald-500/30">
                    <div className="text-[11px] font-mono uppercase text-emerald-300">Perimeter Delta</div>
                    <div className="text-sm font-bold text-white mt-1.5">
                      {report.scan_quota?.score_changed
                        ? 'Results changed since your last free scan. Unlock the domain to see the new score.'
                        : 'No change since your last free scan.'}
                    </div>
                  </div>
                </div>

                {/* Two views of the same one-time unlock: re-scans and Fix Pack files */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <a
                    href={`/api/billing/polar/checkout?plan=starter_pass&domain=${encodeURIComponent(report.domain)}`}
                    className="p-4 rounded-xl bg-gradient-to-r from-cyan-400 to-sky-400 hover:from-cyan-300 hover:to-sky-300 text-slate-950 font-bold flex flex-col justify-between gap-2 shadow-lg shadow-cyan-500/20 transition"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono uppercase tracking-wider bg-slate-950/15 px-2 py-0.5 rounded">
                        Includes &middot; Unlimited Re-Scans
                      </span>
                      <span className="text-xl font-black font-mono">{FIX_PACK.starterPriceLabel} USD</span>
                    </div>
                    <div className="text-base font-extrabold">
                      Unlock {report.domain} for {UNLOCK_DAYS} Days &rarr;
                    </div>
                    <div className="text-xs opacity-85 font-normal">
                      See your new score right away and run unlimited validation scans while you fix issues with Claude or Codex.
                    </div>
                  </a>

                  <a
                    href={`/api/billing/polar/checkout?plan=starter_pass&domain=${encodeURIComponent(report.domain)}`}
                    className="p-4 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-400 hover:from-emerald-300 hover:to-teal-300 text-slate-950 font-bold flex flex-col justify-between gap-2 shadow-lg shadow-emerald-500/20 transition"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono uppercase tracking-wider bg-slate-950/15 px-2 py-0.5 rounded">
                        Includes &middot; Fix Pack Files
                      </span>
                      <span className="text-xl font-black font-mono">
                        {FIX_PACK.starterPriceLabel} USD
                      </span>
                    </div>
                    <div className="text-base font-extrabold">
                      Get the {FIX_PACK.label} Files for {report.domain} &rarr;
                    </div>
                    <div className="text-xs opacity-85 font-normal">
                      The same one-time unlock: Cloudflare WAF rule, Cloudflare Worker, client-side RASP shield, live badge snippet, white-label PDF report, and unlimited re-scans.
                    </div>
                  </a>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs font-mono text-slate-400">
                  <span>Instant unlock after payment &middot; Pay by card on Polar or with {DONATION_OPTIONS.stablecoinAmount} on-chain.</span>
                  <button
                    type="button"
                    onClick={() => setIsUnlockModalOpen(true)}
                    className="text-cyan-300 hover:text-cyan-200 underline font-bold cursor-pointer"
                  >
                    Pay with Crypto ({DONATION_OPTIONS.stablecoinAmount}) &rarr;
                  </button>
                </div>
              </div>
            ) : (
              !isUnlocked &&
              report.scan_quota && (
                <div className="px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                  <div className="flex items-center gap-2 text-slate-300">
                    <span className="px-2 py-0.5 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-bold">
                      Free Scan {Math.min(report.scan_quota.used, report.scan_quota.free_limit)} of {report.scan_quota.free_limit}
                    </span>
                    <span>
                      {report.scan_quota.remaining > 0
                        ? `${report.scan_quota.remaining} free scan${report.scan_quota.remaining === 1 ? '' : 's'} remaining for ${report.domain} before new results lock.`
                        : `Final free scan used for ${report.domain}. New results stay locked until the domain is unlocked (${FIX_PACK.starterPriceLabel} one-time).`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsUnlockModalOpen(true)}
                    className="text-cyan-300 hover:text-cyan-200 font-bold underline cursor-pointer"
                  >
                    Unlock Unlimited Re-Scans ({FIX_PACK.starterPriceLabel}) &rarr;
                  </button>
                </div>
              )
            )}

            {/* Report Header Card */}
            <div className="bento-card p-6 rounded-2xl space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.08] pb-5">
                <div>
                  <div className="text-xs font-mono uppercase tracking-wider text-slate-500">
                    Readiness Report
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-white flex items-center gap-2.5">
                    <span>{report.domain}</span>
                    <span className="text-xs font-mono font-normal text-red-300 bg-red-500/10 border border-red-500/30 px-2 py-0.5 rounded-full">
                      Live Signals
                    </span>
                    {isUnlocked && (
                      <span className="text-xs font-mono font-semibold text-cyan-300 bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Zap className="w-3 h-3 text-cyan-400" />
                        Full Report
                      </span>
                    )}
                  </h2>
                  <div className="text-xs font-mono text-slate-400 mt-1">
                    Audited: {new Date(report.audited_at).toUTCString()}
                  </div>
                </div>

                {/* Actions Toolbar */}
                <div className="flex flex-wrap items-center gap-2 print:hidden">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      if (!isUnlocked) {
                        setIsUnlockModalOpen(true);
                        return;
                      }
                      void handleGenerateEdgeShield();
                    }}
                    disabled={generatingEdgeShield}
                    className="text-xs cursor-pointer border-cyan-500/30"
                    leftIcon={isUnlocked ? <Shield className="w-3.5 h-3.5 text-cyan-400" /> : <Lock className="w-3.5 h-3.5 text-cyan-400" />}
                  >
                    {generatingEdgeShield ? 'Synthesizing...' : 'Edge Worker & WAF Rule'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleExportJson}
                    className="text-xs"
                    leftIcon={isUnlocked ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5 text-cyan-400" />}
                  >
                    JSON
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleExportMarkdown}
                    className="text-xs"
                    leftIcon={isUnlocked ? <FileText className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5 text-cyan-400" />}
                  >
                    Markdown
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handlePrint}
                    className="text-xs"
                    leftIcon={isUnlocked ? <Printer className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5 text-cyan-400" />}
                  >
                    Print PDF
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runAudit(report.domain)}
                    className="text-xs"
                    leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                  >
                    Re-audit
                  </Button>
                </div>
              </div>

              {generatorError && (
                <div
                  role="alert"
                  className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex flex-wrap items-center justify-between gap-3 print:hidden"
                >
                  <span>{generatorError}</span>
                  <button
                    type="button"
                    onClick={() => setGeneratorError(null)}
                    className="text-[11px] font-mono text-rose-200 hover:text-white cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {fixPackDeliverables && (
                <div className="p-5 rounded-2xl bg-sky-950/20 border border-sky-500/30 space-y-4 print:hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-mono uppercase text-sky-400 font-bold">
                        {FIX_PACK.label} v5.1 · Active Shield Deliverables for {report.domain}
                      </div>
                      <p className="text-xs text-slate-300">
                        Cloudflare Active Edge Worker v5.1 (JA4 Session Binding, Node2Shell Brotli Guard, Weaponized PDF CDR, Anti-SSRF IPv4/IPv6 &amp; SonicWall/Cisco/Ivanti 48h Gate), Client-Side RASP Shield (&lt;3KB), WAF custom rule, and Live SVG Trust Badge.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="text-xs cursor-pointer"
                        onClick={() =>
                          downloadFile(
                            'stealthmark-worker-v5.1.js',
                            fixPackDeliverables.cloudflare_worker_code,
                            'application/javascript'
                          )
                        }
                      >
                        <Download className="w-3.5 h-3.5 mr-1.5" />
                        Download Worker v5.1.js
                      </Button>
                      {fixPackDeliverables.client_rasp_shield_js && (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="text-xs cursor-pointer border-emerald-500/30 text-emerald-300"
                          onClick={() =>
                            downloadFile(
                              'stealthmark-client-shield.js',
                              fixPackDeliverables.client_rasp_shield_js || '',
                              'application/javascript'
                            )
                          }
                        >
                          <Download className="w-3.5 h-3.5 mr-1.5" />
                          Download Client-RASP.js (&lt;3KB)
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        className="text-xs cursor-pointer"
                        onClick={() =>
                          downloadFile(
                            'cloudflare-waf-rule.txt',
                            `${fixPackDeliverables.cloudflare_visual_waf_rule}\n`,
                            'text/plain'
                          )
                        }
                      >
                        <Download className="w-3.5 h-3.5 mr-1.5" />
                        Download WAF Rule
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {generatedArtifacts && (
                <div className="p-5 rounded-2xl bg-sky-950/20 border border-sky-500/30 space-y-4 print:hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-mono uppercase text-sky-400 font-bold">
                        Generated AI Discovery Artifacts
                      </div>
                      <p className="text-xs text-slate-300">
                        Ready-to-publish <code className="text-sky-300 font-mono">/llms.txt</code> and{' '}
                        <code className="text-sky-300 font-mono">/.well-known/agent.json</code> synthesized for {report.domain}.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="text-xs cursor-pointer"
                        onClick={() =>
                          downloadFile('llms.txt', generatedArtifacts.llms_txt, 'text/markdown')
                        }
                      >
                        <Download className="w-3.5 h-3.5 mr-1.5" />
                        Download llms.txt
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="text-xs cursor-pointer"
                        onClick={() =>
                          downloadFile(
                            'agent.json',
                            JSON.stringify(generatedArtifacts.agent_json, null, 2),
                            'application/json'
                          )
                        }
                      >
                        <Download className="w-3.5 h-3.5 mr-1.5" />
                        Download agent.json
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {generatedEdgeShield && (
                <div className="p-5 rounded-2xl bg-cyan-950/20 border border-cyan-500/30 space-y-4 print:hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-mono uppercase text-cyan-400 font-bold">
                        Generated Edge Worker &amp; Cloudflare Rule
                      </div>
                      <p className="text-xs text-slate-300">
                        Blocks <code className="text-cyan-300 font-mono">tlm-scanner</code>,{' '}
                        <code className="text-cyan-300 font-mono">/.env</code>,{' '}
                        <code className="text-cyan-300 font-mono">/.git</code> &amp; enforces DMARC for {report.domain}.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="text-xs cursor-pointer"
                        onClick={() =>
                          downloadFile(
                            'stealthmark-edge-worker.js',
                            generatedEdgeShield.cloudflare_worker_js,
                            'application/javascript'
                          )
                        }
                      >
                        <Download className="w-3.5 h-3.5 mr-1.5" />
                        Download Worker.js
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="text-xs cursor-pointer"
                        onClick={() =>
                          downloadFile(
                            'cloudflare-waf-rule.txt',
                            `${generatedEdgeShield.cloudflare_waf_expression}\n\n# DNS DMARC Record:\n${generatedEdgeShield.dmarc_dns_record}\n`,
                            'text/plain'
                          )
                        }
                      >
                        <Download className="w-3.5 h-3.5 mr-1.5" />
                        Download WAF + DMARC
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Sample / Free Mode Banner with Live Forensic Evidence + 1-Click Polar/Crypto Checkout */}
              {!isUnlocked && (
                <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-red-950/30 via-[#0a0d14] to-blue-950/40 border border-red-500/25 space-y-4">
                  {/* Live Forensic Verification & Blurred Fix Snippet on Target Domain */}
                  <div className="p-4 rounded-xl bg-black/75 border border-rose-500/35 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                        <span className="text-xs font-mono font-bold text-rose-300 uppercase">
                          🚨 Live Perimeter Exposure Verified on {report.domain} ({(report.summary?.counts?.warn || 0) + (report.summary?.counts?.fail || 0)} Exposed Controls)
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-400">
                        Verify yourself: <code className="text-cyan-300">curl -sI https://{report.domain}</code>
                      </span>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-[11px] font-mono">
                      <div className="p-3 rounded-lg bg-rose-950/25 border border-rose-500/25 text-rose-200 space-y-1">
                        <div className="text-[10px] uppercase text-rose-400 font-bold">1. High-Severity Exploit Classes the Fix Pack Guards Against:</div>
                        <div>• Evilginx2 / Modlishka AiTM Session Cookie Hijacking (Missing JA4 TLS Binding)</div>
                        <div>• Node2Shell Brotli RCE (CVE-2026-111497) &amp; Cloud Metadata SSRF (169.254.169.254 / fd00:ec2::254)</div>
                        <div>• Weaponized PDF / Prompt-Injection Surface &amp; Redacted OWASP 2025 Failures</div>
                      </div>
                      <div className="p-3 rounded-lg bg-emerald-950/25 border border-emerald-500/25 text-emerald-200 space-y-1 relative overflow-hidden">
                        <div className="text-[10px] uppercase text-emerald-400 font-bold">2. Ready-to-Paste Grade A+ v5.1 Fix Bundle for {report.domain}:</div>
                        <div className="text-slate-300">
                          _dmarc.{report.domain}. IN TXT &quot;v=DMARC1; p=reject; rua=mailto:dmarc@{report.domain}&quot;
                        </div>
                        <div className="blur-[3px] select-none text-slate-400">
                          stealthmark-worker-v5.1.js: JA4 Session Bind + Node2Shell 415 Guard + Static PDF CDR + SSRF Pin...
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5 pt-1">
                      <a
                        href={`/api/billing/polar/checkout?plan=starter_pass&domain=${encodeURIComponent(report.domain)}${leadEmail.includes('@') ? `&email=${encodeURIComponent(leadEmail.trim())}` : ''}`}
                        className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-400 via-cyan-400 to-sky-400 hover:from-emerald-300 hover:to-sky-300 text-slate-950 text-xs font-extrabold transition shadow-lg shadow-emerald-500/20"
                      >
                        ⚡ Unlock the {FIX_PACK.label} + {UNLOCK_DAYS} Days of Re-Scans ({FIX_PACK.starterPriceLabel})
                      </a>
                      <button
                        type="button"
                        onClick={() => setIsUnlockModalOpen(true)}
                        className="px-3.5 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/40 text-amber-200 text-xs font-mono font-bold transition cursor-pointer"
                      >
                        ⛓️ Pay w/ Crypto ({DONATION_OPTIONS.stablecoinAmount})
                      </button>
                    </div>
                  </div>

                  {/* One-time Fix Pack price strip */}
                  <div className="p-3 rounded-xl bg-emerald-950/50 border border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="text-xs font-mono text-emerald-200">
                      <strong className="text-emerald-300 uppercase">One-time per domain:</strong>{' '}
                      the full {FIX_PACK.label} + Grade A+ Claude/Cursor Blueprint for{' '}
                      <strong className="text-white">{FIX_PACK.starterPriceLabel} USD</strong>, with unlimited re-scans for {UNLOCK_DAYS} days.
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsUnlockModalOpen(true)}
                      className="text-[11px] font-mono font-bold text-emerald-300 hover:text-white underline underline-offset-2 shrink-0 cursor-pointer"
                    >
                      Unlock ({FIX_PACK.starterPriceLabel}) &rarr;
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="danger" className="uppercase font-mono text-[9px] bg-red-500/10 text-red-300 border-red-500/30">
                          {teaserUnlocked ? 'Radar Active ✓' : `Red Team Recon · ${SCAN_CHECK_COUNT}-Point Passive Audit`}
                        </Badge>
                        <span className="text-xs font-mono text-red-200">
                          {teaserUnlocked
                            ? `Passive port & CVE alerts enabled for ${report.domain}`
                            : `New results for ${report.domain} are locked · ${FIX_PACK.starterPriceLabel} one-time unlocks them, plus the A+ blueprint and the ${FIX_PACK.label} files`}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 max-w-xl">
                        The first {FREE_SCANS_PER_DOMAIN} scans of each domain show the full report, with every fix recommendation, for free. Unlocking <strong>{report.domain}</strong> with the {FIX_PACK.label} (<strong className="text-emerald-300">{FIX_PACK.starterPriceLabel} USD</strong> one-time) shows the new results and adds the exact header/DNS configurations, Cursor/Claude A+ prompts, the Cloudflare WAF rule and Worker, and the 3-page White-Label PDF.
                      </p>
                      <ul className="text-[11px] text-slate-400 space-y-0.5 max-w-xl">
                        <li><span className="text-cyan-300 font-mono">Devs:</span> exact Grade A+ configuration + Cursor/Claude fix prompt per control, and a signed README badge.</li>
                        <li><span className="text-cyan-300 font-mono">Agencies:</span> a 3-page white-label PDF for your client, plus a Cloudflare WAF rule and Worker to ship.</li>
                      </ul>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <a
                        href={`/api/billing/polar/checkout?plan=starter_pass&domain=${encodeURIComponent(report.domain)}`}
                        className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-400 via-sky-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 text-xs font-extrabold transition shadow-lg shadow-cyan-500/25"
                      >
                        Unlock New Results + {FIX_PACK.label} ({FIX_PACK.starterPriceLabel})
                      </a>
                      <span className="text-[10px] font-mono text-emerald-300">
                        One-time per domain · no subscription
                      </span>
                    </div>
                  </div>

                  {!teaserUnlocked && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        submitLeadEmail(report);
                      }}
                      className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-white/10"
                    >
                      <input
                        type="email"
                        required
                        value={leadEmail}
                        onChange={(e) => setLeadEmail(e.target.value)}
                        placeholder="secops@company.com — Activate free Shodan port & CVE radar alerts"
                        className="flex-1 px-3.5 py-2 rounded-xl bg-black/60 border border-cyan-500/30 text-xs text-white placeholder:text-slate-500 font-mono focus:outline-none focus:border-cyan-400"
                      />
                      <Button
                        type="submit"
                        variant="secondary"
                        size="sm"
                        disabled={revealingEmail}
                        className="text-xs font-mono border-cyan-500/40 text-cyan-300 cursor-pointer"
                      >
                        Get Free Port &amp; CVE Alerts →
                      </Button>
                    </form>
                  )}
                  {!teaserUnlocked && leadError && (
                    <p role="alert" className="text-[11px] text-rose-300">
                      {leadError}
                    </p>
                  )}
                  {!teaserUnlocked && (
                    <p className="text-[11px] text-slate-500">
                      Alerts and one follow-up email come from StealthMark Security Team &lt;security@stealthmark.io&gt;. Unsubscribe anytime.
                    </p>
                  )}
                </div>
              )}

              {/* Executive Grade Scorecard & 3 Security Pillars */}
              {(() => {
                const sc = computeExecutiveScorecard(report);
                const gradeColors: Record<string, string> = {
                  'A+': 'from-emerald-500/25 to-cyan-500/15 text-emerald-300 border-emerald-500/40',
                  A: 'from-sky-500/20 to-blue-500/10 text-sky-300 border-sky-500/35',
                  B: 'from-cyan-500/20 to-indigo-500/15 text-cyan-300 border-cyan-500/35',
                  C: 'from-amber-500/20 to-orange-500/15 text-amber-300 border-amber-500/35',
                  D: 'from-rose-500/20 to-amber-500/15 text-rose-300 border-rose-500/35',
                  F: 'from-rose-600/30 to-rose-950/40 text-rose-300 border-rose-500/50',
                };
                return (
                  <div className="p-4 sm:p-5 rounded-2xl bg-black/50 border border-white/10 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div
                          className={`w-16 h-16 rounded-2xl bg-gradient-to-br border flex items-center justify-center text-2xl font-extrabold font-mono shadow-lg ${
                            gradeColors[sc.grade] || gradeColors.B
                          }`}
                        >
                          {sc.grade}
                        </div>
                        <div>
                          <div className="text-[11px] font-mono uppercase tracking-wider text-cyan-400">
                            Executive Perimeter &amp; AI Readiness Grade
                          </div>
                          <div className="text-base sm:text-lg font-extrabold text-white">
                            {sc.label}
                          </div>
                          {sc.capReason && (
                            <div className="text-xs text-rose-300 font-mono mt-0.5">
                              ⚠️ {sc.capReason}
                            </div>
                          )}
                        </div>
                      </div>
                      {sc.grade === 'A+' || sc.grade === 'A' ? (
                        <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
                        {report.badge && (
                          <button
                            type="button"
                            onClick={() => {
                              if (!report.badge) return;
                              const mdBadge = `[![StealthMark Security Audit](https://stealthmark.io/api/badge/${encodeURIComponent(
                                report.domain
                              )}.svg)](https://stealthmark.io/verify/${encodeURIComponent(
                                report.domain
                              )}?utm_source=trust_badge)`;
                              navigator.clipboard.writeText(mdBadge);
                              setCopiedBadge(true);
                              setTimeout(() => setCopiedBadge(false), 2500);
                            }}
                            className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-cyan-500/30 text-xs font-mono text-cyan-300 flex items-center gap-1.5 cursor-pointer self-start sm:self-center"
                          >
                            {copiedBadge ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{copiedBadge ? 'Live SVG Badge Copied!' : `Copy "${report.badge.grade} Live SVG" Badge`}</span>
                          </button>
                        )}
                          <Link
                            href={`/verify/${encodeURIComponent(report.domain)}`}
                            className="px-3 py-2 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-xs font-mono text-cyan-300 flex items-center gap-1.5"
                          >
                            Live Certificate →
                          </Link>
                          <Link
                            href={`/leaderboard?domain=${encodeURIComponent(report.domain)}#claim`}
                            className="px-3 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-xs font-mono text-emerald-300 flex items-center gap-1.5"
                          >
                            Claim your Hall of Fame spot →
                          </Link>
                        </div>
                      ) : (
                        <a
                          href={`/api/billing/polar/checkout?plan=starter_pass&domain=${encodeURIComponent(report.domain)}`}
                          className="px-3.5 py-2 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-xs font-mono font-bold text-sky-300 flex items-center gap-1.5 self-start sm:self-center transition"
                        >
                          <Zap className="w-3.5 h-3.5 text-sky-400" />
                          <span>Get the Fixes ({FIX_PACK.starterPriceLabel}) · Badge unlocks at grade A →</span>
                        </a>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-white/10">
                      <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between">
                        <div>
                          <div className="text-[10px] font-mono uppercase text-slate-400">
                            1. Infrastructure, Ports &amp; DNS
                          </div>
                          <div className="text-xs font-bold text-white font-mono mt-0.5">
                            {sc.pillars.infrastructure.pass} Pass · {sc.pillars.infrastructure.issues} Issues
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                            sc.pillars.infrastructure.status === 'OPTIMAL'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : sc.pillars.infrastructure.status === 'WARNING'
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-rose-500/20 text-rose-300'
                          }`}
                        >
                          {sc.pillars.infrastructure.status}
                        </span>
                      </div>

                      <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between">
                        <div>
                          <div className="text-[10px] font-mono uppercase text-slate-400">
                            2. Web, PHP/CMS &amp; Headers
                          </div>
                          <div className="text-xs font-bold text-white font-mono mt-0.5">
                            {sc.pillars.web_runtime.pass} Pass · {sc.pillars.web_runtime.issues} Issues
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                            sc.pillars.web_runtime.status === 'OPTIMAL'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : sc.pillars.web_runtime.status === 'WARNING'
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-rose-500/20 text-rose-300'
                          }`}
                        >
                          {sc.pillars.web_runtime.status}
                        </span>
                      </div>

                      <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between">
                        <div>
                          <div className="text-[10px] font-mono uppercase text-slate-400">
                            3. AI Agents, MCP &amp; x402
                          </div>
                          <div className="text-xs font-bold text-white font-mono mt-0.5">
                            {sc.pillars.ai_governance.pass} Pass · {sc.pillars.ai_governance.issues} Issues
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                            sc.pillars.ai_governance.status === 'OPTIMAL'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : sc.pillars.ai_governance.status === 'WARNING'
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-rose-500/20 text-rose-300'
                          }`}
                        >
                          {sc.pillars.ai_governance.status}
                        </span>
                      </div>
                    </div>

                    {/* Strategy 3 + 2 + 5: Public Certificate Pressure (/verify/[domain]) + Agency White-Label Arbitrage + 14-Day Drift Trial */}
                    {sc.grade !== 'A+' && sc.grade !== 'A' && !isUnlocked && (
                      <div className="mt-3 p-4 rounded-xl bg-gradient-to-r from-rose-950/40 via-[#0B101E] to-emerald-950/30 border border-rose-500/35 space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-500/30 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-mono font-bold uppercase text-rose-300">
                                🔴 Current Public Status: /verify/{report.domain}
                              </span>
                              <Link
                                href={`/verify/${encodeURIComponent(report.domain)}`}
                                className="text-[10px] font-mono text-rose-300 underline hover:text-white"
                              >
                                View Public Page →
                              </Link>
                            </div>
                            <p className="text-xs text-slate-300">
                              Public certificate currently displays <strong className="text-rose-300">GRADE {sc.grade} · UNVERIFIED PERIMETER</strong> (missing JA4 TLS Session Cookie Binding &amp; &lt;3KB Client RASP).
                            </p>
                          </div>

                          <div className="p-3 rounded-lg bg-emerald-950/25 border border-emerald-500/30 space-y-1.5 flex flex-col justify-between">
                            <div>
                              <div className="text-[10px] font-mono font-bold uppercase text-emerald-300">
                                🟢 After Deploying the {FIX_PACK.label} ({FIX_PACK.starterPriceLabel})
                              </div>
                              <p className="text-xs text-slate-300 mt-1">
                                Unlocks <strong className="text-white">Cloudflare JA4 Worker + WAF Rule + &lt;3KB Client RASP + Live Badge Snippet + 3-Page White-Label PDF</strong>.
                              </p>
                            </div>
                            <div className="pt-1">
                              <a
                                href={`/api/billing/polar/checkout?plan=starter_pass&domain=${encodeURIComponent(report.domain)}`}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-mono font-bold transition"
                              >
                                <Zap className="w-3.5 h-3.5" />
                                <span>Unlock Fix Pack &amp; Turn Badge Green ({FIX_PACK.starterPriceLabel}) →</span>
                              </a>
                            </div>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] font-mono text-slate-300">
                          <span>
                            💼 <strong className="text-cyan-300">Agencies &amp; Freelance Pentesters:</strong> Resell the 3-Page White-Label A4 PDF + Worker to your clients, or share <code className="text-emerald-300">?ref=your_0x_wallet</code> to have a <strong>30% commission recorded</strong>, not paid out automatically.
                          </span>
                          <Link href="/.cursorrules" className="text-cyan-400 hover:underline shrink-0">
                            Get .cursorrules &amp; MCP →
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Enterprise Security & WAF Hardening Bridge (/enterprise) */}
              <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-indigo-950/50 via-purple-950/30 to-black border border-indigo-500/35 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="purple" className="uppercase font-mono text-[9px]">
                      Enterprise Perimeter &amp; Cloud WAF Hardening
                    </Badge>
                    <span className="text-xs font-mono text-indigo-300">
                      Need custom Red-Team verification for {report.domain}?
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 max-w-xl">
                    Engage our security engineering team to audit multi-subdomain infrastructure, API endpoints, and Cloud Armor / Cloudflare WAF policies for <strong>{report.domain}</strong> with hands-on remediation verification.
                  </p>
                </div>
                <Link
                  href="/enterprise"
                  className="shrink-0"
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    className="text-xs font-semibold border-indigo-500/40 text-indigo-200 hover:text-white cursor-pointer"
                  >
                    <span>Request Enterprise Assessment</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                  </Button>
                </Link>
              </div>

              {/* Counts Grid (Zero Arbitrary Score) */}
              <div>
                <div className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">
                  Observable Findings Count
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-between">
                    <div>
                      <div className="text-[11px] font-mono uppercase text-emerald-400">Pass</div>
                      <div className="text-2xl font-extrabold text-emerald-300 font-mono">
                        {report.summary.counts.pass}
                      </div>
                    </div>
                    <CheckCircle2 className="w-6 h-6 text-emerald-400/80" />
                  </div>

                  <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between">
                    <div>
                      <div className="text-[11px] font-mono uppercase text-amber-400">Warnings</div>
                      <div className="text-2xl font-extrabold text-amber-300 font-mono">
                        {report.summary.counts.warn}
                      </div>
                    </div>
                    <AlertTriangle className="w-6 h-6 text-amber-400/80" />
                  </div>

                  <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-center justify-between">
                    <div>
                      <div className="text-[11px] font-mono uppercase text-rose-400">Failures</div>
                      <div className="text-2xl font-extrabold text-rose-300 font-mono">
                        {report.summary.counts.fail}
                      </div>
                    </div>
                    <XCircle className="w-6 h-6 text-rose-400/80" />
                  </div>

                  <div className="p-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-between">
                    <div>
                      <div className="text-[11px] font-mono uppercase text-cyan-400">Informational</div>
                      <div className="text-2xl font-extrabold text-cyan-300 font-mono">
                        {report.summary.counts.info}
                      </div>
                    </div>
                    <Info className="w-6 h-6 text-cyan-400/80" />
                  </div>
                </div>
              </div>

              {/* Honesty Banner */}
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] flex items-start gap-3">
                <Shield className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-400 leading-relaxed space-y-1">
                  <div className="font-semibold text-slate-200">
                    Strictly Objective &amp; Passive Measurement
                  </div>
                  <div>
                    This audit records only what was observed on public networks: DNS records, HTTP
                    status and headers, /robots.txt, and manifests. No synthetic 0–100 score is
                    assigned.
                  </div>
                </div>
              </div>
            </div>

            {/* Section Filter & Tabs */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
                {/* Tabs */}
                <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                  <button
                    onClick={() => setActiveTab('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      activeTab === 'all'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    All Sections
                  </button>
                  {Object.entries(SECTION_TITLES).map(([key, meta]) => (
                    <button
                      key={key}
                      onClick={() => setActiveTab(key)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        activeTab === key
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {meta.title}
                    </button>
                  ))}
                </div>

                {/* Status filter */}
                <div className="flex items-center gap-1 p-1 rounded-lg bg-white/[0.03] border border-white/[0.08]">
                  <button
                    onClick={() => setStatusFilter('all')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer ${
                      statusFilter === 'all'
                        ? 'bg-white/10 text-white font-semibold'
                        : 'text-slate-400 hover:text-slate-300'
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setStatusFilter('issues')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer ${
                      statusFilter === 'issues'
                        ? 'bg-rose-500/20 text-rose-300 font-semibold'
                        : 'text-slate-400 hover:text-slate-300'
                    }`}
                  >
                    Issues Only
                  </button>
                  <button
                    onClick={() => setStatusFilter('passes')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer ${
                      statusFilter === 'passes'
                        ? 'bg-emerald-500/20 text-emerald-300 font-semibold'
                        : 'text-slate-400 hover:text-slate-300'
                    }`}
                  >
                    Passes
                  </button>
                </div>
              </div>

              {/* Sections Breakdown */}
              <div ref={findingsRef} className="space-y-6">
                {currentSections.map(([secKey, items]) => {
                  const meta = SECTION_TITLES[secKey] || {
                    title: secKey,
                    desc: '',
                  };
                  const filteredItems = items.filter((item) => {
                    if (statusFilter === 'issues') return item.status === 'warn' || item.status === 'fail' || item.status === 'error';
                    if (statusFilter === 'passes') return item.status === 'pass';
                    return true;
                  });

                  if (filteredItems.length === 0 && statusFilter !== 'all') {
                    return null;
                  }

                  const secCounts = report.summary.by_section[secKey] || {
                    pass: 0,
                    warn: 0,
                    fail: 0,
                    info: 0,
                    error: 0,
                  };

                  return (
                    <div key={secKey} className="bento-card p-6 rounded-2xl space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
                        <div>
                          <h3 className="text-lg font-bold text-white">{meta.title}</h3>
                          <p className="text-xs text-slate-400">{meta.desc}</p>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] font-mono">
                          {secCounts.pass > 0 && (
                            <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                              {secCounts.pass} pass
                            </span>
                          )}
                          {secCounts.warn > 0 && (
                            <span className="text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
                              {secCounts.warn} warn
                            </span>
                          )}
                          {secCounts.fail > 0 && (
                            <span className="text-red-400 bg-red-500/10 px-2 py-0.5 rounded">
                              {secCounts.fail} fail
                            </span>
                          )}
                          {secCounts.info > 0 && (
                            <span className="text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded">
                              {secCounts.info} info
                            </span>
                          )}
                          {(secCounts.not_assessed ?? 0) > 0 && (
                            <span className="text-slate-400 bg-white/5 px-2 py-0.5 rounded">
                              {secCounts.not_assessed} not assessed
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3">
                        {filteredItems.map((item) => {
                          const isIssue =
                            item.status === 'warn' ||
                            item.status === 'fail' ||
                            item.status === 'error';
                          const isItemLocked = item.locked === true;

                          if (isItemLocked) {
                            return (
                              <div
                                key={item.id}
                                className="p-4 rounded-xl bg-red-500/[0.03] border border-red-500/25 space-y-2 relative overflow-hidden"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <Lock className="w-4 h-4 text-red-400 shrink-0" />
                                    <span className="text-sm font-semibold text-slate-200">{item.title}</span>
                                    {item.owaspGate ? (
                                      <span
                                        title={item.owaspGate.label.en}
                                        className="shrink-0 whitespace-nowrap font-mono text-[10px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded"
                                      >
                                        OWASP {item.owaspGate.code}
                                      </span>
                                    ) : (
                                      <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded">
                                        {meta.title}
                                      </span>
                                    )}
                                  </div>
                                  <Badge
                                    variant={statusBadgeVariant[item.status] || 'neutral'}
                                    size="sm"
                                    className="uppercase font-mono text-[10px]"
                                  >
                                    {statusLabel(item.status)}
                                  </Badge>
                                </div>

                                <div className="pl-6 pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                  <p className="text-xs text-slate-400 italic">{item.detail}</p>
                                  {item.emailGate ? (
                                    <div className="flex flex-col gap-1 shrink-0 sm:max-w-sm">
                                      <form
                                        onSubmit={(e) => {
                                          e.preventDefault();
                                          submitLeadEmail(report);
                                        }}
                                        className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0"
                                      >
                                        <input
                                          type="email"
                                          required
                                          aria-label="Work email"
                                          value={leadEmail}
                                          onChange={(e) => setLeadEmail(e.target.value)}
                                          placeholder="you@company.com"
                                          className="w-full sm:w-52 h-7 px-2.5 rounded-lg bg-black/60 border border-red-500/40 text-[11px] text-white placeholder:text-slate-500 font-mono focus:outline-none focus:border-cyan-400"
                                        />
                                        <Button
                                          type="submit"
                                          size="sm"
                                          variant="secondary"
                                          disabled={revealingEmail}
                                          className="text-[11px] h-7 px-3 shrink-0 cursor-pointer border-red-500/40 text-red-200"
                                        >
                                          Reveal 3rd Exposure + Free Radar →
                                        </Button>
                                      </form>
                                      {leadError && (
                                        <p role="alert" className="text-[10px] text-rose-300">
                                          {leadError}
                                        </p>
                                      )}
                                      <p className="text-[10px] text-slate-500">
                                        Alerts and one follow-up email come from StealthMark Security Team &lt;security@stealthmark.io&gt;. Unsubscribe anytime.
                                      </p>
                                    </div>
                                  ) : (
                                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                      <a
                                        href={`/api/billing/polar/checkout?plan=starter_pass&domain=${encodeURIComponent(report.domain)}`}
                                        className="inline-flex items-center shrink-0 h-7 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold transition"
                                      >
                                        <Zap className="w-3 h-3 mr-1" />
                                        Card Checkout ({FIX_PACK.starterPriceLabel})
                                      </a>
                                      <button
                                        type="button"
                                        onClick={() => setIsUnlockModalOpen(true)}
                                        className="inline-flex items-center shrink-0 h-7 px-2.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-[11px] font-mono font-bold transition cursor-pointer"
                                      >
                                        💎 Pay w/ Crypto ({DONATION_OPTIONS.stablecoinAmount})
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div
                              key={item.id}
                              className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] space-y-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  {statusIcons[item.status] || statusIcons.info}
                                  <span className="text-sm font-semibold text-slate-200">
                                    {item.title}
                                  </span>
                                  {item.owaspGate && (
                                    <span
                                      title={item.owaspGate.label.en}
                                      className="shrink-0 whitespace-nowrap font-mono text-[10px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded"
                                    >
                                      OWASP {item.owaspGate.code}
                                    </span>
                                  )}
                                </div>
                                <Badge
                                  variant={statusBadgeVariant[item.status] || 'neutral'}
                                  size="sm"
                                  className="uppercase font-mono text-[10px]"
                                >
                                  {statusLabel(item.status)}
                                </Badge>
                              </div>

                              <div className="pl-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <p className="text-xs text-slate-400 leading-relaxed">
                                  {item.detail}
                                </p>
                                {!isUnlocked && !isIssue && (
                                  <button
                                    type="button"
                                    onClick={() => setIsUnlockModalOpen(true)}
                                    className="px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-cyan-500/15 border border-cyan-500/30 text-[10px] font-mono font-semibold text-cyan-300 flex items-center gap-1.5 shrink-0 cursor-pointer transition"
                                  >
                                    <Lock className="w-3 h-3 text-cyan-400" />
                                    <span>Unlock Exact A+ Config ({FIX_PACK.starterPriceLabel})</span>
                                  </button>
                                )}
                              </div>

                              {item.recommendation && (
                                <div className="ml-6 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-sky-200 space-y-2.5">
                                  <div>
                                    <span className="font-semibold text-sky-300">
                                      Recommendation:{' '}
                                    </span>
                                    <span>{item.recommendation}</span>
                                  </div>
                                  {isIssue && (
                                    <div className="flex flex-wrap items-center gap-2 pt-1">
                                      {isUnlocked || item.freeFix ? (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const promptText = buildAiFixPrompt(report.domain, item);
                                            navigator.clipboard.writeText(promptText);
                                            setCopiedPromptId(item.id);
                                            setTimeout(() => setCopiedPromptId(null), 2500);
                                          }}
                                          className="px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/35 text-[11px] font-mono font-semibold text-cyan-300 flex items-center gap-1.5 cursor-pointer"
                                        >
                                          {copiedPromptId === item.id ? (
                                            <Check className="w-3 h-3 text-emerald-400" />
                                          ) : (
                                            <Copy className="w-3 h-3" />
                                          )}
                                          <span>
                                            {copiedPromptId === item.id
                                              ? 'AI Fix Prompt Copied!'
                                              : '✨ Copy AI Fix Prompt (Cursor / Claude)'}
                                          </span>
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => setIsUnlockModalOpen(true)}
                                          className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-cyan-500/35 text-[11px] font-mono font-semibold text-cyan-300 flex items-center gap-1.5 cursor-pointer"
                                        >
                                          <Lock className="w-3 h-3 text-cyan-400" />
                                          <span>Unlock Fix &amp; ✨ Cursor/Claude Prompt ({FIX_PACK.starterPriceLabel})</span>
                                        </button>
                                      )}
                                      {!isUnlocked && item.freeFix && (
                                        <span className="text-[10px] font-mono text-emerald-300">
                                          1st fix on the house · the rest in the {FIX_PACK.label} ({FIX_PACK.starterPriceLabel})
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <EnterpriseForensicCard />
      </main>

      {report?.unlocked === true && (
        <WhiteLabelPdfReport report={report} visualWafRule={fixPackDeliverables?.cloudflare_visual_waf_rule} />
      )}

      {/* Unlock Modal */}
      <ScanUnlockModal
        isOpen={isUnlockModalOpen}
        onClose={() => setIsUnlockModalOpen(false)}
        initialEmail={leadEmail}
        onUnlocked={(token, deliverables) => {
          // Same path as a Polar return: the audit reads the stored token and shows the deliverables once it accepts it.
          const target = report?.domain || domainInput;
          if (!target) return;
          storeUnlock(target, { token, deliverables: parseDeliverables(deliverables) });
          runAudit(target, undefined, undefined, 'checkout_return');
        }}
        targetDomain={report?.domain || domainInput}
      />


      <div className="print:hidden">
        <Footer />
      </div>
    </div>
  );
}

export default function ScanPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#060709] text-slate-100 flex items-center justify-center font-mono text-sm text-cyan-400">
          Loading Web &amp; AI-Surface Auditor...
        </div>
      }
    >
      <ScanPageContent />
    </Suspense>
  );
}
