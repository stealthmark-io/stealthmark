"use client";

import React, { useState } from "react";
import Link from "next/link";
import { StealthMascot } from "@/components/StealthMascot";
import {
  Search,
  ExternalLink,
  ArrowLeft,
  Lock,
  CheckCircle2,
  Zap,
} from "lucide-react";
import { CodeBlock } from "@/components/ui/code-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SCAN_CHECK_COUNT } from "@/lib/readiness-report";
import { DONATION_OPTIONS, FIX_PACK, FREE_SCANS_PER_DOMAIN, UNLOCK_DAYS } from "@/lib/offer";

interface DocSection {
  id: string;
  title: string;
  category: string;
  badge?: string;
}

const SECTIONS: DocSection[] = [
  { id: "overview", title: "Architecture & 60-Point Recon", category: "Getting Started", badge: "Core" },
  { id: "quickstart", title: "Grade A+ Edge Hardening", category: "Getting Started", badge: "Fix Pack" },
  { id: "controls", title: "60-Point Matrix & 2026 CVEs", category: "Security Engine" },
  { id: "owasp", title: "OWASP Top 10:2025 Gates", category: "Security Engine" },
  { id: "audit-api", title: "Audit API & CLI", category: "API Reference" },
  { id: "tiers", title: "Tiers & Pricing", category: "Engagement" },
];

const AUDIT_CURL = `curl -s "https://stealthmark.io/api/scan/audit?domain=example.com" | jq '.summary'`;

const AUDIT_RESPONSE = `{
  "domain": "example.com",
  "grade": "A+",
  "score": 100,
  "counts": {
    "pass": 38,
    "warn": 0,
    "fail": 0,
    "info": 7,
    "error": 0,
    "not_assessed": 0
  },
  "owasp_2025": {
    "gates_passed": 10,
    "gates_total": 10
  }
}`;

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState<string>("overview");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const filteredSections = SECTIONS.filter(
    (s) =>
      s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const categories = Array.from(new Set(filteredSections.map((s) => s.category)));

  return (
    <div className="min-h-screen bg-[#060709] text-slate-100 flex flex-col bg-grid-pattern relative selection:bg-cyan-500/30 selection:text-white">
      <div className="absolute top-0 left-1/4 w-[600px] h-[350px] ambient-glow-purple pointer-events-none" />
      <div className="absolute top-24 right-1/4 w-[500px] h-[250px] ambient-glow-cyan pointer-events-none" />

      {/* Top Navigation */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0b0d13]/85 backdrop-blur-xl px-4 sm:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-xs sm:text-sm text-slate-400 hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back to Home</span>
          </Link>

          <div className="h-4 w-px bg-white/10" />

          <Link href="/" className="flex items-center gap-2.5">
            <StealthMascot variant="logo" />
            <span className="font-bold text-white tracking-tight">StealthMark</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-semibold">
              Security Docs v5.1
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-5 text-xs font-medium text-slate-400">
            <Link href="/scan" className="hover:text-white transition">
              {SCAN_CHECK_COUNT}-Point Scanner
            </Link>
            <Link href="/#forensic-audit" className="hover:text-white transition">
              Deep Forensic Audit
            </Link>
            <Link href="/trust" className="hover:text-white transition">
              Trust &amp; Methodology
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/enterprise/contact"
            className="hidden sm:inline-flex items-center justify-center h-8 px-3 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.10] text-xs font-mono text-slate-200 transition"
          >
            Request Forensic Audit
          </Link>
          <Link href="/scan">
            <Button size="sm" variant="gradient" className="text-xs cursor-pointer">
              <span>Run {SCAN_CHECK_COUNT}-Point Scan</span>
              <ExternalLink className="w-3.5 h-3.5 ml-1" />
            </Button>
          </Link>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 gap-8 relative z-10">
        {/* Left Sidebar */}
        <aside className="w-64 border-r border-white/10 py-2 pr-6 hidden md:block shrink-0">
          <div className="mb-5 relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search security docs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#0b0d13] border border-white/10 rounded-xl pl-8 pr-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <nav className="space-y-6">
            {categories.map((cat) => (
              <div key={cat}>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2 font-mono">
                  {cat}
                </h3>
                <ul className="space-y-1">
                  {filteredSections
                    .filter((s) => s.category === cat)
                    .map((s) => (
                      <li key={s.id}>
                        <button
                          onClick={() => setActiveSection(s.id)}
                          className={`w-full text-left text-xs px-3 py-2 rounded-xl flex items-center justify-between transition cursor-pointer ${
                            activeSection === s.id
                              ? "bg-indigo-600/30 text-white font-semibold border border-indigo-500/40 shadow-md"
                              : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                          }`}
                        >
                          <span>{s.title}</span>
                          {s.badge && (
                            <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                              {s.badge}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Content Body */}
        <main className="flex-1 max-w-4xl space-y-8">
          {/* Mobile Section Switcher */}
          <div className="flex md:hidden gap-2 overflow-x-auto pb-2">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono whitespace-nowrap border ${
                  activeSection === s.id
                    ? "bg-cyan-500/20 text-cyan-200 border-cyan-500/40 font-bold"
                    : "bg-white/[0.03] text-slate-400 border-white/10"
                }`}
              >
                {s.title}
              </button>
            ))}
          </div>

          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
            <span>Security Docs</span>
            <span>/</span>
            <span className="text-slate-400">
              {SECTIONS.find((s) => s.id === activeSection)?.category}
            </span>
            <span>/</span>
            <span className="text-cyan-400 font-medium">
              {SECTIONS.find((s) => s.id === activeSection)?.title}
            </span>
          </div>

          {/* Section: Overview */}
          {activeSection === "overview" && (
            <article className="space-y-6 animate-in fade-in">
              <div>
                <h1 className="text-3xl font-bold text-white tracking-tight mb-2">
                  {SCAN_CHECK_COUNT}-Point Passive Recon &amp; Perimeter Security Architecture
                </h1>
                <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
                  StealthMark v5.1 is a cybersecurity reconnaissance, edge virtual-patching, PDF CDR, and forensic auditing platform. Our
                  automated scanner evaluates any public domain across{" "}
                  <strong className="text-white">{SCAN_CHECK_COUNT} non-intrusive security controls</strong> mapped to{" "}
                  <strong className="text-cyan-300">OWASP Top 10:2025 (10/10 passive gates)</strong>, active 2026 CVE
                  signatures (Node2Shell CVE-2026-111497, SonicWall SMA 1000, Cisco ASA CVE-2026-76418, Ivanti CVE-2026-104935),
                  Anti-SSRF IPv4/IPv6 pinning, Weaponized PDF CDR inspection, x402 Counterparty Trust Receipts (<code className="text-cyan-300 font-mono">/api/v2/trust-receipt</code>),
                  and our viral CLI (<code className="text-emerald-300 font-mono">npx @stealthmark/cli doctor</code> &amp; <code className="text-emerald-300 font-mono">pdf-check</code>).
                </p>
              </div>

              <div className="grid sm:grid-cols-3 gap-4 my-6">
                <div className="p-5 rounded-2xl border border-white/10 bg-[#0b0d13]/80 backdrop-blur-md">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold mb-3 text-sm font-mono">
                    01
                  </div>
                  <h3 className="text-sm font-semibold text-white mb-1">Passive {SCAN_CHECK_COUNT}-Point Recon</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Zero-exploitation inspection of HTTP response headers, TLS 1.3 handshakes, DNS/DMARC/SPF/CAA
                    records, Shodan open ports, exposed dotfiles, and client-side JS bundles.
                  </p>
                </div>
                <div className="p-5 rounded-2xl border border-emerald-500/30 bg-[#0b0d13]/80 backdrop-blur-md">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold mb-3 text-sm font-mono">
                    02
                  </div>
                  <h3 className="text-sm font-semibold text-white mb-1">
                    {FIX_PACK.label} ({FIX_PACK.starterPriceLabel} per domain)
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Unlocks the Fix Pack files for a domain: Cloudflare WAF rule, Cloudflare Worker, client-side RASP shield
                    script, live badge snippet and white-label PDF report, plus unlimited re-scans for {UNLOCK_DAYS} days.
                  </p>
                </div>
                <div className="p-5 rounded-2xl border border-white/10 bg-[#0b0d13]/80 backdrop-blur-md">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold mb-3 text-sm font-mono">
                    03
                  </div>
                  <h3 className="text-sm font-semibold text-white mb-1">Enterprise Security Engineering</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Direct B2B engagement for SaaS and cloud platforms: Red Team surface recon, Blue Team edge WAF
                    hardening, quoted per scope.
                  </p>
                </div>
              </div>

              <div className="border-l-2 border-emerald-500 bg-emerald-950/20 p-4 rounded-r-2xl space-y-1">
                <p className="text-xs text-emerald-200 leading-relaxed">
                  <strong>Free audit, one paid item:</strong> scan any domain at{" "}
                  <Link href="/scan" className="text-emerald-300 underline">/scan</Link> with no signup. The full report is
                  free for the first {FREE_SCANS_PER_DOMAIN} scans of each domain. The {FIX_PACK.label} is{" "}
                  <strong>{FIX_PACK.starterPriceLabel} USD</strong> one-time per domain, paid by card through Polar or with{" "}
                  {DONATION_OPTIONS.stablecoinAmount} on-chain.
                </p>
              </div>
            </article>
          )}

          {/* Section: Quickstart / Grade A+ Hardening */}
          {activeSection === "quickstart" && (
            <article className="space-y-6 animate-in fade-in">
              <div>
                <h1 className="text-3xl font-bold text-white tracking-tight mb-2">
                  Grade A+ Edge Hardening Blueprint
                </h1>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Achieving <strong className="text-emerald-400">Grade A+ (100/100)</strong> on the StealthMark{" "}
                  {SCAN_CHECK_COUNT}-Point Scanner requires four defense layers across your edge proxy, application
                  middleware, and DNS zone.
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="p-5 rounded-2xl border border-white/10 bg-[#0b0d13]/85 space-y-2">
                  <div className="flex items-center gap-2 text-cyan-300 font-mono text-xs font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Layer 01 · Per-Request Cryptographic CSP Nonce</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Replaces static <code className="text-cyan-300 font-mono">script-src &apos;unsafe-inline&apos;</code>{" "}
                    with a per-request UUID nonce and <code className="text-cyan-300 font-mono">&apos;strict-dynamic&apos;</code>{" "}
                    so injected XSS scripts cannot execute.
                  </p>
                </div>

                <div className="p-5 rounded-2xl border border-white/10 bg-[#0b0d13]/85 space-y-2">
                  <div className="flex items-center gap-2 text-cyan-300 font-mono text-xs font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Layer 02 · Cloudflare WAF &amp; Google Cloud Armor</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Blocks <code className="text-rose-300 font-mono">/.env</code>, <code className="text-rose-300 font-mono">/.git</code>,
                    PHP CGI injection, oversized Brotli payloads (<strong className="text-white">CVE-2026-111497</strong>),
                    and Next.js subrequest header spoofing at the edge.
                  </p>
                </div>

                <div className="p-5 rounded-2xl border border-white/10 bg-[#0b0d13]/85 space-y-2">
                  <div className="flex items-center gap-2 text-cyan-300 font-mono text-xs font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Layer 03 · Anti-Phishing Permissions-Policy &amp; HSTS</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Enforces <code className="text-cyan-300 font-mono">clipboard-read=()</code>,{" "}
                    <code className="text-cyan-300 font-mono">publickey-credentials-get=(self)</code> (FIDO2/WebAuthn),
                    COOP/CORP isolation, and HSTS (<code className="text-cyan-300 font-mono">max-age=300</code>, raised to{" "}
                    <code className="text-cyan-300 font-mono">31536000</code> once every subdomain serves HTTPS).
                  </p>
                </div>

                <div className="p-5 rounded-2xl border border-white/10 bg-[#0b0d13]/85 space-y-2">
                  <div className="flex items-center gap-2 text-cyan-300 font-mono text-xs font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Layer 04 · DNS Anti-Spoofing &amp; RFC 9116 Disclosure</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Enforces DMARC (<code className="text-cyan-300 font-mono">p=quarantine</code> or{" "}
                    <code className="text-cyan-300 font-mono">p=reject</code>), SPF, CAA authority pinning, and{" "}
                    <code className="text-cyan-300 font-mono">/.well-known/security.txt</code>.
                  </p>
                </div>
              </div>

              {/* Locked Code Blueprint Callout */}
              <div className="p-6 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-[#0b0f19] to-cyan-950/40 border border-emerald-500/40 space-y-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="space-y-1">
                    <div className="text-xs font-mono font-bold text-emerald-300 flex items-center gap-1.5 uppercase">
                      <Lock className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copy-Paste Grade A+ Code, WAF Rules &amp; Claude/Cursor Prompts</span>
                    </div>
                    <p className="text-xs text-slate-300 max-w-xl leading-relaxed">
                      To prevent automated scraping of remediation blueprints, the tailored Cloudflare WAF rule, Cloudflare Worker,
                      client-side RASP shield script, live badge snippet and white-label PDF report are generated per domain
                      inside the <strong>{FIX_PACK.label}</strong> (
                      <strong className="text-emerald-300">{FIX_PACK.starterPriceLabel} USD</strong> one-time per domain).
                    </p>
                  </div>
                  <Link href="/scan">
                    <Button variant="gradient" size="sm" className="text-xs font-bold cursor-pointer">
                      <Zap className="w-3.5 h-3.5 mr-1.5" />
                      <span>Scan Domain &amp; Unlock ({FIX_PACK.starterPriceLabel})</span>
                    </Button>
                  </Link>
                </div>
              </div>
            </article>
          )}

          {/* Section: 60-Point Control Matrix & CVEs */}
          {activeSection === "controls" && (
            <article className="space-y-6 animate-in fade-in">
              <div>
                <h1 className="text-3xl font-bold text-white tracking-tight mb-2">
                  {SCAN_CHECK_COUNT}-Point Control Matrix &amp; 2026 CVE Signatures
                </h1>
                <p className="text-sm text-slate-400">
                  Every domain audit evaluates three specialized security pillars in parallel without sending intrusive
                  or state-mutating payloads.
                </p>
              </div>

              <div className="space-y-4">
                <div className="p-5 rounded-2xl border border-white/10 bg-[#0b0d13]/85 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">Pillar 01 · Infrastructure, Ports, TLS &amp; DNS</h3>
                    <Badge variant="info">14 Controls</Badge>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    HTTPS enforcement, HTTP-to-HTTPS redirect chain, TLS 1.2/1.3 negotiation, certificate expiration
                    horizon, eMudhra/emSign CA distrust check, HSTS preload, CAA DNS records, SPF anti-spoofing, DMARC enforcement (<code className="font-mono text-cyan-300">p=quarantine</code> / <code className="font-mono text-cyan-300">p=reject</code>), DNSSEC, subdomain takeover CNAME dangling check, Shodan InternetDB open ports (22, 3306, 5432, 6379, 27017, 3389), and indexed host CVEs.
                  </p>
                </div>

                <div className="p-5 rounded-2xl border border-white/10 bg-[#0b0d13]/85 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">Pillar 02 · Web Application, Secrets &amp; 2026 CVE Guard</h3>
                    <Badge variant="info">24 Controls</Badge>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Content-Security-Policy (<code className="font-mono text-cyan-300">script-src</code> nonce/hash vs{" "}
                    <code className="font-mono text-amber-300">unsafe-inline</code>), X-Frame-Options /{" "}
                    <code className="font-mono text-cyan-300">frame-ancestors</code>, X-Content-Type-Options{" "}
                    <code className="font-mono text-cyan-300">nosniff</code>, Referrer-Policy, Permissions-Policy (<code className="font-mono text-cyan-300">clipboard-read=()</code>, <code className="font-mono text-cyan-300">publickey-credentials-get=(self)</code>),
                    COOP/CORP/COEP isolation, CORS wildcard reflection, Cookie <code className="font-mono text-cyan-300">__Host-; Secure; HttpOnly; SameSite</code>, Server/X-Powered-By version banners, exposed <code className="font-mono text-rose-300">/.env</code> &amp; <code className="font-mono text-rose-300">/.git/HEAD</code>, exposed production sourcemaps, client JS bundle secret scanning, and 2026 CVE signatures (<strong className="text-white">CVE-2026-111497</strong> Brotli OOB write, <strong className="text-white">CVE-2026-93680</strong> runtime RCE, <strong className="text-white">CVE-2026-34197</strong> Apache ActiveMQ).
                  </p>
                </div>

                <div className="p-5 rounded-2xl border border-white/10 bg-[#0b0d13]/85 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">Pillar 03 · AI Agent Surface, MCP &amp; Discovery Governance</h3>
                    <Badge variant="info">7 Controls</Badge>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    <code className="font-mono text-cyan-300">/robots.txt</code> AI crawler directives (GPTBot,
                    ClaudeBot, PerplexityBot, OAI-SearchBot), <code className="font-mono text-cyan-300">/llms.txt</code>{" "}
                    prompt-injection inspection, <code className="font-mono text-cyan-300">/.well-known/agent.json</code>{" "}
                    &amp; <code className="font-mono text-cyan-300">/.well-known/mcp.json</code> capability manifests,
                    and unauthenticated <code className="font-mono text-rose-300">/_next/mcp</code> endpoint exposure check.
                  </p>
                </div>
              </div>
            </article>
          )}

          {/* Section: OWASP Top 10:2025 */}
          {activeSection === "owasp" && (
            <article className="space-y-6 animate-in fade-in">
              <div>
                <h1 className="text-3xl font-bold text-white tracking-tight mb-2">
                  OWASP Top 10:2025 Passive Gate Mapping (10/10)
                </h1>
                <p className="text-sm text-slate-400">
                  Every StealthMark audit maps its findings directly to the 10 categories of{" "}
                  <strong className="text-white">OWASP Top 10:2025</strong> so engineering and compliance teams can
                  prioritize remediation by industry-standard risk category.
                </p>
              </div>

              <div className="border border-white/10 rounded-2xl overflow-hidden bg-[#0b0d13]/80">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#10141f] text-slate-400 font-mono border-b border-white/10">
                    <tr>
                      <th className="p-3">OWASP 2025 Gate</th>
                      <th className="p-3">Category</th>
                      <th className="p-3">Audited Perimeter Signals</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06] text-slate-300">
                    <tr>
                      <td className="p-3 font-mono text-cyan-300 font-bold">A01:2025</td>
                      <td className="p-3 font-semibold text-white">Broken Access Control</td>
                      <td className="p-3">CORS origin reflection, exposed admin/debug routes, open redirects, COOP/CORP</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-mono text-cyan-300 font-bold">A02:2025</td>
                      <td className="p-3 font-semibold text-white">Security Misconfiguration</td>
                      <td className="p-3">CSP, X-Frame-Options, nosniff, Permissions-Policy, exposed /.env &amp; /.git, directory listing</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-mono text-cyan-300 font-bold">A03:2025</td>
                      <td className="p-3 font-semibold text-white">Software Supply Chain Failures</td>
                      <td className="p-3">Subresource Integrity (SRI) on third-party scripts, exposed sourcemaps, CAA records</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-mono text-cyan-300 font-bold">A04:2025</td>
                      <td className="p-3 font-semibold text-white">Cryptographic Failures</td>
                      <td className="p-3">TLS 1.3 negotiation, eMudhra CA distrust, HSTS preload max-age, SSL cert expiry, DNSSEC</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-mono text-cyan-300 font-bold">A05:2025</td>
                      <td className="p-3 font-semibold text-white">Injection &amp; Cross-Site Scripting</td>
                      <td className="p-3">Per-request CSP nonces, strict-dynamic, trace/debug method disablement</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-mono text-cyan-300 font-bold">A06:2025</td>
                      <td className="p-3 font-semibold text-white">Insecure Design</td>
                      <td className="p-3">SPF + DMARC anti-spoofing policy, AI crawler governance, capability boundaries</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-mono text-cyan-300 font-bold">A07:2025</td>
                      <td className="p-3 font-semibold text-white">Authentication Failures</td>
                      <td className="p-3">Session cookie __Host-/Secure/HttpOnly/SameSite flags, FIDO2/WebAuthn policy</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-mono text-cyan-300 font-bold">A08:2025</td>
                      <td className="p-3 font-semibold text-white">Software &amp; Data Integrity</td>
                      <td className="p-3">Client JS bundle API key leaks, sourcemaps, unsigned third-party scripts</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-mono text-cyan-300 font-bold">A09:2025</td>
                      <td className="p-3 font-semibold text-white">Security Logging &amp; Alerting</td>
                      <td className="p-3">RFC 9116 security.txt disclosure channel, Reporting-Endpoints / NEL headers</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-mono text-cyan-300 font-bold">A10:2025</td>
                      <td className="p-3 font-semibold text-white">Mishandling of Exceptional Conditions</td>
                      <td className="p-3">CVE-2026-111497 Brotli decompression bounds, stack-trace leakage on 404/500</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
          )}

          {/* Section: Audit API */}
          {activeSection === "audit-api" && (
            <article className="space-y-6 animate-in fade-in">
              <div>
                <h1 className="text-3xl font-bold text-white tracking-tight mb-2">
                  Audit API &amp; CLI Reference
                </h1>
                <p className="text-sm text-slate-400">
                  Trigger a live {SCAN_CHECK_COUNT}-point non-intrusive perimeter scan programmatically or from your
                  CI/CD pipeline.
                </p>
              </div>

              <div className="divide-y divide-white/10 border border-white/10 rounded-2xl overflow-hidden bg-[#0b0d13]/80">
                <div className="p-3.5 flex items-center justify-between text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-bold">GET</span>
                    <span className="text-white">/api/scan/audit?domain=&lt;hostname&gt;</span>
                  </div>
                  <span className="text-slate-400 font-sans text-[11px]">Runs the {SCAN_CHECK_COUNT}-point passive audit and returns JSON report</span>
                </div>
                <div className="p-3.5 flex items-center justify-between text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">CLI v5.1</span>
                    <span className="text-white">npx @stealthmark/cli doctor &amp; npx @stealthmark/cli pdf-check &lt;file.pdf&gt;</span>
                  </div>
                  <span className="text-slate-400 font-sans text-[11px]">Audits Node2Shell, Linux SUID GTFOBins, TeamViewer &amp; Weaponized PDFs</span>
                </div>
                <div className="p-3.5 flex items-center justify-between text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400 font-bold">x402</span>
                    <span className="text-white">/api/v2/trust-receipt?domain=&lt;hostname&gt;</span>
                  </div>
                  <span className="text-slate-400 font-sans text-[11px]">Issues HMAC-SHA256 Counterparty Security Trust Receipt (x402 v1)</span>
                </div>
              </div>

              <CodeBlock code={AUDIT_CURL} language="bash" title="Query Live 60-Point Audit" />
              <CodeBlock code={AUDIT_RESPONSE} language="json" title="Summary Response (JSON)" />
            </article>
          )}

          {/* Section: Tiers & Forensic Audits */}
          {activeSection === "tiers" && (
            <article className="space-y-6 animate-in fade-in">
              <div>
                <h1 className="text-3xl font-bold text-white tracking-tight mb-2">
                  Service Tiers &amp; Pricing
                </h1>
                <p className="text-sm text-slate-400">
                  No mandatory subscriptions or account walls. Run a free {SCAN_CHECK_COUNT}-point scan, unlock the{" "}
                  <strong className="text-emerald-300">{FIX_PACK.starterPriceLabel} USD</strong> one-time {FIX_PACK.label}{" "}
                  for a domain, or engage our security engineering team directly for custom assessments.
                </p>
              </div>

              <div className="border border-white/10 rounded-2xl overflow-hidden bg-[#0b0d13]/80">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#10141f] text-slate-400 font-mono border-b border-white/10">
                    <tr>
                      <th className="p-3">Tier</th>
                      <th className="p-3">Price</th>
                      <th className="p-3">Deliverables</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06] text-slate-300">
                    <tr>
                      <td className="p-3 font-semibold text-white">Free {SCAN_CHECK_COUNT}-Point Recon</td>
                      <td className="p-3 font-mono text-emerald-400 font-bold">$0</td>
                      <td className="p-3">Instant letter grade (A+ to F), OWASP Top 10:2025 gate summary, and the full report with a fix recommendation for every finding, free for the first {FREE_SCANS_PER_DOMAIN} scans of each domain. After that, new scan results for the domain lock until it is unlocked.</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-semibold text-cyan-300">{FIX_PACK.label}</td>
                      <td className="p-3 font-mono text-emerald-400 font-bold">
                        {FIX_PACK.starterPriceLabel} one-time per domain
                      </td>
                      <td className="p-3">Unlocks the Fix Pack files for the domain (Cloudflare WAF rule, Cloudflare Worker, client-side RASP shield script, live badge snippet and white-label PDF report) and unlimited re-scans for {UNLOCK_DAYS} days. Pay by card through Polar or with {DONATION_OPTIONS.stablecoinAmount} on-chain.</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-semibold text-indigo-300">Enterprise Security Assessment</td>
                      <td className="p-3 font-mono text-emerald-400 font-bold">Custom Scope</td>
                      <td className="p-3">Full Red Team surface assessment, Blue Team perimeter &amp; WAF hardening, cloud architecture security review, and custom remediation patches via <Link href="/enterprise/contact" className="text-cyan-400 underline">/enterprise/contact</Link>.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
          )}
        </main>
      </div>
    </div>
  );
}
