'use client';

import React, { useEffect } from 'react';
import { ShieldAlert, ShieldCheck, AlertTriangle, X, Radio } from 'lucide-react';

interface DefconModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetDefcon: number | null;
  currentDefcon: number;
  onConfirm: (level: number) => void;
}

const DEFCON_TACTICAL_DETAILS: Record<
  number,
  {
    name: string;
    badge: string;
    color: string;
    bgAccent: string;
    borderAccent: string;
    buttonClass: string;
    description: string;
    rules: string[];
  }
> = {
  1: {
    name: 'DEFCON 1 — EMERGENCY ORIGIN LOCKDOWN',
    badge: 'MAXIMUM RESTRICTION',
    color: 'text-rose-400',
    bgAccent: 'bg-rose-500/10',
    borderAccent: 'border-rose-500/30',
    buttonClass: 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950/50',
    description:
      'Authorize Emergency Origin Lockdown? Only cryptographically verified agents with valid Ed25519 KYA passports will be admitted; all anonymous crawlers and unverified bots will be dropped at the edge.',
    rules: [
      'Origin web servers completely shielded from non-verified bots',
      'Mandatory cryptographic Ed25519 signature on every incoming payload',
      'Zero-tolerance 403 Forbidden for scrapers lacking agentic passports',
      'Emergency token freeze on high-consumption endpoints',
    ],
  },
  2: {
    name: 'DEFCON 2 — HIGH READINESS',
    badge: 'STRICT ENFORCEMENT',
    color: 'text-orange-400',
    bgAccent: 'bg-orange-500/10',
    borderAccent: 'border-orange-500/30',
    buttonClass: 'bg-orange-600 hover:bg-orange-500 text-white shadow-orange-950/50',
    description:
      'Engage DEFCON 2 (High Readiness)? Mandatory Ed25519 KYA passports will be enforced for all synthetic callers, filtering out unsigned autonomous agents and rogue scrapers.',
    rules: [
      'KYA passport verification required for all synthetic agent callers',
      'Heuristic payload inspection against prompt injection override tokens',
      'Tightened 60 RPM window across all registered gateway endpoints',
    ],
  },
  3: {
    name: 'DEFCON 3 — ELEVATED SURVEILLANCE',
    badge: 'ADAPTIVE CHALLENGE',
    color: 'text-amber-400',
    bgAccent: 'bg-amber-500/10',
    borderAccent: 'border-amber-500/30',
    buttonClass: 'bg-amber-600 hover:bg-amber-500 text-black font-bold shadow-amber-950/50',
    description:
      'Engage DEFCON 3 (Elevated Surveillance)? Cryptographic identity challenges and timestamp nonces will be enforced on agent callers to mitigate token consumption anomalies.',
    rules: [
      'Dual-door inspection challenge applied on agent-like User-Agents',
      'Active token anomaly scoring on JSON and structured outputs',
      'Dynamic latency buffer applied to unauthenticated automated agents',
    ],
  },
  4: {
    name: 'DEFCON 4 — GUARDED PERIMETER',
    badge: 'RATE LIMITING ACTIVE',
    color: 'text-cyan-400',
    bgAccent: 'bg-cyan-500/10',
    borderAccent: 'border-cyan-500/30',
    buttonClass: 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-950/50',
    description:
      'Engage DEFCON 4 (Guarded Perimeter)? Adaptive sliding-window rate limiting will be enforced against high-frequency scrapers, price bots, and aggressive crawlers.',
    rules: [
      'Adaptive sliding-window rate limiting on scraping IPs',
      'Payload bomb cap strictly enforced at 2MB',
      'Dual-door routing directs bot traffic to lightweight manifests',
    ],
  },
  5: {
    name: 'DEFCON 5 — NORMAL OPERATIONS',
    badge: 'STANDARD ROUTING',
    color: 'text-emerald-400',
    bgAccent: 'bg-emerald-500/10',
    borderAccent: 'border-emerald-500/30',
    buttonClass: 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/50',
    description:
      'Restore Normal Operations (DEFCON 5)? Standard dual-door proxying, token caching, and baseline perimeter inspection will be restored across the edge cluster.',
    rules: [
      'Standard edge proxying with dual-door routing active',
      'High-speed Action Manifest generation and token cache hits',
      'Baseline security shields operational across all domains',
    ],
  },
};

export function DefconModal({
  isOpen,
  onClose,
  targetDefcon,
  currentDefcon,
  onConfirm,
}: DefconModalProps) {
  // Close on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || targetDefcon === null) return null;

  const targetInfo = DEFCON_TACTICAL_DETAILS[targetDefcon] || DEFCON_TACTICAL_DETAILS[5];

  const handleConfirm = () => {
    onConfirm(targetDefcon);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Frosted dark backdrop */}
      <div
        className="fixed inset-0 bg-black/85 backdrop-blur-md transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Military Command Dialog */}
      <div className="relative w-full max-w-lg bg-[#0a0c10] border border-white/15 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-rose-950/30 z-10 animate-in zoom-in-95 duration-200 overflow-hidden text-left">
        {/* Glow strip */}
        <div
          className={`absolute top-0 left-8 right-8 h-[2px] bg-gradient-to-r from-transparent via-${
            targetDefcon === 1 ? 'rose' : targetDefcon <= 3 ? 'amber' : 'emerald'
          }-500 to-transparent pointer-events-none`}
        />

        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close modal"
          className="absolute top-5 right-5 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header with tactical icon */}
        <div className="flex items-start gap-4 mb-5">
          <div className={`p-3 rounded-2xl ${targetInfo.bgAccent} border ${targetInfo.borderAccent} shrink-0`}>
            {targetDefcon === 1 ? (
              <ShieldAlert className="w-6 h-6 text-rose-400 animate-pulse" />
            ) : targetDefcon <= 3 ? (
              <AlertTriangle className="w-6 h-6 text-amber-400" />
            ) : (
              <ShieldCheck className="w-6 h-6 text-emerald-400" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono tracking-widest uppercase px-2 py-0.5 rounded-full bg-white/10 text-slate-300 font-semibold">
                TACTICAL COMMAND PROTOCOL
              </span>
              <span
                className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${targetInfo.bgAccent} ${targetInfo.color} border ${targetInfo.borderAccent}`}
              >
                {targetInfo.badge}
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight mt-1.5 font-mono">
              {targetInfo.name}
            </h2>
          </div>
        </div>

        {/* Explanatory Quote / Warning */}
        <div className={`p-4 rounded-2xl ${targetInfo.bgAccent} border ${targetInfo.borderAccent} mb-5 space-y-2`}>
          <div className="flex items-center gap-2 text-xs font-mono font-semibold text-slate-200">
            <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            <span>Operational Posture Shift: DEFCON {currentDefcon} → DEFCON {targetDefcon}</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed font-sans">
            {targetInfo.description}
          </p>
        </div>

        {/* Rule changes list */}
        <div className="space-y-2 mb-6">
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block">
            Engaged Perimeter Directives:
          </span>
          <div className="space-y-1.5">
            {targetInfo.rules.map((rule, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs text-slate-300 font-mono">
                <span className={`text-xs mt-0.5 ${targetInfo.color}`}>▸</span>
                <span className="leading-snug">{rule}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Command Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5 pt-2 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-mono font-semibold transition border border-white/10 cursor-pointer text-center"
          >
            Abort Protocol (Cancel)
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={`w-full sm:w-auto px-5 py-2.5 rounded-xl text-xs font-mono font-bold transition shadow-lg flex items-center justify-center gap-2 cursor-pointer ${targetInfo.buttonClass}`}
          >
            <span>Authorize &amp; Engage DEFCON {targetDefcon}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
