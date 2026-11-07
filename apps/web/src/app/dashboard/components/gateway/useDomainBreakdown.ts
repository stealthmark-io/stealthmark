import { useEffect, useState } from "react";
import { AGENT_MAX_ROWS } from "@/app/api/usage/_constants";
import type { SiteSummary, UsageAgentsResponse } from "@/app/api/usage/_shared";
import { agentsEndpoint, isAgentsResponse } from "../../views/useAgentActivity";
import type { BreakdownStatus, DomainBreakdown } from "./domains";

const BREAKDOWN_POLL_INTERVAL_MS = 30_000;

export interface BreakdownState {
  /** Host filter that `breakdown` and `settled` belong to. */
  host: string | null;
  breakdown: DomainBreakdown | null;
  /** Hosts of the organization. They cover every domain, so the selector survives a host change or a failed load. */
  sites: readonly SiteSummary[];
  settled: boolean;
}

const INITIAL_STATE: BreakdownState = { host: null, breakdown: null, sites: [], settled: false };

export interface UseDomainBreakdownResult {
  breakdown: DomainBreakdown | null;
  sites: readonly SiteSummary[];
  status: BreakdownStatus;
}

/**
 * Whether the counts of `host` are only a lower bound. With a host filter the route also scans every host of the
 * organization for the sites list and sets `truncated` when either scan was cut off, so a small domain of a busy
 * organization would be marked as a lower bound although its own scan finished. Its own scan was cut off only when it
 * read the maximum number of rows.
 */
export function isBreakdownTruncated(
  body: Pick<UsageAgentsResponse, "truncated" | "sampled_rows">,
  host: string | null,
): boolean {
  if (body.truncated !== true) return false;
  if (host === null) return true;
  return typeof body.sampled_rows !== "number" || body.sampled_rows >= AGENT_MAX_ROWS;
}

/** What the view may show for `host`: the breakdown of another host counts as loading. */
export function selectBreakdown(state: BreakdownState, enabled: boolean, host: string | null): UseDomainBreakdownResult {
  if (!enabled) return { breakdown: null, sites: [], status: "unavailable" };
  if (state.host !== host || !state.settled) return { breakdown: null, sites: state.sites, status: "loading" };
  if (state.breakdown === null) return { breakdown: null, sites: state.sites, status: "unavailable" };
  return { breakdown: state.breakdown, sites: state.sites, status: "ready" };
}

/**
 * Month figures per agent and per domain of the session organization, read from the usage ledger route the Agents tab
 * already uses. `host` restricts the agents to one domain; the sites list always covers every domain. It refreshes
 * slowly because the route scans the month's events.
 */
export function useDomainBreakdown(enabled: boolean, host: string | null): UseDomainBreakdownResult {
  const [state, setState] = useState<BreakdownState>(INITIAL_STATE);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();

    function markUnavailable() {
      if (controller.signal.aborted) return;
      setState((prev) => ({
        host,
        breakdown: prev.host === host ? prev.breakdown : null,
        sites: prev.sites,
        settled: true,
      }));
    }

    async function load() {
      try {
        const res = await fetch(agentsEndpoint(host), { cache: "no-store", signal: controller.signal });
        if (!res.ok) {
          if (res.status !== 401) console.warn(`[Telemetry] Domain breakdown answered HTTP ${res.status}`);
          markUnavailable();
          return;
        }
        const body: unknown = await res.json();
        if (controller.signal.aborted) return;
        if (!isAgentsResponse(body)) {
          console.warn("[Telemetry] Domain breakdown answered an unexpected body");
          markUnavailable();
          return;
        }
        setState({
          host,
          breakdown: { host, agents: body.agents, sites: body.sites, truncated: isBreakdownTruncated(body, host) },
          sites: body.sites,
          settled: true,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn("[Telemetry] Could not load the domain breakdown:", error instanceof Error ? error.name : "unknown");
        markUnavailable();
      }
    }

    load();
    const interval = setInterval(load, BREAKDOWN_POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [enabled, host]);

  return selectBreakdown(state, enabled, host);
}
