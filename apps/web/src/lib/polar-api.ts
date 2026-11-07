// POLAR_API_BASE lets Preview point at https://sandbox-api.polar.sh for the paid-flow E2E.
export function polarApiBase(): string {
  return (process.env.POLAR_API_BASE || 'https://api.polar.sh').replace(/\/+$/, '');
}

export function polarApiToken(): string | null {
  return process.env.POLAR_ACCESS_TOKEN || process.env.POLAR_API_KEY || null;
}

export function isPolarCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'polar.sh' || url.hostname.endsWith('.polar.sh'));
  } catch {
    return false;
  }
}
