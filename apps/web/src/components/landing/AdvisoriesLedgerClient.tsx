'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Lock,
  Shield,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import {
  COORDINATED_DISCLOSURES,
  DISCLOSURE_METRICS,
  PRE_DISCLOSURE_QUEUE,
  PUBLIC_ADVISORIES,
  type AdvisoryBadgeColor,
  type DisclosurePlatform,
} from '@/lib/community-findings';
import { GITHUB_ORG_URL, LINKEDIN_COMPANY_URL, LINKEDIN_FOUNDER_URL } from '@/lib/site';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';

type FilterTab = 'ALL' | 'PUBLIC' | DisclosurePlatform | 'QUEUE';

const BADGE_CLASSES: Record<AdvisoryBadgeColor, string> = {
  emerald: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
  cyan: 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300',
  indigo: 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300',
  amber: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
  rose: 'bg-rose-500/15 border-rose-500/30 text-rose-300',
};

const PLATFORM_STYLES: Record<DisclosurePlatform, string> = {
  'Maya Protocol': 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
  HackerOne: 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300',
  Bugcrowd: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
};

function StageBadge({ stage }: { stage: string }) {
  const isSettled = stage === 'Partial Settlement';
  const isTriaged = stage.startsWith('Triaged');
  const isQueued = stage.startsWith('Queued');
  const classes = isSettled
    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
    : isTriaged
      ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
      : isQueued
        ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
        : 'bg-slate-800/80 border-white/15 text-slate-300';

  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-0.5 rounded-full border ${classes}`}>
      {isQueued ? <Clock className="w-3 h-3 shrink-0" /> : <ShieldCheck className="w-3 h-3 shrink-0" />}
      {stage}
    </span>
  );
}

export function AdvisoriesLedgerClient() {
  const [activeTab, setActiveTab] = useState<FilterTab>('ALL');

  const filteredCoordinated = useMemo(() => {
    if (activeTab === 'ALL') return COORDINATED_DISCLOSURES;
    if (activeTab === 'Maya Protocol' || activeTab === 'HackerOne' || activeTab === 'Bugcrowd') {
      return COORDINATED_DISCLOSURES.filter((item) => item.platform === activeTab);
    }
    return [];
  }, [activeTab]);

  const showPublic = activeTab === 'ALL' || activeTab === 'PUBLIC';
  const showCoordinated =
    activeTab === 'ALL' ||
    activeTab === 'Maya Protocol' ||
    activeTab === 'HackerOne' ||
    activeTab === 'Bugcrowd';
  const showQueue = activeTab === 'ALL' || activeTab === 'QUEUE';

  const tabs: { id: FilterTab; label: string; count: number }[] = [
    {
      id: 'ALL',
      label: 'All Research',
      count:
        DISCLOSURE_METRICS.publicAdvisoryCount +
        COORDINATED_DISCLOSURES.length +
        DISCLOSURE_METRICS.preDisclosureDraftCount,
    },
    { id: 'PUBLIC', label: 'Disclosed & Open-Source', count: DISCLOSURE_METRICS.publicAdvisoryCount },
    {
      id: 'Maya Protocol',
      label: 'Maya Protocol (2+2)',
      count: DISCLOSURE_METRICS.mayaReportedCount + DISCLOSURE_METRICS.mayaQueuedCount,
    },
    { id: 'HackerOne', label: 'HackerOne', count: DISCLOSURE_METRICS.hackerOneCount },
    { id: 'Bugcrowd', label: 'Bugcrowd', count: DISCLOSURE_METRICS.bugcrowdCount },
    { id: 'QUEUE', label: 'Pre-Disclosure Queue', count: DISCLOSURE_METRICS.preDisclosureDraftCount },
  ];

  return (
    <div className="space-y-10">
      {/* Header & Zero-Leak Policy Banner */}
      <section className="rounded-2xl border border-white/10 bg-[#070B14]/90 backdrop-blur-xl p-6 sm:p-10 shadow-2xl space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <div className="space-y-3 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-mono">
              <Terminal className="w-3.5 h-3.5" />
              <span>COORDINATED VULNERABILITY DISCLOSURE &amp; RESEARCH LEDGER</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
              Community Security Research &amp; Embargo-Safe Disclosures
            </h1>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
              Every discovery produced by StealthMark&apos;s security engineering team feeds generalized
              formal Z3 invariants and passive detection rules in the StealthMark {SCAN_CHECK_COUNT}-Point
              Engine—protecting ecosystem defenders immediately while unpatched vendor internals stay
              strictly confidential.
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <a
              href={LINKEDIN_COMPANY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-xs font-mono text-sky-200 transition"
            >
              <span>LinkedIn · @stealthmark-scan</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <a
              href={LINKEDIN_FOUNDER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-xs font-mono text-indigo-200 transition"
            >
              <span>Marcos Cassasnovas</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <a
              href={GITHUB_ORG_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/15 text-xs font-mono text-slate-200 transition"
            >
              <span>GitHub</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* Strict OPSEC / Zero-Leak Guardrail Banner */}
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 flex items-start gap-3">
          <Lock className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-xs sm:text-sm text-slate-300 space-y-1">
            <p className="font-semibold text-emerald-300 font-mono">
              ZERO-LEAK COORDINATED DISCLOSURE POLICY (90-DAY POST-FIX EMBARGO &amp; PROGRAM CONFIDENTIALITY)
            </p>
            <p>
              Public records below display only verified upstream fixes and generalized defensive invariant
              classes. Source file paths, function symbols, private ticket IDs, PoC payloads, and unpatched
              target identifiers remain withheld until vendor patches ship and coordinated embargoes clear.
            </p>
          </div>
        </div>

        {/* Program Breakdown Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
            <div className="text-xs font-mono text-slate-400">Open-Source / Public</div>
            <div className="text-2xl font-bold text-white mt-1">
              {DISCLOSURE_METRICS.publicAdvisoryCount}
            </div>
            <div className="text-[11px] font-mono text-emerald-400 mt-1">Published PRs &amp; CVEs</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
            <div className="text-xs font-mono text-slate-400">Maya Protocol</div>
            <div className="text-2xl font-bold text-white mt-1">
              {DISCLOSURE_METRICS.mayaReportedCount} + {DISCLOSURE_METRICS.mayaQueuedCount}
            </div>
            <div className="text-[11px] font-mono text-emerald-400 mt-1">
              {DISCLOSURE_METRICS.mayaReportedCount} Reported · {DISCLOSURE_METRICS.mayaQueuedCount} Pending Queue
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
            <div className="text-xs font-mono text-slate-400">HackerOne</div>
            <div className="text-2xl font-bold text-white mt-1">{DISCLOSURE_METRICS.hackerOneCount}</div>
            <div className="text-[11px] font-mono text-cyan-400 mt-1">Private Program Submissions</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
            <div className="text-xs font-mono text-slate-400">Bugcrowd</div>
            <div className="text-2xl font-bold text-white mt-1">{DISCLOSURE_METRICS.bugcrowdCount}</div>
            <div className="text-[11px] font-mono text-amber-400 mt-1">Confidential Submissions</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4 col-span-2 lg:col-span-1">
            <div className="text-xs font-mono text-slate-400">Pre-Disclosure Queue</div>
            <div className="text-2xl font-bold text-white mt-1">
              {DISCLOSURE_METRICS.preDisclosureDraftCount}
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-1">Under 7/7 Verification Gate</div>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap gap-2 pt-2">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2 rounded-lg text-xs font-mono border transition cursor-pointer ${
                  active
                    ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200'
                    : 'bg-slate-950/60 border-white/10 text-slate-300 hover:border-white/25 hover:text-white'
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            );
          })}
        </div>
      </section>

      {/* Track 1: Published & Open-Source Disclosures */}
      {showPublic && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white flex items-center gap-2 font-mono">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span>Disclosed Community Advisories &amp; Upstream Patches</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {PUBLIC_ADVISORIES.map((adv) => (
              <article
                key={adv.id}
                className="flex flex-col justify-between rounded-xl border border-white/10 bg-slate-950/75 p-5 hover:border-cyan-500/40 transition"
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs text-slate-400">{adv.id}</span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full border text-[11px] font-mono ${BADGE_CLASSES[adv.badgeColor]}`}
                    >
                      {adv.status}
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-mono text-cyan-400 mb-1">
                      {adv.tag} · {adv.target}
                    </div>
                    <h3 className="text-base font-semibold text-white leading-snug">{adv.title}</h3>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">{adv.impact}</p>
                  <div className="rounded-lg bg-white/[0.03] border border-white/10 p-3 text-xs font-mono text-slate-300">
                    {adv.ruleCoverage}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                  <span className="text-slate-400">{adv.referenceLabel}</span>
                  {adv.referenceUrl.startsWith('/') ? (
                    <Link
                      href={adv.referenceUrl}
                      className="inline-flex items-center gap-1.5 text-cyan-300 hover:text-cyan-200 transition"
                    >
                      <span>{adv.referenceUrlLabel}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  ) : (
                    <a
                      href={adv.referenceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-cyan-300 hover:text-cyan-200 transition"
                    >
                      <span>{adv.referenceUrlLabel}</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Track 2: Embargoed Coordinated Disclosures */}
      {showCoordinated && (
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h2 className="text-xl font-bold text-white flex items-center gap-2 font-mono">
              <Shield className="w-5 h-5 text-cyan-400" />
              <span>Embargoed Coordinated Disclosure Track Record</span>
            </h2>
            <span className="text-xs font-mono text-slate-400">
              Showing {filteredCoordinated.length} redacted program records
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {filteredCoordinated.map((item) => (
              <article
                key={item.id}
                className="flex flex-col justify-between rounded-xl border border-white/10 bg-[#070B14]/90 p-5 hover:border-white/25 transition"
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2.5 py-0.5 rounded-full border text-[11px] font-mono ${PLATFORM_STYLES[item.platform]}`}
                      >
                        {item.platform}
                      </span>
                      <span className="text-xs font-mono text-slate-500">{item.id}</span>
                    </div>
                    <StageBadge stage={item.stage} />
                  </div>

                  <div>
                    <div className="text-xs font-mono text-slate-400 mb-1">
                      {item.sector} · <span className="text-slate-200">{item.severity}</span>
                    </div>
                    <h3 className="text-base font-semibold text-white leading-snug">{item.title}</h3>
                  </div>

                  <div className="text-xs font-mono text-cyan-300/90">{item.cweClass}</div>

                  <p className="text-xs text-slate-400 leading-relaxed border-l-2 border-white/15 pl-3">
                    {item.embargoNote}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                  <span className="text-slate-300">{item.defensiveCapability}</span>
                  <Link
                    href={item.proverPath}
                    className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200 shrink-0 transition"
                  >
                    <span>{item.proverLabel}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Track 3: Pre-Disclosure Gate Queue */}
      {showQueue && (
        <section className="rounded-2xl border border-white/10 bg-slate-950/75 p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white font-mono">
              Pre-Disclosure Gate Queue ({DISCLOSURE_METRICS.preDisclosureDraftCount} Staged Draft Audits)
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Additional ecosystem audits awaiting deterministic 7/7 verification completion prior to
              vendor contact. Aggregate sector status only.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {PRE_DISCLOSURE_QUEUE.map((bucket) => (
              <div
                key={bucket.channel}
                className="rounded-xl border border-white/10 bg-[#070B14]/80 p-4 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-semibold text-white">{bucket.channel}</span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-white/5 text-cyan-300 border border-white/10">
                    {bucket.draftCount} staged
                  </span>
                </div>
                <p className="text-xs text-slate-300">{bucket.focusAreas}</p>
                <div className="text-[11px] font-mono text-slate-400">{bucket.gateStatus}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
