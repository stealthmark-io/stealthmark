/**
 * StealthMark Black October 2026 Edge & MCP Shield
 * Implements the 4-layer runtime defense against October 2026 CVEs:
 *  1. Anti-Evasion & Anti-SSRF Canonical Normalizer (CVE-2026-105482, CVE-2026-105483, CVE-2026-19611, CVE-2026-59083, CVE-2026-106069, CVE-2026-106072, CVE-2026-116826)
 *  2. Offensive Agent Botnet Trap & Server Action Guard (CVE-2026-94486, CVE-2026-77932, CVE-2026-93674, CVE-2026-42271, CVE-2026-109444, CVE-2026-116818, CVE-2026-94482, CVE-2026-47885, CVE-2026-111497)
 *  3. MCP Protocol & Async JSON Parser Guard (CVE-2026-111768, CVE-2026-18401, CVE-2026-111771)
 */

export interface NormalizationResult {
  normalizedPath: string;
  normalizedHost: string;
  anomalies: string[];
  isBlocked: boolean;
}

const NULL_BYTE_REGEX = /(%00|\x00|\\0)/i;
const FULLWIDTH_UNICODE_REGEX = /[\uFF01-\uFF5E]/;
const NON_CANONICAL_IP_REGEX = /^(?:0[0-7]+|0x[0-9a-f]+)(?:\.(?:0[0-7]+|0x[0-9a-f]+|\d+)){0,3}$/i;
const SSRF_OCTAL_HEX_URL_REGEX =
  /(?:https?:\/\/|\/\/)(?:0[0-7]{1,3}|0x[0-9a-fA-F]{1,8})(?:\.(?:0[0-7]{1,3}|0x[0-9a-fA-F]{1,8}|\d{1,3})){0,3}(?:[:/?#]|$)/i;
const CLOUD_METADATA_REGEX =
  /(?:169\.254\.169\.254|100\.100\.100\.200|\b2852039166\b|0xa9fea9fe\b|0xa9\.0xfe\.0xa9\.0xfe\b|0251\.0376\.0251\.0376\b|025177524776\b|(?:0*:){0,5}:ffff:169\.254\.169\.254|(?:0*:){0,5}:ffff:0*a9fe:0*a9fe|metadata\.google\.internal|metadata\.goog|fd00:ec2::254|file:\/\/)/i;
const MAX_URL_DECODE_PASSES = 4;

/**
 * Extracts the raw unnormalized path + search string directly from `request.url` before `NextURL`
 * collapses dot-segments, backslashes, or single-layer percent encodings.
 */
export function extractRawPathAndSearch(rawRequestUrl: string): string {
  const schemeIdx = rawRequestUrl.indexOf('://');
  if (schemeIdx === -1) return rawRequestUrl;
  const authorityStart = schemeIdx + 3;
  const hashIdx = rawRequestUrl.indexOf('#', authorityStart);
  const withoutHash = hashIdx === -1 ? rawRequestUrl : rawRequestUrl.slice(0, hashIdx);
  const slashIdx = withoutHash.indexOf('/', authorityStart);
  const queryIdx = withoutHash.indexOf('?', authorityStart);
  if (slashIdx === -1) {
    return queryIdx === -1 ? '/' : `/${withoutHash.slice(queryIdx)}`;
  }
  return withoutHash.slice(slashIdx);
}

export function sanitizeAndNormalizeRequest(rawUrl: string, rawHost: string): NormalizationResult {
  const anomalies: string[] = [];
  let isBlocked = false;

  // 1. Immediate Null Byte block (CVE-2026-105482)
  if (NULL_BYTE_REGEX.test(rawUrl) || NULL_BYTE_REGEX.test(rawHost)) {
    anomalies.push('NULL_BYTE_INJECTION_CVE_2026_105482');
    isBlocked = true;
  }

  // 2. Fullwidth Unicode detection prior to NFKC collapse (CVE-2026-105483 / CVE-2026-19611)
  if (FULLWIDTH_UNICODE_REGEX.test(rawUrl) || FULLWIDTH_UNICODE_REGEX.test(rawHost)) {
    anomalies.push('UNICODE_FULLWIDTH_BYPASS_ATTEMPT');
  }

  // 3. Strict NFKC normalization (preserving raw path+query if full request.url was passed)
  const nfkcHost = rawHost.normalize('NFKC').toLowerCase().trim();
  const rawTarget = /^https?:\/\//i.test(rawUrl) ? extractRawPathAndSearch(rawUrl) : rawUrl;
  let decodedPath = rawTarget.normalize('NFKC');

  // 4. Bounded fixed-point URL decoding (up to 4 passes) against Double/Triple Hex Encoding (CVE-2026-59083)
  let decodePasses = 0;
  try {
    for (let pass = 1; pass <= MAX_URL_DECODE_PASSES; pass += 1) {
      if (!decodedPath.includes('%')) break;
      const next = decodeURIComponent(decodedPath);
      if (next === decodedPath) break;
      decodePasses = pass;
      decodedPath = next;
    }
    if (decodePasses >= 2) {
      anomalies.push('DOUBLE_HEX_ENCODING_CVE_2026_59083');
    }
    if (decodePasses >= 3 || /%[0-9a-fA-F]{2}/.test(decodedPath)) {
      anomalies.push('TRIPLE_HEX_ENCODING_EVASION');
      isBlocked = true;
    }
  } catch {
    anomalies.push('MALFORMED_URI_ENCODING');
    isBlocked = true;
  }

  // Re-check Null Byte after multi-pass decoding (e.g. %2500 / %252500)
  if (NULL_BYTE_REGEX.test(decodedPath) && !anomalies.includes('NULL_BYTE_INJECTION_CVE_2026_105482')) {
    anomalies.push('NULL_BYTE_INJECTION_CVE_2026_105482');
    isBlocked = true;
  }

  // Block backslash path separator evasion (raw or percent-decoded \ / %5c / %255c)
  if (rawTarget.includes('\\') || decodedPath.includes('\\')) {
    anomalies.push('BACKSLASH_PATH_SEPARATOR_ANOMALY');
    isBlocked = true;
    decodedPath = decodedPath.replace(/\\/g, '/');
  }

  // 5. Non-canonical Octal/Hex IP format detection (CVE-2026-106069 / CVE-2026-106072)
  const hostWithoutPort = nfkcHost.replace(/^\[|\]$/g, '').split(':')[0] || '';
  if (NON_CANONICAL_IP_REGEX.test(hostWithoutPort) || SSRF_OCTAL_HEX_URL_REGEX.test(decodedPath)) {
    anomalies.push('NON_CANONICAL_IP_FORMAT_SSRF');
    isBlocked = true;
  }

  // 6. Cloud Metadata SSRF probe inspection in path/query/host (CVE-2026-116826)
  // Covers 169.254.169.254, 100.100.100.200, decimal 2852039166, hex 0xa9fea9fe,
  // IPv6-mapped ::ffff:169.254.169.254 / ::ffff:a9fe:a9fe, fd00:ec2::254, metadata.google.internal, file://
  if (
    CLOUD_METADATA_REGEX.test(decodedPath) ||
    CLOUD_METADATA_REGEX.test(rawUrl) ||
    CLOUD_METADATA_REGEX.test(nfkcHost)
  ) {
    anomalies.push('CLOUD_METADATA_SSRF_PROBE');
    isBlocked = true;
  }

  return {
    normalizedPath: decodedPath,
    normalizedHost: nfkcHost,
    anomalies,
    isBlocked,
  };
}

export interface ThreatAssessment {
  threatScore: number;
  matchedSignatures: string[];
  classification: 'LEGIT_AGENT_OR_USER' | 'SUSPICIOUS_SCRAPER' | 'MALICIOUS_AGENT_BOTNET';
}

const OFFENSIVE_AGENT_PATHS: ReadonlyArray<{ pattern: RegExp; id: string; weight: number }> = [
  { pattern: /^\/_next\/mcp(\/|$)/i, id: 'NEXTJS_MCP_LEAK_CVE_2026_94486', weight: 90 },
  { pattern: /\/api\/v1\/chat\/react-agent/i, id: 'DBGPT_RCE_PROBE_CVE_2026_77932', weight: 100 },
  { pattern: /\/api\/v1\/validate\/code/i, id: 'LANGFLOW_RCE_PROBE_CVE_2026_93674', weight: 100 },
  { pattern: /\/config\/update|\/mcp\/tools\/call/i, id: 'LITELLM_COMMAND_INJECTION_PROBE', weight: 85 },
  { pattern: /\/shell_run|\/sub_agent\/exec/i, id: 'OPENSRE_EVOSCIENTIST_RCE_PROBE', weight: 100 },
  { pattern: /\/live\/visitors/i, id: 'OPENPANEL_WS_SQLI_CVE_2026_116818', weight: 80 },
  {
    pattern: /\/(?:rest\/(?:default\/|all\/)?V1\/guest-carts\/[^/]+\/items|customer\/address_file\/upload|pub\/media\/custom_options\/.*?\.(?:php\d?|phtml|phar))/i,
    id: 'MAGENTO_UNRESTRICTED_UPLOAD_CVE_2026_48356',
    weight: 95,
  },
  { pattern: /\/api\/v4\/ci\/lint\b/i, id: 'GITLAB_CICD_REGEX_OVERFLOW_CVE_2026_97229', weight: 90 },
  {
    pattern: /\/(?:dana-na\/|dana-admin\/|api\/v1\/totp\/user-backup-code)/i,
    id: 'IVANTI_CONNECT_SECURE_CHAIN_CVE_2026_118527',
    weight: 95,
  },
  {
    pattern: /\/\+CSCO(?:E|T|U)\+\/|\/\+webvpn\+\//i,
    id: 'CISCO_ASA_FTD_WEBVPN_DOS_CVE_2026_76418',
    weight: 95,
  },
  {
    pattern: /\/(?:global-protect\/(?:login|getconfig|hipreport)\.esp|ssl-vpn\/hipreport\.esp)/i,
    id: 'PALO_ALTO_GLOBALPROTECT_MFA_BYPASS_CVE_2026_0257',
    weight: 95,
  },
  {
    pattern: /(?:handle_upload|uo_login_action|post_delete_assessment_file_by_id|wpbs_action_ajax_calendar_remove_note|\/wp-json\/pm\/v2\/projects\/[^/]+\/tasks)/i,
    id: 'WP_CRITICAL_PLUGIN_EXPLOIT_WAVE_CVE_2026_118235_119096',
    weight: 95,
  },
  {
    pattern: /\/(?:dataSet\/testTransform|dataSetParam\/verification|reportDashboard\/getData|reportExcel\/preview)\b/i,
    id: 'AJ_REPORT_JWT_FORGERY_CVE_2026_120209',
    weight: 95,
  },
  {
    pattern: /\/(?:node\/manage\/|user_login_info|system\/build-info)\b/i,
    id: 'JPOM_AUTH_BYPASS_CVE_2026_120201',
    weight: 90,
  },
  {
    pattern: /\/(?:sandbox\/file|container\/file|worker\/build-image|protocol\.csp)\b/i,
    id: 'BETA9_SANDBOX_ESCAPE_CVE_2026_120306_120307',
    weight: 95,
  },
];

export function evaluateAgentBehavior(normalizedPath: string, headers: Headers): ThreatAssessment {
  let score = 0;
  const matchedSignatures: string[] = [];

  for (const rule of OFFENSIVE_AGENT_PATHS) {
    if (rule.pattern.test(normalizedPath)) {
      score += rule.weight;
      matchedSignatures.push(rule.id);
    }
  }

  // Jpom JPOM-USER-TOKEN header query condition injection guard (CVE-2026-120201)
  const jpomUserToken = headers.get('jpom-user-token');
  if (jpomUserToken !== null) {
    if (!/^[a-zA-Z0-9._-]{16,256}$/.test(jpomUserToken.trim()) || /['"=<>(){}\s]|--|\b(?:or|and|select|union)\b/i.test(jpomUserToken)) {
      score += 95;
      matchedSignatures.push('JPOM_TOKEN_HEADER_INJECTION_CVE_2026_120201');
    }
  }

  // AJ-Report forged Share-Token on testTransform guard (CVE-2026-120209)
  const shareToken = headers.get('share-token') || headers.get('authorization');
  if (shareToken && /\/(?:dataSet\/testTransform|dataSetParam\/verification)\b/i.test(normalizedPath)) {
    score += 95;
    matchedSignatures.push('AJ_REPORT_SHARE_TOKEN_FORGERY_CVE_2026_120209');
  }

  // Next.js App Router Server Actions DoS guard (CVE-2026-94482 & CVE-2026-47885)
  const nextActionHeader = headers.get('next-action');
  if (nextActionHeader) {
    const contentType = headers.get('content-type') || '';
    const contentLength = parseInt(headers.get('content-length') || '0', 10);

    if (!/^[a-f0-9]{40,42}$/i.test(nextActionHeader) || contentLength > 1_048_576) {
      score += 85;
      matchedSignatures.push('NEXT_SERVER_ACTION_DOS_CVE_2026_94482');
    }
    if (contentType.includes('multipart/form-data') && contentLength > 524_288) {
      score += 50;
      matchedSignatures.push('MULTIPART_MEMORY_PRESSURE_CVE_2026_47885');
    }
  }

  // Inbound Brotli payload RCE guard (CVE-2026-111497)
  const contentEncoding = headers.get('content-encoding') || '';
  if (/\bbr\b/i.test(contentEncoding)) {
    score += 85;
    matchedSignatures.push('INBOUND_BROTLI_PAYLOAD_CVE_2026_111497');
  }

  const classification =
    score >= 80
      ? 'MALICIOUS_AGENT_BOTNET'
      : score >= 40
      ? 'SUSPICIOUS_SCRAPER'
      : 'LEGIT_AGENT_OR_USER';

  return {
    threatScore: Math.min(score, 100),
    matchedSignatures,
    classification,
  };
}

export interface McpGuardOptions {
  expectedAudience: string;
  maxToolInputElements?: number;
  maxNumericDigits?: number;
}

export function validateMcpPayloadAndToken(
  rawBody: string,
  authHeader: string | null,
  options: McpGuardOptions
): { valid: boolean; reason?: string } {
  const maxElements = options.maxToolInputElements ?? 2000;
  const maxDigits = options.maxNumericDigits ?? 64;

  // 1. O(n) check for oversized numeric literals before JSON.parse (CVE-2026-18401)
  const longNumberRegex = new RegExp(`\\b\\d{${maxDigits},}\\b`);
  if (longNumberRegex.test(rawBody)) {
    return { valid: false, reason: 'JSON_ASYNC_PARSER_DOS_CVE_2026_18401' };
  }

  // 2. Structural element cap to protect Node.js heap (CVE-2026-111768)
  let elementCount = 0;
  for (let i = 0; i < rawBody.length; i++) {
    const ch = rawBody[i];
    if (ch === ',' || ch === '[' || ch === '{') {
      elementCount++;
      if (elementCount > maxElements) {
        return { valid: false, reason: 'MCP_MAX_TOOL_INPUT_ELEMENTS_EXCEEDED_CVE_2026_111768' };
      }
    }
  }

  // 3. Strict fail-closed JWT structure & 'aud' claim verification (CVE-2026-111771 / RFC 8707).
  // SECURITY NOTE: This synchronous parser guard enforces structural 3-part JWS format, rejects
  // `alg: "none"`, and requires an explicit matching `payload.aud` claim before JSON-RPC execution.
  // Cryptographic signature verification (Ed25519 / ES256 / RS256 against the issuer JWKS) is NOT
  // performed in this synchronous guard and MUST be verified upstream by the authenticating gateway
  // or token verifier before granting privileged access.
  if (options.expectedAudience && authHeader && /^bearer(?:\s+|$)/i.test(authHeader.trim())) {
    const token = authHeader.trim().replace(/^bearer\s*/i, '').trim();
    const parts = token.split('.');
    if (
      parts.length !== 3 ||
      !parts[0] ||
      !parts[1] ||
      !parts[2] ||
      parts.some((seg) => !/^[A-Za-z0-9_-]+$/.test(seg))
    ) {
      return { valid: false, reason: 'MALFORMED_BEARER_TOKEN' };
    }

    try {
      const decodeBase64Url = (segment: string): string => {
        const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
        return atob(padded);
      };

      const header = JSON.parse(decodeBase64Url(parts[0])) as { alg?: unknown } | null;
      if (
        !header ||
        typeof header !== 'object' ||
        typeof header.alg !== 'string' ||
        header.alg.trim() === '' ||
        header.alg.trim().toLowerCase() === 'none'
      ) {
        return { valid: false, reason: 'MALFORMED_BEARER_TOKEN' };
      }

      const payload = JSON.parse(decodeBase64Url(parts[1])) as { aud?: unknown } | null;
      if (!payload || typeof payload !== 'object' || payload.aud === undefined || payload.aud === null) {
        return { valid: false, reason: 'MCP_INVALID_TOKEN_AUDIENCE_CVE_2026_111771' };
      }

      const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (
        audList.length === 0 ||
        !audList.every((entry) => typeof entry === 'string' && entry.trim().length > 0) ||
        !audList.includes(options.expectedAudience)
      ) {
        return { valid: false, reason: 'MCP_INVALID_TOKEN_AUDIENCE_CVE_2026_111771' };
      }
    } catch {
      return { valid: false, reason: 'MALFORMED_BEARER_TOKEN' };
    }
  }

  return { valid: true };
}
