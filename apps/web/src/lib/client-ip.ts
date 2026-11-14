const CF_RAY_REGEX = /^[0-9a-f]{8,32}(?:-[a-z0-9]{2,8})?$/i;

function isValidIpv4(value: string): boolean {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) return false;
  const octets = value.split('.');
  for (const octet of octets) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(octet)) return false;
    const num = Number(octet);
    if (num < 0 || num > 255) return false;
  }
  return true;
}

function isValidIpv6(value: string): boolean {
  if (value.length === 0 || value.length > 45) return false;
  if (/[\s,%[\]]/.test(value)) return false;
  if ((value.startsWith(':') && !value.startsWith('::')) || (value.endsWith(':') && !value.endsWith('::'))) {
    return false;
  }

  const halves = value.split('::');
  if (halves.length > 2) return false;

  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];

  let groupCount = 0;
  for (const seg of left) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(seg)) return false;
    groupCount += 1;
  }

  for (let i = 0; i < right.length; i += 1) {
    const seg = right[i];
    if (i === right.length - 1 && seg.includes('.')) {
      if (!isValidIpv4(seg)) return false;
      groupCount += 2;
    } else {
      if (!/^[0-9a-fA-F]{1,4}$/.test(seg)) return false;
      groupCount += 1;
    }
  }

  if (halves.length === 1 && left.length > 0 && left[left.length - 1].includes('.')) {
    return false;
  }

  return halves.length === 1 ? groupCount === 8 : groupCount <= 7;
}

/**
 * Strict canonical IPv4 / IPv6 literal check. Rejects malformed strings, leading-zero octal octets,
 * CIDR suffixes, ports, zone indices, and comma-joined multi-value headers.
 */
export function isValidIpAddress(value: string | null | undefined): value is string {
  if (!value || typeof value !== 'string') return false;
  if (value.includes(',') || value !== value.trim()) return false;
  return value.includes(':') ? isValidIpv6(value) : isValidIpv4(value);
}

/**
 * The visitor's address as the nearest trusted proxy saw it.
 *
 * Proxy boundary rules:
 * - `CF-Connecting-IP` is rejected if it contains multiple comma-separated values or fails strict IPv4/IPv6 syntax.
 * - When `TRUST_CLOUDFLARE_EDGE=true` (production behind Cloudflare Tunnel on Hermes001), `CF-Connecting-IP` is only
 *   trusted when accompanied by a coherent `CF-Ray` header; otherwise we fall back to the nearest proxy hop in `X-Forwarded-For`.
 * - When `TRUST_CLOUDFLARE_EDGE=false` (direct reverse-proxy mode without Cloudflare), `CF-Connecting-IP` is ignored
 *   and only the last hop of `X-Forwarded-For` is trusted.
 * - `X-Real-IP` and earlier `X-Forwarded-For` entries come from the client and never key a rate limit or audit log.
 */
export function clientIp(request: Request): string | null {
  const trustEdgeMode = process.env.TRUST_CLOUDFLARE_EDGE?.trim().toLowerCase();
  const rawEdge = request.headers.get('cf-connecting-ip')?.trim();

  if (trustEdgeMode !== 'false' && rawEdge && isValidIpAddress(rawEdge)) {
    const cfRay = request.headers.get('cf-ray')?.trim() ?? '';
    const rayCoherent = trustEdgeMode === 'true' ? CF_RAY_REGEX.test(cfRay) : cfRay === '' || CF_RAY_REGEX.test(cfRay);
    if (rayCoherent) {
      return rawEdge;
    }
  }

  const nearest = request.headers
    .get('x-forwarded-for')
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);

  return nearest && isValidIpAddress(nearest) ? nearest : null;
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
