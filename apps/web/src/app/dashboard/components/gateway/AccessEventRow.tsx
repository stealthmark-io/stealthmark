import { CheckCircle2, ShieldAlert } from "lucide-react";
import { isBlockedEvent } from "./domains";
import { formatStatus } from "./format";
import type { AgentTrafficEvent } from "./types";

interface AccessEventRowProps {
  event: AgentTrafficEvent;
}

export function AccessEventRow({ event }: AccessEventRowProps) {
  const isOk = !isBlockedEvent(event);

  return (
    <tr className="transition-all duration-500 hover:bg-white/[0.02]">
      <td className="py-3 font-mono text-slate-400 whitespace-nowrap">{event.time}</td>
      <td className="py-3">
        <div className="font-semibold text-white">{event.agent}</div>
        <div className="text-[10px] text-slate-500">{event.provider}</div>
      </td>
      <td className="py-3 font-mono text-cyan-300">
        <span className="px-1.5 py-0.5 rounded bg-white/5 mr-1 text-[10px] text-slate-400">{event.method}</span>
        {event.targetPath}
      </td>
      <td className="py-3">
        {isOk ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-400">
            <CheckCircle2 className="w-3 h-3" /> {formatStatus(event.status)} ALLOWED
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-mono text-rose-400">
            <ShieldAlert className="w-3 h-3" /> {formatStatus(event.status)} BLOCKED
          </span>
        )}
      </td>
      <td className="py-3 text-right">
        <span
          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold ${
            isOk
              ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
              : "bg-rose-500/10 text-rose-300 border border-rose-500/20"
          }`}
        >
          {event.securityCheck}
        </span>
      </td>
    </tr>
  );
}
