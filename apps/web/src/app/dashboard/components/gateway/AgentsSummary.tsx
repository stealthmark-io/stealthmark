import { Bot } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { AgentSummaryView } from "./domains";
import { formatLastSeen } from "./format";

interface AgentsSummaryProps {
  /** Null while the month breakdown loads. */
  summary: AgentSummaryView | null;
  /** Selected domain, or null for all domains. */
  domain: string | null;
}

function basisLabel(summary: AgentSummaryView): string | null {
  if (summary.basis === "unavailable") return null;
  if (summary.basis === "recent") {
    return `In the latest ${(summary.sampleSize ?? 0).toLocaleString("en-US")} events`;
  }
  return summary.truncated ? "This month, at least" : "This month";
}

function unavailableMessage(summary: AgentSummaryView, scope: string): string {
  return summary.unavailableReason === "signed-out"
    ? `Sign in to see which agents visited ${scope}.`
    : `The agents of ${scope} could not be loaded. Retrying.`;
}

export function AgentsSummary({ summary, domain }: AgentsSummaryProps) {
  const scope = domain ?? "all domains";
  const label = summary ? basisLabel(summary) : null;

  return (
    <Card variant="default" hoverEffect="none" className="border-white/10 p-4" data-testid="telemetry-agents-summary">
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 min-w-0">
            <Bot className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
            <span className="break-all">Agents on {scope}</span>
          </h3>
          {label && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.05] text-slate-300 border border-white/10">
              {label}
            </span>
          )}
        </div>

        {summary === null ? (
          <p className="text-xs text-slate-400 font-mono" aria-busy="true">
            Loading agents...
          </p>
        ) : summary.basis === "unavailable" ? (
          <p className="text-xs text-slate-400">{unavailableMessage(summary, scope)}</p>
        ) : summary.rows.length === 0 ? (
          <p className="text-xs text-slate-400">No agents recorded for {scope} yet.</p>
        ) : (
          <div className="overflow-x-auto os-scroll">
            <table className="w-full max-w-2xl text-left text-xs min-w-[320px]">
              <caption className="sr-only">Agents that visited {scope}, with their visits and last seen time</caption>
              <thead>
                <tr className="border-b border-white/10 text-slate-400 uppercase font-mono text-[11px]">
                  <th scope="col" className="pb-2 font-semibold">Agent</th>
                  <th scope="col" className="pb-2 font-semibold text-right">Visits</th>
                  <th scope="col" className="pb-2 font-semibold text-right">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04] text-slate-300">
                {summary.rows.map((row) => (
                  <tr key={row.agent}>
                    <td className="py-2 pr-3">
                      <span className="font-semibold text-white break-all">{row.agent}</span>
                      {row.company && <span className="ml-2 text-xs text-slate-400">{row.company}</span>}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-slate-200">{row.visits.toLocaleString("en-US")}</td>
                    <td className="py-2 text-right font-mono text-slate-400 whitespace-nowrap">{formatLastSeen(row.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {summary && summary.rows.length > 0 && (
          <p className="text-xs text-slate-400">
            One visit is one request.{" "}
            {summary.totalAgents > summary.rows.length
              ? `Showing ${summary.rows.length} of ${summary.totalAgents} agents; the Agents tab lists them all. `
              : ""}
            Agents name themselves and are not verified, so the company is the one the name claims.
          </p>
        )}
      </div>
    </Card>
  );
}
