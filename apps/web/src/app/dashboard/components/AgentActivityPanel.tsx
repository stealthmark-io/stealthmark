"use client";

import React, { useState } from "react";
import { AlertTriangle, Bot, Globe, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AgentSummary, SiteSummary, UsageEventItem } from "@/app/api/usage/_shared";
import { useAgentActivity, type AgentActivityData } from "../views/useAgentActivity";

export const AGENT_ACTIVITY_EMPTY_COPY = "No agent traffic yet. Install the SDK and send your first event.";
export const AGENT_ACTIVITY_HOST_EMPTY_COPY = "No agent traffic for this site in the selected period.";
export const HOST_SELECT_ID = "agent-activity-host";
const UNKNOWN_SITE_LABEL = "unknown";
const ALL_SITES_VALUE = "";

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatTimestamp(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function formatPeriod(periodMonth: string): string {
  const date = new Date(`${periodMonth}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return periodMonth;
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function AgentRow({ agent }: { agent: AgentSummary }) {
  return (
    <tr className="hover:bg-white/[0.02] transition">
      <td className="p-4 font-semibold text-white break-all">{agent.agent}</td>
      <td className="p-4 font-mono text-slate-200">{formatCount(agent.events)}</td>
      <td className="p-4">
        {agent.blocked > 0 ? (
          <Badge variant="danger" size="sm">{formatCount(agent.blocked)}</Badge>
        ) : (
          <span className="font-mono text-slate-500">0</span>
        )}
      </td>
      <td className="p-4 font-mono text-xs text-slate-400 whitespace-nowrap">{formatTimestamp(agent.last_seen)}</td>
      <td className="p-4">
        {agent.top_paths.length === 0 ? (
          <span className="text-xs text-slate-500">-</span>
        ) : (
          <ul className="space-y-1">
            {agent.top_paths.map((entry) => (
              <li key={entry.path} className="font-mono text-xs text-cyan-300 break-all">
                {entry.path} <span className="text-slate-500">x{formatCount(entry.count)}</span>
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

function EventRow({ event }: { event: UsageEventItem }) {
  const blocked = event.event_type === "agent_blocked";
  const target = [event.metadata.method, event.metadata.path].filter(Boolean).join(" ");
  return (
    <tr className="hover:bg-white/[0.02] transition text-xs">
      <td className="px-4 py-3 font-mono text-slate-400 whitespace-nowrap">{formatTimestamp(event.created_at)}</td>
      <td className="px-4 py-3 font-semibold text-white break-all">{event.agent_identifier ?? "unknown"}</td>
      <td className="px-4 py-3 font-mono text-slate-300 break-all" data-testid="agent-activity-event-site">
        {event.metadata.host ?? <span className="text-slate-500">{UNKNOWN_SITE_LABEL}</span>}
      </td>
      <td className="px-4 py-3 font-mono text-cyan-300 break-all">{target || "-"}</td>
      <td className="px-4 py-3">
        <Badge variant={blocked ? "danger" : "neutral"} size="sm">{event.event_type}</Badge>
      </td>
      <td className="px-4 py-3 font-mono text-slate-500">{event.source}</td>
    </tr>
  );
}

function SiteRow({ site, selected }: { site: SiteSummary; selected: boolean }) {
  return (
    <tr className={selected ? "bg-cyan-500/[0.06]" : "hover:bg-white/[0.02] transition"}>
      <td className="p-4 font-semibold break-all">
        {site.host === null ? (
          <span className="text-slate-400">{UNKNOWN_SITE_LABEL}</span>
        ) : (
          <span className="text-white">{site.host}</span>
        )}
      </td>
      <td className="p-4 font-mono text-slate-200">{formatCount(site.events)}</td>
      <td className="p-4 font-mono text-slate-200">{formatCount(site.agents)}</td>
      <td className="p-4 font-mono text-xs text-slate-400 whitespace-nowrap">{formatTimestamp(site.last_seen)}</td>
    </tr>
  );
}

interface SitesCardProps {
  sites: SiteSummary[];
  selectedHost: string | null;
  onSelectHost?: (host: string | null) => void;
}

function SitesCard({ sites, selectedHost, onSelectHost }: SitesCardProps) {
  const hosts = sites.flatMap((site) => (site.host === null ? [] : [site.host]));
  if (selectedHost !== null && !hosts.includes(selectedHost)) hosts.push(selectedHost);

  return (
    <Card className="overflow-hidden" data-testid="agent-activity-sites">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Globe className="w-4 h-4 text-cyan-400" aria-hidden="true" />
          <span>Sites</span>
        </h3>
        {hosts.length > 0 && onSelectHost && (
          <div className="flex items-center gap-2">
            <label htmlFor={HOST_SELECT_ID} className="text-xs font-semibold text-slate-300 uppercase font-mono">
              Filter by site
            </label>
            <select
              id={HOST_SELECT_ID}
              value={selectedHost ?? ALL_SITES_VALUE}
              onChange={(e) => onSelectHost(e.target.value === ALL_SITES_VALUE ? null : e.target.value)}
              className="bg-black/60 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/30 font-mono cursor-pointer max-w-[16rem]"
            >
              <option value={ALL_SITES_VALUE}>All sites</option>
              {hosts.map((host) => (
                <option key={host} value={host}>
                  {host}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="overflow-x-auto os-scroll mt-2">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Agent events per site this period</caption>
          <thead className="bg-white/[0.03] text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th scope="col" className="p-4 font-semibold">Site</th>
              <th scope="col" className="p-4 font-semibold">Events this period</th>
              <th scope="col" className="p-4 font-semibold">Agents</th>
              <th scope="col" className="p-4 font-semibold">Last seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {sites.map((site) => (
              <SiteRow
                key={site.host === null ? "no-host" : `host:${site.host}`}
                site={site}
                selected={site.host !== null && site.host === selectedHost}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

interface AgentActivityViewProps {
  data: AgentActivityData | null;
  /** Sites for the selector; defaults to `data.sites`. Pass it to keep the selector while `data` reloads. */
  sites?: SiteSummary[];
  loading: boolean;
  error: string | null;
  signedIn: boolean;
  selectedHost?: string | null;
  onSelectHost?: (host: string | null) => void;
  onRefresh?: () => void;
}

export function AgentActivityView({
  data,
  sites,
  loading,
  error,
  signedIn,
  selectedHost = null,
  onSelectHost,
  onRefresh,
}: AgentActivityViewProps) {
  const isEmpty = data !== null && data.agents.length === 0 && data.events.length === 0;
  const hostFiltered = selectedHost !== null;
  const siteList = sites ?? data?.sites ?? [];

  return (
    <div className="space-y-6" aria-busy={loading} data-testid="agent-activity-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Bot className="w-5 h-5 text-cyan-400" />
            <span>Agents</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Which agents read {hostFiltered ? selectedHost : "your sites"}
            {data ? ` in ${formatPeriod(data.periodMonth)}` : " this period"}.
          </p>
        </div>
        {signedIn && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            isLoading={loading}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Refresh
          </Button>
        )}
      </div>

      {!signedIn && (
        <Card className="p-6 text-sm text-slate-300" data-testid="agent-activity-signed-out">
          Sign in to see which agents read your site.
        </Card>
      )}

      {signedIn && !data && loading && (
        <Card className="p-6 space-y-3" aria-busy="true" data-testid="agent-activity-loading">
          <div className="h-4 w-48 rounded bg-white/10 animate-pulse" />
          <div className="h-4 w-full rounded bg-white/10 animate-pulse" />
          <div className="h-4 w-3/4 rounded bg-white/10 animate-pulse" />
        </Card>
      )}

      {signedIn && error && (
        <Card className="p-4 flex items-center gap-3 text-sm text-amber-300" role="alert" data-testid="agent-activity-error">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Agent activity could not be loaded. Try again in a moment.</span>
        </Card>
      )}

      {signedIn && (siteList.length > 0 || (data !== null && hostFiltered)) && (
        <SitesCard sites={siteList} selectedHost={selectedHost} onSelectHost={onSelectHost} />
      )}

      {signedIn && isEmpty && !error && (
        <Card className="p-8 text-center text-sm text-slate-300" data-testid="agent-activity-empty">
          {hostFiltered ? AGENT_ACTIVITY_HOST_EMPTY_COPY : AGENT_ACTIVITY_EMPTY_COPY}
        </Card>
      )}

      {signedIn && data && !isEmpty && (
        <>
          <Card className="overflow-hidden" data-testid="agent-activity-table">
            <div className="overflow-x-auto os-scroll">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/[0.03] text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="p-4 font-semibold">Agent</th>
                    <th className="p-4 font-semibold">Events this period</th>
                    <th className="p-4 font-semibold">Blocked</th>
                    <th className="p-4 font-semibold">Last seen</th>
                    <th className="p-4 font-semibold">Top paths</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {data.agents.map((agent) => (
                    <AgentRow key={agent.agent} agent={agent} />
                  ))}
                </tbody>
              </table>
            </div>
            {data.truncated && (
              <p className="px-4 py-3 text-[11px] text-slate-500 border-t border-white/[0.06]">
                Showing the latest events of this period only.
              </p>
            )}
          </Card>

          <Card className="overflow-hidden" data-testid="agent-activity-events">
            <h3 className="px-4 pt-4 text-sm font-semibold text-white">Recent events</h3>
            {data.events.length === 0 ? (
              <p className="px-4 py-4 text-xs text-slate-500">No recent events.</p>
            ) : (
              <div className="overflow-x-auto os-scroll mt-2">
                <table className="w-full text-left">
                  <caption className="sr-only">Recent agent events</caption>
                  <thead className="bg-white/[0.03] text-[11px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-semibold">Time</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Agent</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Site</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Request</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Type</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {data.events.map((event) => (
                      <EventRow key={event.id} event={event} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

interface AgentActivityPanelProps {
  isAuthenticated: boolean;
}

export function AgentActivityPanel({ isAuthenticated }: AgentActivityPanelProps) {
  const [selectedHost, setSelectedHost] = useState<string | null>(null);
  const { data, sites, loading, error, refresh } = useAgentActivity(isAuthenticated, selectedHost);
  return (
    <AgentActivityView
      data={data}
      sites={sites}
      loading={loading}
      error={error}
      signedIn={isAuthenticated}
      selectedHost={selectedHost}
      onSelectHost={setSelectedHost}
      onRefresh={refresh}
    />
  );
}
