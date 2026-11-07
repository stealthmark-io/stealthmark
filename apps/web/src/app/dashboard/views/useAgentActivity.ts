"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AgentSummary,
  SiteSummary,
  UsageAgentsResponse,
  UsageEventItem,
  UsageEventsResponse,
} from "@/app/api/usage/_shared";

export const AGENTS_ENDPOINT = "/api/usage/agents";
const EVENTS_PATH = "/api/usage/events";
export const EVENTS_LIMIT = 25;

export function agentsEndpoint(host: string | null): string {
  return host === null ? AGENTS_ENDPOINT : `${AGENTS_ENDPOINT}?host=${encodeURIComponent(host)}`;
}

export function eventsEndpoint(host: string | null, limit: number = EVENTS_LIMIT): string {
  const base = `${EVENTS_PATH}?limit=${limit}`;
  return host === null ? base : `${base}&host=${encodeURIComponent(host)}`;
}

export interface AgentActivityData {
  periodMonth: string;
  agents: AgentSummary[];
  sites: SiteSummary[];
  events: UsageEventItem[];
  truncated: boolean;
}

export interface UseAgentActivityResult {
  /** Activity of the current host filter only; null while that host loads or after its load failed. */
  data: AgentActivityData | null;
  /** Sites of the organization. They cover every host, so the list survives a host change or a failed load. */
  sites: SiteSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export interface FetchState {
  data: AgentActivityData | null;
  sites: SiteSummary[];
  error: string | null;
  settled: boolean;
  /** Host filter that `data` and `error` belong to. */
  host: string | null;
}

const INITIAL_STATE: FetchState = { data: null, sites: [], error: null, settled: false, host: null };

export function succeededState(data: AgentActivityData, host: string | null): FetchState {
  return { data, sites: data.sites, error: null, settled: true, host };
}

/** A failed load keeps the previous data only when it belongs to the same host (a refresh), never another host's. */
export function failedState(prev: FetchState, host: string | null, error: string): FetchState {
  return { data: prev.host === host ? prev.data : null, sites: prev.sites, error, settled: true, host };
}

/** What the view may show for `host`: data and error of another host are hidden and count as loading. */
export function selectActivity(
  state: FetchState,
  enabled: boolean,
  host: string | null,
): Omit<UseAgentActivityResult, "refresh"> {
  const current = enabled && state.host === host;
  return {
    data: current ? state.data : null,
    sites: enabled ? state.sites : [],
    loading: enabled && !(state.settled && state.host === host),
    error: current ? state.error : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isAgentsResponse(body: unknown): body is UsageAgentsResponse {
  return (
    isRecord(body) && Array.isArray(body.agents) && Array.isArray(body.sites) && typeof body.period_month === "string"
  );
}

export function isEventsResponse(body: unknown): body is UsageEventsResponse {
  return isRecord(body) && Array.isArray(body.events);
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`agent_activity_request_failed_${res.status}`);
  return res.json();
}

async function fetchAgentActivity(host: string | null, signal: AbortSignal): Promise<AgentActivityData> {
  const [agentsBody, eventsBody] = await Promise.all([
    getJson(agentsEndpoint(host), signal),
    getJson(eventsEndpoint(host), signal),
  ]);
  if (!isAgentsResponse(agentsBody) || !isEventsResponse(eventsBody)) {
    throw new Error("agent_activity_response_invalid");
  }
  return {
    periodMonth: agentsBody.period_month,
    agents: agentsBody.agents,
    sites: agentsBody.sites,
    events: eventsBody.events,
    truncated: agentsBody.truncated === true,
  };
}

/**
 * Loads per-agent usage, per-site usage and recent SDK events of the session organization while `enabled`
 * (a signed-in user). A non-null `host` restricts agents and events to that site; the sites list stays complete.
 * `data` never carries another host's agents or events: after the host changes it is null until that host's response arrives.
 */
export function useAgentActivity(enabled: boolean, host: string | null = null): UseAgentActivityResult {
  const [state, setState] = useState<FetchState>(INITIAL_STATE);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    return () => setState(INITIAL_STATE);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetchAgentActivity(host, controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        setState(succeededState(data, host));
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "agent_activity_request_failed";
        setState((prev) => failedState(prev, host, message));
      },
    );
    return () => controller.abort();
  }, [enabled, host, reloadToken]);

  const refresh = useCallback(() => {
    setState((prev) => ({ ...prev, settled: false }));
    setReloadToken((token) => token + 1);
  }, []);

  return { ...selectActivity(state, enabled, host), refresh };
}
