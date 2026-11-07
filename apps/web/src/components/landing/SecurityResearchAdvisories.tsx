"use client";

import React from "react";
import { ShieldCheck, ExternalLink, GitPullRequest, FileCheck2, Terminal } from "lucide-react";

const ADVISORIES = [
  {
    id: "SM-ADV-2026-01",
    target: "PrimeIntellect-ai/prime-agent",
    badge: "CWE-863 · CWE-532 · HIGH",
    badgeColor: "text-rose-300 bg-rose-500/10 border-rose-500/30",
    status: "Disclosed · Rust Patch PR #3886",
    date: "Nov 2026",
    title: "Project .prime/settings.json Consent Override & Git Remote Token Redaction",
    summary:
      "Discovered an asymmetric settings-merge flaw in crates/pa-core/src/settings/manager.rs (L418-435) where an untrusted repository's .prime/settings.json could override a developer's global agentTraces opt-out and trigger background 20 MB session trace uploads, alongside unredacted HTTP(S) git remote credentials in active_git_context().",
    ruleId: "ai-agent-project-config-consent-override",
    links: [
      {
        label: "Discussion #3887",
        href: "https://github.com/PrimeIntellect-ai/prime-agent/discussions/3887",
      },
      {
        label: "Rust Patch PR #3886",
        href: "https://github.com/PrimeIntellect-ai/prime-agent/pull/3886",
      },
    ],
  },
  {
    id: "SM-ADV-2026-02",
    target: "affaan-m/ECC · Everything Claude Code (50k+ ★)",
    badge: "OWASP Top 10:2025 · A02 / A08",
    badgeColor: "text-cyan-300 bg-cyan-500/10 border-cyan-500/30",
    status: "Open PR Under Review (#3747)",
    date: "Nov 2026",
    title: "Non-Destructive 2025/2026 Web-Perimeter, Cache-Poisoning & Registry Token Audit Skill",
    summary:
      "Contributed our production 60-point passive perimeter verification methodology—including two-stage HSTS rollout gates, reproducible X-Forwarded-Host cache-poisoning fixtures, and non-destructive /.npmrc & /.yarnrc.yml token-exposure checks—to Everything Claude Code.",
    ruleId: "web-perimeter-owasp-2025-audit",
    links: [
      {
        label: "Upstream PR #3747",
        href: "https://github.com/affaan-m/ECC/pull/3747",
      },
      {
        label: "StealthMark Fork",
        href: "https://github.com/stealthmark-io/ECC",
      },
    ],
  },
  {
    id: "SM-ATTEST-2026-03",
    target: "Dominion Observatory × StealthMark MCP",
    badge: "OWASP Agentic ASI-02 · SHA-256 Pinned",
    badgeColor: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
    status: "Independently Verified Baseline",
    date: "Nov 2026",
    title: "Third-Party Cryptographic Baseline of StealthMark's 6 Production MCP Tools",
    summary:
      "Independently audited and snapshotted by Dominion Observatory (@vdineshk) against silent MCP tool-manifest drift and rug-pull mutations on https://stealthmark.io/api/mcp (SHA-256: 9dba2097...3b4f00fca).",
    ruleId: "SHA-256: 9dba2097...4f00fca",
    links: [
      {
        label: "Verification Issue #3",
        href: "https://github.com/stealthmark-io/stealthmark-sdk/issues/3",
      },
      {
        label: "Signed Baseline JSON",
        href: "https://github.com/stealthmark-io/stealthmark-sdk/blob/main/security/baselines/dominion-mcp-baseline.json",
      },
    ],
  },
  {
    id: "SM-ADV-2026-04",
    target: "unclebob/ub-mode & crapper (5.8k+ ★)",
    badge: "CWE-829 · CWE-776 · Agent Quality Gate",
    badgeColor: "text-amber-300 bg-amber-500/10 border-amber-500/30",
    status: "Upstream Patch PR #27 (CRAP = 1.0)",
    date: "Nov 2026",
    title: "Hardening Vitest Coverage Auto-Install & JaCoCo DTD Subset Parsing in /ub-mode Crapper",
    summary:
      "Audited Robert C. Martin's (Uncle Bob) viral /ub-mode agent harness companion tool (crapper) and submitted upstream fixes enforcing strict SemVer + --ignore-scripts on Vitest auto-install and internal DTD subset stripping.",
    ruleId: "ai-agent-coverage-runner-semver-guard",
    links: [
      {
        label: "Patch PR #27",
        href: "https://github.com/unclebob/crapper/pull/27",
      },
      {
        label: "ub-mode Advisory #10",
        href: "https://github.com/unclebob/ub-mode/issues/10",
      },
    ],
  },
];

export function SecurityResearchAdvisories() {
  return (
    <section id="research" className="max-w-7xl mx-auto px-4 sm:px-6">
      <div className="rounded-2xl border border-white/10 bg-[#070B14]/90 backdrop-blur-xl p-6 sm:p-10 shadow-2xl">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-white/10 pb-6">
          <div className="space-y-2 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-mono">
              <Terminal className="w-3.5 h-3.5" />
              <span>STEALTHMARK SECURITY RESEARCH &amp; PUBLIC DISCLOSURES</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Verified Zero-Day Advisories, Open-Source Patches &amp; Third-Party Attestation
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Every rule in the StealthMark 60-Point Engine and <code className="text-cyan-300 font-mono">npx @stealthmark/cli</code> is backed by real-world vulnerability research, upstream Rust/TypeScript patches, and independent cryptographic baseline verification.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
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
              href="https://www.linkedin.com/company/stealthmark-io/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-xs font-mono text-sky-300 transition"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
              <span>LinkedIn Official Page</span>
              <ExternalLink className="w-3 h-3 text-sky-400" />
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          {ADVISORIES.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-white/10 bg-black/50 p-5 flex flex-col justify-between space-y-4 hover:border-cyan-500/40 transition overflow-hidden min-w-0"
            >
              <div className="space-y-3 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className={`text-[11px] font-mono px-2.5 py-0.5 rounded border font-semibold ${item.badgeColor}`}>
                    {item.badge}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    {item.id} &middot; {item.date}
                  </span>
                </div>

                <div className="text-xs font-mono text-cyan-300 font-semibold break-words">
                  {item.target}
                </div>

                <h3 className="text-base font-bold text-white leading-snug break-words">
                  {item.title}
                </h3>

                <p className="text-xs text-slate-300 leading-relaxed break-words">
                  {item.summary}
                </p>
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
                  {item.links.map((lk) => (
                    <a
                      key={lk.href}
                      href={lk.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 text-[11px] font-mono text-slate-200 transition"
                    >
                      <span>{lk.label}</span>
                      <ExternalLink className="w-3 h-3 text-cyan-400" />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
