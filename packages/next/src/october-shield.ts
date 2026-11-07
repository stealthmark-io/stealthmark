// ═══════════════════════════════════════════════════════════════════
// @stealthmark/next — October 2026 4-Layer Edge & MCP Shield
// ═══════════════════════════════════════════════════════════════════

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
const CLOUD_METADATA_REGEX = /(?:169\.254\.169\.254|\[fd00:ec2::254\]|metadata\.google\.internal|file:\/\/)/i;

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

  const hostWithoutPort = normalizedHost.split(':')[0] ?? '';
  if (OCTAL_HEX_IP_REGEX.test(hostWithoutPort) || SSRF_OCTAL_HEX_URL_REGEX.test(currentPath)) {
    anomalies.push('NON_CANONICAL_IP_FORMAT_SSRF');
    isBlocked = true;
  }

  if (CLOUD_METADATA_REGEX.test(currentPath) || CLOUD_METADATA_REGEX.test(normalizedHost)) {
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
    pattern: /\/(?:rest\/(?:default\/|all\/)?V1\/guest-carts\/[^/]+\/items|customer\/address_file\/upload|pub\/media\/custom_options\/.*?\.(?:php\d?|phtml|phar))/i,
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

  const contentEncoding = headers.get('content-encoding') || '';
  if (/\bbr\b/i.test(contentEncoding)) {
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
}

const EXCESSIVE_JSON_NUMBER_REGEX = /:\s*-?\d{64,}/;

export function validateMcpPayloadAndToken(
  rawBody: string,
  authorizationHeader: string | null,
  config: McpValidationConfig
): { valid: boolean; reason?: string } {
  const maxBytes = config.maxPayloadBytes ?? 262_144;
  const maxElements = config.maxToolInputElements ?? 2000;

  if (Buffer.byteLength(rawBody, 'utf8') > maxBytes) {
    return { valid: false, reason: 'MCP_PAYLOAD_SIZE_EXCEEDED' };
  }

  if (EXCESSIVE_JSON_NUMBER_REGEX.test(rawBody)) {
    return { valid: false, reason: 'JSON_ASYNC_PARSER_DOS_CVE_2026_18401' };
  }

  const estimatedElements = (rawBody.match(/[,:\[\]{}]/g) || []).length;
  if (estimatedElements > maxElements) {
    return { valid: false, reason: 'MCP_MAX_TOOL_INPUT_ELEMENTS_EXCEEDED_CVE_2026_111768' };
  }

  if (authorizationHeader?.startsWith('Bearer ')) {
    const token = authorizationHeader.slice(7).trim();
    const parts = token.split('.');
    if (parts.length === 3 && parts[1]) {
      try {
        const payloadJson = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
          aud?: string | string[];
        };
        const aud = payloadJson.aud;
        const audMatches = Array.isArray(aud)
          ? aud.includes(config.expectedAudience)
          : aud === config.expectedAudience;

        if (!audMatches) {
          return { valid: false, reason: 'MCP_INVALID_TOKEN_AUDIENCE_CVE_2026_111771' };
        }
      } catch {
        return { valid: false, reason: 'MALFORMED_BEARER_TOKEN' };
      }
    }
  }

  return { valid: true };
}
