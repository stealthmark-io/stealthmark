// ═══════════════════════════════════════════════════════════════════
// @stealthmark/core — Encoding Guard
// Canonical constants & helpers mitigating CVE-2026-111497 (Node2Shell)
// ═══════════════════════════════════════════════════════════════════

export const SAFE_OUTBOUND_ACCEPT_ENCODING = 'gzip, deflate';

export const BROTLI_BLOCK_STATUS = 415;

export const BROTLI_BLOCK_CODE = 'INBOUND_BROTLI_BLOCKED_CVE_2026_111497';

export const BROTLI_BLOCK_BODY = {
  error: 'unsupported_media_type',
  code: BROTLI_BLOCK_CODE,
  message: 'Brotli-encoded request payloads are rejected to mitigate CVE-2026-111497.',
} as const;

const UNSUPPORTED_BROTLI_TOKENS = new Set(['br', 'x-brotli', 'brotli']);

/**
 * Normalizes comma-separated tokens (lowercase and trimmed) and checks
 * whether any token indicates Brotli compression ('br', 'x-brotli', or 'brotli').
 * Guarantees zero false positives on tokens like 'brace' or 'bread'.
 */
export function hasUnsupportedBrotliEncoding(
  headerValue: string | string[] | null | undefined
): boolean {
  if (!headerValue) return false;

  const entries = Array.isArray(headerValue) ? headerValue : [headerValue];
  for (const entry of entries) {
    if (typeof entry !== 'string') continue;
    const tokens = entry.split(',');
    for (const rawToken of tokens) {
      const trimmed = rawToken.trim().toLowerCase();
      if (!trimmed) continue;
      const baseToken = trimmed.split(';')[0]?.trim() ?? trimmed;
      if (UNSUPPORTED_BROTLI_TOKENS.has(trimmed) || UNSUPPORTED_BROTLI_TOKENS.has(baseToken)) {
        return true;
      }
    }
  }

  return false;
}
