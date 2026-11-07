import type { ActiveShield, DefconLevel } from "./types";

export const TELEMETRY_EVENTS_ENDPOINT = "/api/telemetry/events";

/** Events asked for when the table is loaded for one domain; the all-domains feed answers with the same window. */
export const DOMAIN_EVENTS_LIMIT = 50;

export const DEFCON_LEVELS: DefconLevel[] = [
  { level: 5, name: "Normal", color: "text-emerald-400", bg: "bg-emerald-500", desc: "Baseline posture. Agents are observed and the site answers normally." },
  { level: 4, name: "Guarded", color: "text-cyan-400", bg: "bg-cyan-500", desc: "Adaptive rate limiting for high-frequency agents." },
  { level: 3, name: "Elevated", color: "text-amber-400", bg: "bg-amber-500", desc: "Stricter agent identity checks enforced." },
  { level: 2, name: "High", color: "text-orange-400", bg: "bg-orange-500", desc: "Signed agent identity required (roadmap)." },
  { level: 1, name: "Lockdown", color: "text-rose-400", bg: "bg-rose-500", desc: "Emergency origin freeze. Only allow-listed agents pass." },
];

export const ACTIVE_SHIELDS: ActiveShield[] = [
  {
    id: "agent-detection",
    name: "Agent Detection",
    status: "Active",
    desc: "Recognizes agents that identify themselves: Accept: application/agent+json, the x-stealthmark-agent header and known crawler User-Agents such as GPTBot, ClaudeBot, PerplexityBot and OAI-SearchBot.",
  },
  {
    id: "event-recording",
    name: "Event Recording",
    status: "Active",
    desc: "Records one event per agent request and shows per-agent and per-route activity in this console.",
  },
  {
    id: "humans-unchanged",
    name: "Same Page for Humans",
    status: "Active",
    desc: "Human visitors are not counted and the page content they receive does not change; two x-stealthmark-* response headers are added. Agents that disguise themselves as browsers are not detected.",
  },
  {
    id: "policy-observe",
    name: "Policy: Observe",
    status: "Default",
    desc: "The site answers agents as it answers everyone else while every agent request is recorded. A request that asks for the agent manifest (Accept: application/agent+json or the well-known manifest path) receives the manifest.",
  },
  {
    id: "policy-manifest",
    name: "Policy: Manifest",
    status: "Available",
    desc: "Agents receive a machine-readable agent manifest that describes what your site exposes.",
  },
  {
    id: "policy-block",
    name: "Policy: Block",
    status: "Available",
    desc: "Agent requests are answered with 403, except requests that ask for application/agent+json or the well-known manifest, which receive the manifest. Human traffic is not affected.",
  },
];

export function findDefconLevel(level: number): DefconLevel {
  return DEFCON_LEVELS.find((d) => d.level === level) || DEFCON_LEVELS[0];
}
