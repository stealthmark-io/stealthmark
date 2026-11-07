import { useEffect, useState } from "react";
import { toAuditEvent } from "@/app/api/telemetry/_audit-event";
import { eventsEndpoint, isEventsResponse } from "../../views/useAgentActivity";
import { DOMAIN_EVENTS_LIMIT } from "./constants";
import type { AgentTrafficEvent } from "./types";

const DOMAIN_EVENTS_POLL_INTERVAL_MS = 4000;

export interface DomainEventsState {
  /** Host that `events`, `failed` and `settled` belong to. */
  host: string | null;
  events: AgentTrafficEvent[] | null;
  failed: boolean;
  settled: boolean;
}

const INITIAL_STATE: DomainEventsState = { host: null, events: null, failed: false, settled: false };

export interface UseDomainEventsResult {
  /** Latest events of the host; null while they load or when the first load failed. */
  events: AgentTrafficEvent[] | null;
  loading: boolean;
  failed: boolean;
}

/** What the view may show for `host`: the events of another host count as loading, and no host means nothing to load. */
export function selectDomainEvents(state: DomainEventsState, host: string | null): UseDomainEventsResult {
  if (host === null) return { events: null, loading: false, failed: false };
  if (state.host !== host || !state.settled) return { events: null, loading: true, failed: false };
  return { events: state.events, loading: false, failed: state.failed };
}

/**
 * Latest events of one host of the session organization, read from the host-filtered usage route. The table and the CSV
 * of a selected domain use it because the all-domains feed only holds the latest events across every domain, which may
 * not include that host at all. `host` null loads nothing.
 */
export function useDomainEvents(host: string | null): UseDomainEventsResult {
  const [state, setState] = useState<DomainEventsState>(INITIAL_STATE);

  useEffect(() => {
    if (host === null) return;
    const controller = new AbortController();

    function markFailed() {
      if (controller.signal.aborted) return;
      setState((prev) => ({
        host,
        events: prev.host === host ? prev.events : null,
        failed: true,
        settled: true,
      }));
    }

    async function load() {
      try {
        const res = await fetch(eventsEndpoint(host, DOMAIN_EVENTS_LIMIT), { cache: "no-store", signal: controller.signal });
        if (!res.ok) {
          console.warn(`[Telemetry] Domain events request answered HTTP ${res.status}`);
          markFailed();
          return;
        }
        const body: unknown = await res.json();
        if (controller.signal.aborted) return;
        if (!isEventsResponse(body)) {
          console.warn("[Telemetry] Domain events answered an unexpected body");
          markFailed();
          return;
        }
        setState({ host, events: body.events.map(toAuditEvent), failed: false, settled: true });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn("[Telemetry] Could not load the domain events:", error instanceof Error ? error.name : "unknown");
        markFailed();
      }
    }

    load();
    const interval = setInterval(load, DOMAIN_EVENTS_POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [host]);

  return selectDomainEvents(state, host);
}
