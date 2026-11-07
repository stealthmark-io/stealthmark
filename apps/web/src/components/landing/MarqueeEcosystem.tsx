"use client";

import React from "react";
import { IntegrationIcon } from "@/components/IntegrationIcon";

export function MarqueeEcosystem() {
  const standards = [
    { name: "OWASP Top 10:2025", provider: "10/10 Passive Gates", status: "Verified", logoId: "cloudflare" },
    { name: "CVE-2026-111497", provider: "Brotli / Node2Shell Guard", status: "Mitigated", logoId: "nextjs" },
    { name: "Per-Request CSP Nonce", provider: "Strict-Dynamic XSS Shield", status: "Enforced", logoId: "vercel" },
    { name: "Shodan InternetDB", provider: "Open Ports & CVE Recon", status: "Scanned", logoId: "aws" },
    { name: "DMARC · SPF · CAA", provider: "DNS & Mail Anti-Spoofing", status: "Audited", logoId: "cloudflare" },
    { name: "RFC 9116 security.txt", provider: "Vulnerability Disclosure", status: "Standard", logoId: "github" },
    { name: "JS Bundle Secret Scan", provider: "API Key & Token Leak Recon", status: "Inspected", logoId: "nextjs" },
    { name: "GPTBot & ClaudeBot", provider: "AI Crawler Governance", status: "Controlled", logoId: "openai" },
    { name: "Perplexity & OAI-Search", provider: "Search Agent Verification", status: "Controlled", logoId: "perplexity" },
    { name: "Meta-ExternalAgent", provider: "Automated Scraper Policy", status: "Controlled", logoId: "meta" },
  ];

  const stacks = [
    { name: "Next.js App Router", tech: "Per-request CSP Nonce Middleware", badge: "Edge Fix Pack", logoId: "nextjs" },
    { name: "Cloudflare Workers", tech: "WAF Rules & CVE-2026 Header Guard", badge: "Edge Fix Pack", logoId: "cloudflare" },
    { name: "Express & Fastify", tech: "Google Cloud Armor & Rate-Limit Guard", badge: "Node.js", logoId: "express" },
    { name: "Vercel & Nginx", tech: "HSTS Preload & Dotfile Lockdown", badge: "Any Host", logoId: "vercel" },
  ];

  return (
    <section id="ecosystem" className="py-14 space-y-6 overflow-hidden max-w-7xl mx-auto">
      <div className="text-center space-y-2 px-4">
        <div className="text-xs font-mono font-semibold tracking-widest text-cyan-400 uppercase">
          60-POINT COVERAGE · EDGE WAF · AI CRAWLER GOVERNANCE
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
          Built for modern cloud perimeters, edge proxies, and production stacks
        </h2>
        <p className="text-xs sm:text-sm text-slate-400 max-w-2xl mx-auto">
          Every scan inspects 60 non-intrusive controls across TLS 1.3, DNS records, Shodan open ports, exposed JS secrets, runtime CVEs, and automated AI crawlers—generating drop-in remediation code for your stack.
        </p>
      </div>

      {/* Row 1: Audited security vectors & AI crawlers (moves left) */}
      <div className="relative w-full overflow-hidden mask-gradient">
        <div className="animate-marquee-left flex gap-3.5 py-1">
          {[...standards, ...standards].map((item, i) => (
            <div
              key={`std-${i}`}
              className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-[#0d1017]/85 border border-white/[0.08] hover:border-white/20 backdrop-blur-md shadow-sm shrink-0 group transition-all"
            >
              <IntegrationIcon id={item.logoId} size="sm" />
              <div className="text-left">
                <div className="text-xs font-bold text-white group-hover:text-cyan-200 transition-colors">{item.name}</div>
                <div className="text-[10px] text-slate-400 font-mono">{item.provider}</div>
              </div>
              <span className="ml-2 text-[9px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-semibold">
                {item.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Row 2: Protected stacks and remediation targets (moves right) */}
      <div className="relative w-full overflow-hidden mask-gradient">
        <div className="animate-marquee-right flex gap-3.5 py-1">
          {[...stacks, ...stacks, ...stacks].map((stack, i) => (
            <div
              key={`stack-${i}`}
              className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-[#0d1017]/85 border border-white/[0.08] hover:border-white/20 backdrop-blur-md shadow-sm shrink-0 group transition-all"
            >
              <IntegrationIcon id={stack.logoId} size="sm" />
              <div className="text-left">
                <div className="text-xs font-bold text-white group-hover:text-emerald-200 transition-colors">{stack.name}</div>
                <div className="text-[10px] text-slate-400 font-mono">{stack.tech}</div>
              </div>
              <span className="ml-2 text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-semibold">
                {stack.badge}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
