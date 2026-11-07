"use client";

import { useCallback, useEffect, useState } from "react";
import { isQuotaResponse, type QuotaResponse } from "@/lib/quota";

export interface UseQuotaResult {
  quota: QuotaResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

interface FetchState {
  quota: QuotaResponse | null;
  error: string | null;
  settled: boolean;
}

const QUOTA_ENDPOINT = "/api/billing/quota";
const INITIAL_STATE: FetchState = { quota: null, error: null, settled: false };

async function fetchQuota(signal: AbortSignal): Promise<QuotaResponse> {
  const res = await fetch(QUOTA_ENDPOINT, { cache: "no-store", signal });
  if (!res.ok) {
    const failure = (await res.json().catch(() => ({}))) as { error?: unknown; code?: unknown };
    const detail = [failure.error, failure.code].filter((v): v is string => typeof v === "string" && v.length > 0).join(" · ");
    throw new Error(`HTTP ${res.status}${detail ? ` · ${detail}` : ""}`);
  }
  const body: unknown = await res.json();
  if (!isQuotaResponse(body)) throw new Error("quota_response_invalid");
  return body;
}

/** Loads the organization quota while `enabled` (a signed-in user); clears it when disabled. */
export function useQuota(enabled: boolean): UseQuotaResult {
  const [state, setState] = useState<FetchState>(INITIAL_STATE);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    return () => setState(INITIAL_STATE);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetchQuota(controller.signal).then(
      (quota) => setState({ quota, error: null, settled: true }),
      (err: unknown) => {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "quota_request_failed";
        setState((prev) => ({ quota: prev.quota, error: message, settled: true }));
      },
    );
    return () => controller.abort();
  }, [enabled, reloadToken]);

  const refresh = useCallback(() => {
    setState((prev) => ({ ...prev, settled: false }));
    setReloadToken((token) => token + 1);
  }, []);

  return {
    quota: enabled ? state.quota : null,
    loading: enabled && !state.settled,
    error: enabled ? state.error : null,
    refresh,
  };
}
