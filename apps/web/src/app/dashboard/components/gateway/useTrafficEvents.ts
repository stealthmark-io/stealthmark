import { useEffect, useState } from "react";
import { TELEMETRY_EVENTS_ENDPOINT } from "./constants";
import type { AgentTrafficEvent, TelemetryEventsResponse } from "./types";

const EVENTS_POLL_INTERVAL_MS = 4000;

export function useTrafficEvents() {
  const [trafficEvents, setTrafficEvents] = useState<AgentTrafficEvent[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  /** The first request has answered, whatever it answered; until then an empty list says nothing about activity. */
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadEvents() {
      try {
        const res = await fetch(TELEMETRY_EVENTS_ENDPOINT, { cache: "no-store" });
        if (!res.ok) {
          if (res.status !== 401) console.warn(`[Telemetry] Events request answered HTTP ${res.status}`);
          if (isMounted) {
            setLoadFailed(res.status !== 401);
            setLoaded(true);
          }
          return;
        }
        const data: TelemetryEventsResponse = await res.json();
        if (isMounted) {
          setTrafficEvents(Array.isArray(data.events) ? data.events : []);
          setLoadFailed(false);
          setLoaded(true);
        }
      } catch (error) {
        console.warn("[Telemetry] Could not load agent events:", error instanceof Error ? error.name : "unknown");
        if (isMounted) {
          setLoadFailed(true);
          setLoaded(true);
        }
      }
    }

    loadEvents();
    const interval = setInterval(loadEvents, EVENTS_POLL_INTERVAL_MS);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return { trafficEvents, loadFailed, loaded };
}
