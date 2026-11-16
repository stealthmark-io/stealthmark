// ═══════════════════════════════════════════════════════════════════
// @stealthmark/core — Request context for metered events
// Host normalisation and bounded event metadata, shared by every adapter.
// ═══════════════════════════════════════════════════════════════════

/** Longest valid DNS name (RFC 1035). */
export const MAX_HOST_LENGTH = 253;

/** Ingest API limit: a metadata string longer than this is truncated server side. */
const MAX_METADATA_STRING_LENGTH = 200;
/** Ingest API limit: metadata that serializes to more bytes rejects the whole batch. */
const MAX_METADATA_BYTES = 1024;
const MAX_METHOD_LENGTH = 16;

const HOSTNAME_PATTERN = /^[a-z0-9._-]+$/;
const IPV6_LITERAL_PATTERN = /^\[[0-9a-f:.]+\]$/;

type HeaderSource = Headers | Record<string, string | undefined>;

function readHeader(headers: HeaderSource, name: string): string | undefined {
  const value = headers instanceof Headers ? headers.get(name) : headers[name];
  return value ?? undefined;
}

function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * Normalises a Host or X-Forwarded-Host header value into a bare hostname.
 *
 * Takes the first entry of a comma separated list, lowercases it, strips the port and a trailing
 * dot, and caps it at 253 characters. Returns undefined for a missing, empty or malformed value
 * (anything that is not a hostname, an IPv4 address or a bracketed IPv6 literal).
 */
export function normalizeHost(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const first = value.split(',')[0].trim().toLowerCase();
  if (first === '') return undefined;

  let host: string;
  if (first.startsWith('[')) {
    const end = first.indexOf(']');
    if (end === -1) return undefined;
    host = first.slice(0, end + 1);
    if (!IPV6_LITERAL_PATTERN.test(host)) return undefined;
  } else {
    const colon = first.indexOf(':');
    host = colon === -1 ? first : first.slice(0, colon);
    if (host.endsWith('.')) host = host.slice(0, -1);
    if (!HOSTNAME_PATTERN.test(host)) return undefined;
  }

  return host.slice(0, MAX_HOST_LENGTH);
}

/**
 * Resolves the host a request was addressed to. By default only the Host header is read, because
 * X-Forwarded-Host is client controlled unless a trusted proxy overwrites it. With `trustForwardedHost`
 * the first X-Forwarded-Host value wins and the Host header is the fallback.
 * Returns undefined when no readable header carries a usable host.
 */
export function resolveRequestHost(
  headers: HeaderSource,
  options: { trustForwardedHost?: boolean } = {}
): string | undefined {
  const forwarded = options.trustForwardedHost ? normalizeHost(readHeader(headers, 'x-forwarded-host')) : undefined;
  return forwarded ?? normalizeHost(readHeader(headers, 'host'));
}

/**
 * Builds the metadata object of a metered event: path, method and, when known, host.
 *
 * The ingest API rejects a whole batch when one event's metadata serializes to more than 1024 bytes,
 * so the path is the part that gets shortened to fit. Host and method are never dropped.
 */
export function buildEventMetadata(input: { path: string; method?: string; host?: string }): Record<string, string> {
  const method = (input.method || 'GET').slice(0, MAX_METHOD_LENGTH);
  const host = input.host ? input.host.slice(0, MAX_HOST_LENGTH) : undefined;
  const assemble = (path: string): Record<string, string> =>
    host === undefined ? { path, method } : { path, method, host };

  let path = input.path.slice(0, MAX_METADATA_STRING_LENGTH);
  let metadata = assemble(path);
  while (path.length > 0 && utf8ByteLength(JSON.stringify(metadata)) > MAX_METADATA_BYTES) {
    path = path.slice(0, -1);
    metadata = assemble(path);
  }
  return metadata;
}

/** Longest textual IPv6 address with a zone id and a port; anything longer is not an address. */
const MAX_CLIENT_ADDRESS_LENGTH = 64;
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_GROUP_PATTERN = /^[0-9a-f]{1,4}$/;
const IPV4_MAPPED_PREFIX = '::ffff:';

function isIpv4(address: string): boolean {
  const octets = IPV4_PATTERN.exec(address);
  return octets !== null && octets.slice(1).every((octet) => Number(octet) <= 255);
}

/** Drops the brackets, port and zone id that can surround an address in a header or a socket field. */
function stripAddressDecoration(value: string): string {
  if (value.startsWith('[')) return value.slice(1).split(']')[0];
  const withoutZone = value.split('%')[0];
  const isIpv4WithPort = withoutZone.includes('.') && withoutZone.split(':').length === 2;
  return isIpv4WithPort ? withoutZone.split(':')[0] : withoutZone;
}

/** The /64 an IPv6 address belongs to, written as `a:b:c:d::/64`; undefined when it is not an IPv6 address. */
function ipv6Prefix64(address: string): string | undefined {
  const halves = address.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves[1] ? halves[1].split(':') : [];
  const missing = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (missing < 0) return undefined;
  const groups = [...head, ...new Array<string>(missing).fill('0'), ...tail];
  if (groups.length !== 8 || !groups.every((group) => IPV6_GROUP_PATTERN.test(group))) return undefined;
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/**
 * Normalises a client address into the key the per-client cap counts on: an IPv4 address as is, an IPv6 address
 * reduced to its /64 (one subscriber owns the whole prefix). Returns undefined for a missing or malformed value.
 */
export function normalizeClientAddress(value: string | null | undefined): string | undefined {
  const trimmed = (value ?? '').trim().toLowerCase();
  if (trimmed === '' || trimmed.length > MAX_CLIENT_ADDRESS_LENGTH) return undefined;
  const bare = stripAddressDecoration(trimmed);
  const address = bare.startsWith(IPV4_MAPPED_PREFIX) ? bare.slice(IPV4_MAPPED_PREFIX.length) : bare;
  return isIpv4(address) ? address : ipv6Prefix64(address);
}

function lastForwardedHop(value: string | undefined): string | undefined {
  return value?.split(',').at(-1);
}

/**
 * Resolves the address the per-client cap is keyed on. By default only the socket address counts, because
 * X-Forwarded-For is client controlled unless a trusted proxy sets it. With `trustForwardedFor` the last hop of
 * the header wins (the one the nearest proxy appended; earlier hops can be forged) and the socket address is
 * the fallback. Returns undefined when neither is usable.
 */
export function resolveClientAddress(
  headers: HeaderSource,
  options: { trustForwardedFor?: boolean; socketAddress?: string | null } = {}
): string | undefined {
  const forwarded = options.trustForwardedFor
    ? normalizeClientAddress(lastForwardedHop(readHeader(headers, 'x-forwarded-for')))
    : undefined;
  return forwarded ?? normalizeClientAddress(options.socketAddress);
}
