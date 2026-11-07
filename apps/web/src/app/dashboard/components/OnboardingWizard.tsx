'use client';

import React, { useState, useCallback } from 'react';
import {
  Globe, Search, CheckCircle2, ShieldCheck, ShoppingCart, Calendar,
  FileText, SearchIcon, LayoutList, ChevronRight, ToggleLeft, ToggleRight,
  Copy, Check, Terminal, Wifi, ArrowRight, Sparkles, Route, Lock, Gauge,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/* ═══════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════ */

interface DetectedCapability {
  id: string;
  label: string;
  action: string;
  method: 'GET' | 'POST';
  path: string;
  icon: React.ReactNode;
  enabled: boolean;
  rateLimit: number;
  isBlocked?: boolean;
}

interface OnboardingState {
  domain: string;
  capabilities: DetectedCapability[];
}

interface OnboardingWizardProps {
  onComplete: (domain: string, capabilities: DetectedCapability[]) => void;
}

/* ═══════════════════════════════════════════════════════════════════
   Domain → Capability Detection (Client-side)
   ═══════════════════════════════════════════════════════════════════ */

const DOMAIN_PRESETS: Record<string, DetectedCapability[]> = {
  demodental: [
    { id: 'plans', label: 'Browse Treatment Plans', action: 'GET_PLANS', method: 'GET', path: '/agent/v1/plans', icon: <LayoutList className="w-4 h-4" />, enabled: true, rateLimit: 60 },
    { id: 'simulate', label: 'Generate Smile Simulation', action: 'SIMULATE_SMILE', method: 'POST', path: '/agent/v1/simulate', icon: <Sparkles className="w-4 h-4" />, enabled: true, rateLimit: 20 },
    { id: 'checkout', label: 'Subscribe to Plan', action: 'CHECKOUT', method: 'POST', path: '/agent/v1/checkout', icon: <ShoppingCart className="w-4 h-4" />, enabled: true, rateLimit: 10 },
    { id: 'admin', label: 'Access Admin Panel', action: 'ADMIN_ACCESS', method: 'GET', path: '/admin/*', icon: <Lock className="w-4 h-4" />, enabled: false, rateLimit: 0, isBlocked: true },
  ],
  demotickets: [
    { id: 'events', label: 'Browse Event Catalog', action: 'LIST_EVENTS', method: 'GET', path: '/agent/v1/events', icon: <Calendar className="w-4 h-4" />, enabled: true, rateLimit: 120 },
    { id: 'seats', label: 'Check Seat Availability', action: 'CHECK_SEATS', method: 'GET', path: '/agent/v1/seats', icon: <SearchIcon className="w-4 h-4" />, enabled: true, rateLimit: 60 },
    { id: 'purchase', label: 'Purchase Tickets', action: 'PURCHASE', method: 'POST', path: '/agent/v1/purchase', icon: <ShoppingCart className="w-4 h-4" />, enabled: true, rateLimit: 10 },
    { id: 'abandoned', label: 'View Abandoned Carts', action: 'VIEW_CARTS', method: 'GET', path: '/cart/abandoned', icon: <Lock className="w-4 h-4" />, enabled: false, rateLimit: 0, isBlocked: true },
  ],
  democv: [
    { id: 'upload', label: 'Upload CV for Audit', action: 'UPLOAD_CV', method: 'POST', path: '/agent/v1/upload', icon: <FileText className="w-4 h-4" />, enabled: true, rateLimit: 30 },
    { id: 'audit', label: 'Run ATS Optimization', action: 'AUDIT_CV', method: 'POST', path: '/agent/v1/audit', icon: <Sparkles className="w-4 h-4" />, enabled: true, rateLimit: 20 },
    { id: 'report', label: 'Download Report', action: 'GET_REPORT', method: 'GET', path: '/agent/v1/report', icon: <FileText className="w-4 h-4" />, enabled: true, rateLimit: 60 },
    { id: 'users', label: 'Access User Database', action: 'DB_ACCESS', method: 'GET', path: '/api/users/*', icon: <Lock className="w-4 h-4" />, enabled: false, rateLimit: 0, isBlocked: true },
  ],
  stealthmark: [
    { id: 'scanner', label: 'Audit Website Security', action: 'AUDIT_URL', method: 'POST', path: '/api/v1/scanner/audit-url', icon: <SearchIcon className="w-4 h-4" />, enabled: true, rateLimit: 60 },
    { id: 'waitlist', label: 'Request Early Access', action: 'REQUEST_EARLY_ACCESS', method: 'POST', path: '/api/waitlist', icon: <FileText className="w-4 h-4" />, enabled: true, rateLimit: 30 },
    { id: 'enterprise', label: 'Request a Technical Session', action: 'CONTACT_SALES', method: 'POST', path: '/api/enterprise/contact', icon: <LayoutList className="w-4 h-4" />, enabled: true, rateLimit: 10 },
    { id: 'admin', label: 'Access Admin Area', action: 'ADMIN_ACCESS', method: 'GET', path: '/admin/*', icon: <Lock className="w-4 h-4" />, enabled: false, rateLimit: 0, isBlocked: true },
  ],
};

function detectCapabilities(domain: string): DetectedCapability[] {
  const lower = domain.toLowerCase();
  for (const key of Object.keys(DOMAIN_PRESETS)) {
    if (lower.includes(key)) return DOMAIN_PRESETS[key].map(c => ({ ...c }));
  }
  // Generic detection for unknown domains
  return [
    { id: 'catalog', label: 'Browse Product Catalog', action: 'BROWSE_CATALOG', method: 'GET', path: '/agent/v1/catalog', icon: <LayoutList className="w-4 h-4" />, enabled: true, rateLimit: 120 },
    { id: 'search', label: 'Search Products / Services', action: 'SEARCH', method: 'GET', path: '/agent/v1/search', icon: <SearchIcon className="w-4 h-4" />, enabled: true, rateLimit: 60 },
    { id: 'purchase', label: 'Complete Purchase', action: 'PURCHASE', method: 'POST', path: '/agent/v1/purchase', icon: <ShoppingCart className="w-4 h-4" />, enabled: true, rateLimit: 10 },
    { id: 'contact', label: 'Submit Contact Form', action: 'SUBMIT_FORM', method: 'POST', path: '/agent/v1/contact', icon: <FileText className="w-4 h-4" />, enabled: true, rateLimit: 5 },
    { id: 'admin', label: 'Access Admin Area', action: 'ADMIN_ACCESS', method: 'GET', path: '/admin/*', icon: <Lock className="w-4 h-4" />, enabled: false, rateLimit: 0, isBlocked: true },
  ];
}

function renderWizardCapabilityIcon(cap?: DetectedCapability) {
  if (!cap) return <Route className="w-4 h-4 text-cyan-400" />;
  if (React.isValidElement(cap.icon)) return cap.icon;
  if (cap.isBlocked) return <Lock className="w-4 h-4 text-rose-400" />;
  const action = typeof cap.action === 'string' ? cap.action : '';
  const path = typeof cap.path === 'string' ? cap.path : '';
  if (action.includes('AUDIT') || path.includes('audit')) return <ShieldCheck className="w-4 h-4 text-emerald-400" />;
  if (action.includes('SEARCH') || path.includes('search')) return <Search className="w-4 h-4 text-cyan-400" />;
  if (action.includes('CHECKOUT') || path.includes('checkout') || action.includes('PURCHASE')) return <ShoppingCart className="w-4 h-4 text-amber-400" />;
  if (action.includes('PLANS') || path.includes('plan') || path.includes('catalog')) return <LayoutList className="w-4 h-4 text-indigo-400" />;
  return <Route className="w-4 h-4 text-cyan-400" />;
}

/* ═══════════════════════════════════════════════════════════════════
   OnboardingWizard
   ═══════════════════════════════════════════════════════════════════ */

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [state, setState] = useState<OnboardingState>({
    domain: '',
    capabilities: [],
  });
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  /* ── Step 1: Scan Domain ── */
  const handleScan = useCallback(() => {
    if (!state.domain.trim()) return;
    setScanning(true);
    setScanDone(false);
    setTimeout(() => {
      const caps = detectCapabilities(state.domain);
      setState(prev => ({ ...prev, capabilities: caps }));
      setScanning(false);
      setScanDone(true);
    }, 2000);
  }, [state.domain]);

  /* ── Step 2: Toggle capability ── */
  const toggleCapability = (id: string) => {
    setState(prev => ({
      ...prev,
      capabilities: prev.capabilities.map(c =>
        c.id === id && !c.isBlocked ? { ...c, enabled: !c.enabled } : c
      ),
    }));
  };

  const updateRateLimit = (id: string, value: number) => {
    setState(prev => ({
      ...prev,
      capabilities: prev.capabilities.map(c =>
        c.id === id ? { ...c, rateLimit: value } : c
      ),
    }));
  };

  /* ── Step 3: Copy helper ── */
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  /* ── Generate Flight Plan JSON ── */
  const generateFlightPlan = () => {
    const enabled = state.capabilities.filter(c => c.enabled && !c.isBlocked);
    const blocked = state.capabilities.filter(c => !c.enabled || c.isBlocked);
    return JSON.stringify({
      route_map: 'stealthmark_v1',
      domain: state.domain,
      routes: enabled.map((c, i) => ({
        step: i + 1,
        action: c.action,
        method: c.method,
        path: c.path,
        rate_limit_rpm: c.rateLimit,
      })),
      blocked_paths: blocked.map(c => c.path),
    }, null, 2);
  };

  const handleComplete = () => {
    onComplete(state.domain, state.capabilities);
  };

  /* ── Stepper ── */
  const steps = [
    { num: 1, label: 'Your Site', icon: <Globe className="w-4 h-4" /> },
    { num: 2, label: 'Route Map', icon: <Route className="w-4 h-4" /> },
    { num: 3, label: 'Install', icon: <Wifi className="w-4 h-4" /> },
  ];

  const middlewareCode = `// middleware.ts (Next.js App Router)
import { NextResponse } from 'next/server';
import { withStealthMark } from '@stealthmark/next';

export default withStealthMark(() => NextResponse.next(), {
  siteName: '${state.domain || 'yourdomain.com'}',
  apiKey: process.env.STEALTHMARK_API_KEY,
  agentPolicy: 'observe', // 'observe' (default) | 'manifest' | 'block'
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};`;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* ── Header ── */}
      <div className="text-center space-y-3">
        <Badge variant="info" pulse className="uppercase tracking-widest text-cyan-300 font-mono text-[10px]">
          Setup Wizard
        </Badge>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          Add Your Site
        </h2>
        <p className="text-sm text-slate-400 max-w-lg mx-auto">
          Name your site, review the routes agents ask for, then add the middleware. Two-line install, no DNS change.
        </p>
      </div>

      {/* ── Step Bar ── */}
      <div className="flex items-center justify-center gap-2 sm:gap-4">
        {steps.map((s, i) => (
          <React.Fragment key={s.num}>
            <button
              onClick={() => { if (s.num < step || (s.num === 2 && scanDone)) setStep(s.num); }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                step === s.num
                  ? 'bg-gradient-to-r from-indigo-600/30 to-cyan-500/30 text-white border border-cyan-500/40 shadow-lg shadow-cyan-950/40'
                  : step > s.num
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : 'bg-white/5 text-slate-500 border border-white/10'
              }`}
            >
              {step > s.num ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                s.icon
              )}
              <span className="hidden sm:inline">{s.label}</span>
              <span className="sm:hidden">{s.num}</span>
            </button>
            {i < steps.length - 1 && (
              <ChevronRight className={`w-4 h-4 shrink-0 ${step > s.num ? 'text-emerald-500' : 'text-white/15'}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* ═══ STEP 1: Domain Scanner ═══════════════════════════════ */}
      {step === 1 && (
        <div className="p-6 sm:p-8 rounded-3xl bg-[#0d1017]/85 border border-white/10 backdrop-blur-xl space-y-6 shadow-2xl">
          <div className="space-y-2">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Globe className="w-5 h-5 text-cyan-400" />
              Enter Your Domain
            </h3>
            <p className="text-xs text-slate-400">Start from a template of the routes agents usually ask for. You can edit it in the next step.</p>
          </div>

          {/* Input */}
          <div className="p-1.5 rounded-2xl bg-[#060709] border border-white/15 flex flex-col sm:flex-row items-center gap-2 focus-within:border-cyan-500/60 transition">
            <div className="flex items-center gap-2 pl-3 w-full sm:w-auto flex-1 font-mono text-xs text-slate-400">
              <span className="text-cyan-400 font-bold select-none">https://</span>
              <input
                type="text"
                value={state.domain}
                onChange={(e) => setState(prev => ({ ...prev, domain: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                placeholder="your-website.com"
                className="w-full bg-transparent border-none text-white focus:outline-none placeholder-slate-600 font-sans text-sm"
              />
            </div>
            <button
              onClick={handleScan}
              disabled={scanning || !state.domain.trim()}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-500 hover:opacity-95 text-white font-bold text-xs tracking-wide uppercase transition shrink-0 flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            >
              {scanning ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Loading...</span>
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  <span>Load Template</span>
                </>
              )}
            </button>
          </div>

          {/* Presets */}
          <div className="flex items-center justify-center gap-2 text-[11px] text-slate-500 font-mono">
            <span>Demo templates:</span>
            {['demodental.example.com', 'demotickets.example.com', 'democv.example.com'].map((d) => (
              <button
                key={d}
                onClick={() => { setState(prev => ({ ...prev, domain: d })); }}
                className="text-slate-400 hover:text-cyan-400 transition underline underline-offset-2 cursor-pointer"
              >
                {d}
              </button>
            ))}
          </div>

          {/* Scan Results */}
          {scanDone && state.capabilities.length > 0 && (
            <div className="space-y-4 pt-4 border-t border-white/10">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span className="text-sm font-bold text-white">
                  Template ready: {state.capabilities.filter(c => !c.isBlocked).length} agent-accessible routes
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {state.capabilities.map((cap) => (
                  <div
                    key={cap.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition ${
                      cap.isBlocked
                        ? 'border-rose-500/20 bg-rose-950/15 opacity-60'
                        : 'border-white/10 bg-white/[0.02]'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      cap.isBlocked ? 'bg-rose-500/10 text-rose-400' : 'bg-cyan-500/10 text-cyan-400'
                    }`}>
                      {renderWizardCapabilityIcon(cap)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-white">{cap.label}</div>
                      <div className="text-[10px] font-mono text-slate-500">{cap.method} {cap.path}</div>
                    </div>
                    {cap.isBlocked ? (
                      <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">EXCLUDED</span>
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    )}
                  </div>
                ))}
              </div>

              <Button
                onClick={() => setStep(2)}
                variant="gradient"
                className="w-full rounded-xl shadow-lg shadow-cyan-600/20 cursor-pointer"
              >
                <span>Review Route Map</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ═══ STEP 2: Visual Agent Map Builder ═════════════════════ */}
      {step === 2 && (
        <div className="p-6 sm:p-8 rounded-3xl bg-[#0d1017]/85 border border-white/10 backdrop-blur-xl space-y-6 shadow-2xl">
          <div className="space-y-2">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Route className="w-5 h-5 text-cyan-400" />
              Route Map for <span className="text-cyan-300 font-mono">{state.domain}</span>
            </h3>
            <p className="text-xs text-slate-400">
              Choose which routes you want agents to see. The map is saved with your site as a reference. The policy agents actually meet (observe, manifest or block) is set in your middleware.
            </p>
          </div>

          {/* Permission Toggles */}
          <div className="space-y-3">
            {state.capabilities.map((cap) => (
              <div
                key={cap.id}
                className={`p-4 rounded-xl border transition ${
                  cap.isBlocked
                    ? 'border-rose-500/25 bg-rose-950/10'
                    : cap.enabled
                    ? 'border-emerald-500/25 bg-emerald-950/10'
                    : 'border-white/10 bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                      cap.isBlocked ? 'bg-rose-500/15 text-rose-400' :
                      cap.enabled ? 'bg-emerald-500/15 text-emerald-400' :
                      'bg-white/5 text-slate-500'
                    }`}>
                      {renderWizardCapabilityIcon(cap)}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-white">{cap.label}</div>
                      <div className="text-[10px] font-mono text-slate-500">
                        {cap.method} <span className="text-cyan-400/60">{cap.path}</span>
                      </div>
                    </div>
                  </div>

                  {/* Toggle */}
                  {cap.isBlocked ? (
                    <div className="flex items-center gap-2">
                      <Lock className="w-3.5 h-3.5 text-rose-400" />
                      <span className="text-[10px] font-mono text-rose-400 font-bold">ALWAYS EXCLUDED</span>
                    </div>
                  ) : (
                    <button
                      onClick={() => toggleCapability(cap.id)}
                      className="cursor-pointer shrink-0"
                    >
                      {cap.enabled ? (
                        <ToggleRight className="w-8 h-8 text-emerald-400" />
                      ) : (
                        <ToggleLeft className="w-8 h-8 text-slate-500" />
                      )}
                    </button>
                  )}
                </div>

                {/* Rate Limit slider (only for enabled, non-blocked) */}
                {cap.enabled && !cap.isBlocked && (
                  <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-3">
                    <Gauge className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="text-[10px] font-mono text-slate-500 shrink-0">Planned limit:</span>
                    <input
                      type="range"
                      min={1}
                      max={120}
                      value={cap.rateLimit}
                      onChange={(e) => updateRateLimit(cap.id, Number(e.target.value))}
                      className="flex-1 h-1 appearance-none bg-white/10 rounded-full accent-cyan-500 cursor-pointer"
                    />
                    <span className="text-[10px] font-mono text-cyan-400 font-bold w-16 text-right">
                      {cap.rateLimit} req/min
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Generated Flight Plan Preview */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">Route Map (JSON)</span>
            </div>
            <div className="relative">
              <pre className="p-4 rounded-xl bg-[#060709] border border-white/10 text-[11px] font-mono text-cyan-300 overflow-x-auto max-h-[200px] overflow-y-auto leading-relaxed">
                {generateFlightPlan()}
              </pre>
              <button
                onClick={() => copyToClipboard(generateFlightPlan(), 'blueprint')}
                className="absolute top-3 right-3 p-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition cursor-pointer"
              >
                {copied === 'blueprint' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              </button>
            </div>
          </div>

          <Button
            onClick={() => setStep(3)}
            variant="gradient"
            className="w-full rounded-xl shadow-lg shadow-cyan-600/20 cursor-pointer"
          >
            <span>Continue to Install</span>
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* ═══ STEP 3: Activation ═══════════════════════════════════ */}
      {step === 3 && (
        <div className="p-6 sm:p-8 rounded-3xl bg-[#0d1017]/85 border border-white/10 backdrop-blur-xl space-y-6 shadow-2xl">
          <div className="space-y-2">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Wifi className="w-5 h-5 text-emerald-400" />
              Install the Middleware
            </h3>
            <p className="text-xs text-slate-400">Two-line install, no DNS change, no origin rewrite. Same page for humans.</p>
          </div>

          <div className="space-y-4">
            <div className="p-5 rounded-xl bg-[#060709] border border-indigo-500/20 space-y-3">
              <div className="text-xs font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5" />
                Add this middleware to your project
              </div>
              <div className="relative">
                <pre className="p-4 rounded-lg bg-black/50 border border-white/5 text-[11px] font-mono text-indigo-200 overflow-x-auto leading-relaxed">
                  {middlewareCode}
                </pre>
                <button
                  onClick={() => copyToClipboard(middlewareCode, 'middleware')}
                  className="absolute top-3 right-3 p-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition cursor-pointer"
                  aria-label="Copy middleware code"
                >
                  {copied === 'middleware' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                </button>
              </div>
              <div className="text-[10px] text-slate-500">
                Open-source middleware (Apache-2.0) for Next.js, Express and Fastify. See the docs for the install steps.
              </div>
            </div>
          </div>

          {/* Complete Button */}
          <Button
            onClick={handleComplete}
            variant="gradient"
            size="lg"
            className="w-full rounded-xl shadow-xl shadow-emerald-600/20 cursor-pointer text-base"
          >
            <ShieldCheck className="w-5 h-5 text-emerald-300" />
            <span>Save Site</span>
            <Sparkles className="w-4 h-4 text-cyan-300" />
          </Button>
        </div>
      )}
    </div>
  );
}

export type { DetectedCapability };
