'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { MapPin, Navigation, AlertTriangle, CheckCircle2, Route, Zap } from 'lucide-react';

/* ── Domain-contextual flight plan data ─────────────────────────── */

interface FlightStep {
  step: number;
  action: string;
  path: string;
  ms: number;
  requires?: string[];
}

interface FlightPlanData {
  domain: string;
  label: string;
  routes: FlightStep[];
  totalMs: number;
  tokensUsed: number;
}

const FLIGHT_PLANS: Record<string, FlightPlanData> = {
  demodental: {
    domain: 'demodental.example.com',
    label: 'DemoDental Smile — Cosmetic Dentistry',
    routes: [
      { step: 1, action: 'GET_PLANS', path: '/agent/v1/plans', ms: 3.2 },
      { step: 2, action: 'SIMULATE_SMILE', path: '/agent/v1/simulate', requires: ['photo', 'shade'], ms: 8.1 },
      { step: 3, action: 'CHECKOUT', path: '/agent/v1/checkout', ms: 2.4 },
    ],
    totalMs: 13.7,
    tokensUsed: 182,
  },
  demotickets: {
    domain: 'demotickets.example.com',
    label: 'DemoTickets — Sports Ticketing Platform',
    routes: [
      { step: 1, action: 'LIST_EVENTS', path: '/agent/v1/events', ms: 2.8 },
      { step: 2, action: 'CHECK_AVAILABILITY', path: '/agent/v1/seats', requires: ['event_id', 'section'], ms: 4.2 },
      { step: 3, action: 'PURCHASE_TICKETS', path: '/agent/v1/purchase', requires: ['seat_ids', 'payment_token'], ms: 6.1 },
    ],
    totalMs: 13.1,
    tokensUsed: 196,
  },
  democv: {
    domain: 'democv.example.com',
    label: 'DemoCV — Deterministic ATS Optimization',
    routes: [
      { step: 1, action: 'UPLOAD_CV', path: '/agent/v1/upload', requires: ['cv_pdf'], ms: 5.4 },
      { step: 2, action: 'AUDIT_CV', path: '/agent/v1/audit', ms: 12.3 },
      { step: 3, action: 'GET_REPORT', path: '/agent/v1/report', ms: 1.8 },
    ],
    totalMs: 19.5,
    tokensUsed: 214,
  },
  coto: {
    domain: 'coto.com.ar',
    label: 'Coto Digital — Retail & Supermarket Marketplace',
    routes: [
      { step: 1, action: 'GET_CATALOG', path: '/agent/v1/catalog', ms: 12.0 },
      { step: 2, action: 'BUILD_CART', path: '/agent/v1/cart/build', requires: ['items', 'zipcode'], ms: 24.5 },
      { step: 3, action: 'HITL_APPROVAL', path: '/agent/v1/checkout/push-auth', requires: ['biometric_auth'], ms: 1.0 },
    ],
    totalMs: 37.5,
    tokensUsed: 198,
  },
  pedidosya: {
    domain: 'pedidosya.com.ar',
    label: 'PedidosYa — Quick Commerce & Food Delivery',
    routes: [
      { step: 1, action: 'LIST_STORES', path: '/agent/v1/restaurants', ms: 9.5 },
      { step: 2, action: 'QUOTE_ORDER', path: '/agent/v1/order/quote', requires: ['items'], ms: 18.2 },
      { step: 3, action: 'HITL_SETTLEMENT', path: '/agent/v1/order/push-auth', requires: ['biometric_auth'], ms: 1.0 },
    ],
    totalMs: 28.7,
    tokensUsed: 185,
  },
  default: {
    domain: 'your-website.com',
    label: 'Your Web Application',
    routes: [
      { step: 1, action: 'DISCOVER_CATALOG', path: '/agent/v1/manifest', ms: 2.1 },
      { step: 2, action: 'EXECUTE_ACTION', path: '/agent/v1/action', requires: ['intent', 'params'], ms: 6.8 },
      { step: 3, action: 'CONFIRM_RESULT', path: '/agent/v1/confirm', ms: 1.9 },
    ],
    totalMs: 10.8,
    tokensUsed: 156,
  },
};

function getFlightPlan(scannedDomain: string): FlightPlanData {
  const lower = scannedDomain.toLowerCase();
  for (const key of Object.keys(FLIGHT_PLANS)) {
    if (key !== 'default' && lower.includes(key)) return FLIGHT_PLANS[key];
  }
  return { ...FLIGHT_PLANS.default, domain: scannedDomain || 'your-website.com' };
}

/* ── Maze animation steps (the "Without StealthMark" chaos) ───── */

interface MazeStep {
  label: string;
  type: 'error' | 'warning' | 'loading';
  tokensAccum: number;
  ms: number;
}

const MAZE_STEPS: MazeStep[] = [
  { label: 'Downloading HTML DOM...', type: 'loading', tokensAccum: 4200, ms: 1200 },
  { label: 'Parsing 23 React bundles...', type: 'loading', tokensAccum: 8900, ms: 2400 },
  { label: 'Blocked by Cookie Consent Banner', type: 'error', tokensAccum: 9100, ms: 2800 },
  { label: 'Retrying with headless bypass...', type: 'warning', tokensAccum: 12300, ms: 3600 },
  { label: 'Interpreting minified CSS selectors...', type: 'loading', tokensAccum: 15800, ms: 4100 },
  { label: 'Token budget exceeded — ABANDONED', type: 'error', tokensAccum: 18450, ms: 4800 },
];

/* ── Component ──────────────────────────────────────────────────── */

interface AgentFlightPlanProps {
  scannedDomain: string;
  badgeColor: 'rose' | 'amber' | 'emerald';
}

export function AgentFlightPlan({ scannedDomain, badgeColor }: AgentFlightPlanProps) {
  const plan = getFlightPlan(scannedDomain);
  const isProtected = badgeColor === 'emerald';

  /* ── Animation state ── */
  const [mazeStep, setMazeStep] = useState(-1);
  const [flightStep, setFlightStep] = useState(-1);
  const [isAnimating, setIsAnimating] = useState(false);

  const runAnimation = useCallback(() => {
    setIsAnimating(true);
    setMazeStep(-1);
    setFlightStep(-1);

    /* Maze side — stagger steps */
    MAZE_STEPS.forEach((_, i) => {
      setTimeout(() => setMazeStep(i), (i + 1) * 700);
    });

    /* Flight Plan side — faster, cleaner */
    plan.routes.forEach((_, i) => {
      setTimeout(() => setFlightStep(i), (i + 1) * 500 + 200);
    });

    /* Mark complete */
    const totalDuration = Math.max(MAZE_STEPS.length * 700, plan.routes.length * 500 + 200) + 800;
    setTimeout(() => setIsAnimating(false), totalDuration);
  }, [plan.routes]);

  /* Auto-play once on mount */
  useEffect(() => {
    const timer = setTimeout(runAnimation, 600);
    return () => clearTimeout(timer);
  }, [runAnimation]);

  const mazeComplete = mazeStep >= MAZE_STEPS.length - 1;
  const flightComplete = flightStep >= plan.routes.length - 1;

  return (
    <div className="space-y-4 pt-4">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Route className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-bold uppercase text-white tracking-wider">Agent Flight Plan Comparison</span>
        </div>
        <button
          onClick={runAnimation}
          disabled={isAnimating}
          className="text-[10px] font-mono px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-cyan-400 hover:border-cyan-500/30 transition disabled:opacity-40 cursor-pointer"
        >
          {isAnimating ? '⏳ Simulating...' : '▶ Replay'}
        </button>
      </div>

      {/* Dual Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* ── LEFT: Without StealthMark (The Maze) ──────────── */}
        <div className="relative rounded-2xl border border-rose-500/30 bg-[#0a0810]/90 p-5 space-y-4 overflow-hidden">
          {/* Background chaos pattern */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none">
            <svg width="100%" height="100%">
              <defs>
                <pattern id="maze-pattern" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M0 20h20v20M20 0v20h20" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-rose-500" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#maze-pattern)" />
            </svg>
          </div>

          {/* Header */}
          <div className="relative flex items-center justify-between pb-3 border-b border-rose-500/20">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              <span className="text-[10px] font-mono font-bold text-rose-400 uppercase tracking-widest">Without StealthMark</span>
            </div>
            <span className="text-[10px] font-mono text-slate-500">Traditional Web</span>
          </div>

          {/* Timeline Steps */}
          <div className="relative space-y-2.5 min-h-[220px]">
            {MAZE_STEPS.map((step, i) => {
              const isActive = mazeStep >= i;
              const isCurrent = mazeStep === i;
              return (
                <div
                  key={i}
                  className={`flex items-start gap-3 transition-all duration-500 ${
                    isActive ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'
                  }`}
                >
                  {/* Step indicator */}
                  <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                    step.type === 'error'
                      ? 'bg-rose-500/20 border border-rose-500/40'
                      : step.type === 'warning'
                      ? 'bg-amber-500/20 border border-amber-500/40'
                      : 'bg-white/5 border border-white/10'
                  }`}>
                    {step.type === 'error' ? (
                      <AlertTriangle className="w-3 h-3 text-rose-400" />
                    ) : step.type === 'warning' ? (
                      <AlertTriangle className="w-3 h-3 text-amber-400" />
                    ) : (
                      <span className={`w-2 h-2 rounded-full ${isCurrent ? 'bg-slate-300 animate-pulse' : 'bg-slate-500'}`} />
                    )}
                  </div>
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className={`text-[11px] font-mono leading-relaxed ${
                      step.type === 'error' ? 'text-rose-300 font-bold' :
                      step.type === 'warning' ? 'text-amber-300' : 'text-slate-400'
                    }`}>
                      {step.label}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[9px] font-mono text-slate-500">{step.ms.toLocaleString()}ms</span>
                      <span className="text-[9px] font-mono text-rose-400/80">{step.tokensAccum.toLocaleString()} tokens</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Final verdict */}
          <div className={`relative flex items-center justify-between pt-3 border-t border-rose-500/20 transition-all duration-700 ${
            mazeComplete ? 'opacity-100' : 'opacity-0'
          }`}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              <span className="text-xs font-bold text-rose-300">AGENT ABANDONED</span>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-mono">
              <span className="text-rose-400">18,450 tokens</span>
              <span className="text-slate-500">·</span>
              <span className="text-rose-400">4,800ms</span>
              <span className="text-slate-500">·</span>
              <span className="text-rose-400 font-bold">82% drop-off</span>
            </div>
          </div>
        </div>

        {/* ── RIGHT: With StealthMark Flight Plan (The Highway) ─ */}
        <div className="relative rounded-2xl border border-emerald-500/30 bg-[#060d0a]/90 p-5 space-y-4 overflow-hidden">
          {/* Background route pattern */}
          <div className="absolute inset-0 opacity-[0.04] pointer-events-none">
            <svg width="100%" height="100%">
              <defs>
                <pattern id="route-pattern" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
                  <circle cx="30" cy="30" r="1" fill="currentColor" className="text-emerald-400" />
                  <line x1="30" y1="0" x2="30" y2="60" stroke="currentColor" strokeWidth="0.3" className="text-emerald-400" strokeDasharray="4 8" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#route-pattern)" />
            </svg>
          </div>

          {/* Header */}
          <div className="relative flex items-center justify-between pb-3 border-b border-emerald-500/20">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-widest">With StealthMark Flight Plan</span>
            </div>
            <span className="text-[10px] font-mono text-emerald-500/60">{plan.domain}</span>
          </div>

          {/* Protocol badge */}
          <div className="relative flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
            <Navigation className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[10px] font-mono text-cyan-300">
              stealthmark_flight_plan_v1 → <span className="text-emerald-300">{plan.label}</span>
            </span>
          </div>

          {/* Flight Route Steps */}
          <div className="relative space-y-3 min-h-[180px]">
            {/* Vertical connecting line */}
            <div className="absolute left-[11px] top-3 bottom-3 w-px bg-gradient-to-b from-emerald-500/40 via-cyan-500/30 to-emerald-500/40" />

            {plan.routes.map((route, i) => {
              const isActive = flightStep >= i;
              const isCurrent = flightStep === i;
              return (
                <div
                  key={i}
                  className={`flex items-start gap-3 transition-all duration-400 ${
                    isActive ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4'
                  }`}
                >
                  {/* Waypoint dot */}
                  <div className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all ${
                    isActive
                      ? 'bg-emerald-500/30 border-2 border-emerald-400 shadow-lg shadow-emerald-500/30'
                      : 'bg-white/5 border border-white/10'
                  } ${isCurrent ? 'scale-125' : ''}`}>
                    {isActive ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-300" />
                    ) : (
                      <MapPin className="w-3 h-3 text-slate-500" />
                    )}
                  </div>
                  {/* Route info */}
                  <div className="flex-1 min-w-0 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded">
                        STEP {route.step}
                      </span>
                      <span className="text-[11px] font-mono font-bold text-white">{route.action}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] font-mono text-cyan-400/70">{route.path}</span>
                      <span className="text-[9px] font-mono text-emerald-400">{route.ms}ms</span>
                    </div>
                    {route.requires && (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        {route.requires.map((r) => (
                          <span key={r} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300/70 border border-cyan-500/15">
                            {r}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Final verdict */}
          <div className={`relative flex items-center justify-between pt-3 border-t border-emerald-500/20 transition-all duration-700 ${
            flightComplete ? 'opacity-100' : 'opacity-0'
          }`}>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-emerald-300">TRANSACTION SIGNED</span>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-mono">
              <span className="text-emerald-400">{plan.tokensUsed} tokens</span>
              <span className="text-slate-500">·</span>
              <span className="text-emerald-400">{plan.totalMs}ms</span>
              <span className="text-slate-500">·</span>
              <span className="text-emerald-400 font-bold">99.4% conversion</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom comparison bar */}
      <div className="flex items-center justify-center gap-6 py-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className="text-slate-500">Token Savings:</span>
          <span className="text-emerald-400 font-bold">{((1 - plan.tokensUsed / 18450) * 100).toFixed(1)}%</span>
        </div>
        <div className="w-px h-4 bg-white/10" />
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className="text-slate-500">Speed Improvement:</span>
          <span className="text-cyan-400 font-bold">{(4800 / plan.totalMs).toFixed(0)}x faster</span>
        </div>
        <div className="w-px h-4 bg-white/10" />
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className="text-slate-500">Conversion Delta:</span>
          <span className="text-emerald-400 font-bold">+17.4%</span>
        </div>
      </div>
    </div>
  );
}
