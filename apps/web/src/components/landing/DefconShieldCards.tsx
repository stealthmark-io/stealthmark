'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Shield, ShieldCheck } from 'lucide-react';

interface DefconCardInfo {
  level: number;
  name: string;
  badge: string;
  badgeStyle: string;
  borderStyle: string;
  glowStyle: string;
  iconColor: string;
  headline: string;
  description: string;
  idealFor: string;
  activeShield: string;
}

const DEFCON_CARDS: DefconCardInfo[] = [
  {
    level: 5,
    name: 'Normal',
    badge: 'DEFCON 5 · Baseline Hardened',
    badgeStyle: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    borderStyle: 'border-emerald-500/40 hover:border-emerald-400 bg-emerald-950/10',
    glowStyle: 'shadow-emerald-500/10',
    iconColor: 'text-emerald-400',
    headline: 'Grade A+ Perimeter & CSP Nonces',
    description: 'Enforces per-request cryptographic CSP nonces, HSTS, strict COOP/CORP headers, and passive AI crawler telemetry.',
    idealFor: 'Standard production traffic with zero XSS or inline-script vectors.',
    activeShield: 'Per-Request CSP Nonce & HSTS'
  },
  {
    level: 4,
    name: 'Guarded',
    badge: 'DEFCON 4 · Adaptive WAF',
    badgeStyle: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
    borderStyle: 'border-cyan-500/40 hover:border-cyan-400 bg-cyan-950/10',
    glowStyle: 'shadow-cyan-500/10',
    iconColor: 'text-cyan-400',
    headline: 'Edge Rate Limiting & Bot Filtering',
    description: 'Enforces sliding-window rate limits per IP and TLS JA3/JA4 fingerprint. Drops high-frequency vulnerability scanners and scrapers.',
    idealFor: 'Mitigating automated recon, directory brute-forcing & credential stuffing.',
    activeShield: 'HTTP 429 Sliding-Window Edge Throttle'
  },
  {
    level: 3,
    name: 'Elevated',
    badge: 'DEFCON 3 · CVE Shield',
    badgeStyle: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    borderStyle: 'border-amber-500/40 hover:border-amber-400 bg-amber-950/10',
    glowStyle: 'shadow-amber-500/10',
    iconColor: 'text-amber-400',
    headline: 'CVE & Decompression Guard',
    description: 'Strips oversized Brotli payloads (CVE-2026-111497), x-middleware-subrequest bypasses, and prototype-pollution query strings at the edge.',
    idealFor: 'Exploit waves for new CVEs targeting Node.js, Next.js, or edge runtimes.',
    activeShield: 'CVE-2026-111497 & CVE-2026-93680 Block'
  },
  {
    level: 2,
    name: 'High',
    badge: 'DEFCON 2 · Cryptographic Gate',
    badgeStyle: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
    borderStyle: 'border-orange-500/40 hover:border-orange-400 bg-orange-950/10',
    glowStyle: 'shadow-orange-500/10',
    iconColor: 'text-orange-400',
    headline: 'Strict Origin & Signed Agent Gate',
    description: 'Requires verified cryptographic signatures or mTLS client certificates on sensitive API routes and blocks all unverified headless clients.',
    idealFor: 'Production API gateways, authentication routes & high-value endpoints.',
    activeShield: '100% Unverified Automation Containment'
  },
  {
    level: 1,
    name: 'Lockdown',
    badge: 'DEFCON 1 · Incident Freeze',
    badgeStyle: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
    borderStyle: 'border-rose-500/40 hover:border-rose-400 bg-rose-950/10',
    glowStyle: 'shadow-rose-500/10',
    iconColor: 'text-rose-400',
    headline: 'Sovereign Emergency Lockdown',
    description: 'Freezes exposed API and admin surfaces during active incident response. Only allowlisted IP ranges and verified operators reach origin.',
    idealFor: 'Active breach containment, DDoS mitigation & forensic preservation.',
    activeShield: 'Zero-Trust Allowlist & Edge Isolation'
  }
];

export function DefconShieldCards() {
  const [selectedLevel, setSelectedLevel] = useState<number>(5);

  return (
    <section id="security-matrix" className="max-w-7xl mx-auto px-4 sm:px-6 space-y-10 py-12 text-left scroll-mt-24">
      <div className="text-center max-w-3xl mx-auto space-y-3">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-xs font-mono font-semibold tracking-wider uppercase">
          <ShieldCheck className="w-4 h-4 text-cyan-400" />
          DEFCON Perimeter Matrix · 5-Layer Defense Architecture
        </div>
        <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight">
          5 Defense Postures. Engineered for Zero-Trust Perimeters.
        </h2>
        <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
          From Grade A+ daily hardening (per-request CSP nonces and HSTS) to edge containment and incident lockdown. Every free 60-point audit (20 scans per domain) and Enterprise engagement maps to these 5 defensive postures.
        </p>
      </div>

      {/* 5 Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {DEFCON_CARDS.map((card) => {
          const isSelected = selectedLevel === card.level;
          return (
            <div
              key={card.level}
              onClick={() => setSelectedLevel(card.level)}
              className={`p-5 rounded-2xl border transition-all duration-300 cursor-pointer flex flex-col justify-between space-y-4 shadow-xl backdrop-blur-xl relative ${card.borderStyle} ${card.glowStyle} ${
                isSelected ? 'scale-[1.03] ring-2 ring-cyan-400/50 bg-[#0d1017]' : 'bg-[#0d1017]/80'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full border font-bold ${card.badgeStyle}`}>
                    {card.badge}
                  </span>
                  {card.level === 5 ? (
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  ) : (
                    <Shield className={`w-3.5 h-3.5 ${card.iconColor}`} />
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-extrabold text-white tracking-tight">{card.headline}</h3>
                  <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">{card.description}</p>
                </div>
              </div>

              <div className="space-y-2 pt-3 border-t border-white/10 text-[10px] font-mono">
                <div>
                  <span className="text-slate-500 uppercase block font-bold">Ideal For:</span>
                  <span className="text-slate-300 leading-snug block mt-0.5">{card.idealFor}</span>
                </div>

                <div className="pt-1">
                  <span className="text-slate-500 uppercase block font-bold">Active Shield:</span>
                  <span className={`font-semibold ${card.iconColor}`}>{card.activeShield}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Level Summary Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-indigo-950/40 via-cyan-950/30 to-emerald-950/40 border border-cyan-500/30 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-300 font-bold shrink-0">
            L{selectedLevel}
          </div>
          <div>
            <div className="text-white font-bold flex items-center gap-2">
              <span>Active Selection: DEFCON {selectedLevel} ({DEFCON_CARDS.find(c => c.level === selectedLevel)?.name})</span>
              <span className="text-[10px] px-2 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold">Edge Hardening Rule</span>
            </div>
            <div className="text-slate-400 text-[11px] mt-0.5">
              {selectedLevel === 5 ? 'Baseline Grade A+ posture: per-request CSP nonces, HSTS, and zero exposed dotfiles.' :
               selectedLevel === 1 ? 'Emergency origin isolation: only allowlisted operator IPs reach the backend.' :
               'Enforces edge rules to block CVE exploit payloads, scanners, and unauthorized bots.'}
            </div>
          </div>
        </div>

        <Link
          href="/scan"
          className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 text-white font-bold transition shrink-0 cursor-pointer"
        >
          Audit Your Perimeter (60 Checks) →
        </Link>
      </div>
    </section>
  );
}
