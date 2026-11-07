import { Zap } from "lucide-react";
import { TouchableTooltip } from "@/components/ui/tooltip";
import { formatClusterStatus } from "./format";

interface GatewayHeaderProps {
  status: string;
  isLive: boolean;
}

export function GatewayHeader({ status, isLive }: GatewayHeaderProps) {
  const statusLabel = formatClusterStatus(status);
  const statusKnown = statusLabel !== "UNKNOWN";

  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
          <Zap className="w-5 h-5 text-cyan-400" />
          <span>Agent Telemetry</span>
        </h2>
        <p className="text-sm text-slate-300 mt-1 max-w-2xl">
          See which AI agents (GPTBot, ClaudeBot, PerplexityBot and others) read your sites, page by page. Each event is
          one request from an agent that identified itself; human visitors are never counted.
        </p>
        <p className="text-xs text-slate-400 mt-1 max-w-2xl">
          Only sites that run the StealthMark middleware with your API key report here. Agents that disguise themselves
          as browsers are not detected.
        </p>
      </div>

      <TouchableTooltip
        title="Gateway status"
        side="bottom"
        align="end"
        content="Status reported by the StealthMark gateway service."
        className="self-start"
      >
        <div
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-mono shadow-sm ${
            statusKnown
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-white/[0.04] border-white/10 text-slate-400"
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${statusKnown && isLive ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
          <span className="font-semibold">Gateway: {statusLabel}</span>
        </div>
      </TouchableTooltip>
    </div>
  );
}
