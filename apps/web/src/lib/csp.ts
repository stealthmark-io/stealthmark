export interface CspEnvironment {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_API_URL?: string;
  NEXT_PUBLIC_GATEWAY_URL?: string;
  NEXT_PUBLIC_GA_ID?: string;
}

export const CSP_REPORT_PATH = '/api/csp-report';

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

export function cspEnvironment(): CspEnvironment {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_GATEWAY_URL: process.env.NEXT_PUBLIC_GATEWAY_URL,
    NEXT_PUBLIC_GA_ID: process.env.NEXT_PUBLIC_GA_ID,
  };
}

/**
 * Enforced Content-Security-Policy with per-request cryptographic nonce + strict-dynamic.
 * Internal backend origins are proxied via first-party stealthmark.io endpoints to prevent
 * passive recon leakage in public response headers.
 */
export function buildContentSecurityPolicy(env: CspEnvironment, nonce?: string): string {
  const publicApiOrigins = [env.NEXT_PUBLIC_API_URL, env.NEXT_PUBLIC_GATEWAY_URL]
    .map(originOf)
    .filter((origin): origin is string => origin !== null);

  const connect = Array.from(new Set(["'self'", 'https://api.stealthmark.io', 'https://gateway.stealthmark.io', ...publicApiOrigins]));
  const script = nonce
    ? ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]
    : ["'self'"];

  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', script],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:']],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', connect],
    ['frame-ancestors', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['object-src', ["'none'"]],
    ['upgrade-insecure-requests', []],
  ];

  const formatted = directives.map(([name, sources]) => (sources.length > 0 ? `${name} ${sources.join(' ')}` : name));
  return [...formatted, `report-to csp-endpoint`, `report-uri ${CSP_REPORT_PATH}`].join('; ');
}
