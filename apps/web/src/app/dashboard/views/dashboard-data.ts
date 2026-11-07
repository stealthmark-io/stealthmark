import { flags } from "@/lib/flags";
import type { ApiKeyItem, DetectedCapability } from "../components";

export const DEFAULT_API_KEYS: ApiKeyItem[] = [
  {
    id: "key-1",
    name: "Demo key (sample)",
    keyPrefix: "sm_live_89f1...2a4d",
    scopes: ["usage:ingest"],
    rateLimitRpm: 300,
    createdAt: "2026-09-10T14:22:00Z",
    lastUsedAt: "2026-09-19T11:15:20Z",
    status: "active",
  },
  {
    id: "key-2",
    name: "Demo key: staging (sample)",
    keyPrefix: "sm_live_3c21...8b7e",
    scopes: ["usage:ingest"],
    rateLimitRpm: 120,
    createdAt: "2026-09-12T09:40:00Z",
    lastUsedAt: "2026-09-19T10:40:11Z",
    status: "active",
  },
];

export const DEFAULT_CAPABILITIES: DetectedCapability[] = [
  { id: "cap-1", label: "Example: Read Docs", action: "Read Docs", method: "GET", path: "/docs", enabled: true, rateLimit: 60, isBlocked: false, icon: null },
  { id: "cap-2", label: "Example: Read Pricing", action: "Read Pricing", method: "GET", path: "/pricing", enabled: true, rateLimit: 60, isBlocked: false, icon: null },
  { id: "cap-3", label: "Example: Search Catalog", action: "Search Catalog", method: "GET", path: "/search", enabled: true, rateLimit: 30, isBlocked: false, icon: null },
  { id: "cap-4", label: "Example: Admin Area", action: "Access Admin Area", method: "GET", path: "/admin/*", enabled: false, rateLimit: 0, isBlocked: true, icon: null },
];

export const STEALTHMARK_CAPABILITIES: DetectedCapability[] = [
  { id: "cap-sm-1", label: "Audit Website Security", action: "Audit Website Security", method: "GET", path: "/api/scan/audit", enabled: true, rateLimit: 60, isBlocked: false, icon: null },
  { id: "cap-sm-2", label: "Request Early Access", action: "Request Early Access", method: "POST", path: "/api/waitlist", enabled: true, rateLimit: 30, isBlocked: false, icon: null },
  { id: "cap-sm-3", label: "Request a Technical Session", action: "Request a Technical Session", method: "POST", path: "/api/enterprise/contact", enabled: true, rateLimit: 10, isBlocked: false, icon: null },
  { id: "cap-sm-4", label: "Access Admin Area", action: "Access Admin Area", method: "GET", path: "/admin/*", enabled: false, rateLimit: 0, isBlocked: true, icon: null },
];

export type DashboardTab = "gateway" | "agents" | "hitl" | "flight-plan" | "api-keys" | "mcp" | "wizard" | "settings";

export const TAB_ENABLED: Record<DashboardTab, boolean> = {
  gateway: true,
  agents: true,
  hitl: flags.hitl,
  "flight-plan": flags.hitl,
  "api-keys": true,
  mcp: flags.mcpPanel,
  wizard: true,
  settings: true,
};

export const URL_TABS: readonly DashboardTab[] = ["agents", "flight-plan", "api-keys", "mcp", "wizard"];


export const DEFAULT_DEFCON_LEVEL = 5;
export const DEFCON_STORAGE_KEY = "stealthmark_defcon_level";
