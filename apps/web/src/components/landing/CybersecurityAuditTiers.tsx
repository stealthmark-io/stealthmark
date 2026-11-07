import React from 'react';
import Link from 'next/link';
import { Check, Heart, CreditCard, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';
import { DONATION_OPTIONS, FIX_PACK, FREE_SCANS_PER_DOMAIN, UNLOCK_DAYS } from '@/lib/offer';

const FREE_AUDIT_FEATURES: readonly string[] = [
  `${SCAN_CHECK_COUNT} passive checks across TLS, DNS, headers, exposed files and the AI surface`,
  'Full report with a fix recommendation for every finding',
  `${FREE_SCANS_PER_DOMAIN} free scans per domain`,
  'No signup, no card',
];

const FIX_PACK_FEATURES: readonly string[] = [
  `${FIX_PACK.starterPriceLabel} one-time per domain`,
  'Cloudflare WAF rule and Cloudflare Worker',
  'Client-side RASP shield script and live badge snippet',
  'White-label PDF report',
  `Unlimited re-scans of the domain for ${UNLOCK_DAYS} days`,
];

const X402_MICROSERVICES_FEATURES: readonly string[] = [
  'C1 Streams Collateral Detector: Tarjan SCC circular leverage & Z3 insolvency shock witness (/x402/streams/leaderboard)',
  'C2 Polymarket ↔ Kalshi Arb Trap Detector: Z3 semantic oracle divergence verifier (/x402/arb-trap/preview)',
  'C3 x402 Seller Trust Grade & WAF Auditor: 6-dimension passive grader & dynamic SVG badge (/x402/trust-grade/leaderboard)',
  'C4 Multichain OFT / NTT / CCIP Verifier: LayerZero v2, Wormhole & Chainlink CCIP peer symmetry + EAS attestations',
  '16 Base Mainnet x402 Pay-Per-Proof Verification Endpoints + 12-Tool Non-Custodial Execution MCP (Hyperliquid & Solana Rent Reclaimer)',
];

function FeatureList({ items, iconClass }: { items: readonly string[]; iconClass: string }) {
  return (
    <div className="space-y-3 pt-4 border-t border-white/[0.08] text-xs text-slate-200">
      {items.map((item) => (
        <div key={item} className="flex items-start gap-2.5">
          <Check className={`w-4 h-4 shrink-0 mt-0.5 ${iconClass}`} />
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

export function CybersecurityAuditTiers() {
  return (
    <section id="pricing" className="max-w-7xl mx-auto px-4 sm:px-6 space-y-12 py-16 scroll-mt-20">
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <Badge variant="info" pulse className="uppercase tracking-widest text-cyan-300 font-mono text-[10px]">
          Free Audit &middot; {FIX_PACK.label} {FIX_PACK.starterPriceLabel} Per Domain &middot; x402 Microservices
        </Badge>
        <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight">
          Free {SCAN_CHECK_COUNT}-Point Audits. One {FIX_PACK.starterPriceLabel} {FIX_PACK.label} Per Domain.
        </h2>
        <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
          Scan any domain on <strong>stealthmark.io</strong> with no signup and no card: the full report, with a fix for every finding, is free for the first <strong>{FREE_SCANS_PER_DOMAIN} scans of each domain</strong>. The {FIX_PACK.label} ({FIX_PACK.starterPriceLabel} one-time per domain) adds the deployable files and unlimited re-scans for {UNLOCK_DAYS} days. Larger scopes are quoted as Enterprise engagements, and agent builders can call our 16 x402 microservices on Base.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        {/* Card 1: Free audit */}
        <div className="p-6 sm:p-8 rounded-3xl bg-[#0D1017]/90 border-2 border-emerald-500/50 backdrop-blur-xl flex flex-col justify-between space-y-6 transition-all">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold font-mono text-emerald-300 uppercase tracking-wider">Free Audit</span>
              <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold">
                {FREE_SCANS_PER_DOMAIN} Free Scans / Domain
              </span>
            </div>
            <div>
              <div className="text-4xl font-extrabold text-white font-mono flex items-baseline gap-2">
                $0
                <span className="text-xs font-normal text-slate-400">/ first {FREE_SCANS_PER_DOMAIN} scans per domain</span>
              </div>
              <span className="text-[11px] text-emerald-300 font-mono">No signup &middot; No card</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed min-h-[36px]">
              The complete {SCAN_CHECK_COUNT}-point passive diagnostic, with every finding and its fix recommendation in the report.
            </p>
            <FeatureList items={FREE_AUDIT_FEATURES} iconClass="text-emerald-400" />
          </div>
          <Link href="/scan" className="w-full block pt-4">
            <Button variant="gradient" className="w-full text-xs font-semibold py-3 cursor-pointer">
              Run Free {SCAN_CHECK_COUNT}-Point Scan
            </Button>
          </Link>
        </div>

        {/* Card 2: Fix Pack */}
        <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-b from-[#16122d] via-[#0d111d] to-[#0D1017] border-2 border-cyan-400 shadow-2xl shadow-cyan-950/60 relative z-10 backdrop-blur-xl flex flex-col justify-between space-y-6 transition-all">
          <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3.5 py-1 rounded-full bg-gradient-to-r from-emerald-500 via-cyan-500 to-indigo-500 text-slate-950 font-mono text-[10px] font-extrabold uppercase tracking-wider shadow-lg whitespace-nowrap">
            One-Time &middot; Per Domain
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold font-mono text-cyan-300 uppercase tracking-wider">{FIX_PACK.label}</span>
              <Heart className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-baseline gap-2.5 font-mono">
                <span className="text-4xl font-extrabold text-white">{FIX_PACK.starterPriceLabel}</span>
                <span className="text-xs font-normal text-slate-300">one-time per domain</span>
              </div>
              <span className="text-[11px] text-emerald-300/90 font-mono block mt-1">
                Card via Polar or {DONATION_OPTIONS.stablecoinAmount} on-chain
              </span>
            </div>
            <p className="text-xs text-slate-200 leading-relaxed min-h-[36px]">
              Scan your domain, then unlock the deployable fixes for it from the report. Fix Packs are bought per scanned domain.
            </p>
            <FeatureList items={FIX_PACK_FEATURES} iconClass="text-cyan-400" />
          </div>
          <div className="pt-4">
            <Link
              href="/scan"
              className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-extrabold text-xs shadow-lg shadow-cyan-500/25 hover:opacity-95 transition"
            >
              <CreditCard className="w-4 h-4" />
              Scan a Domain to Unlock the {FIX_PACK.label}
            </Link>
          </div>
        </div>

        {/* Card 3: 16 x402 Formal Z3 & Crypto Security Microservices Showcase */}
        <div className="p-6 sm:p-8 rounded-3xl bg-[#0D1017]/90 border border-blue-500/40 hover:border-blue-400/60 backdrop-blur-xl flex flex-col justify-between space-y-6 transition-all">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold font-mono text-sky-400 uppercase tracking-wider">Omni x402 &amp; MCP Microservices</span>
              <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-blue-500/15 text-sky-300 border border-blue-500/30 font-semibold uppercase tracking-wider">
                16 x402 APIs + 12 MCP Tools
              </span>
            </div>
            <div>
              <div className="text-3xl font-extrabold text-white font-mono flex items-baseline gap-2">
                x402 &amp; DeFi Z3
                <span className="text-xs font-normal text-slate-400">Base Mainnet USDC</span>
              </div>
              <span className="text-[11px] text-sky-300 font-mono">Streams SCC &middot; Arb Trap &middot; Trust Grade &middot; OFT/NTT/CCIP</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed min-h-[36px]">
              Production mathematical verification microservices for AI agents, DeFi curators, Polymarket/Kalshi traders, and multichain bridges.
            </p>
            <FeatureList items={X402_MICROSERVICES_FEATURES} iconClass="text-sky-400" />
          </div>
          <div className="pt-4 grid grid-cols-2 gap-2">
            <a
              href="https://gateway.stealthmark.io/x402/trust-grade/leaderboard?format=html"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1 py-2.5 px-3 rounded-xl bg-blue-600/25 border border-blue-400/40 text-sky-200 text-[11px] font-mono font-bold hover:bg-blue-600/40 transition"
            >
              <span>x402 Leaderboard</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="https://gateway.stealthmark.io/x402/streams/leaderboard?format=html"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1 py-2.5 px-3 rounded-xl bg-emerald-600/25 border border-emerald-400/40 text-emerald-200 text-[11px] font-mono font-bold hover:bg-emerald-600/40 transition"
            >
              <span>Streams SCC</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="https://gateway.stealthmark.io/x402/arb-trap/preview?pm=openai-1t-ipo-before-2027&kalshi=KXOAIANTH-40-OAI"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1 py-2.5 px-3 rounded-xl bg-purple-600/25 border border-purple-400/40 text-purple-200 text-[11px] font-mono font-bold hover:bg-purple-600/40 transition"
            >
              <span>Arb Trap Z3</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="https://gateway.stealthmark.io/x402/catalog"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1 py-2.5 px-3 rounded-xl bg-white/10 border border-white/20 text-white text-[11px] font-mono font-bold hover:bg-white/20 transition"
            >
              <span>16 x402 APIs</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
