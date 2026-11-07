import { useCallback, useSyncExternalStore } from "react";
import { readDomainParam, withDomainParam } from "./domains";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("popstate", onChange);
  };
}

function getSearch(): string {
  return window.location.search;
}

function getServerSearch(): string {
  return "";
}

/**
 * Domain the Telemetry tab is filtered to (null = all domains), kept in the `domain` search param so a reload or a
 * shared link keeps it. The URL is the single source of truth; the server render and hydration see no param.
 */
export function useDomainSelection(): readonly [string | null, (domain: string | null) => void] {
  const search = useSyncExternalStore(subscribe, getSearch, getServerSearch);

  const select = useCallback((next: string | null) => {
    const { pathname, search: current, hash } = window.location;
    window.history.replaceState(null, "", `${pathname}${withDomainParam(current, next)}${hash}`);
    listeners.forEach((notify) => notify());
  }, []);

  return [readDomainParam(search), select] as const;
}
