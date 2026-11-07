"use client";

import type { AuthUser } from "@/lib/auth";
import { flags } from "@/lib/flags";
import type { ApiKeyItem, DetectedCapability } from "../components";
import { DEFCON_STORAGE_KEY, TAB_ENABLED } from "./dashboard-data";
import { isDemoApiKey, writeStoredValue, type ApiKeyWithSecret } from "./dashboard-helpers";
import type { DashboardState } from "./useDashboardState";

export type CreateKeyResult = { ok: true; key: string } | { ok: false; reason: string };

/** Short, non-sensitive description of a failed key creation: HTTP status, route error and database code. */
export function describeKeyFailure(status: number, error: unknown, code: unknown): string {
  const parts = [`HTTP ${status}`];
  if (typeof error === "string" && error.length > 0) parts.push(error);
  if (typeof code === "string" && code.length > 0) parts.push(`db ${code}`);
  return parts.join(" · ");
}

export function useDashboardActions(user: AuthUser | null, state: DashboardState) {
  const {
    apiKeys,
    setActiveTab,
    setDefconLevel,
    setOnboardedDomain,
    setOnboardedCapabilities,
    setApiKeys,
    setIsOnboardingDismissed,
  } = state;

  const postDefconLevel = async (url: string, level: number): Promise<void> => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level }),
      });
      if (!res.ok) console.warn(`[Dashboard] DEFCON sync to ${new URL(url, "https://stealthmark.io").pathname} answered HTTP ${res.status}`);
    } catch (err) {
      console.warn("[Dashboard] Could not sync DEFCON posture:", err instanceof Error ? err.name : "unknown");
    }
  };

  const handleDefconChange = async (newLevel: number) => {
    setDefconLevel(newLevel);
    writeStoredValue(DEFCON_STORAGE_KEY, String(newLevel));
    if (!flags.defcon) return;

    const gatewayUrl = process.env.NEXT_PUBLIC_GATEWAY_URL || "https://gateway.stealthmark.io";
    await Promise.all([
      postDefconLevel("/api/defcon", newLevel),
      postDefconLevel(`${gatewayUrl.replace(/\/$/, "")}/api/v1/defcon/level`, newLevel),
    ]);
  };

  const handleOnboardingComplete = async (domain: string, capabilities: DetectedCapability[]) => {
    setOnboardedDomain(domain);
    setOnboardedCapabilities(capabilities);
    setActiveTab(TAB_ENABLED["flight-plan"] ? "flight-plan" : "gateway");
    const domainKey = user ? `stealthmark_domain_${user.id}` : "stealthmark_domain_guest";
    const capsKey = user ? `stealthmark_capabilities_${user.id}` : "stealthmark_capabilities_guest";
    writeStoredValue("stealthmark_onboarded", "true");
    writeStoredValue(domainKey, domain);
    writeStoredValue(capsKey, JSON.stringify(capabilities));

    // Persist domain & provision credentials via real backend API
    try {
      const res = await fetch("/api/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          name: domain.split('.')[0].toUpperCase() + ' Production',
          capabilities: capabilities.map((c) => c.action),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.apiKey?.key === "string" && data.apiKey?.keyPrefix) {
          const newKey: ApiKeyWithSecret = {
            id: `key-${Date.now()}`,
            name: "Production Gateway Agent",
            keyPrefix: data.apiKey.keyPrefix,
            scopes: ["usage:ingest"],
            rateLimitRpm: 120,
            createdAt: new Date().toISOString(),
            lastUsedAt: null,
            status: "active",
            rawKey: data.apiKey.key,
          };
          setApiKeys((prev) => [
            newKey,
            ...prev.filter((k) => k.keyPrefix !== newKey.keyPrefix && !isDemoApiKey(k)),
          ]);
        }
      } else {
        console.warn(`[Dashboard] Registering the site answered HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn("[Dashboard] Connect domain backend sync warning:", err);
    }
  };

  /** Keys are minted server-side; the raw secret is shown once and kept in memory only, never in localStorage. */
  const handleCreateKey = async (name: string, rpm: number): Promise<CreateKeyResult> => {
    if (!user) return { ok: false, reason: "not_signed_in" };
    const scopes = ["usage:ingest"];
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopes, rateLimitRpm: rpm }),
      });
      const data = (await res.json().catch(() => ({}))) as { key?: unknown; item?: ApiKeyItem; error?: unknown; code?: unknown };
      if (!res.ok || typeof data.key !== "string" || !data.item) {
        return { ok: false, reason: describeKeyFailure(res.status, data.error, data.code) };
      }
      const created: ApiKeyWithSecret = { ...data.item, rawKey: data.key };
      setApiKeys((prev) => [created, ...prev.filter((k) => k.id !== created.id && !isDemoApiKey(k))]);
      return { ok: true, key: data.key };
    } catch (err) {
      console.warn("[API Keys] Create failed:", err);
      return { ok: false, reason: "network_error" };
    }
  };

  const handleGenerateKey = async (): Promise<CreateKeyResult> => handleCreateKey("Production Gateway Agent", 120);

  const handleRevokeKey = (id: string) => {
    setApiKeys(apiKeys.map((k) => (k.id === id ? { ...k, status: "revoked" as const, rawKey: undefined } : k)));

    if (user) {
      fetch(`/api/keys?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch((err) => {
        console.warn("[API Keys] Revoke warning:", err);
      });
    }
  };

  const handleDismissOnboarding = () => {
    setIsOnboardingDismissed(true);
    if (user) writeStoredValue(`stealthmark_onboarding_dismissed_${user.id}`, "true");
  };

  return {
    handleDefconChange,
    handleOnboardingComplete,
    handleCreateKey,
    handleGenerateKey,
    handleRevokeKey,
    handleDismissOnboarding,
  };
}
