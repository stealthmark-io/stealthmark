// ═══════════════════════════════════════════════════════════════════
// @stealthmark/core — Canonical Path & Host/Origin DNS-Rebinding Guard
// Pure-TS (Edge-runtime safe, zero Node built-ins) shared by @stealthmark/express and @stealthmark/next
// ═══════════════════════════════════════════════════════════════════

const NULL_BYTE_RE = /%00|\x00/i;
const MALFORMED_PERCENT_RE = /%(?![0-9a-fA-F]{2})/;
const DOUBLE_HEX_RE = /%25[0-9a-fA-F]{2}/i;
const DECIMAL_PART_RE = /^[0-9]+$/;
const HEX_PART_RE = /^0x[0-9a-f]+$/i;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export interface NormalizedRequestPathResult {
  pathOnly: string;
  blocked: boolean;
  anomaly?: string;
}

export interface NormalizedAllowedHost {
  canonicalHost: string;
  port?: number;
}

/**
 * Normalizes a request path once BEFORE route/manifest/policy checks to eliminate
 * parser differentials (CVE-2026-126755) and NUL-byte / malformed-encoding bypasses,
 * while preserving legitimate encoded `%` literals (`%25`, e.g. `/discounts/50%25-off`).
 */
export function normalizeRequestPath(rawPath: string): NormalizedRequestPathResult {
  const input = (rawPath || '/').split('?')[0] || '/';
  if (NULL_BYTE_RE.test(input)) {
    return { pathOnly: '/', blocked: true, anomaly: 'NULL_BYTE_INJECTION_CVE_2026_105482' };
  }
  let current = input.normalize('NFKC');
  if (MALFORMED_PERCENT_RE.test(current)) {
    return { pathOnly: '/', blocked: true, anomaly: 'MALFORMED_URI_ENCODING' };
  }

  const hasDoubleHex = DOUBLE_HEX_RE.test(current);
  const maxPasses = hasDoubleHex ? 2 : 1;
  for (let pass = 0; pass < maxPasses && /%[0-9a-fA-F]{2}/.test(current); pass++) {
    try {
      const decoded = decodeURIComponent(current);
      if (NULL_BYTE_RE.test(decoded)) {
        return { pathOnly: '/', blocked: true, anomaly: 'NULL_BYTE_INJECTION_CVE_2026_105482' };
      }
      current = decoded.normalize('NFKC');
    } catch {
      return { pathOnly: '/', blocked: true, anomaly: 'MALFORMED_URI_ENCODING' };
    }
  }

  current = current.replace(/\/{2,}/g, '/');
  if (current.length > 1 && current.endsWith('/')) {
    current = current.slice(0, -1);
  }
  return { pathOnly: current || '/', blocked: false };
}

function parseIpv6Groups(rawAddr: string): number[] | null {
  let addr = rawAddr.toLowerCase();
  if (!addr || addr.includes(':::')) return null;

  // Handle embedded IPv4 tail (e.g. ::ffff:127.0.0.1)
  const lastColon = addr.lastIndexOf(':');
  if (lastColon !== -1 && addr.slice(lastColon + 1).includes('.')) {
    const v4Match = IPV4_RE.exec(addr.slice(lastColon + 1));
    if (!v4Match) return null;
    const octets = [Number(v4Match[1]), Number(v4Match[2]), Number(v4Match[3]), Number(v4Match[4])];
    if (octets.some((o) => o > 255)) return null;
    const hi = ((octets[0]! << 8) | octets[1]!).toString(16);
    const lo = ((octets[2]! << 8) | octets[3]!).toString(16);
    addr = `${addr.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = addr.split('::');
  if (halves.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const parts = side.split(':');
    const out: number[] = [];
    for (const part of parts) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      out.push(Number.parseInt(part, 16));
    }
    return out;
  };

  const left = parseSide(halves[0] ?? '');
  if (!left) return null;
  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }
  const right = parseSide(halves[1] ?? '');
  if (!right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

function canonicalizeHostName(rawName: string): { canonical: string; valid: boolean } {
  const clean = rawName.normalize('NFKC').toLowerCase().trim();
  if (!clean || /[\s,\x00-\x1f]/.test(clean)) return { canonical: '', valid: false };
  if (clean.startsWith('[') && clean.endsWith(']')) {
    const inner = clean.slice(1, -1);
    const groups = parseIpv6Groups(inner);
    if (!groups) return { canonical: '', valid: false };
    return { canonical: `[${groups.map((g) => g.toString(16)).join(':')}]`, valid: true };
  }
  if (clean.includes(':')) {
    const groups = parseIpv6Groups(clean);
    if (!groups) return { canonical: '', valid: false };
    return { canonical: `[${groups.map((g) => g.toString(16)).join(':')}]`, valid: true };
  }
  return { canonical: clean.replace(/\.+$/, ''), valid: clean.replace(/\.+$/, '').length > 0 };
}

function parseAsciiPort(portStr: string): number | null {
  if (!/^[0-9]{1,5}$/.test(portStr)) return null;
  const n = Number(portStr);
  return n >= 1 && n <= 65535 ? n : null;
}

function parseHostHeader(rawHost: string): { canonicalHost: string; port?: number; valid: boolean } {
  if (!rawHost) return { canonicalHost: '', valid: true };
  const clean = rawHost.normalize('NFKC').toLowerCase().trim();
  if (!clean || /[\s,\x00-\x1f]/.test(clean)) return { canonicalHost: '', valid: false };

  if (clean.startsWith('[')) {
    const end = clean.indexOf(']');
    if (end === -1) return { canonicalHost: '', valid: false };
    const bracketHost = clean.slice(0, end + 1);
    const rest = clean.slice(end + 1);
    let port: number | undefined;
    if (rest) {
      if (!rest.startsWith(':')) return { canonicalHost: '', valid: false };
      const parsedPort = parseAsciiPort(rest.slice(1));
      if (parsedPort === null) return { canonicalHost: '', valid: false };
      port = parsedPort;
    }
    const { canonical, valid } = canonicalizeHostName(bracketHost);
    return { canonicalHost: canonical, port, valid };
  }

  const colonIdx = clean.indexOf(':');
  if (colonIdx !== -1) {
    // Reject multiple colons on unbracketed Host headers (malformed IPv6/host)
    if (clean.indexOf(':', colonIdx + 1) !== -1) return { canonicalHost: '', valid: false };
    const hostPart = clean.slice(0, colonIdx);
    const parsedPort = parseAsciiPort(clean.slice(colonIdx + 1));
    if (!hostPart || parsedPort === null) return { canonicalHost: '', valid: false };
    const { canonical, valid } = canonicalizeHostName(hostPart);
    return { canonicalHost: canonical, port: parsedPort, valid };
  }

  const { canonical, valid } = canonicalizeHostName(clean);
  return { canonicalHost: canonical, valid };
}

/**
 * Detects non-canonical IPv4 forms: integer decimal (`2130706433`), abbreviated IPv4 (`127.1`),
 * octal (`0177.0.0.1`, `127.0.0.01`) or hex (`0x7f000001`, `127.0.0.0x1`) in any octet.
 */
export function isNonCanonicalIpHost(rawHostNoPort: string): boolean {
  const clean = rawHostNoPort.normalize('NFKC').toLowerCase().trim().replace(/\.+$/, '');
  if (!clean || clean.startsWith('[') || clean.includes(':')) return false;
  const parts = clean.split('.');
  if (parts.length > 4) return false;
  if (!parts.every((p) => DECIMAL_PART_RE.test(p) || HEX_PART_RE.test(p))) return false;
  if (parts.length < 4) return true;
  return parts.some((p) => p.startsWith('0x') || (p.length > 1 && p.startsWith('0')));
}

/**
 * Recognizes all loopback host variants: `localhost`, `localhost.`, `*.localhost`, `127.0.0.0/8`,
 * `[::1]`, expanded `[0:0:0:0:0:0:0:1]`, and IPv4-mapped IPv6 `[::ffff:127.0.0.0/104]`.
 */
export function isLoopbackHost(rawHostNoPort: string): boolean {
  const { canonical, valid } = canonicalizeHostName(rawHostNoPort);
  if (!valid || !canonical) return false;
  if (canonical === 'localhost' || canonical.endsWith('.localhost')) return true;

  const v4Match = IPV4_RE.exec(canonical);
  if (v4Match) {
    const octets = [Number(v4Match[1]), Number(v4Match[2]), Number(v4Match[3]), Number(v4Match[4])];
    return octets[0] === 127 && octets.every((o) => o <= 255);
  }

  if (canonical.startsWith('[') && canonical.endsWith(']')) {
    const groups = parseIpv6Groups(canonical.slice(1, -1));
    if (!groups) return false;
    const isV6Loopback =
      groups[0] === 0 &&
      groups[1] === 0 &&
      groups[2] === 0 &&
      groups[3] === 0 &&
      groups[4] === 0 &&
      groups[5] === 0 &&
      groups[6] === 0 &&
      groups[7] === 1;
    if (isV6Loopback) return true;
    const isV4MappedLoopback =
      groups[0] === 0 &&
      groups[1] === 0 &&
      groups[2] === 0 &&
      groups[3] === 0 &&
      groups[4] === 0 &&
      groups[5] === 0xffff &&
      (groups[6]! >> 8) === 127;
    return isV4MappedLoopback;
  }
  return false;
}

/**
 * Pre-normalizes an `allowedHosts` list once at middleware initialization.
 * Properly accepts bare IPv6 literals (`::1`), bracketed IPv6 (`[::1]`, `[::1]:3001`), and host[:port].
 */
export function normalizeAllowedHosts(
  allowedHosts?: readonly string[]
): readonly NormalizedAllowedHost[] {
  if (!allowedHosts || allowedHosts.length === 0) return [];
  const out: NormalizedAllowedHost[] = [];
  for (const raw of allowedHosts) {
    const trimmed = raw.normalize('NFKC').toLowerCase().trim();
    if (!trimmed) continue;
    // Bare IPv6 literal without brackets (e.g. '::1') has >= 2 colons
    const colonCount = (trimmed.match(/:/g) ?? []).length;
    if (!trimmed.startsWith('[') && colonCount >= 2) {
      const { canonical, valid } = canonicalizeHostName(trimmed);
      if (valid) out.push({ canonicalHost: canonical });
      continue;
    }
    const parsed = parseHostHeader(trimmed);
    if (parsed.valid && parsed.canonicalHost) {
      out.push({ canonicalHost: parsed.canonicalHost, port: parsed.port });
    }
  }
  return out;
}

function readSingleHeader(
  rawHeaders: Headers | Record<string, string | string[] | undefined>,
  name: string
): { present: boolean; value: string; duplicate: boolean } {
  const target = name.toLowerCase();
  if (typeof Headers !== 'undefined' && rawHeaders instanceof Headers) {
    const val = rawHeaders.get(target);
    if (val === null) return { present: false, value: '', duplicate: false };
    return { present: true, value: val, duplicate: val.includes(',') };
  }
  let foundCount = 0;
  let value = '';
  let duplicate = false;
  for (const [k, v] of Object.entries(rawHeaders)) {
    if (k.toLowerCase() !== target || v === undefined) continue;
    foundCount++;
    if (Array.isArray(v)) {
      if (v.length > 1) duplicate = true;
      value = v[0] ?? '';
      if (value.includes(',')) duplicate = true;
    } else {
      if (v.includes(',')) duplicate = true;
      value = v;
    }
  }
  if (foundCount > 1) duplicate = true;
  return { present: foundCount > 0, value, duplicate };
}

function parseStrictOriginHost(origin: string): { host: string; valid: boolean } {
  if (!origin || /[\s,\x00-\x1f]/.test(origin)) return { host: '', valid: false };
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return { host: '', valid: false };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { host: '', valid: false };
  if (url.username !== '' || url.password !== '') return { host: '', valid: false };
  if (origin.toLowerCase() !== url.origin.toLowerCase()) return { host: '', valid: false };
  const host = url.hostname;
  if (!host || isNonCanonicalIpHost(host)) return { host: '', valid: false };
  return { host, valid: true };
}

/**
 * Detects browser-based DNS rebinding, duplicate/malformed Host/Origin headers,
 * non-canonical IP Host headers, and cross-origin or `Origin: null` requests against
 * loopback services (CVE-2026-76807 / CVE-2026-77359).
 */
export function isHostOrOriginAnomalous(
  rawHeaders: Headers | Record<string, string | string[] | undefined>,
  allowedHosts?: readonly string[] | readonly NormalizedAllowedHost[]
): boolean {
  const hostInfo = readSingleHeader(rawHeaders, 'host');
  const originInfo = readSingleHeader(rawHeaders, 'origin');
  if (hostInfo.duplicate || originInfo.duplicate) {
    return true;
  }

  const rawHost = hostInfo.value.normalize('NFKC').toLowerCase().trim();
  if (hostInfo.present && !rawHost) {
    return true;
  }

  // Raw host before stripping trailing dot (needed for non-canonical IP check)
  const rawHostWithoutPort = rawHost.startsWith('[')
    ? rawHost.slice(0, rawHost.indexOf(']') + 1)
    : (rawHost.split(':')[0] ?? '');
  if (rawHostWithoutPort && isNonCanonicalIpHost(rawHostWithoutPort)) {
    return true;
  }

  const parsedHost = parseHostHeader(rawHost);
  if (!parsedHost.valid) {
    return true;
  }

  const normalizedAllowlist: readonly NormalizedAllowedHost[] =
    allowedHosts && allowedHosts.length > 0
      ? typeof allowedHosts[0] === 'string'
        ? normalizeAllowedHosts(allowedHosts as readonly string[])
        : (allowedHosts as readonly NormalizedAllowedHost[])
      : [];

  if (normalizedAllowlist.length > 0) {
    if (!parsedHost.canonicalHost) return true;
    const matches = normalizedAllowlist.some((entry) =>
      entry.port !== undefined
        ? entry.canonicalHost === parsedHost.canonicalHost && entry.port === parsedHost.port
        : entry.canonicalHost === parsedHost.canonicalHost
    );
    if (!matches) return true;
  }

  const rawOrigin = originInfo.value.normalize('NFKC').toLowerCase().trim();
  const hostIsLoopback = parsedHost.canonicalHost ? isLoopbackHost(parsedHost.canonicalHost) : false;
  if (rawOrigin) {
    if (rawOrigin === 'null') {
      return hostIsLoopback;
    }
    const parsedOrigin = parseStrictOriginHost(rawOrigin);
    if (hostIsLoopback) {
      if (!parsedOrigin.valid || !isLoopbackHost(parsedOrigin.host)) {
        return true;
      }
    }
  }
  return false;
}
