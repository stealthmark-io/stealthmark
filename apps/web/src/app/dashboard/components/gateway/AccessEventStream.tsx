import { Activity, FileText, Radio } from "lucide-react";
import { Card } from "@/components/ui/card";
import { AccessEventRow } from "./AccessEventRow";
import { DOMAIN_EVENTS_LIMIT } from "./constants";
import type { EventsSource } from "./domains";
import type { AgentTrafficEvent } from "./types";

interface AccessEventStreamProps {
  /** Events to list, already filtered to the selected domain. */
  events: AgentTrafficEvent[];
  loadFailed: boolean;
  isExporting: boolean;
  onExport: () => void;
  /** Selected domain, or null/absent for all domains. */
  domain?: string | null;
  /** Where the events of a domain came from; by default they are narrowed from the latest events of every domain. */
  source?: EventsSource;
  /** Events the page loaded before the domain filter; only used by the "latest" source. */
  loadedCount?: number;
  /** The first answer has not arrived, so an empty list says nothing yet. */
  loading?: boolean;
  /** Guests cannot load events. */
  signedIn?: boolean;
  onClearDomain?: () => void;
}

export function AccessEventStream({
  events,
  loadFailed,
  isExporting,
  onExport,
  domain = null,
  source = domain === null ? "all" : "latest",
  loadedCount = events.length,
  loading = false,
  signedIn = true,
  onClearDomain,
}: AccessEventStreamProps) {
  const windowLabel =
    domain === null
      ? "Latest 50, refreshed every few seconds"
      : source === "host"
        ? `Latest ${DOMAIN_EVENTS_LIMIT} for ${domain}, refreshed every few seconds`
        : `${events.length} of the latest ${loadedCount} events, refreshed every few seconds`;

  const olderEventsNote =
    domain !== null && source === "latest"
      ? `Only the latest ${loadedCount} events of every domain are loaded, so older events of ${domain} may not be listed. `
      : "";

  return (
    <Card variant="default" className="border-white/10 p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <Radio className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-bold text-white">Recent agent events</h3>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.05] text-slate-300 border border-white/10 break-all">
            {windowLabel}
          </span>
        </div>

        <button
          type="button"
          onClick={onExport}
          disabled={isExporting}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] border border-white/10 hover:border-white/20 text-slate-200 text-xs font-mono font-semibold transition active:scale-95 cursor-pointer disabled:opacity-50"
          title={domain === null ? "Download these events as CSV" : `Download the events of ${domain} shown here as CSV`}
        >
          <FileText className="w-3.5 h-3.5 text-slate-400" />
          <span>Export CSV</span>
        </button>
      </div>

      {loadFailed && (
        <p role="alert" className="text-xs text-amber-300 font-mono">
          The latest events could not be loaded. Retrying.
        </p>
      )}

      <div className="overflow-x-auto os-scroll">
        <table className="w-full text-left text-xs min-w-[560px]">
          <thead>
            <tr className="border-b border-white/10 text-slate-400 uppercase font-mono text-[11px]">
              <th className="pb-3">Timestamp</th>
              <th className="pb-3">Agent</th>
              <th className="pb-3">Route</th>
              <th className="pb-3">Status</th>
              <th className="pb-3 text-right">Policy result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04] text-slate-300">
            {events.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center font-mono">
                  <div className="flex flex-col items-center justify-center gap-2 text-slate-400">
                    <Activity className="w-6 h-6 text-slate-600" />
                    {!signedIn ? (
                      <span className="text-xs text-slate-400">Sign in to see agent events.</span>
                    ) : loading ? (
                      <span className="text-xs text-slate-400" aria-busy="true">
                        Loading events...
                      </span>
                    ) : loadFailed ? (
                      <span className="text-xs text-slate-400">Nothing to list until the events load.</span>
                    ) : domain === null ? (
                      <>
                        <span className="text-xs text-slate-400">No agent events recorded yet.</span>
                        <p className="text-xs text-slate-400 max-w-sm">
                          Events appear here when an agent that identifies itself visits a site that runs the middleware
                          with your API key.
                        </p>
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-slate-400 break-all">
                          {source === "host"
                            ? `No agent events recorded for ${domain}.`
                            : `No agent events for ${domain} in the latest ${loadedCount} events.`}
                        </span>
                        <p className="text-xs text-slate-400 max-w-sm">
                          {olderEventsNote}
                          Events appear here when an agent that identifies itself visits {domain} and the site reports it
                          with your API key.
                        </p>
                        {onClearDomain && (
                          <button
                            type="button"
                            onClick={onClearDomain}
                            className="mt-1 px-3 py-1 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] border border-white/10 text-slate-200 text-[11px] font-mono font-semibold transition cursor-pointer"
                          >
                            Show all domains
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              events.map((evt) => <AccessEventRow key={evt.id} event={evt} />)
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
