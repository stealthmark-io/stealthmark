/**
 * The address /scan should show once a Fix Pack checkout is redeemed: the same URL without the checkout_id (or
 * session_id) that unlocks the pack. Returns null when there is nothing to strip.
 */
export function withoutCheckoutParams(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has('checkout_id') && !url.searchParams.has('session_id')) return null;
  url.searchParams.delete('checkout_id');
  url.searchParams.delete('session_id');
  return url.pathname + url.search + url.hash;
}

/**
 * The checkout_id a stored unlock token was issued for, so /scan can redeem the same checkout again once the token
 * expires. The payload is signed, not secret: this only reads it, and the server still checks the checkout with Polar.
 */
export function unlockCheckoutId(token: string): string | null {
  const payload = token.split('.')[1];
  if (!token.startsWith('smu1.') || !payload) return null;
  try {
    const decoded: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof decoded === 'object' && decoded !== null && 'cid' in decoded && typeof decoded.cid === 'string' && decoded.cid) {
      return decoded.cid;
    }
  } catch {
    // A payload that does not decode names no checkout to redeem again.
  }
  return null;
}
