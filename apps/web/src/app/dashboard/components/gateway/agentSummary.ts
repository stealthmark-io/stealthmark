import type { AgentSummary } from "@/app/api/usage/_shared";
import type { AgentTrafficEvent } from "./types";

export interface AgentRow {
  agent: string;
  /** Vendor inferred from the agent name; null when the name is not a known crawler token. */
  company: string | null;
  visits: number;
  /** ISO timestamp, or the clock time of an event that carries nothing more precise. */
  lastSeen: string | null;
}

const UNKNOWN_AGENT = "unknown";

/** Lowercase User-Agent tokens of the vendor crawlers @stealthmark/core detects, with the vendor that publishes each. */
const COMPANY_BY_TOKEN: ReadonlyArray<readonly [token: string, company: string]> = [
  ["gptbot", "OpenAI"],
  ["oai-searchbot", "OpenAI"],
  ["chatgpt-user", "OpenAI"],
  ["claudebot", "Anthropic"],
  ["claude-user", "Anthropic"],
  ["claude-searchbot", "Anthropic"],
  ["anthropic-ai", "Anthropic"],
  ["perplexitybot", "Perplexity"],
  ["perplexity-user", "Perplexity"],
  ["meta-externalagent", "Meta"],
  ["amazonbot", "Amazon"],
  ["google-cloudvertexbot", "Google"],
  ["ccbot", "Common Crawl"],
  ["bytespider", "ByteDance"],
  ["cohere-ai", "Cohere"],
  ["duckassistbot", "DuckDuckGo"],
  ["youbot", "You.com"],
];

export const COMPANY_TOKENS: readonly string[] = COMPANY_BY_TOKEN.map(([token]) => token);

/**
 * Names the vendor behind a crawler token. Agents identify themselves and are not verified, so this is the vendor the
 * name claims, never proof of who sent the request.
 */
export function companyForAgent(agent: string): string | null {
  const identifier = agent.toLowerCase();
  const match = COMPANY_BY_TOKEN.find(([token]) => identifier.includes(token));
  return match ? match[1] : null;
}

function toRow(agent: string, visits: number, lastSeen: string | null): AgentRow {
  return { agent, company: companyForAgent(agent), visits, lastSeen };
}

/** One row per agent of the usage aggregation; the order of the response (most events first) is kept. */
export function rowsFromAgentSummaries(agents: readonly AgentSummary[]): AgentRow[] {
  return agents.map((entry) => toRow(entry.agent, entry.events, entry.last_seen));
}

function eventMoment(event: AgentTrafficEvent): number {
  const ms = event.timestamp ? Date.parse(event.timestamp) : Number.NaN;
  return Number.isNaN(ms) ? -1 : ms;
}

/** Groups loaded events by agent, most visits first and then by name; last seen is the newest event of the agent. */
export function rowsFromEvents(events: readonly AgentTrafficEvent[]): AgentRow[] {
  const byAgent = new Map<string, { visits: number; newest: AgentTrafficEvent }>();
  for (const event of events) {
    const agent = event.agent.trim() || UNKNOWN_AGENT;
    const entry = byAgent.get(agent);
    if (!entry) {
      byAgent.set(agent, { visits: 1, newest: event });
      continue;
    }
    entry.visits += 1;
    if (eventMoment(event) > eventMoment(entry.newest)) entry.newest = event;
  }
  return [...byAgent.entries()]
    .map(([agent, entry]) => toRow(agent, entry.visits, entry.newest.timestamp ?? entry.newest.time))
    .sort((a, b) => b.visits - a.visits || a.agent.localeCompare(b.agent));
}
