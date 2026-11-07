import React from "react";
import Link from "next/link";
import { ArrowRight, Building2, CheckCircle2, AlertTriangle, Mail, ShieldCheck } from "lucide-react";
import { SCAN_CHECK_COUNT } from "@/lib/readiness-report";

const SECURITY_PILLARS = [
  {
    vol: "PILLAR 01",
    title: "Red Team Surface & API Exposure Assessment",
    desc: `Deep inspection across subdomains, ports, TLS/DNS, exposed .env/sourcemaps, CORS policies, GraphQL introspection, and runtime CVEs (including CVE-2026-111497 Brotli OOB write).`,
  },
  {
    vol: "PILLAR 02",
    title: "Application Auth, Session & Cloud Architecture Review",
    desc: "Technical review of authentication flows, JWT/cookie session isolation, API rate limiting, SSRF boundaries, and cloud origin exposure.",
  },
  {
    vol: "PILLAR 03",
    title: "Blue Team Perimeter & Edge WAF Hardening",
    desc: "Custom Cloudflare Worker rules, per-request CSP nonce architecture, HSTS/COOP/CORP headers, and automated threat mitigation.",
  },
  {
    vol: "PILLAR 04",
    title: "Custom Remediation Patches & A+ Certification",
    desc: "Copy-paste engineering patches for Next.js, Nginx, Vercel, and Cloudflare with post-deployment verification to certify Grade A+ (100/100).",
  },
];

export function EnterpriseForensicCard() {
  return (
    <section id="forensic-audit" className="max-w-6xl mx-auto px-4 sm:px-6 w-full scroll-mt-24">
      <div className="p-6 sm:p-10 rounded-3xl bg-gradient-to-br from-blue-950/55 via-[#0a0d14]/95 to-black border border-blue-500/40 shadow-2xl shadow-blue-950/40 space-y-8 backdrop-blur-xl">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <div className="space-y-3 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-blue-600 text-white font-mono text-[10px] font-extrabold uppercase tracking-wider">
                Custom Pentest &amp; Edge Hardening
              </span>
              <span className="text-xs font-mono text-sky-300 font-semibold uppercase tracking-wider">
                Direct Security Engineering &middot; No Account Required
              </span>
            </div>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
              Need deeper perimeter &amp; application security beyond the automated {SCAN_CHECK_COUNT}-point scan?
            </h2>
            <p className="text-xs sm:text-base text-slate-300 leading-relaxed">
              For SaaS, cloud platforms, and production web infrastructures: our security engineering team conducts{" "}
              <strong className="text-white">Red Team Surface Assessments, API Security Reviews &amp; Blue Team Edge WAF Hardening</strong>—delivering custom remediation patches and certifying your domain to Grade A+.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col gap-3 shrink-0">
            <Link
              href="/enterprise/contact"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 text-xs sm:text-sm font-extrabold transition shadow-lg shadow-cyan-500/25"
            >
              <Mail className="w-4 h-4" />
              Request Custom Scope Brief
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              href="/enterprise"
              className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-blue-600/25 hover:bg-blue-600/40 border border-blue-400/40 text-sky-200 text-xs font-bold transition"
            >
              <Building2 className="w-4 h-4" />
              View Enterprise Assessment Scope
            </Link>
          </div>
        </div>

        {/* 4 Security Deliverable Pillars */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SECURITY_PILLARS.map((item) => (
            <div
              key={item.vol}
              className="p-4 sm:p-5 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-cyan-400/35 transition space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-extrabold uppercase tracking-widest px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                  {item.vol}
                </span>
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
              </div>
              <h3 className="text-sm sm:text-base font-bold text-white">{item.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>

        {/* Live Dogfooding Verification Bar */}
        <div className="pt-2 border-t border-white/10 space-y-3">
          <div className="text-xs font-mono text-slate-400 uppercase tracking-wider">
            Verified on our own infrastructure before we audit yours:
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-2xl bg-red-500/[0.06] border border-red-500/25 space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-red-400 font-bold">Before &middot; Red Team recon</div>
              <div className="flex items-center gap-2 text-white font-bold text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Grade A &middot; 1 warning &middot; 0 fails
              </div>
              <p className="text-xs text-slate-400">script-src allowed &apos;unsafe-inline&apos; without a nonce or hash.</p>
            </div>
            <div className="p-4 rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/25 space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-bold">After &middot; A+ verified ({SCAN_CHECK_COUNT} checks)</div>
              <div className="flex items-center gap-2 text-white font-bold text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Grade A+ &middot; 0 warnings &middot; 0 fails
              </div>
              <p className="text-xs text-slate-400">
                Per-request CSP nonce + Brotli CVE-2026-111497 edge guard enforced in production.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
