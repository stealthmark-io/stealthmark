import React from 'react';
import Link from 'next/link';
import { Check, Zap, Shield, Building2, ArrowRight, Coins } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CREDIT_PACKS, pricePer1k, type CreditPack, type CreditPackId } from '@/lib/polar-products';
import { FREE_SITE_ALLOWANCE } from '@/lib/plan-copy';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';

const PACK_TAGLINES: Record<CreditPackId, string> = {
  starter: 'Side projects and first production traffic.',
  growth: 'Growing sites with steady agent traffic.',
  scale: 'High-volume sites and multi-site teams.',
};

const FREE_FEATURES: readonly string[] = [
  '250 agent events / month',
  FREE_SITE_ALLOWANCE,
  '7-day event history',
  `Per-agent console & ${SCAN_CHECK_COUNT}-point open /scan diagnostic`,
];

const PACK_FEATURES: readonly string[] = [
  'One-time payment, no subscription',
  'Credits valid for 12 months',
  'Buy again any time',
];

const ENTERPRISE_FEATURES: readonly string[] = [
  'Negotiated event volume, history and terms',
  'MSA, PO and invoicing',
];

function formatCredits(credits: number): string {
  return credits.toLocaleString('en-US');
}

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

function PackCard({ pack, featured }: { pack: CreditPack; featured: boolean }) {
  const shell = featured
    ? 'bg-gradient-to-b from-[#16122d] via-[#0d111d] to-[#0D1017] border-2 border-cyan-400 shadow-2xl shadow-cyan-950/60 relative z-10'
    : 'bg-[#0D1017]/90 border border-indigo-500/30 hover:border-indigo-500/50';
  const accent = featured ? 'text-cyan-300' : 'text-indigo-300';

  return (
    <div
      data-testid={`pack-${pack.pack}`}
      className={`p-6 rounded-3xl backdrop-blur-xl flex flex-col justify-between space-y-6 transition-all ${shell}`}
    >
      {featured && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-cyan-400 via-indigo-500 to-cyan-500 text-white font-mono text-[10px] font-extrabold uppercase tracking-wider shadow-lg whitespace-nowrap">
          Most popular
        </div>
      )}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <span className={`text-xs font-bold font-mono uppercase tracking-wider ${accent}`}>{pack.name}</span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/5 text-slate-300 border border-white/10 font-semibold">
            One-time
          </span>
        </div>
        <div>
          <div className="text-4xl font-extrabold text-white font-mono flex items-baseline gap-1">${pack.priceUsd}</div>
          <span className="text-[11px] text-slate-400 block mt-1">
            {formatCredits(pack.credits)} agent events &middot; ${pricePer1k(pack)} / 1k
          </span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed min-h-[36px]">{PACK_TAGLINES[pack.pack]}</p>
        <FeatureList items={PACK_FEATURES} iconClass={featured ? 'text-cyan-400' : 'text-indigo-400'} />
      </div>

      <a href={`/api/billing/checkout?pack=${pack.pack}`} className="w-full block pt-4">
        <Button
          variant={featured ? 'gradient' : 'outline'}
          className={`w-full text-xs font-semibold py-3 cursor-pointer ${
            featured ? 'shadow-lg shadow-cyan-500/25' : 'border-indigo-500/30 text-indigo-200 hover:bg-indigo-500/10'
          }`}
        >
          {featured && <Zap className="w-4 h-4 mr-1.5" />}
          Buy {pack.name} &middot; ${pack.priceUsd}
        </Button>
      </a>
    </div>
  );
}

export function PricingGrid() {
  return (
    <section id="pricing" className="max-w-7xl mx-auto px-4 sm:px-6 space-y-12 py-16 scroll-mt-20">
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <Badge variant="info" pulse className="uppercase tracking-widest text-cyan-300 font-mono text-[10px]">
          Pay as you go
        </Badge>
        <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight">
          Buy credits. Use them when agents show up.
        </h2>
        <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
          Start free with 250 agent events a month. When you need more, buy a credit pack. One-time payment, no
          subscription, credits are valid for 12 months.
        </p>
      </div>

      {/* ⚡ B2B Fix & Forensic Pack Callout ($19 One-Time) */}
      <div className="max-w-4xl mx-auto p-5 rounded-3xl bg-gradient-to-r from-blue-950/50 via-indigo-950/40 to-black border-2 border-blue-500/50 shadow-xl shadow-blue-950/40 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-1.5 text-left">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-blue-600 text-white font-mono text-[10px] font-extrabold uppercase tracking-wider">
              Blue Team Shield &middot; No registration
            </span>
            <span className="text-xs font-mono text-sky-300 font-bold">$49 USD ($24.50 w/ BLACKOCTOBER)</span>
          </div>
          <h3 className="text-lg font-bold text-white">
            B2B Fix &amp; Forensic Report Pack ($49 / $24.50 w/ code)
          </h3>
          <p className="text-xs text-slate-300 max-w-xl leading-relaxed">
            Unlock complete remediation for your domain: a Cloudflare WAF custom-rule expression (blocks <code className="text-cyan-300 font-mono">/.env</code>, <code className="text-cyan-300 font-mono">/.git</code>, known scanner user agents and PHP CGI argument-injection query strings), an edge Worker that blocks the same paths and adds security headers, Cursor/Claude AI Fix Prompts, and the 3-Page White-Label Forensic PDF Report (A4 print-ready).
          </p>
        </div>
        <Link href="/scan" className="shrink-0">
          <Button variant="gradient" size="sm" className="text-xs font-semibold px-5 py-2.5 shadow-lg shadow-cyan-500/20 cursor-pointer">
            <Zap className="w-4 h-4 mr-1.5" />
            Scan Domain &amp; Unlock ($49 / $24.50 w/ code)
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6 items-stretch">
        <div className="p-6 rounded-3xl bg-[#0D1017]/90 border border-white/10 hover:border-white/20 backdrop-blur-xl flex flex-col justify-between space-y-6 transition-all">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider">Free</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-semibold">
                Free forever
              </span>
            </div>
            <div>
              <div className="text-4xl font-extrabold text-white font-mono flex items-baseline gap-1">
                $0
                <span className="text-xs font-normal text-slate-400">/ mo</span>
              </div>
              <span className="text-[11px] text-slate-400">No credit card required</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed min-h-[36px]">
              Hobby sites and evaluation: see which AI agents read your site.
            </p>
            <FeatureList items={FREE_FEATURES} iconClass="text-cyan-400" />
          </div>
          <Link href="/login" className="w-full block pt-4">
            <Button variant="outline" className="w-full text-xs font-semibold py-3 border-white/10 hover:bg-white/5 cursor-pointer">
              Start free
            </Button>
          </Link>
        </div>

        {CREDIT_PACKS.map((pack) => (
          <PackCard key={pack.pack} pack={pack} featured={pack.pack === 'growth'} />
        ))}

        <div className="p-6 rounded-3xl bg-[#0D1017]/90 border border-blue-500/30 hover:border-blue-500/50 backdrop-blur-xl flex flex-col justify-between space-y-6 transition-all">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold font-mono text-blue-400 uppercase tracking-wider">Enterprise</span>
              <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30 font-semibold uppercase tracking-wider">
                Contract
              </span>
            </div>
            <div>
              <div className="text-4xl font-extrabold text-white font-mono">Custom</div>
              <span className="text-[11px] text-blue-400 font-semibold font-mono">Custom contract</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed min-h-[36px]">
              For mission-critical applications that are core to your business.
            </p>
            <FeatureList items={ENTERPRISE_FEATURES} iconClass="text-blue-400" />
          </div>
          <Link href="/enterprise/contact" className="w-full block pt-4">
            <Button variant="secondary" className="w-full text-xs font-semibold py-3 border border-blue-500/30 text-blue-300 hover:bg-blue-500/10 hover:border-blue-400/50 cursor-pointer flex items-center justify-center gap-1.5 transition-all">
              <Building2 className="w-4 h-4 mr-1 text-blue-400" />
              Contact sales
              <ArrowRight className="w-3.5 h-3.5 ml-1 text-blue-400" />
            </Button>
          </Link>
        </div>
      </div>

      <div className="max-w-4xl mx-auto rounded-2xl bg-white/[0.02] border border-white/10 p-4 text-center text-xs text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono">
          <Coins className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>
            1 credit = 1 agent event. Credits are valid for 12 months from purchase.{' '}
            <Link href="/refund" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 ml-1">
              Refund Policy
            </Link>
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>Payments powered by Polar.sh</span>
        </div>
      </div>
    </section>
  );
}
