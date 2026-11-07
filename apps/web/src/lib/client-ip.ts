/**
 * The visitor's address as the nearest trusted proxy saw it. Cloudflare overwrites CF-Connecting-IP on every proxied
 * request, and the last X-Forwarded-For entry is the one the nearest proxy appended. X-Real-IP and the earlier
 * X-Forwarded-For entries come from the client, so they never key a rate limit.
 */
export function clientIp(request: Request): string | null {
  const edge = request.headers.get('cf-connecting-ip')?.trim();
  if (edge) return edge;
  const nearest = request.headers
    .get('x-forwarded-for')
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  return nearest || null;
}

/** An IPv6 client can rotate through its whole /64, so limits key on that prefix; IPv4 keys on the address. */
export function clientNetwork(ip: string): string {
  if (!ip.includes(':')) return ip;
  if (ip.includes('.')) return ip.slice(ip.lastIndexOf(':') + 1);
  const [head, tail] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
