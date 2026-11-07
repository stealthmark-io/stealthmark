const LOGIN_NEXT_KEY = 'stealthmark_login_next';
const MAX_NEXT_LENGTH = 300;
const NEXT_BASE = 'https://stealthmark.invalid';
const UNSAFE_CHARS = /[\u0000-\u001F\u007F\\]/;

/**
 * Accepts only a same-origin path (optionally with a query) to continue to after signing in.
 * Anything else, including absolute URLs, protocol-relative URLs and backslashes, yields null.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_NEXT_LENGTH) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || UNSAFE_CHARS.test(raw)) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw, NEXT_BASE);
  } catch {
    return null;
  }
  if (parsed.origin !== NEXT_BASE) return null;
  if (parsed.pathname.startsWith('/login') || parsed.pathname.startsWith('/api/auth')) return null;
  const path = `${parsed.pathname}${parsed.search}`;
  if (path.startsWith('//')) return null;
  return path;
}

export function rememberLoginNext(path: string | null): void {
  if (!path || typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(LOGIN_NEXT_KEY, path);
  } catch (error) {
    console.warn('[Auth] Could not remember the page to return to:', error instanceof Error ? error.name : 'unknown');
  }
}

/** Returns the remembered destination once and forgets it. */
export function takeLoginNext(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = sessionStorage.getItem(LOGIN_NEXT_KEY);
    sessionStorage.removeItem(LOGIN_NEXT_KEY);
    return safeNextPath(stored);
  } catch (error) {
    console.warn('[Auth] Could not read the page to return to:', error instanceof Error ? error.name : 'unknown');
    return null;
  }
}

/** Sends the browser to the remembered destination, or returns false when there is none. */
export function continueToRememberedPage(): boolean {
  const next = takeLoginNext();
  if (!next) return false;
  window.location.assign(next);
  return true;
}
