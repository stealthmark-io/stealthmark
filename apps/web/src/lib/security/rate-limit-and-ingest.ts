/**
 * StealthMark Defensive Threat-Score Rate-Limiter & Sanitized Security Telemetry
 * Zero metering credits: uses threatScore exclusively for edge rate-limiting & auto-banning
 * and strips control chars to prevent CVE-2026-116818 / CVE-2026-116812 log injection.
 */

export interface AgentTelemetryInput {
  workspaceId: string;
  clientIp: string;
  ja4Fingerprint?: string;
  canonicalPath: string;
  normalizedHost: string;
  threatScore: number;
  classification: 'LEGIT_AGENT_OR_USER' | 'SUSPICIOUS_SCRAPER' | 'MALICIOUS_AGENT_BOTNET';
  flags: string[];
}

export interface RateLimitDecision {
  allowed: boolean;
  remainingBudget: number;
  riskWeightApplied: number;
  banActive: boolean;
}

/**
 * Atomic Lua script for Upstash Redis: checks active ban, applies risk weight
 * proportional to threatScore, and triggers 1h auto-ban when threatScore >= 80.
 */
export const DEFENSIVE_THREAT_LUA = `
  local ban_key = KEYS[1]
  local bucket_key = KEYS[2]
  local max_capacity = tonumber(ARGV[1])
  local window_seconds = tonumber(ARGV[2])
  local weight = tonumber(ARGV[3])
  local auto_ban_threshold = tonumber(ARGV[4])
  local threat_score = tonumber(ARGV[5])

  if redis.call("EXISTS", ban_key) == 1 then
    return {0, 0, 1}
  end

  if threat_score >= auto_ban_threshold then
    redis.call("SETEX", ban_key, 3600, "MALICIOUS_AGENT_BOTNET")
    return {0, 0, 1}
  end

  local current = tonumber(redis.call("GET", bucket_key) or "0")
  if current + weight > max_capacity then
    return {0, math.max(0, max_capacity - current), 0}
  end

  local new_val = redis.call("INCRBY", bucket_key, weight)
  if new_val == weight then
    redis.call("EXPIRE", bucket_key, window_seconds)
  end

  return {1, math.max(0, max_capacity - new_val), 0}
`;

export function stripControlChars(str: string, maxLength: number): string {
  return str.replace(/[\x00-\x1F\x7F]/g, '').slice(0, maxLength);
}

export function computeDefensiveDecision(
  input: AgentTelemetryInput,
  maxRiskBudgetPerMinute = 120
): RateLimitDecision {
  const riskWeightApplied = 1 + Math.floor(Math.max(0, input.threatScore) / 15);
  const banActive = input.threatScore >= 80;
  return {
    allowed: !banActive && riskWeightApplied <= maxRiskBudgetPerMinute,
    remainingBudget: banActive ? 0 : Math.max(0, maxRiskBudgetPerMinute - riskWeightApplied),
    riskWeightApplied,
    banActive,
  };
}
