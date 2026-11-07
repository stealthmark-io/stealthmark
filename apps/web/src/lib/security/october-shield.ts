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
const CLOUD_METADATA_REGEX = /(169\.254\.169\.254|metadata\.google\.internal|fd00:ec2::254|file:\/\/)/i;

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

  // 3. Strict NFKC normalization
  const nfkcHost = rawHost.normalize('NFKC').toLowerCase().trim();
  let decodedPath = rawUrl.normalize('NFKC');

  // 4. Iterative URL decoding (max 2 passes) against Double Hex URL Encoding (CVE-2026-59083)
  try {
    const firstPass = decodeURIComponent(decodedPath);
    if (firstPass !== decodedPath && /%[0-9a-fA-F]{2}/.test(firstPass)) {
      anomalies.push('DOUBLE_HEX_ENCODING_CVE_2026_59083');
      decodedPath = decodeURIComponent(firstPass);
    } else {
      decodedPath = firstPass;
    }
  } catch {
    anomalies.push('MALFORMED_URI_ENCODING');
    isBlocked = true;
  }

  // 5. Non-canonical Octal/Hex IP format detection (CVE-2026-106069 / CVE-2026-106072)
  const hostWithoutPort = nfkcHost.split(':')[0] || '';
  if (NON_CANONICAL_IP_REGEX.test(hostWithoutPort)) {
    anomalies.push('NON_CANONICAL_IP_FORMAT_SSRF');
    isBlocked = true;
  }

  // 6. Cloud Metadata SSRF probe inspection in path/query (CVE-2026-116826)
  if (CLOUD_METADATA_REGEX.test(decodedPath)) {
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

  // 3. Strict 'aud' claim verification when a JWT Bearer token is supplied (CVE-2026-111771)
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const parts = token.split('.');
    if (parts.length === 3 && parts[1]) {
      try {
        const decoded = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
        const payload = JSON.parse(decoded) as { aud?: string | string[] };
        if (payload.aud !== undefined) {
          const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
          if (!aud.includes(options.expectedAudience)) {
            return { valid: false, reason: 'MCP_INVALID_TOKEN_AUDIENCE_CVE_2026_111771' };
          }
        }
      } catch {
        return { valid: false, reason: 'MALFORMED_BEARER_TOKEN' };
      }
    }
  }

  return { valid: true };
}
