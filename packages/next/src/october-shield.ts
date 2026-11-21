// ═══════════════════════════════════════════════════════════════════
// @stealthmark/next — October 2026 4-Layer Edge & MCP Shield
// ═══════════════════════════════════════════════════════════════════

import { hasUnsupportedBrotliEncoding } from '@stealthmark/core';

export interface NormalizedTargetResult {
  normalizedPath: string;
  normalizedHost: string;
  anomalies: string[];
  isBlocked: boolean;
}

const NULL_BYTE_REGEX = /%00|\x00/i;
const FULLWIDTH_UNICODE_REGEX = /[\uFF01-\uFF5E]/;
const DOUBLE_HEX_ENCODE_REGEX = /%25[0-9a-fA-F]{2}/;
const OCTAL_HEX_IP_REGEX =
  /^(?:0[0-7]{1,3}|0x[0-9a-fA-F]{1,8})(?:\.(?:0[0-7]{1,3}|0x[0-9a-fA-F]{1,8}|\d{1,3})){0,3}$/;
const SSRF_OCTAL_HEX_URL_REGEX =
  /(?:https?:\/\/|\/\/)(?:0[0-7]{1,3}|0x[0-9a-fA-F]{1,8})(?:\.(?:0[0-7]{1,3}|0x[0-9a-fA-F]{1,8}|\d{1,3})){0,3}(?:[:/]|$)/i;
const CLOUD_METADATA_REGEX =
  /(?:169\.254\.169\.254|100\.100\.100\.200|2852039166|0xa9fea9fe|\[fd00:ec2::254\]|::ffff:169\.254\.169\.254|::ffff:a9fe:a9fe|metadata\.google\.internal|file:\/\/)/i;

function extractHostWithoutPort(normalizedHost: string): string {
  if (normalizedHost.startsWith('[')) {
    const endBracket = normalizedHost.indexOf(']');
    return endBracket >= 0 ? normalizedHost.slice(0, endBracket + 1) : normalizedHost;
  }
  if ((normalizedHost.match(/:/g)?.length ?? 0) === 1) {
    return normalizedHost.split(':')[0] ?? '';
  }
  return normalizedHost;
}

export function sanitizeAndNormalizeRequest(
  rawPath: string,
  rawHost: string
): NormalizedTargetResult {
  const anomalies: string[] = [];
  let isBlocked = false;

  if (NULL_BYTE_REGEX.test(rawPath) || NULL_BYTE_REGEX.test(rawHost)) {
    anomalies.push('NULL_BYTE_INJECTION_CVE_2026_105482');
    isBlocked = true;
  }

  if (FULLWIDTH_UNICODE_REGEX.test(rawPath) || FULLWIDTH_UNICODE_REGEX.test(rawHost)) {
    anomalies.push('UNICODE_FULLWIDTH_BYPASS_ATTEMPT');
  }

  let currentPath = rawPath.normalize('NFKC');
  const normalizedHost = rawHost.normalize('NFKC').toLowerCase().trim();

  if (DOUBLE_HEX_ENCODE_REGEX.test(currentPath)) {
    anomalies.push('DOUBLE_HEX_ENCODING_CVE_2026_59083');
  }

  let decodeIterations = 0;
  while (decodeIterations < 2 && /%[0-9a-fA-F]{2}/.test(currentPath)) {
    try {
      currentPath = decodeURIComponent(currentPath);
      decodeIterations++;
    } catch {
      anomalies.push('MALFORMED_URI_ENCODING');
      isBlocked = true;
      break;
    }
  }

  const hostWithoutPort = extractHostWithoutPort(normalizedHost);
  const pathUrlCandidates = currentPath.match(CANDIDATE_URL_REGEX) ?? [];
  const hasNonCanonicalCandidate = pathUrlCandidates.some((cand) => {
    const authority = cand.replace(/^(?:https?:\/\/|\/\/)/i, '').split(/[/?#]/)[0] ?? '';
    const hostPart = authority.includes('@') ? (authority.split('@').pop() ?? '') : authority;
    return isNonCanonicalIpHost(extractHostWithoutPort(hostPart));
  });

  if (
    OCTAL_HEX_IP_REGEX.test(hostWithoutPort) ||
    isNonCanonicalIpHost(hostWithoutPort) ||
    SSRF_OCTAL_HEX_URL_REGEX.test(currentPath) ||
    hasNonCanonicalCandidate
  ) {
    anomalies.push('NON_CANONICAL_IP_FORMAT_SSRF');
    isBlocked = true;
  }

  if (
    CLOUD_METADATA_REGEX.test(currentPath) ||
    CLOUD_METADATA_REGEX.test(normalizedHost) ||
    (hostWithoutPort.length > 0 && isCloudMetadataOrLinkLocalHost(hostWithoutPort)) ||
    hasBlockedSsrfInPayload(currentPath)
  ) {
    anomalies.push('CLOUD_METADATA_SSRF_PROBE');
    isBlocked = true;
  }

  return {
    normalizedPath: currentPath,
    normalizedHost,
    anomalies,
    isBlocked,
  };
}

export interface AgentThreatAssessment {
  threatScore: number;
  matchedSignatures: string[];
  classification: 'LEGIT_AGENT_OR_USER' | 'SUSPICIOUS_SCRAPER' | 'MALICIOUS_AGENT_BOTNET';
}

const OCTOBER_2026_AGENT_PROBES: Array<{ id: string; pattern: RegExp; weight: number }> = [
  { id: 'NEXTJS_MCP_LEAK_CVE_2026_94486', pattern: /^\/_next\/mcp(?:\/|$)/i, weight: 90 },
  { id: 'DBGPT_RCE_PROBE_CVE_2026_77932', pattern: /\/api\/v1\/chat\/react-agent/i, weight: 100 },
  { id: 'LANGFLOW_RCE_PROBE_CVE_2026_93674', pattern: /\/api\/v1\/validate\/code/i, weight: 100 },
  { id: 'LITELLM_RCE_PROBE_CVE_2026_42271', pattern: /\/(?:config\/update|mcp\/tools\/call)/i, weight: 85 },
  { id: 'OPENSRE_SHELL_RCE_CVE_2026_109444', pattern: /\/(?:api\/v1\/)?shell_run/i, weight: 100 },
  { id: 'OPENPANEL_SQLI_CVE_2026_116818', pattern: /\/(?:api\/)?live\/visitors/i, weight: 80 },
  {
    id: 'MAGENTO_UNRESTRICTED_UPLOAD_CVE_2026_48356',
    pattern: /\/(?:rest\/(?:default\/|all\/)?V1\/guest-carts\/[^/]+\/items|customer\/address_file\/upload|pub\/media\/custom_options\/[^?#"'\s]{1,256}\.(?:php\d?|phtml|phar))/i,
    weight: 95,
  },
  { id: 'GITLAB_CICD_REGEX_OVERFLOW_CVE_2026_97229', pattern: /\/api\/v4\/ci\/lint\b/i, weight: 90 },
  {
    id: 'IVANTI_CONNECT_SECURE_CHAIN_CVE_2026_118527',
    pattern: /\/(?:dana-na\/|dana-admin\/|api\/v1\/totp\/user-backup-code)/i,
    weight: 95,
  },
  {
    id: 'CISCO_ASA_FTD_WEBVPN_DOS_CVE_2026_76418',
    pattern: /\/\+CSCO(?:E|T|U)\+\/|\/\+webvpn\+\//i,
    weight: 95,
  },
  {
    id: 'PALO_ALTO_GLOBALPROTECT_MFA_BYPASS_CVE_2026_0257',
    pattern: /\/(?:global-protect\/(?:login|getconfig|hipreport)\.esp|ssl-vpn\/hipreport\.esp)/i,
    weight: 95,
  },
  {
    id: 'WP_CRITICAL_PLUGIN_EXPLOIT_WAVE_CVE_2026_118235_119096',
    pattern: /(?:handle_upload|uo_login_action|post_delete_assessment_file_by_id|wpbs_action_ajax_calendar_remove_note|\/wp-json\/pm\/v2\/projects\/[^/]+\/tasks)/i,
    weight: 95,
  },
  {
    id: 'AJ_REPORT_JWT_FORGERY_CVE_2026_120209',
    pattern: /\/(?:dataSet\/testTransform|dataSetParam\/verification|reportDashboard\/getData|reportExcel\/preview)\b/i,
    weight: 95,
  },
  {
    id: 'JPOM_AUTH_BYPASS_CVE_2026_120201',
    pattern: /\/(?:node\/manage\/|user_login_info|system\/build-info)\b/i,
    weight: 90,
  },
  {
    id: 'BETA9_SANDBOX_ESCAPE_CVE_2026_120306_120307',
    pattern: /\/(?:sandbox\/file|container\/file|worker\/build-image|protocol\.csp)\b/i,
    weight: 95,
  },
];

export function evaluateAgentBehavior(
  normalizedPath: string,
  headers: Headers
): AgentThreatAssessment {
  let threatScore = 0;
  const matchedSignatures: string[] = [];

  for (const probe of OCTOBER_2026_AGENT_PROBES) {
    if (probe.pattern.test(normalizedPath)) {
      threatScore += probe.weight;
      matchedSignatures.push(probe.id);
    }
  }

  const jpomUserToken = headers.get('jpom-user-token');
  if (jpomUserToken !== null) {
    if (!/^[a-zA-Z0-9._-]{16,256}$/.test(jpomUserToken.trim()) || /['"=<>(){}\s]|--|\b(?:or|and|select|union)\b/i.test(jpomUserToken)) {
      threatScore += 95;
      matchedSignatures.push('JPOM_TOKEN_HEADER_INJECTION_CVE_2026_120201');
    }
  }

  const shareToken = headers.get('share-token') || headers.get('authorization');
  if (shareToken && /\/(?:dataSet\/testTransform|dataSetParam\/verification)\b/i.test(normalizedPath)) {
    threatScore += 95;
    matchedSignatures.push('AJ_REPORT_SHARE_TOKEN_FORGERY_CVE_2026_120209');
  }

  const nextActionHeader = headers.get('next-action');
  const contentType = headers.get('content-type') || '';
  const contentLength = parseInt(headers.get('content-length') || '0', 10);

  if (nextActionHeader !== null) {
    if (!/^[a-fA-F0-9]{40,42}$/.test(nextActionHeader.trim())) {
      threatScore += 85;
      matchedSignatures.push('NEXT_SERVER_ACTION_DOS_CVE_2026_94482');
    }
    if (contentType.includes('multipart/form-data') && contentLength > 1_048_576) {
      threatScore += 75;
      matchedSignatures.push('NEXT_MULTIPART_MEMORY_EXHAUSTION_CVE_2026_47885');
    }
  }

  const contentEncoding = headers.get('content-encoding');
  if (hasUnsupportedBrotliEncoding(contentEncoding)) {
    threatScore += 95;
    matchedSignatures.push('INBOUND_BROTLI_PAYLOAD_CVE_2026_111497');
  }

  const classification =
    threatScore >= 80
      ? 'MALICIOUS_AGENT_BOTNET'
      : threatScore >= 35
      ? 'SUSPICIOUS_SCRAPER'
      : 'LEGIT_AGENT_OR_USER';

  return {
    threatScore: Math.min(threatScore, 100),
    matchedSignatures,
    classification,
  };
}

export interface McpValidationConfig {
  expectedAudience: string;
  maxToolInputElements?: number;
  maxPayloadBytes?: number;
  maxNumericDigits?: number;
  blockPrivateNetworkUrls?: boolean;
  expectedSchemaSha256?: string;
  actualSchemaSha256?: string;
}

const STRUCTURAL_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STRUCTURAL_ULID_REGEX = /^[0-9a-hjkmnp-tv-z]{26}$/i;
const STRUCTURAL_HEX_HASH_REGEX = /^[0-9a-f]{16,}$/i;
const STRUCTURAL_LONG_INT_REGEX = /^\d{5,}$/;
const STRUCTURAL_PURE_INT_REGEX = /^\d+$/;
const STRUCTURAL_COLLECTION_NOUN_REGEX =
  /^(?:orders|users|items|products|invoices|customers|accounts|tickets|carts|pedidos|clientes|facturas)$/i;

/**
 * Collapses high-cardinality path parameters (UUIDs, ULIDs, >=16-char hex hashes,
 * >=5-digit integers, or pure integers after collection nouns) to `:id` in O(n).
 * Strips scheme/authority, query strings, hashes, and empty segments (`//`).
 * Preserves version prefixes (/v1, /v2, /v3) and blog dates (/blog/2026/01/hello).
 */
export function normalizeStructuralPath(pathname: string): string {
  let pathOnly = pathname.replace(/^https?:\/\/[^/?#]+/i, '');
  const queryOrHashIdx = pathOnly.search(/[?#]/);
  if (queryOrHashIdx !== -1) {
    pathOnly = pathOnly.slice(0, queryOrHashIdx);
  }

  const segments = pathOnly.split('/').filter((seg) => seg.length > 0);
  if (segments.length === 0) {
    return '/';
  }

  const out = new Array<string>(segments.length);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const prev = i > 0 ? segments[i - 1]! : '';

    if (
      STRUCTURAL_UUID_REGEX.test(seg) ||
      STRUCTURAL_ULID_REGEX.test(seg) ||
      STRUCTURAL_HEX_HASH_REGEX.test(seg) ||
      STRUCTURAL_LONG_INT_REGEX.test(seg) ||
      (STRUCTURAL_PURE_INT_REGEX.test(seg) && STRUCTURAL_COLLECTION_NOUN_REGEX.test(prev))
    ) {
      out[i] = ':id';
    } else {
      out[i] = seg;
    }
  }

  return `/${out.join('/')}`;
}

const CANONICAL_DEC_OCTET_REGEX = /^(?:0|[1-9]\d{0,2})$/;
const CANDIDATE_URL_REGEX = /(?:https?:\/\/|(?<!\/)\/\/)[^\s"'<>\\/][^\s"'<>\\]*/gi;
const BASE64URL_SEGMENT_REGEX = /^[A-Za-z0-9_-]+$/;

function isNonCanonicalIpHost(rawHost: string): boolean {
  const host = rawHost.normalize('NFKC').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!host) return false;
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return true;
  const parts = host.split('.');
  if (parts.length < 1 || parts.length > 4) return false;
  if (!parts.every((p) => /^(?:\d+|0x[0-9a-f]+)$/i.test(p))) return false;
  if (parts.length < 4) return true;
  return parts.some((p) => /^0\d+/.test(p) || /^0x[0-9a-f]+$/i.test(p));
}

function parseCanonicalIpv4Octets(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!CANONICAL_DEC_OCTET_REGEX.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

function isBlockedIpv4Octets([a, b, c]: [number, number, number, number]): boolean {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

function parseIpv6SegmentList(segmentStr: string): number[] | null {
  if (!segmentStr) return [];
  const tokens = segmentStr.split(':');
  const groups: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (!tok) return null;
    if (tok.includes('.')) {
      if (i !== tokens.length - 1) return null;
      const ipv4 = parseCanonicalIpv4Octets(tok);
      if (!ipv4) return null;
      groups.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
    } else if (/^[0-9a-f]{1,4}$/i.test(tok)) {
      groups.push(parseInt(tok, 16));
    } else {
      return null;
    }
  }
  return groups;
}

function parseCanonicalIpv6Groups(rawHost: string): number[] | null {
  const withoutZone = rawHost.split('%')[0] ?? '';
  if (!withoutZone.includes(':')) return null;
  const halves = withoutZone.split('::');
  if (halves.length > 2) return null;
  const left = parseIpv6SegmentList(halves[0] ?? '');
  if (!left) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const right = parseIpv6SegmentList(halves[1] ?? '');
  if (!right) return null;
  const totalExplicit = left.length + right.length;
  if (totalExplicit > 7) return null;
  return [...left, ...new Array<number>(8 - totalExplicit).fill(0), ...right];
}

function isBlockedIpv6Groups(g: number[]): boolean {
  const allZeroPrefix5 = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
  if (allZeroPrefix5 && g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1)) return true;
  if ((g[0]! & 0xfe00) === 0xfc00 || (g[0]! & 0xffc0) === 0xfe80 || (g[0]! & 0xff00) === 0xff00) return true;
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;
  const isIpv4Mapped = allZeroPrefix5 && g[5] === 0xffff;
  const isIpv4Compat = allZeroPrefix5 && g[5] === 0 && (g[6] !== 0 || g[7] !== 0);
  const isNat64 = g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0;
  if (isIpv4Mapped || isIpv4Compat || isNat64) {
    return isBlockedIpv4Octets([(g[6]! >> 8) & 0xff, g[6]! & 0xff, (g[7]! >> 8) & 0xff, g[7]! & 0xff]);
  }
  return (g[0]! & 0xe000) !== 0x2000;
}

function isMetadataOrCgnatIpv4([a, b]: [number, number, number, number]): boolean {
  return (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

function isCloudMetadataOrLinkLocalHost(rawHostname: string): boolean {
  const host = rawHostname.normalize('NFKC').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!host) return false;
  if (
    host === 'metadata' ||
    host === 'metadata.google.internal' ||
    host === 'instance-data' ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  const ipv4 = parseCanonicalIpv4Octets(host);
  if (ipv4) return isMetadataOrCgnatIpv4(ipv4);
  if (host.includes(':')) {
    const g = parseCanonicalIpv6Groups(host);
    if (!g) return false;
    if (g[0] === 0xfd00 && g[1] === 0x0ec2 && g[7] === 0x0254) return true;
    if ((g[0]! & 0xffc0) === 0xfe80) return true;
    const allZeroPrefix5 = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
    const isIpv4Mapped = allZeroPrefix5 && g[5] === 0xffff;
    const isIpv4Compat = allZeroPrefix5 && g[5] === 0 && (g[6] !== 0 || g[7] !== 0);
    const isNat64 = g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0;
    if (isIpv4Mapped || isIpv4Compat || isNat64) {
      return isMetadataOrCgnatIpv4([(g[6]! >> 8) & 0xff, g[6]! & 0xff, (g[7]! >> 8) & 0xff, g[7]! & 0xff]);
    }
  }
  return false;
}

function isBlockedMcpHost(rawHostname: string): boolean {
  const host = rawHostname.normalize('NFKC').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!host || host.includes('@') || /\s/.test(host) || host.includes('..')) return true;
  if (
    host === 'localhost' ||
    host === 'localhost.localdomain' ||
    host === 'metadata' ||
    host === 'metadata.google.internal' ||
    host === 'instance-data' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.arpa') ||
    host.endsWith('.invalid')
  ) {
    return true;
  }
  if (isNonCanonicalIpHost(host)) return true;
  const ipv4 = parseCanonicalIpv4Octets(host);
  if (ipv4) return isBlockedIpv4Octets(ipv4);
  if (host.includes(':')) {
    const ipv6 = parseCanonicalIpv6Groups(host);
    return ipv6 ? isBlockedIpv6Groups(ipv6) : true;
  }
  return false;
}

function isBlockedCandidateUrl(candidate: string): boolean {
  const withoutScheme = candidate.replace(/^(?:https?:\/\/|\/\/)/i, '');
  const authority = withoutScheme.split(/[/?#]/)[0] ?? '';
  if (authority.includes('@')) return true;

  let rawHost = authority;
  if (authority.startsWith('[')) {
    const endBracket = authority.indexOf(']');
    rawHost = endBracket >= 0 ? authority.slice(0, endBracket + 1) : authority;
  } else if ((authority.match(/:/g)?.length ?? 0) === 1) {
    rawHost = authority.split(':')[0] ?? '';
  }

  if (isNonCanonicalIpHost(rawHost) || isBlockedMcpHost(rawHost)) return true;

  try {
    const parsed = new URL(candidate.startsWith('//') ? `http:${candidate}` : candidate);
    if (parsed.username !== '' || parsed.password !== '') return true;
    return isBlockedMcpHost(parsed.hostname);
  } catch {
    return true;
  }
}

function hasBlockedSsrfInText(text: string): boolean {
  const unescaped = text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\//g, '/')
    .replace(/https?:[\\/]{2,}/gi, (m) => `${m.slice(0, m.indexOf(':') + 1)}//`)
    .normalize('NFKC');
  if (CLOUD_METADATA_REGEX.test(unescaped)) return true;

  const candidates = unescaped.match(CANDIDATE_URL_REGEX);
  if (!candidates) return false;
  return candidates.some(isBlockedCandidateUrl);
}

function hasBlockedSsrfInParsedJson(node: unknown, depth = 0): boolean {
  if (depth > 32 || node === null || node === undefined) return false;
  if (typeof node === 'string') return hasBlockedSsrfInText(node);
  if (Array.isArray(node)) {
    return node.some((item) => hasBlockedSsrfInParsedJson(item, depth + 1));
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (hasBlockedSsrfInText(k) || hasBlockedSsrfInParsedJson(v, depth + 1)) return true;
    }
  }
  return false;
}

function hasBlockedSsrfInPayload(rawBody: string): boolean {
  if (hasBlockedSsrfInText(rawBody)) return true;
  const trimmed = rawBody.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (hasBlockedSsrfInParsedJson(parsed)) return true;
    } catch {
      // Ignore JSON syntax error here; raw text was already inspected above.
    }
  }
  return false;
}

/**
 * Validates MCP JSON-RPC payload bounds, schema SHA-256 pinning, SSRF target safety,
 * and Bearer JWS token structure.
 *
 * Security boundary: this synchronous guard verifies JWS 3-segment structure, rejects
 * `alg: "none"`, and enforces `aud` matching `expectedAudience`; cryptographic signature
 * verification against JWKS is performed asynchronously by the upstream authenticator.
 */
export function validateMcpPayloadAndToken(
  rawBody: string,
  authorizationHeader: string | null,
  config: McpValidationConfig
): { valid: boolean; reason?: string } {
  const maxBytes = config.maxPayloadBytes ?? 262_144;
  const maxElements = config.maxToolInputElements ?? 2000;
  const maxDigits =
    typeof config.maxNumericDigits === 'number' &&
    Number.isFinite(config.maxNumericDigits) &&
    config.maxNumericDigits >= 1
      ? Math.floor(config.maxNumericDigits)
      : 64;

  if (Buffer.byteLength(rawBody, 'utf8') > maxBytes) {
    return { valid: false, reason: 'MCP_PAYLOAD_SIZE_EXCEEDED' };
  }

  const excessiveNumberRegex = new RegExp(`\\b\\d{${maxDigits},}\\b`);
  if (excessiveNumberRegex.test(rawBody)) {
    return { valid: false, reason: 'JSON_ASYNC_PARSER_DOS_CVE_2026_18401' };
  }

  const estimatedElements = (rawBody.match(/[,:\[\]{}]/g) || []).length;
  if (estimatedElements > maxElements) {
    return { valid: false, reason: 'MCP_MAX_TOOL_INPUT_ELEMENTS_EXCEEDED_CVE_2026_111768' };
  }

  if (config.expectedSchemaSha256 !== undefined) {
    const expectedPin = config.expectedSchemaSha256.trim().toLowerCase();
    const actualPin = (config.actualSchemaSha256 ?? '').trim().toLowerCase();
    if (!expectedPin || actualPin !== expectedPin) {
      return { valid: false, reason: 'MCP_TOOL_SCHEMA_PIN_MISMATCH' };
    }
  }

  if (config.blockPrivateNetworkUrls !== false && hasBlockedSsrfInPayload(rawBody)) {
    return { valid: false, reason: 'MCP_TOOL_INPUT_SSRF_BLOCKED' };
  }

  if (authorizationHeader !== null && authorizationHeader.trim().length > 0) {
    const trimmedAuth = authorizationHeader.trim();
    if (!/^bearer\s+/i.test(trimmedAuth)) {
      return { valid: false, reason: 'MALFORMED_BEARER_TOKEN' };
    }

    const token = trimmedAuth.replace(/^bearer\s+/i, '').trim();
    const parts = token.split('.');
    if (
      parts.length !== 3 ||
      !parts[0] ||
      !parts[1] ||
      !parts[2] ||
      parts.some((seg) => !BASE64URL_SEGMENT_REGEX.test(seg))
    ) {
      return { valid: false, reason: 'MALFORMED_BEARER_TOKEN' };
    }

    try {
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as {
        alg?: unknown;
      } | null;
      if (
        !header ||
        typeof header !== 'object' ||
        Array.isArray(header) ||
        typeof header.alg !== 'string' ||
        header.alg.trim() === '' ||
        header.alg.trim().toLowerCase() === 'none'
      ) {
        return { valid: false, reason: 'MALFORMED_BEARER_TOKEN' };
      }

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
        aud?: unknown;
      } | null;
      if (
        !payload ||
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        payload.aud === undefined ||
        payload.aud === null
      ) {
        return { valid: false, reason: 'MCP_INVALID_TOKEN_AUDIENCE_CVE_2026_111771' };
      }

      const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (
        audList.length === 0 ||
        !audList.every((entry) => typeof entry === 'string' && entry.trim().length > 0) ||
        !audList.includes(config.expectedAudience)
      ) {
        return { valid: false, reason: 'MCP_INVALID_TOKEN_AUDIENCE_CVE_2026_111771' };
      }
    } catch {
      return { valid: false, reason: 'MALFORMED_BEARER_TOKEN' };
    }
  }

  return { valid: true };
}
