/** OWASP Top 10:2025 categories, presented as the report's ten gates. Names follow the official list. */
export interface OwaspGate {
  code: string;
  gate: number;
  label: { en: string; es: string };
}

interface GateDefinition extends OwaspGate {
  checks: readonly string[];
}

export const OWASP_GATES: readonly GateDefinition[] = [
  {
    code: 'A01:2025',
    gate: 1,
    label: { en: 'Gate 1: Broken Access Control', es: 'Puerta 1: Control de Acceso Roto' },
    checks: [
      'cors_policy',
      'ai_bot_cidr_and_asn_verification',
      'nextjs_mcp_exposure',
      'subdomain_takeover_cname',
      'mcp_session_state_isolation',
      'mcp_oauth_audience_pinning',
      'agent_to_agent_handshake_auth',
      'image_optimizer_ssrf_librsvg_shield',
      'praisonai_unauth_agent_surface',
      'edge_appliance_management_exposure',
      'mcp_sdk_transport_oauth_guard',
    ],
  },
  {
    code: 'A02:2025',
    gate: 2,
    label: { en: 'Gate 2: Security Misconfiguration', es: 'Puerta 2: Configuración Insegura' },
    checks: [
      'content_type_options',
      'framing_protection',
      'referrer_policy',
      'tech_fingerprint',
      'git_exposure',
      'dotfile_edge_shield',
      'api_schema_exposure',
      'source_map_exposure',
      'ai_manifest_hygiene',
      'spf_record',
      'dmarc_record',
      'exposed_ports_and_cves',
      'unkeyed_header_cache_poisoning',
      'nonprod_environment_leak_in_bundle',
      'graphql_and_debug_trace_exposure',
      'clipboard_read_lock',
      'hardware_sensor_isolation',
      'cross_origin_isolation_posture',
      'litellm_gateway_rce_shield',
      'orchestrator_workflow_virtual_patch',
      'headless_agent_shell_lockdown',
      'inference_zeromq_pickle_guard',
      'isr_ssg_cache_header_sanitizer',
      'container_orchestrator_port_isolation',
      'platform_deploy_secret_leak_detector',
      'apache_mod_php_sapi_isolation',
      'jenkins_proxy_cred_exposure',
      'flowise_agent_flow_exposure',
      'ai_inference_ipc_port_isolation',
      'analytical_store_port_isolation',
      'sip_voip_control_port_isolation',
      'outbound_smb_ntlm_egress_posture',
      'atlassian_jetbrains_mgmt_exposure',
      'ai_assistant_workspace_policy_exposure',
    ],
  },
  {
    code: 'A03:2025',
    gate: 3,
    label: { en: 'Gate 3: Software Supply Chain Failures', es: 'Puerta 3: Fallas en la Cadena de Suministro de Software' },
    checks: [
      'supply_chain_manifest_exposure',
      'dependency_confusion_manifest_guard',
      'pypi_npm_startup_hook_guard',
      'ide_extension_c2_telemetry_guard',
      'php2shell_oom_memory_guard',
      'cicd_regex_overflow_rce_shield',
      'apache_http2_rce_banner_shield',
      'nodejs_november_cve_banner_shield',
    ],
  },
  {
    code: 'A04:2025',
    gate: 4,
    label: { en: 'Gate 4: Cryptographic Failures', es: 'Puerta 4: Fallas Criptográficas' },
    checks: [
      'https_available',
      'http_redirect',
      'hsts_configured',
      'tls_certificate_trust',
      'caa_record',
      'pqc_hybrid_key_exchange',
      'emudhra_weak_ecc_quarantine',
      'public_key_entropy_scalar_audit',
      'ct_logs_realtime_issuance_watch',
      'ocsp_stapling_binding_validator',
      'crlset_onecrl_emergency_sync',
      'subdomain_cert_expiry_watcher',
      'pqc_hybrid_kem_negotiation_lock',
      'container_ca_bundle_attestation',
    ],
  },
  {
    code: 'A05:2025',
    gate: 5,
    label: { en: 'Gate 5: Injection', es: 'Puerta 5: Inyección' },
    checks: [
      'content_security_policy',
      'ai_surface_integrity',
      'csp_connect_src_exfil',
      'csp_form_action_lock',
      'indirect_prompt_injection_dom',
      'indirect_prompt_transit_filter',
      'null_byte_double_hex_decode_guard',
      'nfkc_unicode_collation_normalizer',
      'live_analytics_websocket_sql_guard',
      'wordpress_bookit_sqli_shield',
    ],
  },
  {
    code: 'A06:2025',
    gate: 6,
    label: { en: 'Gate 6: Insecure Design', es: 'Puerta 6: Diseño Inseguro' },
    checks: [
      'agent_rate_and_anti_automation_design',
      'aitm_reverse_proxy_telemetry',
      'autofill_trap_rasp_posture',
      'anti_llmjacking_wallet_drain_shield',
      'polyglot_upload_magic_byte_guard',
    ],
  },
  {
    code: 'A07:2025',
    gate: 7,
    label: { en: 'Gate 7: Authentication Failures', es: 'Puerta 7: Fallas de Autenticación' },
    checks: [
      'js_bundle_secrets',
      'client_bundle_exposure',
      'paas_origin_and_ai_secret_shield',
      'auth_session_hardening',
      'jwt_in_localstorage_without_csp',
      'session_cookie_aitm_resistance',
      'tls_ja4_session_binding',
      'webauthn_passkey_ror',
      'gateway_mtls_client_cert_audit',
      'devops_station_stepup_auth_enforcer',
    ],
  },
  {
    code: 'A08:2025',
    gate: 8,
    label: { en: 'Gate 8: Software or Data Integrity Failures', es: 'Puerta 8: Fallas de Integridad de Software o Datos' },
    checks: [
      'subresource_integrity_shield',
      'cms_zero_signer_saml_guard',
      'webhook_hmac_sha256_replay_seal',
      'nextjs_rsc_typedarray_rce_shield',
      'php_session_upload_serializer_shield',
    ],
  },
  {
    code: 'A09:2025',
    gate: 9,
    label: { en: 'Gate 9: Security Logging and Alerting Failures', es: 'Puerta 9: Fallas de Registro y Alertas de Seguridad' },
    checks: [
      'security_reporting_and_incident_telemetry',
      'defcon_autonomous_response',
      'vault_merkle_sha256_certification',
    ],
  },
  {
    code: 'A10:2025',
    gate: 10,
    label: { en: 'Gate 10: Mishandling of Exceptional Conditions', es: 'Puerta 10: Manejo Incorrecto de Condiciones Excepcionales' },
    checks: [
      'exceptional_conditions_stack_leak',
      'server_actions_multipart_dos_guard',
      'async_json_bignumber_dos_shield',
      'mcp_tool_input_heap_guard',
      'vllm_inference_telemetry_exposure',
    ],
  },
];

/** AI discoverability checks, a CMS fingerprint and fallback rows: none is an OWASP risk, so a gate on them would overclaim. */
export const CHECKS_OUTSIDE_OWASP: readonly string[] = [
  'dns_records',
  'robots_txt',
  'llms_txt',
  'sitemap_xml',
  'sitemap_declared',
  'structured_data',
  'ai_citation_metadata',
  'agent_json',
  'ai_agent_rules',
  'a2a_settlement_surface',
  'cms_ecommerce_surface',
  'dns_resolver',
  'headers_inspection',
  'stealthmark_active',
];

const GATE_BY_CHECK = new Map<string, OwaspGate>(
  OWASP_GATES.flatMap(({ checks, ...gate }) => checks.map((id) => [id, gate] as const)),
);

export function owaspGateFor(checkId: string): OwaspGate | null {
  return GATE_BY_CHECK.get(checkId) ?? null;
}
