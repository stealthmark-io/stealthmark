"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { TouchableTooltip } from "@/components/ui/tooltip";
import { defconDescription, defconLabel } from "./dashboard-helpers";

interface DefconBadgeProps {
  defconLevel: number;
}

export function DefconBadge({ defconLevel }: DefconBadgeProps) {
  const label = defconLabel(defconLevel);

  return (
    <TouchableTooltip
      title="DEFCON Operational Posture"
      badge={`DEFCON ${defconLevel}: ${label}`}
      badgeColor={defconLevel === 1 ? 'rose' : defconLevel <= 3 ? 'amber' : 'emerald'}
      side="bottom"
      align="end"
      docLink="/trust"
      content={
        <div className="space-y-2 text-xs">
          <p>{defconDescription(defconLevel)}</p>
          <div className="p-2 rounded-lg bg-emerald-950/30 border border-emerald-500/20 text-emerald-300 text-[10px] leading-relaxed">
            <strong className="text-emerald-400 block mb-0.5">Fail-Open Doctrine:</strong>
            Edge requests exceeding 250ms SLA transparently bypass directly to your origin server to guarantee 0% downtime.
          </div>
        </div>
      }
    >
      <div
        className={`hidden md:flex items-center gap-2 px-3 py-1 rounded-xl text-xs font-mono transition-colors ${
          defconLevel === 1
            ? "bg-rose-950/40 border border-rose-500/30 text-rose-400"
            : defconLevel <= 3
            ? "bg-amber-950/40 border border-amber-500/30 text-amber-400"
            : "bg-white/5 border border-white/10 text-emerald-400"
        }`}
      >
        {defconLevel === 1 ? (
          <ShieldAlert className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
        ) : defconLevel <= 3 ? (
          <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
        ) : (
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
        )}
        <span className="text-slate-400">DEFCON:</span>
        <span className="font-bold">{label}</span>
      </div>
    </TouchableTooltip>
  );
}
