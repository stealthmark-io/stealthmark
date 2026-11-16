import { describe, expect, it } from 'vitest';
import { NOT_ASSESSED_CONTROLS } from '../lib/scan-controls';
import { V6_CONTROLS, V6_MEASURED_IDS, V6_PROBE_PATHS, buildV6Rows, secondaryHost, type PathResult, type V6Observations } from '../lib/scan-v6';
import type { CertSummary, TlsProbeResult } from '../lib/security/tls-probe';

const NOW = Date.parse('2026-11-12T00:00:00Z');
const DAY_MS = 86_400_000;

const cert = (overrides: Partial<CertSummary> = {}): CertSummary => ({
  subject: 'acme.io',
  keyType: 'ec',
  bits: 256,
  validTo: NOW + 365 * DAY_MS,
  hasOcspUrl: true,
  hasEmbeddedSct: true,
  ...overrides,
});

const tlsOk = (leaf: Partial<CertSummary> = {}, chain: CertSummary[] = [cert({ subject: 'Test CA', keyType: 'rsa', bits: 2048 })], ocspStapled = true): TlsProbeResult => ({
  kind: 'ok',
  observation: { leaf: cert(leaf), chain, ocspStapled },
});

const ABSENT: Record<string, PathResult> = Object.fromEntries(V6_PROBE_PATHS.map((p) => [p, { kind: 'absent' }]));

function observe(overrides: Partial<V6Observations> = {}): V6Observations {
  return {
    headers: {},
    paths: ABSENT,
    tls: tlsOk(),
    subdomainTls: { host: 'www.acme.io', result: tlsOk() },
    ports: { kind: 'not_listed', ip: '203.0.113.7' },
    ...overrides,
  };
}

const serving = (path: string, text: string): Record<string, PathResult> => ({ ...ABSENT, [path]: { kind: 'body', text } });

function row(id: string, obs: V6Observations, host = 'acme.io') {
  const found = buildV6Rows(obs, host, NOW).find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
}

describe('v6 control set', () => {
  it('has 56 controls, each either measured by a probe or listed as needing internal access', () => {
    const ids = V6_CONTROLS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(56);
    const notAssessed = ids.filter((id) => NOT_ASSESSED_CONTROLS[id] !== undefined);
    expect(V6_MEASURED_IDS.filter((id) => NOT_ASSESSED_CONTROLS[id] !== undefined)).toEqual([]);
    expect([...V6_MEASURED_IDS, ...notAssessed].sort()).toEqual([...ids].sort());
    expect(V6_MEASURED_IDS).toHaveLength(33);
  });

  it('passes or informs on a clean site and states the reason for every control it cannot measure', () => {
    for (const r of buildV6Rows(observe(), 'acme.io', NOW)) {
      if (NOT_ASSESSED_CONTROLS[r.id] !== undefined) {
        expect(r, r.id).toMatchObject({ status: 'not_assessed', detail: NOT_ASSESSED_CONTROLS[r.id] });
      } else {
        expect(['pass', 'info'], r.id).toContain(r.status);
      }
    }
  });

  it('gives no pass to a control whose probe saw nothing', () => {
    const blind: V6Observations = { headers: null, paths: {}, tls: null, subdomainTls: null, ports: { kind: 'unknown' } };
    for (const r of buildV6Rows(blind, 'acme.io', NOW)) expect(r.status, r.id).not.toBe('pass');
    for (const id of V6_MEASURED_IDS.filter((id) => id !== 'mcp_oauth_audience_pinning' && id !== 'agent_to_agent_handshake_auth')) {
      expect(row(id, blind).status, id).toBe('not_assessed');
    }
  });

  it('checks the www sibling of an apex domain and the apex of a www domain', () => {
    expect(secondaryHost('acme.io')).toBe('www.acme.io');
    expect(secondaryHost('www.acme.io')).toBe('acme.io');
  });
});

describe('v6 path probes', () => {
  it.each([
    ['litellm_gateway_rce_shield', '/health/readiness', '{"status":"healthy","litellm_version":"1.40.0"}'],
    ['orchestrator_workflow_virtual_patch', '/rest/settings', '{"data":{"versionCli":"1.62.0"}}'],
    ['anti_llmjacking_wallet_drain_shield', '/v1/models', '{"object":"list","data":[{"id":"gpt-x"}]}'],
    ['headless_agent_shell_lockdown', '/api/v1/version', '{"package":"Langflow","version":"1.0.0"}'],
    ['cicd_regex_overflow_rce_shield', '/.gitlab-ci.yml', 'stages:\n  - build\n'],
    ['cicd_regex_overflow_rce_shield', '/Jenkinsfile', 'pipeline {\n agent any\n}'],
    ['cicd_regex_overflow_rce_shield', '/.circleci/config.yml', 'jobs:\n  build: {}\n'],
    ['platform_deploy_secret_leak_detector', '/.vercel/project.json', '{"projectId":"prj_1","orgId":"team_1"}'],
    ['platform_deploy_secret_leak_detector', '/.netlify/state.json', '{"siteId":"abc"}'],
    ['dependency_confusion_manifest_guard', '/yarn.lock', '# yarn lockfile v1\n\nleft-pad@1.0.0:\n'],
    ['dependency_confusion_manifest_guard', '/.yarnrc.yml', 'npmRegistryServer: "https://registry.example"\n'],
    ['wordpress_bookit_sqli_shield', '/wp-content/plugins/bookit/readme.txt', '=== BookIt ===\nStable tag: 2.6.0.6\n'],
    ['flowise_agent_flow_exposure', '/api/v1/chatflows', '[{"id":"flow-1","flowData":{},"chatbotConfig":{}}]'],
    ['praisonai_unauth_agent_surface', '/agents', '{"agents":[{"role":"researcher","goal":"scrape","tools":["search"]}]}'],
    ['vllm_inference_telemetry_exposure', '/v1/models', '{"object":"list","data":[{"id":"llama","owned_by":"vllm"}]}'],
    ['ai_assistant_workspace_policy_exposure', '/AGENTS.md', '# Agent Instructions\nAlways follow workspace policy.'],
    ['ai_assistant_workspace_policy_exposure', '/CLAUDE.md', '# CLAUDE Guidelines\nRules for coding.'],
    ['ai_assistant_workspace_policy_exposure', '/.cursorrules', 'Strict subagent rules for cursor.'],
  ])('%s warns when %s exposes it', (id, path, text) => {
    expect(row(id, observe({ paths: serving(path, text) })).status).toBe('warn');
  });

  it.each([
    ['litellm_gateway_rce_shield', '/health/readiness', '{"status":"ok"}'],
    ['anti_llmjacking_wallet_drain_shield', '/v1/models', '{"error":"unauthorized"}'],
    ['platform_deploy_secret_leak_detector', '/.vercel/project.json', '{}'],
    ['cicd_regex_overflow_rce_shield', '/.gitlab-ci.yml', 'not a pipeline'],
    ['wordpress_bookit_sqli_shield', '/wp-content/plugins/bookit/readme.txt', '=== BookIt ===\nStable tag: 2.6.0.7\n'],
    ['flowise_agent_flow_exposure', '/api/v1/chatflows', '[]'],
    ['praisonai_unauth_agent_surface', '/agents', '[]'],
    ['vllm_inference_telemetry_exposure', '/v1/models', '{"object":"list","data":[{"id":"gpt-4","owned_by":"openai"}]}'],
    ['ai_assistant_workspace_policy_exposure', '/AGENTS.md', 'plain text without markdown headings or agent keywords'],
  ])('%s passes when %s answers without the marker', (id, path, text) => {
    expect(row(id, observe({ paths: serving(path, text) })).status).toBe('pass');
  });

  it('passes ai_assistant_workspace_policy_exposure for StealthMark public .cursorrules header on stealthmark.io while warning on third-party hosts', () => {
    const stealthmarkRules = '# StealthMark v6 — 116-Point DevSecOps, Anti-AiTM & Client RASP Rules (.cursorrules)\n# Place in root';
    expect(row('ai_assistant_workspace_policy_exposure', observe({ paths: serving('/.cursorrules', stealthmarkRules) }), 'stealthmark.io').status).toBe('pass');
    expect(row('ai_assistant_workspace_policy_exposure', observe({ paths: serving('/.cursorrules', stealthmarkRules) }), 'acme.io').status).toBe('warn');

    const thirdPartyRules = '# Custom Project v1 — subagent rules\nAlways follow workspace policy.';
    expect(row('ai_assistant_workspace_policy_exposure', observe({ paths: serving('/.cursorrules', thirdPartyRules) })).status).toBe('warn');
  });

  it('fails a public .yarnrc.yml with a registry token and never echoes the token', () => {
    const r = row('dependency_confusion_manifest_guard', observe({ paths: serving('/.yarnrc.yml', 'npmAuthToken: npm_SECRETVALUE123\n') }));
    expect(r.status).toBe('fail');
    expect(r.detail).not.toContain('SECRETVALUE');
  });

  it('reports a path control not assessed when one of its paths could not be read', () => {
    const paths = { ...ABSENT, '/Jenkinsfile': { kind: 'unreachable' } as PathResult };
    expect(row('cicd_regex_overflow_rce_shield', observe({ paths })).status).toBe('not_assessed');
  });

  it('pins OAuth tokens only when the metadata names this origin and HTTPS authorization servers', () => {
    const meta = (body: object) => observe({ paths: serving('/.well-known/oauth-protected-resource', JSON.stringify(body)) });
    expect(row('mcp_oauth_audience_pinning', meta({ resource: 'https://acme.io', authorization_servers: ['https://auth.acme.io'] })).status).toBe('pass');
    expect(row('mcp_oauth_audience_pinning', meta({ resource: 'https://other.example', authorization_servers: ['https://auth.acme.io'] })).status).toBe('warn');
    expect(row('mcp_oauth_audience_pinning', meta({ resource: 'https://acme.io', authorization_servers: ['http://auth.acme.io'] })).status).toBe('warn');
    expect(row('mcp_oauth_audience_pinning', observe()).status).toBe('info');
  });

  it('warns on an A2A agent card that declares no authentication', () => {
    const card = (body: object) => observe({ paths: serving('/.well-known/agent-card.json', JSON.stringify(body)) });
    expect(row('agent_to_agent_handshake_auth', card({ name: 'Bot' })).status).toBe('warn');
    expect(row('agent_to_agent_handshake_auth', card({ name: 'Bot', securitySchemes: { bearer: { type: 'http' } } })).status).toBe('pass');
    expect(row('agent_to_agent_handshake_auth', observe()).status).toBe('info');
  });

  it('validates MCP SDK OAuth authorization server metadata endpoints', () => {
    const oauth = (body: object) => observe({ paths: serving('/.well-known/oauth-authorization-server', JSON.stringify(body)) });
    expect(
      row(
        'mcp_sdk_transport_oauth_guard',
        oauth({
          issuer: 'https://auth.acme.io',
          jwks_uri: 'https://auth.acme.io/.well-known/jwks.json',
          token_endpoint: 'https://auth.acme.io/oauth/token',
        })
      ).status
    ).toBe('pass');
    expect(
      row(
        'mcp_sdk_transport_oauth_guard',
        oauth({
          issuer: 'http://insecure.acme.io',
          jwks_uri: 'https://auth.acme.io/jwks.json',
          token_endpoint: 'https://auth.acme.io/token',
        })
      ).status
    ).toBe('warn');
    expect(row('mcp_sdk_transport_oauth_guard', oauth({})).status).toBe('info');
    expect(row('mcp_sdk_transport_oauth_guard', observe()).status).toBe('info');
    expect(
      row('mcp_sdk_transport_oauth_guard', observe({ paths: { ...ABSENT, '/.well-known/oauth-authorization-server': { kind: 'unreachable' } } })).status
    ).toBe('not_assessed');
  });

  it('evaluates Atlassian and JetBrains administrative exposure across headers and endpoints', () => {
    expect(
      row('atlassian_jetbrains_mgmt_exposure', observe({ headers: { 'x-arequestid': 'req-1', 'x-confluence-request-time': '123' } })).status
    ).toBe('warn');
    expect(
      row(
        'atlassian_jetbrains_mgmt_exposure',
        observe({
          paths: serving(
            '/rest/api/2/serverInfo',
            JSON.stringify({ version: '9.12.0', buildNumber: 9120000, baseUrl: 'https://jira.acme.io' })
          ),
        })
      ).status
    ).toBe('warn');
    expect(
      row(
        'atlassian_jetbrains_mgmt_exposure',
        observe({
          paths: serving('/hub/api/rest/settings/public', JSON.stringify({ ringId: 'ring-abc', version: '2026.1' })),
        })
      ).status
    ).toBe('warn');
    expect(row('atlassian_jetbrains_mgmt_exposure', observe()).status).toBe('pass');
    expect(row('atlassian_jetbrains_mgmt_exposure', observe({ headers: null })).status).toBe('not_assessed');
    expect(
      row(
        'atlassian_jetbrains_mgmt_exposure',
        observe({
          headers: { 'x-arequestid': 'req-1', 'x-confluence-request-time': '123' },
          paths: { ...ABSENT, '/rest/api/2/serverInfo': { kind: 'unreachable' } },
        })
      ).status
    ).toBe('warn');
    expect(
      row('atlassian_jetbrains_mgmt_exposure', observe({ paths: { ...ABSENT, '/rest/api/2/serverInfo': { kind: 'unreachable' } } })).status
    ).toBe('not_assessed');
  });
});

describe('v6 header probes', () => {
  it('grades the advertised PHP branch', () => {
    expect(row('php2shell_oom_memory_guard', observe({ headers: { 'x-powered-by': 'PHP/7.4.33' } })).status).toBe('warn');
    expect(row('php2shell_oom_memory_guard', observe({ headers: { 'x-powered-by': 'PHP/8.3.1' } })).status).toBe('pass');
    expect(row('php2shell_oom_memory_guard', observe()).status).toBe('info');
  });

  it('warns when internal middleware headers reach the client', () => {
    expect(row('isr_ssg_cache_header_sanitizer', observe({ headers: { 'x-middleware-rewrite': '/internal' } })).status).toBe('warn');
    expect(row('isr_ssg_cache_header_sanitizer', observe()).status).toBe('pass');
  });

  it('grades Apache HTTP/2 mod_http2 banner version against CVE-2026-119618', () => {
    expect(row('apache_http2_rce_banner_shield', observe({ headers: { server: 'Apache/2.4.65 (Unix)' } })).status).toBe('warn');
    expect(row('apache_http2_rce_banner_shield', observe({ headers: { server: 'Apache/2.4.54' } })).status).toBe('warn');
    expect(row('apache_http2_rce_banner_shield', observe({ headers: { server: 'Apache/2.2.34' } })).status).toBe('warn');
    expect(row('apache_http2_rce_banner_shield', observe({ headers: { server: 'Apache/2.4.71' } })).status).toBe('pass');
    expect(row('apache_http2_rce_banner_shield', observe({ headers: { server: 'Apache/2.4.72' } })).status).toBe('pass');
    expect(row('apache_http2_rce_banner_shield', observe({ headers: { server: 'nginx/1.26' } })).status).toBe('info');
    expect(row('apache_http2_rce_banner_shield', observe({ headers: null })).status).toBe('not_assessed');
  });

  it('grades Node.js runtime version against the November 2026 CVE wave', () => {
    expect(row('nodejs_november_cve_banner_shield', observe({ headers: { 'x-powered-by': 'Node.js/v22.23.4' } })).status).toBe('warn');
    expect(row('nodejs_november_cve_banner_shield', observe({ headers: { server: 'Node.js/23.1.0' } })).status).toBe('warn');
    expect(row('nodejs_november_cve_banner_shield', observe({ headers: { 'x-powered-by': 'Node/v24.22.2' } })).status).toBe('warn');
    expect(row('nodejs_november_cve_banner_shield', observe({ headers: { server: 'Node.js/v25.0.0' } })).status).toBe('warn');
    expect(row('nodejs_november_cve_banner_shield', observe({ headers: { 'x-powered-by': 'Node.js/v26.13.0' } })).status).toBe('warn');
    expect(row('nodejs_november_cve_banner_shield', observe({ headers: { 'x-powered-by': 'Node.js/v20.10.0' } })).status).toBe('warn');
    expect(row('nodejs_november_cve_banner_shield', observe({ headers: { 'x-powered-by': 'Node.js/v22.23.5' } })).status).toBe('pass');
    expect(row('nodejs_november_cve_banner_shield', observe({ headers: { server: 'Node.js/v24.22.3' } })).status).toBe('pass');
    expect(row('nodejs_november_cve_banner_shield', observe({ headers: { 'x-powered-by': 'Node.js/v26.13.1' } })).status).toBe('pass');
    expect(row('nodejs_november_cve_banner_shield', observe({ headers: { server: 'Node.js/v28.0.0' } })).status).toBe('pass');
    expect(row('nodejs_november_cve_banner_shield', observe()).status).toBe('info');
    expect(row('nodejs_november_cve_banner_shield', observe({ headers: null })).status).toBe('not_assessed');
  });

  it('warns when Apache runs embedded mod_php SAPI', () => {
    expect(row('apache_mod_php_sapi_isolation', observe({ headers: { server: 'Apache/2.4.58 PHP/8.2.0' } })).status).toBe('warn');
    expect(row('apache_mod_php_sapi_isolation', observe({ headers: { server: 'Apache/2.4.58 (Ubuntu) mod_php' } })).status).toBe('warn');
    expect(row('apache_mod_php_sapi_isolation', observe({ headers: { server: 'Apache/2.4.58', 'x-powered-by': 'PHP/8.2.0' } })).status).toBe('info');
    expect(row('apache_mod_php_sapi_isolation', observe({ headers: { server: 'nginx/1.24', 'x-powered-by': 'PHP/8.2.0' } })).status).toBe('info');
    expect(row('apache_mod_php_sapi_isolation', observe({ headers: { server: 'Apache/2.4.71' } })).status).toBe('info');
    expect(row('apache_mod_php_sapi_isolation', observe({ headers: null })).status).toBe('not_assessed');
  });

  it('warns on vulnerable Jenkins version header or unauthenticated /api/json', () => {
    expect(row('jenkins_proxy_cred_exposure', observe({ headers: { 'x-jenkins': '2.587' } })).status).toBe('warn');
    expect(
      row(
        'jenkins_proxy_cred_exposure',
        observe({
          headers: { 'x-jenkins': '2.587' },
          paths: { ...ABSENT, '/api/json': { kind: 'unreachable' } },
        })
      ).status
    ).toBe('warn');
    expect(row('jenkins_proxy_cred_exposure', observe({ paths: serving('/api/json', '{"_class":"hudson.model.Hudson"}') })).status).toBe('warn');
    expect(row('jenkins_proxy_cred_exposure', observe({ headers: { 'x-jenkins': '2.588' } })).status).toBe('pass');
    expect(row('jenkins_proxy_cred_exposure', observe()).status).toBe('pass');
    expect(row('jenkins_proxy_cred_exposure', observe({ headers: null })).status).toBe('not_assessed');
    expect(row('jenkins_proxy_cred_exposure', observe({ paths: { ...ABSENT, '/api/json': { kind: 'unreachable' } } })).status).toBe('not_assessed');
  });

  it('detects exposed edge appliance and remote management interfaces', () => {
    expect(row('edge_appliance_management_exposure', observe({ headers: { 'set-cookie': 'DSID=sessiontoken123; path=/' } })).status).toBe('warn');
    expect(row('edge_appliance_management_exposure', observe({ headers: { server: 'dana-na' } })).status).toBe('warn');
    expect(row('edge_appliance_management_exposure', observe({ headers: { 'set-cookie': 'webvpn=active' } })).status).toBe('warn');
    expect(row('edge_appliance_management_exposure', observe({ headers: { server: 'Cisco +CSCOE+' } })).status).toBe('warn');
    expect(row('edge_appliance_management_exposure', observe({ headers: { server: 'GlobalProtect portal' } })).status).toBe('warn');
    expect(row('edge_appliance_management_exposure', observe({ headers: { 'set-cookie': 'SVPNCOOKIE=xyz' } })).status).toBe('warn');
    expect(row('edge_appliance_management_exposure', observe({ headers: { server: 'Barracuda' } })).status).toBe('warn');
    expect(row('edge_appliance_management_exposure', observe({ headers: { 'x-screenconnect-relay': '1' } })).status).toBe('warn');
    expect(row('edge_appliance_management_exposure', observe({ headers: { server: 'ScreenConnect/24.1.0' } })).status).toBe('warn');
    expect(row('edge_appliance_management_exposure', observe()).status).toBe('pass');
    expect(row('edge_appliance_management_exposure', observe({ headers: null })).status).toBe('not_assessed');
  });
});

describe('v6 TLS probes', () => {
  it('warns on a weak CA key in the served chain and on a weak leaf key', () => {
    const weakChain = observe({ tls: tlsOk({}, [cert({ subject: 'Old CA', keyType: 'rsa', bits: 1024 })]) });
    expect(row('emudhra_weak_ecc_quarantine', weakChain)).toMatchObject({ status: 'warn' });
    expect(row('emudhra_weak_ecc_quarantine', weakChain).detail).toContain('Old CA (RSA 1024)');
    expect(row('public_key_entropy_scalar_audit', observe({ tls: tlsOk({ keyType: 'rsa', bits: 1024 }) })).status).toBe('warn');
    expect(row('public_key_entropy_scalar_audit', observe({ tls: tlsOk({ keyType: 'ec', bits: 224 }) })).status).toBe('warn');
  });

  it('informs, without passing, when the certificate embeds no SCT or no OCSP response is stapled', () => {
    expect(row('ct_logs_realtime_issuance_watch', observe({ tls: tlsOk({ hasEmbeddedSct: false }) })).status).toBe('info');
    expect(row('ocsp_stapling_binding_validator', observe({ tls: tlsOk({}, undefined, false) })).status).toBe('info');
  });

  it('warns when the sibling certificate expired or expires within 14 days', () => {
    const sibling = (days: number) => observe({ subdomainTls: { host: 'www.acme.io', result: tlsOk({ validTo: NOW + days * DAY_MS }) } });
    expect(row('subdomain_cert_expiry_watcher', sibling(-1)).status).toBe('warn');
    expect(row('subdomain_cert_expiry_watcher', sibling(5)).status).toBe('warn');
    expect(row('subdomain_cert_expiry_watcher', sibling(60)).status).toBe('pass');
    expect(row('subdomain_cert_expiry_watcher', observe({ subdomainTls: { host: 'www.acme.io', result: { kind: 'no_host' } } })).status).toBe('info');
    expect(row('subdomain_cert_expiry_watcher', observe({ subdomainTls: { host: 'www.acme.io', result: { kind: 'error' } } })).status).toBe('not_assessed');
  });
});

describe('v6 InternetDB probe', () => {
  const ports = (list: number[]) => observe({ ports: { kind: 'ports', ip: '203.0.113.7', ports: list } });

  it('fails on an open Docker API, warns on other control-plane ports, and skips shared Cloudflare addresses', () => {
    expect(row('container_orchestrator_port_isolation', ports([22, 2375])).status).toBe('fail');
    expect(row('container_orchestrator_port_isolation', ports([6443])).status).toBe('warn');
    expect(row('container_orchestrator_port_isolation', ports([80, 443])).status).toBe('info');
    expect(row('container_orchestrator_port_isolation', observe({ ports: { kind: 'cloudflare', ip: '104.16.0.1' } })).status).toBe('not_assessed');
    expect(row('container_orchestrator_port_isolation', observe({ ports: { kind: 'unknown' } })).status).toBe('not_assessed');
  });

  it('evaluates AI inference IPC port isolation (5555, 5670, 11434)', () => {
    expect(row('ai_inference_ipc_port_isolation', ports([5555])).status).toBe('fail');
    expect(row('ai_inference_ipc_port_isolation', ports([5670])).status).toBe('warn');
    expect(row('ai_inference_ipc_port_isolation', ports([11434])).status).toBe('warn');
    expect(row('ai_inference_ipc_port_isolation', ports([80, 443])).status).toBe('info');
    expect(row('ai_inference_ipc_port_isolation', observe({ ports: { kind: 'cloudflare', ip: '104.16.0.1' } })).status).toBe('not_assessed');
    expect(row('ai_inference_ipc_port_isolation', observe({ ports: { kind: 'unknown' } })).status).toBe('not_assessed');
  });

  it('evaluates analytical store port isolation (6379, 8123, 9000)', () => {
    expect(row('analytical_store_port_isolation', ports([6379])).status).toBe('fail');
    expect(row('analytical_store_port_isolation', ports([8123])).status).toBe('fail');
    expect(row('analytical_store_port_isolation', ports([9000])).status).toBe('fail');
    expect(row('analytical_store_port_isolation', ports([80, 443])).status).toBe('info');
    expect(row('analytical_store_port_isolation', observe({ ports: { kind: 'cloudflare', ip: '104.16.0.1' } })).status).toBe('not_assessed');
    expect(row('analytical_store_port_isolation', observe({ ports: { kind: 'unknown' } })).status).toBe('not_assessed');
  });

  it('evaluates SIP and VoIP control port isolation (8021, 5060, 5061)', () => {
    expect(row('sip_voip_control_port_isolation', ports([8021])).status).toBe('fail');
    expect(row('sip_voip_control_port_isolation', ports([5060])).status).toBe('warn');
    expect(row('sip_voip_control_port_isolation', ports([5061])).status).toBe('info');
    expect(row('sip_voip_control_port_isolation', ports([80, 443])).status).toBe('info');
    expect(row('sip_voip_control_port_isolation', observe({ ports: { kind: 'cloudflare', ip: '104.16.0.1' } })).status).toBe('not_assessed');
    expect(row('sip_voip_control_port_isolation', observe({ ports: { kind: 'unknown' } })).status).toBe('not_assessed');
  });

  it('evaluates outbound SMB and NetBIOS egress posture (445, 139, 135)', () => {
    expect(row('outbound_smb_ntlm_egress_posture', ports([445])).status).toBe('fail');
    expect(row('outbound_smb_ntlm_egress_posture', ports([139])).status).toBe('warn');
    expect(row('outbound_smb_ntlm_egress_posture', ports([135])).status).toBe('warn');
    expect(row('outbound_smb_ntlm_egress_posture', ports([80, 443])).status).toBe('info');
    expect(row('outbound_smb_ntlm_egress_posture', observe({ ports: { kind: 'cloudflare', ip: '104.16.0.1' } })).status).toBe('not_assessed');
    expect(row('outbound_smb_ntlm_egress_posture', observe({ ports: { kind: 'unknown' } })).status).toBe('not_assessed');
  });
});
