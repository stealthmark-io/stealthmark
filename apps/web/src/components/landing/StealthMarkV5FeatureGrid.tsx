import React from "react";
import Link from "next/link";
import { FIX_PACK } from "@/lib/offer";

const V51_SHIELDS = [
  {
    badge: "CVE-2026-111497 · BROTLI RCE",
    title: "Node2Shell Brotli RCE Virtual Patch (Cap-Safe)",
    desc: "Blocks crafted Content-Encoding: br payloads and enforces non-blocking stream decompression limits at the Cloudflare edge before Express 5, body-parser, or Node.js fetch() can trigger unauthenticated RCE.",
  },
  {
    badge: "ISO-32000 CDR · OWASP LLM01",
    title: "Weaponized PDF Upload & AI-Prompt Firewall",
    desc: "Static binary stream inspection (<64KB non-blocking header/trailer slice) rejects uploaded PDF resumes and invoices containing /JavaScript, /Launch, /OpenAction, /GoToR, XXE, or hidden white-on-white AI prompt injections, while enforcing CSP: sandbox on downloads.",
  },
  {
    badge: "OWASP A10:2025 · SSRF PINNING",
    title: "Anti-SSRF (IPv4/IPv6 Metadata & DNS-Rebinding)",
    desc: "Neutralizes Server-Side Request Forgery probes against AWS/GCP/Azure metadata (169.254.169.254, metadata.google.internal, IPv6 [fd00:ec2::254], ::ffff:169.254.169.254) and rejects TTL=0 DNS-rebinding callbacks.",
  },
  {
    badge: "48H POST-PATCH EXPLOIT SHIELD",
    title: "SonicWall SMA 1000, Cisco ASA & Ivanti VPN Gate",
    desc: "Attackers weaponize patches in under 48 hours via binary diffing. Our v5.1 edge gate isolates /amc/, /__api__/, /+CSCOE+/ (CVE-2026-76418), and /dana-na/ (CVE-2026-104935) behind Zero-Trust JA4 TLS + ASN session binding.",
  },
  {
    badge: "NEXT.JS 14 EOL · CLIENT RASP",
    title: "Next.js 14/sharp Virtual Patch & <3KB Browser RASP",
    desc: "Sanitizes /_next/image probes at the edge for unpatchable Next.js 14 apps, while our <3KB Client-Side RASP neutralizes live DOM cloning, zero-opacity autofill credential traps, and WebRTC STUN IP leaks.",
  },
  {
    badge: "PLG VIRAL CLI · DFIR SHA-256",
    title: "npx stealthmark doctor & pdf-check + DFIR Chain",
    desc: "Run `npx @stealthmark/cli doctor` to audit Linux SUID GTFOBins, Node2Shell, TeamViewer <15.83 & Docker Socket 666 in 2s, or `pdf-check <file.pdf>` to inspect suspicious CVs/invoices—backed by SHA-256 forensic snapshots.",
  },
];

export function StealthMarkV5FeatureGrid({ scannedDomain }: { scannedDomain?: string }) {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
      <div className="rounded-3xl bg-[#070B14]/90 border border-emerald-500/25 p-6 sm:p-10 shadow-2xl">
        <div className="text-center max-w-3xl mx-auto mb-10">
          <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-mono uppercase tracking-wider bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
            StealthMark Active Shield v5.1 · 4-House Jury Hardened
          </span>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-white mt-4 tracking-tight">
            One Malicious PDF Resume, SSRF Callback, or 48h VPN Exploit Can Compromise Your Stack.{" "}
            <span className="text-emerald-400">Block All 6 at the Edge in 60s.</span>
          </h2>
          <p className="text-slate-300 mt-3 text-sm sm:text-base">
            StealthMark v5.1 unifies our passive perimeter &amp; AI-surface scanner with the{" "}
            <strong>Active Edge Virtual Patch v5.1</strong>, <strong>Static PDF CDR Engine</strong>,{" "}
            <strong>Anti-SSRF IPv4/IPv6 Guard</strong>, and <strong>&lt;3KB Client RASP</strong>—included in{" "}
            the <strong className="text-emerald-300">{FIX_PACK.label}</strong> ({FIX_PACK.starterPriceLabel} one-time per domain).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {V51_SHIELDS.map((item, i) => (
            <div
              key={i}
              className="rounded-2xl bg-[#0B111E]/95 border border-slate-800 hover:border-emerald-500/40 p-5 flex flex-col justify-between transition"
            >
              <div>
                <span className="inline-block text-[10px] font-mono uppercase tracking-widest px-2.5 py-1 rounded bg-slate-900 text-emerald-400 border border-emerald-500/20">
                  {item.badge}
                </span>
                <h3 className="text-base font-bold text-white mt-3">{item.title}</h3>
                <p className="text-slate-400 text-xs sm:text-sm mt-2 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href={scannedDomain ? `/api/billing/polar/checkout?plan=starter_pass&domain=${encodeURIComponent(scannedDomain)}` : "/scan"}
            className="inline-flex items-center justify-center px-7 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs sm:text-sm transition shadow-xl shadow-emerald-500/20"
          >
            Scan a Domain &amp; Unlock the {FIX_PACK.label} ({FIX_PACK.starterPriceLabel} per domain) →
          </Link>
          <div className="px-4 py-2.5 rounded-xl bg-slate-950/90 border border-slate-800 text-[11px] font-mono text-cyan-300">
            💻 Try Viral CLI: <span className="text-white font-bold">npx @stealthmark/cli doctor</span> ·{" "}
            <span className="text-white font-bold">npx @stealthmark/cli pdf-check cv.pdf</span>
          </div>
        </div>
      </div>
    </section>
  );
}
