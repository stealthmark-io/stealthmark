import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DEFCON_LEVELS, findDefconLevel } from "./constants";
import { defconBadgeVariant, defconDotClass, defconTierClasses } from "./format";

interface DefconControlsProps {
  activeDefcon: number;
  onSelectTier: (level: number) => void;
}

export function DefconControls({ activeDefcon, onSelectTier }: DefconControlsProps) {
  const activeDefconItem = findDefconLevel(activeDefcon);

  return (
    <Card variant="elevated" className="border-white/10 p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white tracking-tight">DEFCON Defense System</h3>
              <span className="text-[10px] font-mono px-2 py-0.2 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                Interactive Posture Control
              </span>
            </div>
            <p className="text-xs text-slate-400">Click any tier to authorize and deploy an operational perimeter shift</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-400">Active Posture:</span>
          <Badge variant={defconBadgeVariant(activeDefcon)} size="sm">
            DEFCON {activeDefcon} — {activeDefconItem.name.toUpperCase()}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 pt-2">
        {DEFCON_LEVELS.map((tier) => {
          const isCurrent = tier.level === activeDefcon;
          return (
            <button
              key={tier.level}
              type="button"
              onClick={() => onSelectTier(tier.level)}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${defconTierClasses(tier.level, isCurrent)}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-mono font-bold text-white">DEFCON {tier.level}</span>
                {isCurrent && (
                  <span className={`w-2 h-2 rounded-full ${defconDotClass(tier.level)} animate-ping`} />
                )}
              </div>
              <div className={`text-xs font-semibold ${tier.color} mb-1`}>{tier.name}</div>
              <div className="text-[11px] text-slate-400 leading-tight">{tier.desc}</div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
