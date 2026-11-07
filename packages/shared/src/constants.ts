// ═══════════════════════════════════════════
// StealthMark — Shared Constants
// ═══════════════════════════════════════════

/** API key prefix — shown in dashboard, used to identify key type */
export const API_KEY_PREFIX = 'sk_live_'

/** Default rate limits for new API keys */
export const DEFAULT_RATE_LIMITS = {
  rpm: 60,     // requests per minute
  rpd: 10_000, // requests per day
  concurrent: 5,
} as const

/** Default pricing per capability (USD) */
export const DEFAULT_PRICING = {
  web_vision:     0.05,
  web_extract:    0.01,
  web_screenshot: 0.03,
  web_search:     0.02,
  web_browser:    0.10, // per minute
} as const

/** Trust score thresholds */
export const TRUST_THRESHOLDS = {
  new:         { min: 0,    maxExecutions: 10 },
  emerging:    { min: 10,   maxExecutions: 100 },
  established: { min: 100,  maxExecutions: 1000 },
  trusted:     { min: 1000, maxExecutions: Infinity },
} as const

/** Trust weight configuration */
export const TRUST_WEIGHTS = {
  identity:    0.3,
  reliability: 0.5,
  evidence:    0.2,
} as const
