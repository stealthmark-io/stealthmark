'use client';

import React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ExternalLink,
  FileCheck2,
  GitPullRequest,
  Lock,
  Shield,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import {
  PUBLIC_ADVISORIES,
  DISCLOSURE_METRICS,
  type AdvisoryBadgeColor,
} from '@/lib/community-findings';
import { LINKEDIN_COMPANY_URL } from '@/lib/site';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';

const BADGE_CLASSES: Record<AdvisoryBadgeColor, string> = {
  emerald: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  cyan: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
  indigo: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/30',
  amber: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  rose: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
};

export function SecurityResearchAdvisories() {
  return (
    <section id="research" className="max-w-7xl mx-auto px-4 sm:px-6">
      <div className="rounded-2xl border border-white/10 bg-[#070B14]/90 backdrop-blur-xl p-6 sm:p-10 shadow-2xl">
        <div className="flex flex-col gap-5 border-b border-white/10 pb-6">
          <div className="space-y-2 max-w-4xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-mono">
              <Terminal className="w-3.5 h-3.5" />
              <span>STEALTHMARK SECURITY RESEARCH &amp; PUBLIC DISCLOSURES</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Verified Zero-Day Advisories, Open-Source Patches &amp; Third-Party Attestation
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Every rule in the StealthMark {SCAN_CHECK_COUNT}-Point Engine and{' '}
              <code className="text-cyan-300 font-mono">npx @stealthmark/cli</code> is backed by
              real-world vulnerability research, upstream Rust/TypeScript patches, and independent
              cryptographic baseline verification.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            <Link
              href="/advisories"
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-xs font-mono text-cyan-300 transition"
            >
              <Shield className="w-3.5 h-3.5 text-cyan-400" />
              <span>Full Disclosure Ledger</span>
              <ArrowRight className="w-3 h-3 text-cyan-400" />
            </Link>
            <a
              href="https://github.com/stealthmark-io"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.10] border border-white/15 text-xs font-mono text-white transition"
            >
              <GitPullRequest className="w-3.5 h-3.5 text-cyan-400" />
              <span>GitHub Open-Source (@stealthmark-io)</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>
            <a
              href="https://www.x402scan.com/server/4f613c20-a216-4742-be54-8cd621415701"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-xs font-mono text-sky-300 transition"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
              <span>x402scan Verified Prover (20 Z3 Tools)</span>
              <ExternalLink className="w-3 h-3 text-sky-400" />
            </a>
            <a
              href={LINKEDIN_COMPANY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-xs font-mono text-sky-200 transition"
            >
              <span>LinkedIn · @stealthmark-scan</span>
              <ExternalLink className="w-3 h-3 text-sky-300" />
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          {PUBLIC_ADVISORIES.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-white/10 bg-black/50 p-5 flex flex-col justify-between space-y-4 hover:border-cyan-500/40 transition overflow-hidden min-w-0"
            >
              <div className="space-y-3 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span
                    className={`text-[11px] font-mono px-2.5 py-0.5 rounded border font-semibold ${BADGE_CLASSES[item.badgeColor]}`}
                  >
                    {item.tag}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">{item.id}</span>
                </div>

                <div className="text-xs font-mono text-cyan-300 font-semibold break-words">
                  {item.target}
                </div>

                <h3 className="text-base font-bold text-white leading-snug break-words">
                  {item.title}
                </h3>

                <p className="text-xs text-slate-300 leading-relaxed break-words">{item.impact}</p>

                <div className="rounded-lg bg-white/[0.03] border border-white/10 p-2.5 text-xs font-mono text-slate-300">
                  {item.ruleCoverage}
                </div>
              </div>

              <div className="pt-3 border-t border-white/10 space-y-3">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-slate-400">Status:</span>
                  <span className="text-emerald-300 font-semibold flex items-center gap-1">
                    <FileCheck2 className="w-3.5 h-3.5" />
                    {item.status}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {item.referenceUrl.startsWith('/') ? (
                    <Link
                      href={item.referenceUrl}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 text-[11px] font-mono text-slate-200 transition"
                    >
                      <span>{item.referenceUrlLabel}</span>
                      <ArrowRight className="w-3 h-3 text-cyan-400" />
                    </Link>
                  ) : (
                    <a
                      href={item.referenceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 text-[11px] font-mono text-slate-200 transition"
                    >
                      <span>{item.referenceUrlLabel}</span>
                      <ExternalLink className="w-3 h-3 text-cyan-400" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Coordinated Disclosure Track Record (Zero-Leak Embargo Active) */}
        <div className="mt-8 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-emerald-300">
                Coordinated Disclosure Track Record (Zero-Leak Embargo Active)
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Link
                href="/advisories"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-xs font-mono text-cyan-300 transition"
              >
                <span>Full Disclosure Ledger</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <Link
                href="/agents"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.10] border border-white/10 text-xs font-mono text-slate-200 transition"
              >
                <span>Verify Provers (/agents)</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-lg border border-white/10 bg-black/40 p-3 space-y-1">
              <div className="text-[11px] font-mono text-slate-400">
                Maya Protocol (90-day embargo active)
              </div>
              <div className="text-xs sm:text-sm font-semibold text-white font-mono">
                {DISCLOSURE_METRICS.mayaReportedCount} Reported ·{' '}
                {DISCLOSURE_METRICS.mayaQueuedCount} Pending Verification
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/40 p-3 space-y-1">
              <div className="text-[11px] font-mono text-slate-400">HackerOne</div>
              <div className="text-xs sm:text-sm font-semibold text-white font-mono">
                {DISCLOSURE_METRICS.hackerOneCount} Private Submissions
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/40 p-3 space-y-1">
              <div className="text-[11px] font-mono text-slate-400">Bugcrowd</div>
              <div className="text-xs sm:text-sm font-semibold text-white font-mono">
                {DISCLOSURE_METRICS.bugcrowdCount} Confidential Submissions
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/40 p-3 space-y-1">
              <div className="text-[11px] font-mono text-slate-400">Pre-Disclosure Queue</div>
              <div className="text-xs sm:text-sm font-semibold text-white font-mono">
                {DISCLOSURE_METRICS.preDisclosureDraftCount} Staged under 7/7 Gate
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
