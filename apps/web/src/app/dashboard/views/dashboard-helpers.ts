import type { ApiKeyItem } from "../components";
import { DEFAULT_DEFCON_LEVEL, DEFCON_STORAGE_KEY, TAB_ENABLED, URL_TABS, type DashboardTab } from "./dashboard-data";

export interface UserPlan {
  planName: string;
  priceMonthly: number;
  usedTransactions: number;
  maxTransactions: number;
  status: string;
  portalUrl: string;
}

function describeStorageError(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

export function readStoredValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn(`[Dashboard] Could not read ${key} from local storage:`, describeStorageError(error));
    return null;
  }
}

export function writeStoredValue(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`[Dashboard] Could not write ${key} to local storage:`, describeStorageError(error));
  }
}

export function readStoredJson<T>(key: string, isValid: (value: unknown) => value is T): T | null {
  const raw = readStoredValue(key);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : null;
  } catch (error) {
    console.warn(`[Dashboard] Ignoring unreadable ${key} in local storage:`, describeStorageError(error));
    return null;
  }
}

export function isEnabledTab(id: string): id is DashboardTab {
  return Object.hasOwn(TAB_ENABLED, id) && TAB_ENABLED[id as DashboardTab];
}

export function isDemoApiKey(k: ApiKeyItem): boolean {
  return k.id === "key-1" || k.id === "key-2" || k.keyPrefix === "sm_live_89f1...2a4d" || k.keyPrefix === "sm_live_3c21...8b7e";
}

export function readInitialTab(): DashboardTab {
  if (typeof window !== "undefined") {
    try {
      const params = new URLSearchParams(window.location.search);
      const t = params.get("tab");
      if (t === "settings" || t === "billing") return "settings";
      const requested = URL_TABS.find((tab) => tab === t);
      if (requested && TAB_ENABLED[requested]) return requested;
    } catch (error) {
      console.warn("[Dashboard] Could not read the tab from the URL:", describeStorageError(error));
    }
  }
  return "gateway";
}

export function readInitialDefcon(): number {
  const saved = readStoredValue(DEFCON_STORAGE_KEY);
  if (saved) {
    const parsed = parseInt(saved, 10);
    if (parsed >= 1 && parsed <= 5) return parsed;
  }
  return DEFAULT_DEFCON_LEVEL;
}

export function defconLabel(level: number): string {
  switch (level) {
    case 1:
      return "1 (Lockdown)";
    case 2:
      return "2 (High)";
    case 3:
      return "3 (Elevated)";
    case 4:
      return "4 (Guarded)";
    default:
      return "5 (Normal)";
  }
}

export function defconDescription(level: number): string {
  switch (level) {
    case 1:
      return "EMERGENCY LOCKDOWN: Origin frozen. Only verified cryptographic agents with VIP whitelist pass.";
    case 2:
      return "HIGH ALERT: Mandatory Ed25519 KYA passports required for all AI bot requests.";
    case 3:
      return "ELEVATED: Aggressive semantic filtering and rate-limit throttling enforced.";
    case 4:
      return "GUARDED: Adaptive rate-limiting enabled for high-frequency scrapers.";
    default:
      return "NORMAL: Observe policy active with transparent token optimization and fail-open resilience.";
  }
}

interface UserPlanInput {
  isAuthenticated: boolean;
  effectiveTier: string;
  isPaidPro: boolean;
  usedTransactions: number;
}

/** Events per month on the free plan, the only capped plan that still exists. */
export const FREE_EVENT_CAP = 250;

const LEGACY_TIERS = new Set(["pro", "business"]);

const TIER_NAMES: Record<string, string> = {
  scale: "Scale",
  growth: "Growth",
  starter: "Starter",
  enterprise: "Enterprise",
};

export const TIER_CAPS: Record<string, number> = {
  free: FREE_EVENT_CAP,
  developer: FREE_EVENT_CAP,
  starter: 15000,
  growth: 60000,
  scale: 250000,
  business: 100000,
  enterprise: 100000,
};

export function buildUserPlan({ isAuthenticated, effectiveTier, isPaidPro, usedTransactions }: UserPlanInput): UserPlan {
  if (!isAuthenticated) {
    return {
      planName: "Guest demo",
      priceMonthly: 0,
      usedTransactions,
      maxTransactions: FREE_EVENT_CAP,
      status: "Sample data",
      portalUrl: "/pricing",
    };
  }

  const isEnterprise = effectiveTier === "enterprise";
  const knownName = TIER_NAMES[effectiveTier];
  const planName = knownName
    ? knownName
    : isEnterprise
    ? "Enterprise"
    : LEGACY_TIERS.has(effectiveTier)
    ? "Legacy plan"
    : "Free";

  const maxTransactions = TIER_CAPS[effectiveTier] ?? FREE_EVENT_CAP;

  return {
    planName,
    priceMonthly: 0,
    usedTransactions,
    maxTransactions,
    status: "Active",
    portalUrl: isPaidPro ? "https://polar.sh/stealthmark-sa/portal" : "/pricing",
  };
}

export type ApiKeyWithSecret = ApiKeyItem & { rawKey?: string };

/** Returns the raw secret of the first active key the console still holds in memory, or null. */
export function resolveActiveApiKey(apiKeys: ApiKeyWithSecret[]): string | null {
  return apiKeys.find((k) => k.status === "active" && k.rawKey)?.rawKey ?? null;
}
