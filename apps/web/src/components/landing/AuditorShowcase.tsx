"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Shield,
  Search,
  Globe,
  ArrowRight,
  FileText,
  FileCode,
  Radio,
  ExternalLink,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FIX_PACK } from "@/lib/offer";
import { SCAN_CHECK_COUNT } from "@/lib/readiness-report";

const AUDIT_PILLARS = [
  {
    icon: <Lock className="w-5 h-5 text-red-400" />,
    title: "1. Shodan Ports & October 2026 CVEs",
    desc: "Passive Shodan InternetDB lookup for exposed 3389 RDP, 1433 SQL, Redis, and MongoDB ports, plus active banner detection for October 2026 KEVs (Brotli CVE-2026-111497, Magento CVE-2026-48356, GitLab CVE-2026-97229, Ivanti CVE-2026-118527, PHP2Shell CVE-2026-109618).",
    checks: ["3389 RDP & 1433 SQL detection", "Brotli, Magento & GitLab KEV recon", "One lookup, zero port scan"],
  },
  {
    icon: <Globe className="w-5 h-5 text-cyan-400" />,
    title: "2. TLS Chain, eMudhra CA & DMARC",
    desc: "Observable TLS handshake, distrusted CA chain inspection (eMudhra / emSign CVE-2026-113470), HSTS enforcement, CAA authorization, and enforced DMARC (p=quarantine/reject) anti-spoofing.",
    checks: ["eMudhra CA distrust check", "HTTPS, HSTS & CAA policy", "SPF & Enforced DMARC"],
  },
  {
    icon: <Shield className="w-5 h-5 text-indigo-400" />,
    title: "3. Dotfiles, Nonce CSP & Edge Headers",
    desc: "Requests /.env and /.git/config to catch exposed dotfiles or soft-200 fallbacks, verifies per-request CSP nonces, COOP/CORP isolation, and flags vulnerable CMS/runtime headers.",
    checks: ["/.env & /.git exposure check", "Per-request CSP Nonce & CORP", "Clickjacking & MIME defense"],
  },
  {
    icon: <FileCode className="w-5 h-5 text-amber-400" />,
    title: "4. JS Bundle Secret & Origin Leak Scan",
    desc: "Inspects HTML and JavaScript bundles for leaked OpenAI, Anthropic, Stripe, AWS, and Supabase service_role keys (redacted), source maps (.js.map), and raw Cloud Run / Railway / Render origin URLs.",
    checks: ["Secret patterns in JS bundles", "Source map (.js.map) exposure", "Cloud origin URL leak detection"],
  },
  {
    icon: <Radio className="w-5 h-5 text-purple-400" />,
    title: "5. MCP & Agentic Surface Security",
    desc: "Checks for exposed Next.js internal /_next/mcp endpoints (CVE-2026-94486), unauthenticated MCP servers, prompt-injection payloads in /llms.txt, and OWASP Top 10:2025 compliance gates.",
    checks: ["/_next/mcp & MCP exposure check", "/llms.txt prompt-injection scan", "OWASP Top 10:2025 gate"],
  },
];

export function AuditorShowcase() {
  const handleCardPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
  };

  return (
    <section id="auditor" className="max-w-5xl mx-auto px-4 sm:px-6 space-y-10 py-10 scroll-mt-24">
      <div className="text-center space-y-3 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.10] border-t-white/[0.18] text-xs font-mono font-medium text-slate-200 backdrop-blur-md">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
          <span className="tracking-wider uppercase">Red Team Recon · {SCAN_CHECK_COUNT}-Point Passive Security &amp; AI-Surface Audit</span>
        </div>
        <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
          Instant Infrastructure, CVE &amp; AI-Surface Auditor
        </h2>
        <p className="text-sm sm:text-base text-slate-400 leading-relaxed max-w-2xl mx-auto">
          Audit any domain in seconds across Shodan exposed ports (RDP/SQL), CVEs reported by InternetDB, leaked /.env secrets, PHP/WordPress fingerprints, and AI crawler governance — with an Executive Grade (A+ to F), and a Cloudflare WAF &amp; Cloud Armor remediation pack in the {FIX_PACK.label} (<strong className="text-emerald-300">{FIX_PACK.starterPriceLabel} USD</strong> one-time per domain).
        </p>
      </div>

      {/* 5 Pillars + White-Label Forensic PDF Card */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {AUDIT_PILLARS.map((p) => (
          <div
            key={p.title}
            onPointerMove={handleCardPointerMove}
            className="bento-card p-5 rounded-xl space-y-3 flex flex-col justify-between group"
          >
            <div className="space-y-2.5">
              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] w-fit group-hover:scale-105 transition">
                {p.icon}
              </div>
              <h3 className="text-sm font-bold text-white tracking-wide">{p.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{p.desc}</p>
            </div>
            <ul className="pt-2 border-t border-white/[0.06] space-y-1.5 text-[11px] text-slate-300 font-mono">
              {p.checks.map((c) => (
                <li key={c} className="flex items-center gap-2">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* B2B Forensic PDF & Edge Fix Pack Card */}
        <div
          onPointerMove={handleCardPointerMove}
          className="bento-card p-5 rounded-xl space-y-3 flex flex-col justify-between"
        >
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] w-fit">
                <FileText className="w-5 h-5 text-cyan-400" />
              </div>
              <Badge variant="info" size="sm">
                B2B &amp; Agencies
              </Badge>
            </div>
            <h3 className="text-sm font-bold text-white tracking-wide">
              White-Label PDF &amp; Cloudflare Fix Pack
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Export a 3-page Executive &amp; Forensic A4 PDF Report customized with your agency brand, plus Cloudflare WAF &amp; Google Cloud Armor rules and an edge Worker to block /.env, /.git and known scanners and enforce security headers (<strong className="text-emerald-300">{FIX_PACK.starterPriceLabel} USD</strong> one-time per domain).
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-black/50 border border-white/10 font-mono text-xs text-slate-200 flex items-center justify-between">
            <span>Executive Grade: A+ to F</span>
            <span className="text-cyan-400 font-bold">3-Page A4 PDF</span>
          </div>
        </div>
      </div>

      {/* Bottom CTA Card */}
      <div
        onPointerMove={handleCardPointerMove}
        className="bento-card p-6 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4"
      >
        <div className="space-y-1 text-center sm:text-left">
          <h4 className="text-base font-bold text-white">
            Need the 3-Page White-Label PDF Report or the Cloudflare Fix Pack?
          </h4>
          <p className="text-xs text-slate-400">
            Run a free {SCAN_CHECK_COUNT}-point domain scan with the full report and fixes, then unlock the Fix Pack for that domain.
          </p>
        </div>
        <Link href="/scan" className="shrink-0 w-full sm:w-auto">
          <Button size="md" className="w-full sm:w-auto rounded-lg font-semibold bg-[#F8FAFC] text-[#060709] hover:bg-white border-0 shadow-none">
            <span>Open {SCAN_CHECK_COUNT}-Point Scanner</span>
            <ExternalLink className="w-4 h-4 ml-1.5 text-[#060709]" />
          </Button>
        </Link>
      </div>
    </section>
  );
}
