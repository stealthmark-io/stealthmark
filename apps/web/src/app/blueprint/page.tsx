'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { flags } from '@/lib/flags';
import {
  ArrowLeft,
  ArrowRight,
  Shield,
  Zap,
  ShoppingCart,
  Ticket,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  Smartphone,
  Layers,
  Terminal,
  Clock,
  ShieldCheck,
  BellRing
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/context/LanguageContext';
import { ClaimWhitelistModal } from '@/components/landing/ClaimWhitelistModal';

type ScenarioKey = 'saas' | 'marketplace' | 'ticketing';

interface ScenarioInfo {
  id: ScenarioKey;
  badge: string;
  badgeColor: string;
  title: string;
  clientExample: string;
  tagline: string;
  painPoint: string;
  solution: string;
  hitlAction: string;
  phonePushPreview: {
    app: string;
    headline: string;
    details: string;
    amount: string;
    buttonText: string;
  };
  metrics: { label: string; value: string }[];
  steps: { step: number; name: string; latency: string; desc: string }[];
}

const SCENARIOS: Record<ScenarioKey, ScenarioInfo> = {
  saas: {
    id: 'saas',
    badge: 'Scenario 01 · Subscription SaaS',
    badgeColor: 'border-cyan-500/30 text-cyan-300 bg-cyan-500/10',
    title: 'Autonomous Subscription & Onboarding',
    clientExample: 'Example: DemoDental Smile / DemoCV / B2B SaaS',
    tagline: 'Agents discover tiers, execute trials, and self-subscribe in under 10 milliseconds.',
    painPoint: 'Without StealthMark, AI agents cannot sign up or pay. They get blocked by client-side SPAs, cookie banners, and bot challenges, abandoning potential recurring revenue.',
    solution: 'StealthMark delivers an RFC-compliant Action Manifest (/.well-known/agent.json). Agents inspect pricing schemas, verify quotas, and invoke the /agent/v1/subscribe webhook directly.',
    hitlAction: 'Autonomous checkout token generated · Optional enterprise billing manager approval push.',
    phonePushPreview: {
      app: 'DemoDental Enterprise Desk',
      headline: 'Subscription Authorization Request',
      details: 'Agent AutoDev-001 requested access to Pro Tier (250k transactions/mo).',
      amount: '$80.00 USD',
      buttonText: 'Approve via FaceID'
    },
    metrics: [
      { label: 'Time to Provision', value: '8.5 ms' },
      { label: 'Token Efficiency', value: '99.1%' },
      { label: 'Conversion Lift', value: '+34%' }
    ],
    steps: [
      { step: 1, name: 'Schema Discovery', latency: '2.1 ms', desc: 'Agent retrieves /.well-known/agent.json Action Manifest without scraping HTML.' },
      { step: 2, name: 'Tier Qualification', latency: '3.4 ms', desc: 'Agent matches internal user budget against Pro Tier ($80).' },
      { step: 3, name: 'Key Issuance', latency: '3.0 ms', desc: 'API key provisioned deterministically with webhook confirmation.' }
    ]
  },
  marketplace: {
    id: 'marketplace',
    badge: 'Scenario 02 · Retail & Marketplace',
    badgeColor: 'border-amber-500/30 text-amber-300 bg-amber-500/10',
    title: 'Retail Commerce with Human-in-the-Loop (HITL)',
    clientExample: 'Example: Coto / PedidosYa / E-Commerce Marketplaces',
    tagline: 'Agents browse and assemble optimal orders in 30ms. The human retains final purchase authorization.',
    painPoint: 'Marketplace owners fear rogue bots executing unwanted transactions or scraping product inventories, driving origin server CPU to 100% and causing checkout cart abandonment.',
    solution: 'StealthMark introduces the Human-in-the-Loop (HITL) Gate: AI agents parse clean JSON inventory catalogs, compare prices, and assemble the cart. The agent NEVER touches credit card vaults.',
    hitlAction: 'Push notification sent to user smartphone with pre-filled cart ($48.50 USD). 1-tap biometric approval triggers final settlement.',
    phonePushPreview: {
      app: 'Coto Digital Order Dispatch',
      headline: 'Review & Pay Sunday BBQ Cart',
      details: 'Agent built optimal cart: 6 items (Asado, Beverages, Charcoal) with $6.20 USD coupon applied.',
      amount: '$48.50 USD',
      buttonText: 'Tap to Authorize Payment'
    },
    metrics: [
      { label: 'Cart Assembly Time', value: '37.5 ms' },
      { label: 'Origin Server Load', value: '0.2% CPU' },
      { label: 'Unauthorized Buys', value: '0.0%' }
    ],
    steps: [
      { step: 1, name: 'Clean Catalog Read', latency: '12.0 ms', desc: 'Agent requests /agent/v1/catalog, bypassing 4MB JavaScript bundles.' },
      { step: 2, name: 'Autonomous Cart Build', latency: '24.5 ms', desc: 'Agent verifies stock, applies discount codes, and locks 6 items.' },
      { step: 3, name: 'HITL Settlement Dispatch', latency: '1.0 ms', desc: 'Agent HALTS. A cryptographic 1-tap push notification is sent to user phone for payment approval.' }
    ]
  },
  ticketing: {
    id: 'ticketing',
    badge: 'Scenario 03 · Ticketing & High-Concurrency Events',
    badgeColor: 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10',
    title: 'Anti-Scalping Virtual Queue & High-Volume Ticketing',
    clientExample: 'Example: DemoTickets / Concert & Stadium Ticketing',
    tagline: '1 Verified Agent = 1 Real Human Identity. Zero bot farms, zero WAF crashes, ordered checkout.',
    painPoint: 'Ticketing platforms collapse under 500,000 scalper bots spamming F5 refreshes during on-sale drops. Traditional WAFs blindly block real fans with HTTP 403 errors, while bot farms hoard inventory.',
    solution: 'StealthMark replaces chaotic DOM scraping with a Cryptographic KYA Passport (Ed25519) and Silent Socket Queue. Scalper bot farms with forged tokens are dropped in < 1ms at the edge.',
    hitlAction: 'Seats reserved in 9.7ms. One-time biometric checkout link pushed to the verified buyer for immediate card authorization.',
    phonePushPreview: {
      app: 'DemoTickets Official Queue Gate',
      headline: 'Seats Reserved · Position #142',
      details: 'Section 104, Row 12 (Seats 14-15). 7-minute payment window locked for your verified passport.',
      amount: '$140.00 USD (2 Tickets)',
      buttonText: 'Confirm Tickets with Apple Pay'
    },
    metrics: [
      { label: 'Scalper Farms Dropped', value: '100%' },
      { label: 'Server Strain', value: 'Reduced 98%' },
      { label: 'Transaction Latency', value: '9.7 ms' }
    ],
    steps: [
      { step: 1, name: 'KYA Identity Verification', latency: '0.9 ms', desc: 'Edge proxy validates Ed25519 signature. 10,000 headless scalper bots dropped at perimeter.' },
      { step: 2, name: 'Silent Socket Queue', latency: '5.0 ms', desc: 'Agent queues at position #142 via lightweight WebSocket handshake without page reloads.' },
      { step: 3, name: 'Seat Lock & Biometric Handoff', latency: '3.8 ms', desc: 'Tickets reserved. Secure 1-time token dispatched to fan phone for final FaceID authorization.' }
    ]
  }
};

interface SimulationStep {
  latency_ms: number;
  action: string;
  result: string;
}

interface SimulationOutput {
  entity: string;
  total_time_ms: number;
  steps: SimulationStep[];
}

export default function AgenticBlueprintPage() {
  if (!flags.dualDoorDemo) notFound();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<ScenarioKey>('marketplace');
  const [simulating, setSimulating] = useState(false);
  const [simOutput, setSimOutput] = useState<SimulationOutput | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const current = SCENARIOS[activeTab];

  const handleRunSimulation = async (scenario: ScenarioKey) => {
    setSimulating(true);
    setSimOutput(null);
    try {
      const gatewayUrl = process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://gateway.stealthmark.io';
      const resp = await fetch(`${gatewayUrl.replace(/\/$/, '')}/api/v1/blueprint/simulate/${scenario}`, {
        method: 'POST'
      });
      const data: { execution?: SimulationOutput } = await resp.json();
      setSimOutput(data.execution ?? null);
    } catch (e) {
      console.error(e);
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#060709] text-slate-100 py-16 px-4 sm:px-6 lg:px-8 space-y-16">
      <div className="max-w-5xl mx-auto space-y-12">
        
        {/* Navigation Back */}
        <Link href="/" className="inline-flex items-center gap-2 text-xs font-mono text-cyan-400 hover:text-cyan-300 transition">
          <ArrowLeft className="w-3.5 h-3.5" />
          {t.blueprint.backToHome}
        </Link>

        {/* Header Title */}
        <div className="space-y-4 border-b border-white/10 pb-8 text-left">
          <Badge variant="info" pulse className="uppercase tracking-widest text-cyan-300 font-mono text-[10px]">
            {t.blueprint.badge}
          </Badge>
          <h1 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight leading-tight">
            {t.blueprint.title}
          </h1>
          <p className="text-sm sm:text-base text-slate-400 max-w-2xl leading-relaxed">
            {t.blueprint.subtitle}
          </p>
        </div>

        {/* ── Visual Architecture Infographic: The 2 Realities ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
          {/* Reality A: The Blind Maze */}
          <div className="p-6 rounded-3xl bg-rose-950/15 border border-rose-500/20 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-rose-400 uppercase tracking-wider flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                <span>{t.blueprint.withoutStealthmark}</span>
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold">FAIL RATE 82%</span>
            </div>
            
            <div className="p-4 rounded-2xl bg-black/40 border border-white/5 space-y-2.5 font-mono text-[11px] text-slate-400">
              <div className="flex items-center gap-2 text-rose-300">
                <span>❌</span>
                <span>Agent downloads 4MB HTML/JS bundle</span>
              </div>
              <div className="flex items-center gap-2 text-rose-300">
                <span>❌</span>
                <span>Hits Cookie Wall / Cloudflare 403 Captcha</span>
              </div>
              <div className="flex items-center gap-2 text-rose-300">
                <span>❌</span>
                <span>Burns ~18,000 LLM tokens attempting to parse DOM</span>
              </div>
              <div className="flex items-center gap-2 text-rose-400 font-bold">
                <span>💀</span>
                <span>Agent crashes or abandons cart · 0 revenue</span>
              </div>
            </div>
            <p className="text-xs text-slate-400">
              Websites were built for human eyes. Autonomous agents navigating bloated HTML waste thousands of dollars in compute and crash servers.
            </p>
          </div>

          {/* Reality B: The Sovereign Agent Blueprint */}
          <div className="p-6 rounded-3xl bg-cyan-950/20 border border-cyan-500/30 space-y-4 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 blur-2xl rounded-full pointer-events-none"></div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-2">
                <Zap className="w-4 h-4 text-cyan-400" />
                <span>{t.blueprint.withStealthmark}</span>
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold">100% DETERMINISTIC</span>
            </div>
            
            <div className="p-4 rounded-2xl bg-black/40 border border-cyan-500/20 space-y-2.5 font-mono text-[11px] text-slate-300">
              <div className="flex items-center gap-2 text-cyan-300">
                <span>✓</span>
                <span>KYA Passport verified in 0.9 ms</span>
              </div>
              <div className="flex items-center gap-2 text-emerald-300">
                <span>✓</span>
                <span>Reads RFC Action Manifest (326 bytes vs 72 KB)</span>
              </div>
              <div className="flex items-center gap-2 text-emerald-300">
                <span>✓</span>
                <span>Assembles verified cart / simulation in &lt; 30 ms</span>
              </div>
              <div className="flex items-center gap-2 text-cyan-400 font-bold">
                <span>📱</span>
                <span>HITL Guard: 1-Tap Biometric Approval to User</span>
              </div>
            </div>
            <p className="text-xs text-slate-300">
              The agent receives a lightweight flight plan. It executes actions in milliseconds, while the human user authorizes the final purchase safely.
            </p>
          </div>
        </div>

        {/* ── 3 Scenario Selector Tabs ── */}
        <div className="space-y-4">
          <div className="text-left">
            <span className="text-xs font-mono text-slate-400 uppercase tracking-wider font-bold">
              Select Enterprise Blueprint Scenario:
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              onClick={() => { setActiveTab('saas'); setSimOutput(null); }}
              className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                activeTab === 'saas'
                  ? 'border-cyan-400 bg-cyan-950/20 shadow-lg shadow-cyan-500/10'
                  : 'border-white/10 bg-[#0d1017] hover:border-white/20'
              }`}
            >
              <div className="flex items-center gap-2 text-xs font-mono text-cyan-300 font-bold">
                <Zap className="w-4 h-4" />
                <span>01 · Subscription SaaS</span>
              </div>
              <div className="text-sm font-bold text-white mt-1">Instant Onboarding</div>
              <div className="text-[11px] text-slate-400 mt-0.5">DemoDental &amp; DemoCV model</div>
            </button>

            <button
              onClick={() => { setActiveTab('marketplace'); setSimOutput(null); }}
              className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                activeTab === 'marketplace'
                  ? 'border-amber-400 bg-amber-950/20 shadow-lg shadow-amber-500/10'
                  : 'border-white/10 bg-[#0d1017] hover:border-white/20'
              }`}
            >
              <div className="flex items-center gap-2 text-xs font-mono text-amber-300 font-bold">
                <ShoppingCart className="w-4 h-4" />
                <span>02 · Marketplaces</span>
              </div>
              <div className="text-sm font-bold text-white mt-1">HITL Order Settlement</div>
              <div className="text-[11px] text-slate-400 mt-0.5">Coto &amp; PedidosYa model</div>
            </button>

            <button
              onClick={() => { setActiveTab('ticketing'); setSimOutput(null); }}
              className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                activeTab === 'ticketing'
                  ? 'border-emerald-400 bg-emerald-950/20 shadow-lg shadow-emerald-500/10'
                  : 'border-white/10 bg-[#0d1017] hover:border-white/20'
              }`}
            >
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-300 font-bold">
                <Ticket className="w-4 h-4" />
                <span>03 · High-Scale Ticketing</span>
              </div>
              <div className="text-sm font-bold text-white mt-1">Anti-Scalper Virtual Queue</div>
              <div className="text-[11px] text-slate-400 mt-0.5">DemoTickets &amp; Live Nation model</div>
            </button>
          </div>
        </div>

        {/* ── Deep Dive Card for Selected Scenario ── */}
        <div className="bento-card p-6 sm:p-10 rounded-3xl space-y-8 text-left border border-white/10 bg-[#0d1017]/90 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-white/10">
            <div className="space-y-1">
              <span className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full border font-bold uppercase ${current.badgeColor}`}>
                {current.badge}
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mt-1">
                {current.title}
              </h2>
              <div className="text-xs font-mono text-slate-400">{current.clientExample}</div>
            </div>

            <Button
              onClick={() => handleRunSimulation(current.id)}
              disabled={simulating}
              variant="gradient"
              className="text-xs font-bold px-6 py-3 rounded-xl shadow-lg shadow-cyan-500/20 cursor-pointer shrink-0"
            >
              <Sparkles className="w-4 h-4 mr-1.5" />
              <span>{simulating ? 'Simulating...' : 'Run Live Agent Simulation'}</span>
            </Button>
          </div>

          {/* Problem vs Solution Split */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-5 rounded-2xl bg-rose-950/20 border border-rose-500/20 space-y-2">
              <div className="text-xs font-mono font-bold text-rose-400 uppercase">The Legacy Chaos (Without StealthMark)</div>
              <p className="text-xs text-slate-300 leading-relaxed">{current.painPoint}</p>
            </div>

            <div className="p-5 rounded-2xl bg-emerald-950/20 border border-emerald-500/20 space-y-2">
              <div className="text-xs font-mono font-bold text-emerald-400 uppercase">The Sovereign Agent Blueprint (With StealthMark)</div>
              <p className="text-xs text-slate-300 leading-relaxed">{current.solution}</p>
            </div>
          </div>

          {/* ── Visual Smartphone Mockup: The HITL Biometric Push ── */}
          <div className="p-6 rounded-2xl bg-gradient-to-r from-indigo-950/40 via-cyan-950/25 to-slate-900 border border-cyan-500/30 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-cyan-300 uppercase">
                <Smartphone className="w-4 h-4 text-cyan-400" />
                <span>Human-in-the-Loop (HITL) Phone Push Notification</span>
              </div>
              <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
                <BellRing className="w-3 h-3 text-emerald-400" /> Live Delivery
              </span>
            </div>

            {/* iOS style notification bubble */}
            <div className="p-4 rounded-2xl bg-[#141923] border border-white/15 shadow-2xl max-w-xl mx-auto flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300 shrink-0 font-black text-sm">
                SM
              </div>
              <div className="flex-1 space-y-1 text-left">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="font-bold text-white font-mono">{current.phonePushPreview.app}</span>
                  <span className="text-slate-500 font-mono">Just now</span>
                </div>
                <div className="text-xs font-semibold text-slate-200">{current.phonePushPreview.headline}</div>
                <div className="text-[11px] text-slate-400">{current.phonePushPreview.details}</div>
                <div className="pt-2 flex items-center justify-between">
                  <span className="text-sm font-bold font-mono text-emerald-400">{current.phonePushPreview.amount}</span>
                  <span className="px-3 py-1 rounded-lg bg-cyan-500 text-black font-extrabold text-[10px] uppercase tracking-wide shadow-md">
                    {current.phonePushPreview.buttonText}
                  </span>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-center text-slate-400">
              The AI agent assembles the optimal transaction in 30ms, but <strong>the human retains 100% control over the credit card vault</strong>.
            </p>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-3 gap-4 pt-2">
            {current.metrics.map((m, i) => (
              <div key={i} className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                <div className="text-[10px] font-mono uppercase text-slate-400">{m.label}</div>
                <div className="text-xl sm:text-2xl font-black font-mono text-cyan-300 mt-1">{m.value}</div>
              </div>
            ))}
          </div>

          {/* Step by Step Execution Path */}
          <div className="space-y-3 pt-4 border-t border-white/10">
            <div className="text-xs font-mono font-bold uppercase text-slate-400 tracking-wider">StealthMark Agentic Blueprint Execution Path:</div>
            <div className="space-y-2.5">
              {current.steps.map((st) => (
                <div key={st.step} className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-lg bg-cyan-500/10 text-cyan-300 font-mono font-bold flex items-center justify-center text-[11px] shrink-0">
                      0{st.step}
                    </span>
                    <span className="font-semibold text-white">{st.name}</span>
                    <span className="text-slate-400 hidden sm:inline text-[11px]">— {st.desc}</span>
                  </div>
                  <span className="font-mono text-[11px] text-emerald-400 shrink-0 font-bold ml-2">
                    {st.latency}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Live Simulation Output Box */}
          {simOutput && (
            <div className="p-5 rounded-2xl bg-black/60 border border-cyan-500/40 space-y-3 font-mono text-xs">
              <div className="flex justify-between items-center text-cyan-300 pb-2 border-b border-white/10">
                <span>SIMULATED AGENT EXECUTION LOG ({simOutput.entity})</span>
                <span className="text-emerald-400 font-bold">TOTAL: {simOutput.total_time_ms} ms</span>
              </div>
              <div className="space-y-1.5 text-slate-300 text-[11px]">
                {simOutput.steps.map((s, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-cyan-400 font-bold">[{s.latency_ms}ms]</span>
                    <span className="text-white font-semibold">{s.action}:</span>
                    <span className="text-emerald-300">{s.result}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* ── Enterprise Pricing & Consultation CTA ── */}
        <div className="p-8 rounded-3xl bg-gradient-to-r from-indigo-950/40 via-cyan-950/30 to-emerald-950/40 border border-cyan-500/30 text-center space-y-4">
          <h3 className="text-2xl font-bold text-white">Ready to Map and Shield Your Enterprise Platform?</h3>
          <p className="text-xs sm:text-sm text-slate-300 max-w-xl mx-auto">
            Book an architectural briefing or request a custom Agent Blueprint audit for your engineering team.
          </p>
          <div className="flex flex-wrap justify-center gap-4 pt-2">
            <Link
              href="/enterprise/contact"
              className="px-6 py-3 rounded-xl bg-white text-black font-bold text-xs hover:bg-slate-200 transition shadow-md flex items-center gap-1.5"
            >
              <span>Request Blueprint Consultation</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="px-6 py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 text-white font-mono text-xs transition cursor-pointer"
            >
              Claim Your Spot — Priority Whitelist →
            </button>
          </div>
        </div>

        <ClaimWhitelistModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          defaultUseCase="Enterprise API Gateway & Compliance"
        />

      </div>
    </div>
  );
}
