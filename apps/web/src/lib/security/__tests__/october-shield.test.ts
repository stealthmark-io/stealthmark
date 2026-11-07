import { describe, it, expect } from 'vitest';
import {
  sanitizeAndNormalizeRequest,
  evaluateAgentBehavior,
  validateMcpPayloadAndToken,
} from '../october-shield';
import { buildWafRulesFromEvents } from '../waf-rule-generator';

describe('StealthMark Security Shield - Octubre 2026 Payloads', () => {
  describe('Capa 1: Normalizador Anti-Evasion y Anti-SSRF', () => {
    it('bloquea truncamiento DNS e inyeccion de Null Bytes (CVE-2026-105482)', () => {
      const res = sanitizeAndNormalizeRequest('/api/agent%00.json', 'agent.io\x00.stealthmark.io');
      expect(res.isBlocked).toBe(true);
      expect(res.anomalies).toContain('NULL_BYTE_INJECTION_CVE_2026_105482');
    });

    it('detecta y colapsa caracteres Unicode Fullwidth a ASCII canonico (CVE-2026-105483 / CVE-2026-19611)', () => {
      const res = sanitizeAndNormalizeRequest('／ａｐｉ／ｍｃｐ', '１２７.0.0.1');
      expect(res.anomalies).toContain('UNICODE_FULLWIDTH_BYPASS_ATTEMPT');
      expect(res.normalizedPath).toBe('/api/mcp');
      expect(res.normalizedHost).toBe('127.0.0.1');
    });

    it('desenvuelve doble codificacion Hex URL usada para evadir filtros (CVE-2026-59083)', () => {
      const res = sanitizeAndNormalizeRequest('/%255fnext/%256dcp', 'stealthmark.io');
      expect(res.anomalies).toContain('DOUBLE_HEX_ENCODING_CVE_2026_59083');
      expect(res.normalizedPath).toBe('/_next/mcp');
    });

    it('bloquea IPs no canonicas en formato octal y hexadecimal (CVE-2026-106069 / CVE-2026-106072)', () => {
      const octalRes = sanitizeAndNormalizeRequest('/webhook', '0177.0.0.1:3000');
      const hexRes = sanitizeAndNormalizeRequest('/webhook', '0x7f.0.0.1');
      expect(octalRes.isBlocked).toBe(true);
      expect(octalRes.anomalies).toContain('NON_CANONICAL_IP_FORMAT_SSRF');
      expect(hexRes.isBlocked).toBe(true);
    });

    it('bloquea intentos de SSRF hacia Cloud Metadata y esquema file:// (CVE-2026-116826)', () => {
      const res = sanitizeAndNormalizeRequest(
        '/api/proxy?url=http://169.254.169.254/latest/meta-data/',
        'stealthmark.io'
      );
      expect(res.isBlocked).toBe(true);
      expect(res.anomalies).toContain('CLOUD_METADATA_SSRF_PROBE');
    });
  });

  describe('Capa 2: Deteccion de Botnets Agenticas (Skynet / MONST3R-AI)', () => {
    it('identifica sondeo de fuga en endpoint interno /_next/mcp (CVE-2026-94486)', () => {
      const headers = new Headers();
      const res = evaluateAgentBehavior('/_next/mcp/tools', headers);
      expect(res.classification).toBe('MALICIOUS_AGENT_BOTNET');
      expect(res.matchedSignatures).toContain('NEXTJS_MCP_LEAK_CVE_2026_94486');
    });

    it('bloquea sondas RCE contra DB-GPT y Langflow (CVE-2026-77932 / CVE-2026-93674)', () => {
      const headers = new Headers();
      const dbgpt = evaluateAgentBehavior('/api/v1/chat/react-agent', headers);
      const langflow = evaluateAgentBehavior('/api/v1/validate/code', headers);
      expect(dbgpt.threatScore).toBe(100);
      expect(langflow.threatScore).toBe(100);
    });

    it('detecta ataques DoS contra Next.js Server Actions y Brotli entrante (CVE-2026-94482 / CVE-2026-111497)', () => {
      const headers = new Headers({
        'next-action': 'invalid-action-id-payload-injection',
        'content-encoding': 'br',
        'content-length': '2097152',
      });
      const res = evaluateAgentBehavior('/dashboard', headers);
      expect(res.classification).toBe('MALICIOUS_AGENT_BOTNET');
      expect(res.matchedSignatures).toContain('NEXT_SERVER_ACTION_DOS_CVE_2026_94482');
      expect(res.matchedSignatures).toContain('INBOUND_BROTLI_PAYLOAD_CVE_2026_111497');
    });

    it('bloquea sondas CISA KEV contra Magento upload, GitLab CI lint, Ivanti Connect Secure, Cisco ASA/FTD y Palo Alto GlobalProtect (CVE-2026-48356 / CVE-2026-97229 / CVE-2026-118527 / CVE-2026-76418 / CVE-2026-0257)', () => {
      const headers = new Headers();
      const magento = evaluateAgentBehavior('/pub/media/custom_options/quote/s/h/shell.phtml', headers);
      const gitlab = evaluateAgentBehavior('/api/v4/ci/lint', headers);
      const ivanti = evaluateAgentBehavior('/dana-na/auth/url_default/welcome.cgi', headers);
      const cisco = evaluateAgentBehavior('/+CSCOE+/logon.html', headers);
      const paloalto = evaluateAgentBehavior('/global-protect/login.esp', headers);
      expect(magento.classification).toBe('MALICIOUS_AGENT_BOTNET');
      expect(magento.matchedSignatures).toContain('MAGENTO_UNRESTRICTED_UPLOAD_CVE_2026_48356');
      expect(gitlab.classification).toBe('MALICIOUS_AGENT_BOTNET');
      expect(gitlab.matchedSignatures).toContain('GITLAB_CICD_REGEX_OVERFLOW_CVE_2026_97229');
      expect(ivanti.classification).toBe('MALICIOUS_AGENT_BOTNET');
      expect(ivanti.matchedSignatures).toContain('IVANTI_CONNECT_SECURE_CHAIN_CVE_2026_118527');
      expect(cisco.classification).toBe('MALICIOUS_AGENT_BOTNET');
      expect(cisco.matchedSignatures).toContain('CISCO_ASA_FTD_WEBVPN_DOS_CVE_2026_76418');
      expect(paloalto.classification).toBe('MALICIOUS_AGENT_BOTNET');
      expect(paloalto.matchedSignatures).toContain('PALO_ALTO_GLOBALPROTECT_MFA_BYPASS_CVE_2026_0257');
    });

    it('bloquea forjado de Share-Token en AJ-Report (CVE-2026-120209), inyeccion en JPOM-USER-TOKEN (CVE-2026-120201) y exploits de plugins de WordPress (CVE-2026-118235 / CVE-2026-119096)', () => {
      const forgedShareToken = [
        Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
        Buffer.from(JSON.stringify({ shareToken: 'forged' })).toString('base64url'),
        'forged-signature',
      ].join('.');
      const ajHeaders = new Headers({ 'share-token': forgedShareToken });
      const aj = evaluateAgentBehavior('/dataSet/testTransform', ajHeaders);
      expect(aj.classification).toBe('MALICIOUS_AGENT_BOTNET');
      expect(aj.matchedSignatures).toContain('AJ_REPORT_JWT_FORGERY_CVE_2026_120209');
      expect(aj.matchedSignatures).toContain('AJ_REPORT_SHARE_TOKEN_FORGERY_CVE_2026_120209');

      const jpomHeaders = new Headers({ 'jpom-user-token': "' OR 1=1 --" });
      const jpom = evaluateAgentBehavior('/node/manage/list', jpomHeaders);
      expect(jpom.classification).toBe('MALICIOUS_AGENT_BOTNET');
      expect(jpom.matchedSignatures).toContain('JPOM_AUTH_BYPASS_CVE_2026_120201');
      expect(jpom.matchedSignatures).toContain('JPOM_TOKEN_HEADER_INJECTION_CVE_2026_120201');

      const wp = evaluateAgentBehavior('/wp-json/pm/v2/projects/1/tasks', new Headers());
      expect(wp.classification).toBe('MALICIOUS_AGENT_BOTNET');
      expect(wp.matchedSignatures).toContain('WP_CRITICAL_PLUGIN_EXPLOIT_WAVE_CVE_2026_118235_119096');

      const beta9 = evaluateAgentBehavior('/sandbox/file?path=/uploads/../../etc/shadow', new Headers());
      expect(beta9.classification).toBe('MALICIOUS_AGENT_BOTNET');
      expect(beta9.matchedSignatures).toContain('BETA9_SANDBOX_ESCAPE_CVE_2026_120306_120307');
    });
  });

  describe('Capa 3: Escudo de Protocolo MCP y Parser JSON', () => {
    it('rechaza numeros gigantes disenados para colgar parsers JSON asincronos (CVE-2026-18401)', () => {
      const maliciousNumberPayload = `{"jsonrpc":"2.0","id":1,"params":{"weight":${'9'.repeat(120)}}}`;
      const res = validateMcpPayloadAndToken(maliciousNumberPayload, null, {
        expectedAudience: 'https://stealthmark.io/api/mcp',
      });
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('JSON_ASYNC_PARSER_DOS_CVE_2026_18401');
    });

    it('frena el agotamiento de memoria por exceso de elementos en argumentos MCP (CVE-2026-111768)', () => {
      const massiveArrayPayload = JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { items: Array.from({ length: 2500 }, (_, i) => i) },
      });
      const res = validateMcpPayloadAndToken(massiveArrayPayload, null, {
        expectedAudience: 'https://stealthmark.io/api/mcp',
        maxToolInputElements: 2000,
      });
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('MCP_MAX_TOOL_INPUT_ELEMENTS_EXCEEDED_CVE_2026_111768');
    });

    it('rechaza tokens Bearer con claim aud invalido en servidores MCP (CVE-2026-111771)', () => {
      const fakeHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const wrongAudPayload = Buffer.from(
        JSON.stringify({ sub: 'agent-123', aud: 'https://otro-servicio.com/mcp' })
      ).toString('base64url');
      const fakeJwt = `Bearer ${fakeHeader}.${wrongAudPayload}.signature`;

      const res = validateMcpPayloadAndToken('{"jsonrpc":"2.0"}', fakeJwt, {
        expectedAudience: 'https://stealthmark.io/api/mcp',
      });
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('MCP_INVALID_TOKEN_AUDIENCE_CVE_2026_111771');
    });
  });

  describe('Capa 4: Generador de Reglas WAF (Cloud Armor CEL & Cloudflare Wirefilter)', () => {
    it('compila reglas CEL, Terraform y Wirefilter desduplicando JA4 e IPs', () => {
      const bundle = buildWafRulesFromEvents([
        {
          id: 'evt-1',
          created_at: new Date().toISOString(),
          workspace_id: 'ws-1',
          client_ip: '185.220.101.44',
          ja4_fingerprint: 't13d1516h2_8daaf6152771_e5627efa2ab1',
          canonical_path: '/_next/mcp',
          raw_host: 'stealthmark.io',
          threat_score: 95,
          classification: 'MALICIOUS_AGENT_BOTNET',
          matched_flags: ['NEXTJS_MCP_LEAK_CVE_2026_94486'],
          risk_weight_applied: 7,
          was_blocked: true,
        },
      ]);
      expect(bundle.ja4List).toEqual(['t13d1516h2_8daaf6152771_e5627efa2ab1']);
      expect(bundle.ipList).toEqual(['185.220.101.44']);
      expect(bundle.cloudArmorCel).toContain('origin.ja4_fingerprint in');
      expect(bundle.cloudflareExpression).toContain('cf.bot_management.ja4 in');
    });
  });
});
