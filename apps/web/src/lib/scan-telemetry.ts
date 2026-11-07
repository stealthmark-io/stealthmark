// Shared by /api/scan/audit and /api/scan/engaged so both record the same client classes and
// attribution values, and a scan view can be joined to its engagement in usage_records.

const SCAN_TRIGGERS = ['autorun', 'manual', 'email_reveal', 'checkout_return'] as const;
export type ScanTrigger = (typeof SCAN_TRIGGERS)[number];

const ATTRIBUTION_RE = /^[a-z0-9_.-]{2,64}$/;

/**
 * Coarse client class from the User-Agent. Only 'browser' can count as a human founder: curl,
 * scripts, headless browsers and crawlers are automation. Mail link scanners that send a real
 * browser UA still land in 'browser', which is why /scan also records an engagement event.
 */
export function classifyUserAgent(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (!ua) return 'empty';
  if (ua.includes('stealthmark')) return 'stealthmark';
  if (/headless|puppeteer|playwright|phantomjs|lighthouse/.test(ua)) return 'headless';
  if (/bot\b|crawler|spider|scanner|preview|slurp|facebookexternalhit/.test(ua)) return 'bot';
  if (ua.startsWith('curl/') || ua.startsWith('wget/')) return 'curl';
  if (/python|aiohttp|httpx|go-http-client|node-fetch|undici|axios|okhttp|java\//.test(ua)) return 'script';
  if (ua.startsWith('mozilla/')) return 'browser';
  return 'other';
}

/** Returns the attribution source (`ref`, else `utm_source`) when it is a safe slug, else null. */
export function parseAttribution(ref: string | null, utmSource: string | null): string | null {
  const value = (ref || utmSource || '').trim().toLowerCase();
  return ATTRIBUTION_RE.test(value) ? value : null;
}

export function parseScanTrigger(value: string | null): ScanTrigger | null {
  return SCAN_TRIGGERS.find((trigger) => trigger === value) ?? null;
}
