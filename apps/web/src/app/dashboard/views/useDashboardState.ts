"use client";

import { useEffect, useState } from "react";
import type { AuthUser } from "@/lib/auth";
import { useGatewayTelemetry } from "@/hooks/useGatewayTelemetry";
import { flags } from "@/lib/flags";
import type { ApiKeyItem, DetectedCapability } from "../components";
import {
  DEFAULT_API_KEYS,
  DEFAULT_CAPABILITIES,
  DEFCON_STORAGE_KEY,
  STEALTHMARK_CAPABILITIES,
  type DashboardTab,
} from "./dashboard-data";
import {
  buildUserPlan,
  isDemoApiKey,
  readInitialDefcon,
  readInitialTab,
  readStoredJson,
  readStoredValue,
  writeStoredValue,
  type ApiKeyWithSecret,
} from "./dashboard-helpers";

function isCapabilityList(value: unknown): value is DetectedCapability[] {
  return Array.isArray(value);
}

function isApiKeyList(value: unknown): value is ApiKeyItem[] {
  return Array.isArray(value);
}

export function useDashboardState(user: AuthUser | null, isAuthenticated: boolean, isAdmin: boolean) {
  const [activeTab, setActiveTab] = useState<DashboardTab>(readInitialTab);

  // Synchronized Persistent DEFCON State (Levels 1 to 5)
  const [defconLevel, setDefconLevel] = useState<number>(readInitialDefcon);

  // Domain state: clean for authenticated users, demo domain for guest mode
  const [onboardedDomain, setOnboardedDomain] = useState<string>("");

  // Capabilities: empty for authenticated users, demo capabilities for guest mode
  const [onboardedCapabilities, setOnboardedCapabilities] = useState<DetectedCapability[]>([]);

  // API Keys: empty for authenticated users, demo keys for guest mode
  const [apiKeys, setApiKeys] = useState<ApiKeyWithSecret[]>([]);

  const [isOnboardingDismissed, setIsOnboardingDismissed] = useState<boolean>(false);
  const [isPaidPro, setIsPaidPro] = useState<boolean>(false);
  const [userPlanTier, setUserPlanTier] = useState<string>("free");

  const isSuperAdmin = isAdmin;

  // Centralized Single Source of Truth for Gateway Telemetry
  const telemetry = useGatewayTelemetry({ pollIntervalMs: 3000 });

  // Agent events this period as recorded in the usage ledger; never a locally incremented counter.
  const userRealRequests = isAuthenticated ? telemetry.metrics.total_requests : 0;

  // Sync state based on authentication status and user ID
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (isAuthenticated && user) {
      // Authenticated User: start clean unless configured
      setOnboardedDomain(readStoredValue(`stealthmark_domain_${user.id}`) || "");

      const capsKey = `stealthmark_capabilities_${user.id}`;
      let parsedCaps: DetectedCapability[] = readStoredJson(capsKey, isCapabilityList) ?? [];

      // Auto-heal if stealthmark.io was previously saved with generic e-commerce routes
      const userDomain = readStoredValue(`stealthmark_domain_${user.id}`);
      const isStealthmarkDomain = userDomain?.toLowerCase().includes("stealthmark") ?? false;
      const hasGenericRoutes = parsedCaps.some((c) => c.path === "/agent/v1/catalog" || c.label === "Browse Product Catalog");
      if (isStealthmarkDomain && (hasGenericRoutes || parsedCaps.length === 0)) {
        parsedCaps = STEALTHMARK_CAPABILITIES;
        writeStoredValue(capsKey, JSON.stringify(STEALTHMARK_CAPABILITIES));
      }
      setOnboardedCapabilities(parsedCaps);

      setIsOnboardingDismissed(readStoredValue(`stealthmark_onboarding_dismissed_${user.id}`) === "true");

      const effectivePlan = readStoredValue(`stealthmark_plan_${user.id}`) || "free";
      setUserPlanTier(effectivePlan);
      setIsPaidPro(effectivePlan === "pro" || effectivePlan === "business");

      const keysKey = `stealthmark_api_keys_${user.id}`;
      const storedKeys = readStoredJson(keysKey, isApiKeyList);
      if (storedKeys) {
        const cleanKeys = storedKeys.filter((k: ApiKeyItem) => !isDemoApiKey(k));
        setApiKeys(cleanKeys);
        writeStoredValue(keysKey, JSON.stringify(cleanKeys));
      }

      // Fetch persistent keys from Supabase /api/keys
      fetch("/api/keys")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.keys && data.keys.length > 0) {
            const cleanRemoteKeys = (data.keys as ApiKeyItem[]).filter((k: ApiKeyItem) => !isDemoApiKey(k));
            if (cleanRemoteKeys.length > 0) {
              setApiKeys(cleanRemoteKeys);
              writeStoredValue(keysKey, JSON.stringify(cleanRemoteKeys));
            }
          }
        })
        .catch((err) => {
          console.warn("[Dashboard] Could not fetch remote api keys:", err);
        });

      // Fetch persistent domain from Supabase /api/domains
      fetch("/api/domains")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.domain) {
            setOnboardedDomain(data.domain);
            writeStoredValue(`stealthmark_domain_${user.id}`, data.domain);
          }
          if (data?.organization?.plan) {
            setUserPlanTier(data.organization.plan);
            writeStoredValue(`stealthmark_plan_${user.id}`, data.organization.plan);
          }
        })
        .catch((err) => {
          console.warn("[Dashboard] Could not fetch remote domain:", err);
        });
    } else if (!isAuthenticated) {
      // Guest Mode: load demo sandbox data
      setOnboardedDomain(readStoredValue("stealthmark_domain_guest") || "democv.example.com");
      setOnboardedCapabilities(readStoredJson("stealthmark_capabilities_guest", isCapabilityList) ?? DEFAULT_CAPABILITIES);
      setApiKeys(readStoredJson("stealthmark_api_keys_guest", isApiKeyList) ?? DEFAULT_API_KEYS);
    }

    if (!flags.defcon) return;

    // Hydrate persistent DEFCON posture from Supabase policy engine
    fetch("/api/defcon")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.defcon_level && typeof data.defcon_level === "number") {
          setDefconLevel(data.defcon_level);
          writeStoredValue(DEFCON_STORAGE_KEY, String(data.defcon_level));
        }
      })
      .catch((err) => {
        console.warn("[Dashboard] Could not hydrate the DEFCON posture:", err);
      });
  }, [isAuthenticated, user?.id]);

  const effectiveTier = userPlanTier;

  const userPlan = buildUserPlan({
    isAuthenticated,
    effectiveTier,
    isPaidPro,
    usedTransactions: userRealRequests,
  });

  return {
    activeTab,
    setActiveTab,
    defconLevel,
    setDefconLevel,
    onboardedDomain,
    setOnboardedDomain,
    onboardedCapabilities,
    setOnboardedCapabilities,
    apiKeys,
    setApiKeys,
    userRealRequests,
    isOnboardingDismissed,
    setIsOnboardingDismissed,
    telemetry,
    isSuperAdmin,
    effectiveTier,
    userPlan,
  };
}

export type DashboardState = ReturnType<typeof useDashboardState>;
