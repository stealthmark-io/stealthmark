'use client';

import React, { useState } from 'react';
import { User, Bot, Play } from 'lucide-react';

export function DualDoorSimulator() {
  const [activeMode, setActiveMode] = useState<'human' | 'agent'>('human');

  const humanHeaders = `GET /es HTTP/2
Host: gateway.stealthmark.io
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)
Accept: text/html,application/xhtml+xml`;

  const agentHeaders = `GET / HTTP/2
Host: gateway.stealthmark.io
X-Stealthmark-Agent: agent_autodev_001
Accept: application/agent+json`;

  const humanOutput = `HTTP/2 200 OK
Content-Type: text/html; charset=utf-8
Content-Length: 72,573 bytes
X-Stealthmark-Route: PROXY_UPSTREAM_HUMAN

<!DOCTYPE html>
<html>
  <head>
    <title>DemoCV — Deterministic Optimization</title>
    <!-- 23 React Server Component scripts loaded -->
  </head>
  <body>... [72.5 KB of hydrated HTML, CSS & React bundles loaded in browser] ...</body>
</html>`;

  const agentOutput = `HTTP/2 200 OK
Content-Type: application/json
Content-Length: 439 bytes
X-Stealthmark-Route: FASTTRACK_SEMANTIC_AGENT
X-Stealthmark-Compute: 3.2ms

{
  "stealthmark": "v1.4",
  "gateway_status": "authorized",
  "trust_score": 98,
  "cluster": "GCP us-central1 (stealthmark-prod)",
  "directory": {
    "democv": {
      "name": "DemoCV — Deterministic ATS Optimization",
      "manifest_url": "/democv/agent/v1/manifest",
      "actions": ["audit_cv"]
    },
    "demodental": {
      "name": "DemoDental Smile — Cosmetic Dentistry",
      "manifest_url": "/demodental/agent/v1/manifest",
      "actions": ["get_plans", "generate_simulation"]
    }
  }
}`;

  return (
    <section id="gateway" className="max-w-6xl mx-auto px-4 sm:px-6 space-y-6 py-14 scroll-mt-24">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 text-[11px] font-mono text-cyan-400 mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
            PRODUCTION ENDPOINT: GCP CLOUD RUN (STEALTHMARK-PROD)
          </div>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            Interactive Dual-Door Simulator
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Toggle between Human Browser and Verified Agent to observe real-time content-negotiation routing.
          </p>
        </div>

        {/* Mode Toggle Pill */}
        <div className="inline-flex p-1 rounded-2xl bg-[#0d1017] border border-white/10 shadow-inner shrink-0">
          <button
            onClick={() => setActiveMode('human')}
            className={`px-4 sm:px-5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeMode === 'human'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Human User</span>
          </button>
          <button
            onClick={() => setActiveMode('agent')}
            className={`px-4 sm:px-5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeMode === 'agent'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span>Verified Agent (KYA)</span>
          </button>
        </div>
      </div>

      <div className="bento-card p-5 sm:p-8 rounded-3xl space-y-6 border border-white/10 bg-[#0d1017]/85 backdrop-blur-xl shadow-2xl">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          
          {/* Request Panel */}
          <div className="lg:col-span-5 bg-[#060709] rounded-2xl border border-white/10 p-5 space-y-4 font-mono text-xs flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <span className="text-slate-400 uppercase tracking-wider text-[10px]">INCOMING HTTP HEADERS</span>
                <span
                  className={`text-[10px] px-2.5 py-0.5 rounded-full font-semibold font-mono ${
                    activeMode === 'human'
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  }`}
                >
                  {activeMode === 'human' ? 'Web Browser (Human)' : 'Autonomous Agent (KYA)'}
                </span>
              </div>
              <pre className="text-slate-300 text-[11px] leading-relaxed overflow-x-auto p-2 rounded-lg bg-black/40 border border-white/5">
                {activeMode === 'human' ? humanHeaders : agentHeaders}
              </pre>
            </div>

            <div className="pt-2">
              <div className="text-[11px] text-slate-500 mb-2 font-mono flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
                <span>Sub-15ms perimeter classification</span>
              </div>
              <button
                onClick={() => setActiveMode(activeMode === 'human' ? 'agent' : 'human')}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 via-cyan-600 to-emerald-600 hover:opacity-95 text-white font-sans font-bold text-xs uppercase tracking-wider transition active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Switch to {activeMode === 'human' ? 'Agent Fastpath' : 'Human Browser'}</span>
              </button>
            </div>
          </div>

          {/* Response Panel */}
          <div className="lg:col-span-7 bg-[#040507] rounded-2xl border border-white/10 p-5 space-y-3 font-mono text-xs relative overflow-hidden flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <span className="text-slate-400 uppercase tracking-wider text-[10px]">STEALTHMARK PROXY OUTPUT</span>
                <span
                  className={`font-bold font-mono text-xs px-2.5 py-0.5 rounded-full ${
                    activeMode === 'human'
                      ? 'text-indigo-400 bg-indigo-500/10 border border-indigo-500/20'
                      : 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
                  }`}
                >
                  {activeMode === 'human' ? '200 OK · 122 ms (72.5 KB)' : '200 OK · 8.5 ms (439 bytes)'}
                </span>
              </div>
              <pre
                className={`text-[11px] leading-relaxed overflow-x-auto max-h-[320px] overflow-y-auto p-3 rounded-lg bg-black/50 border border-white/5 ${
                  activeMode === 'human' ? 'text-slate-300' : 'text-cyan-300'
                }`}
              >
                {activeMode === 'human' ? humanOutput : agentOutput}
              </pre>
            </div>

            <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400">
              <span>Path: {activeMode === 'human' ? 'Origin Next.js UI' : 'Fasttrack Action Schema'}</span>
              <span className="font-mono text-emerald-400 font-semibold">
                {activeMode === 'human' ? '1x Latency' : '99.1% Bandwidth Saved'}
              </span>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
