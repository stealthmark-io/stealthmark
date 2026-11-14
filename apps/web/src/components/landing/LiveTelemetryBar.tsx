"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, Bot, Globe2 } from "lucide-react";

interface LivePulse {
  domainsScannedTotal: number;
  domainsScanned24h: number;
  issuesFound24h: number;
  aiAgentsBlocked24h: number | null;
}

const POLL_INTERVAL_MS = 8000;

function readPulse(json: unknown): LivePulse | null {
  if (!json || typeof json !== "object") return null;
  const { domainsScannedTotal, domainsScanned24h, issuesFound24h, aiAgentsBlocked24h } =
    json as Record<string, unknown>;
  if (
    typeof domainsScannedTotal !== "number" ||
    typeof domainsScanned24h !== "number" ||
    typeof issuesFound24h !== "number"
  ) {
    return null;
  }
  return {
    domainsScannedTotal,
    domainsScanned24h,
    issuesFound24h,
    aiAgentsBlocked24h: typeof aiAgentsBlocked24h === "number" ? aiAgentsBlocked24h : null,
  };
}

export function LiveTelemetryBar() {
  const [pulse, setPulse] = useState<LivePulse | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchPulse = async () => {
      try {
        const res = await fetch("/api/telemetry/live-pulse", { cache: "no-store" });
        if (!res.ok) return;
        const next = readPulse(await res.json());
        if (mounted && next) setPulse(next);
      } catch {
        // Keep the last real reading; the bar stays hidden until the first one arrives
      }
    };

    void fetchPulse();
    const pollTimer = setInterval(fetchPulse, POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(pollTimer);
    };
  }, []);

  if (!pulse) return null;

  return (
    <section aria-label="Live Telemetry" className="max-w-6xl mx-auto px-4 sm:px-6">
      <div className="w-full px-4 py-3 rounded-2xl bg-[#0A101D]/90 border border-white/15 shadow-[0_12px_36px_rgba(0,0,0,0.45)] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 shrink-0">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <span className="text-xs font-mono font-bold tracking-wider text-emerald-400">LIVE</span>
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs sm:text-[13px] font-mono tabular-nums">
          <div className="flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="text-slate-400">Domains scanned (24h):</span>
            <span className="text-white font-semibold">{pulse.domainsScanned24h}</span>
          </div>

          <div className="hidden md:flex items-center gap-1.5">
            <Globe2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-slate-400">Total audits:</span>
            <span className="text-white font-semibold">{pulse.domainsScannedTotal.toLocaleString()}</span>
          </div>

          {pulse.aiAgentsBlocked24h !== null && (
            <div className="flex items-center gap-1.5">
              <Bot className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="text-slate-400">Agent requests blocked (24h):</span>
              <span className="text-indigo-300 font-semibold">{pulse.aiAgentsBlocked24h}</span>
            </div>
          )}

          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/25">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-amber-200/80">Issues found (24h):</span>
            <span className="text-amber-400 font-bold">{pulse.issuesFound24h}</span>
          </div>
        </div>

        <Link
          href="/scan"
          className="text-xs font-mono text-cyan-300 hover:text-white whitespace-nowrap shrink-0"
        >
          Run a free scan →
        </Link>
      </div>
    </section>
  );
}
