export type V6Section = 'ai_surface' | 'headers' | 'transport';

export interface V6Control {
  id: string;
  section: V6Section;
  title: string;
  recommendation: string;
}

/** Controls #61–#116. Rows listed in NOT_ASSESSED_CONTROLS always report not_assessed; the rest are measured passively. */
export const V6_CONTROLS: readonly V6Control[] = [
  // #61–#70: agentic protocol (MCP), LLM gateways and AI compute
  { id: 'mcp_session_state_isolation', section: 'ai_surface', title: 'Model Context Protocol Cross-Tenant Session State Isolation', recommendation: 'Run a separate MCP server context per client and never share session state across tenants.' },
  { id: 'mcp_tool_input_heap_guard', section: 'ai_surface', title: 'Agent Tool Input Structural Heap Exhaustion Guard', recommendation: 'Enforce structural array element caps at the edge before JSON deserialization.' },
  { id: 'mcp_oauth_audience_pinning', section: 'ai_surface', title: 'Cryptographic Agent OAuth/JWT Audience Pinning', recommendation: 'Pin OAuth 2.1 aud claims strictly to your canonical MCP gateway URI.' },
  { id: 'litellm_gateway_rce_shield', section: 'ai_surface', title: 'AI Inference Proxy & Gateway Remote Execution Shield', recommendation: 'Keep AI inference proxy admin routes off the public internet and behind authentication.' },
  { id: 'orchestrator_workflow_virtual_patch', section: 'ai_surface', title: 'Agent Workflow Orchestrator Code-Execution Route Exposure', recommendation: 'Block public access to workflow code-execution routes at the CDN edge.' },
  { id: 'inference_zeromq_pickle_guard', section: 'ai_surface', title: 'Distributed Inference Engine Deserialization Lock', recommendation: 'Restrict internal inference IPC sockets to isolated private VPC subnets.' },
  { id: 'indirect_prompt_transit_filter', section: 'ai_surface', title: 'In-Transit Indirect Prompt Injection Heuristic Filter', recommendation: 'Treat fetched web content as untrusted input and strip hidden instructions before passing it to a model.' },
  { id: 'anti_llmjacking_wallet_drain_shield', section: 'ai_surface', title: 'Anti-LLMjacking & AI Compute Wallet Drain Shield', recommendation: 'Rate-limit inference endpoints per client and set spending caps with your model provider.' },
  { id: 'agent_to_agent_handshake_auth', section: 'ai_surface', title: 'Authorized Agent-to-Agent Handshake & Shadow Agent Governance', recommendation: 'Require cryptographic agent identity attestation on transactional API routes.' },
  { id: 'headless_agent_shell_lockdown', section: 'ai_surface', title: 'Autonomous Sub-Agent Shell Execution Route Lockdown', recommendation: 'Block external requests to headless agent runner routes at the edge.' },

  // #71–#80: web runtime, RSC and deserialization
  { id: 'nextjs_rsc_typedarray_rce_shield', section: 'headers', title: 'Server Component Cache & Stream Deserialization Shield', recommendation: 'Keep Next.js and React patched and validate server component payloads before deserializing them.' },
  { id: 'server_actions_multipart_dos_guard', section: 'headers', title: 'Server Actions Event-Loop & Multipart Memory Guard', recommendation: 'Validate action identifiers and cap inbound multipart stream memory at the edge.' },
  { id: 'image_optimizer_ssrf_librsvg_shield', section: 'headers', title: 'Media Optimization Pipeline SSRF & Vector Sanitizer', recommendation: 'Restrict media optimizer upstream domains and sanitize vector uploads at the edge.' },
  { id: 'php2shell_oom_memory_guard', section: 'headers', title: 'Legacy Runtime Pre-Script Memory Corruption Guard', recommendation: 'Enforce request body and header memory ceilings at the CDN edge.' },
  { id: 'php_session_upload_serializer_shield', section: 'headers', title: 'Concurrent Session Upload Deserialization Block', recommendation: 'Strip unauthorized session upload progress fields at the edge proxy.' },
  { id: 'nfkc_unicode_collation_normalizer', section: 'headers', title: 'Canonical NFKC Unicode & Identity Collation Normalizer', recommendation: 'Normalize inbound request paths and host headers with canonical NFKC rules.' },
  { id: 'null_byte_double_hex_decode_guard', section: 'headers', title: 'Null-Byte Truncation & Recursive Hex Decoding Guard', recommendation: 'Block %00 and recursive hex-encoded traversal patterns in your WAF.' },
  { id: 'async_json_bignumber_dos_shield', section: 'headers', title: 'Asynchronous JSON Parser Numeric Overflow Shield', recommendation: 'Enforce numeric token length bounds in edge request stream inspection.' },
  { id: 'live_analytics_websocket_sql_guard', section: 'headers', title: 'Real-Time Analytics Socket Frame Injection Firewall', recommendation: 'Sanitize live socket filter frames before forwarding to analytical stores.' },
  { id: 'isr_ssg_cache_header_sanitizer', section: 'headers', title: 'Incremental Static Cache Poisoning & Internal Header Purge', recommendation: 'Purge internal rewrite headers at the edge before upstream routing.' },

  // #81–#90: PKI trust and crypto agility
  { id: 'emudhra_weak_ecc_quarantine', section: 'transport', title: 'Compromised Root & Weak-Entropy CA Immediate Quarantine', recommendation: 'Enforce emergency CA quarantine lists at the edge without waiting for OS updates.' },
  { id: 'public_key_entropy_scalar_audit', section: 'transport', title: 'Public Key Entropy & Weak Scalar Cryptographic Audit', recommendation: 'Rotate certificates using modern ECDSA P-256/P-384 or RSA-2048+ keys from trusted CAs.' },
  { id: 'ct_logs_realtime_issuance_watch', section: 'transport', title: 'Certificate Transparency Real-Time Issuance Governance', recommendation: 'Monitor CT logs continuously and restrict issuance via DNS CAA records.' },
  { id: 'ocsp_stapling_binding_validator', section: 'transport', title: 'Cryptographic Revocation Stapling Binding Validator', recommendation: 'Enable strict OCSP stapling verification on your edge load balancer.' },
  { id: 'crlset_onecrl_emergency_sync', section: 'transport', title: 'Emergency Browser Revocation Ledger Alignment (CRLSet / OneCRL)', recommendation: 'Keep edge revocation ledgers synchronized with Chrome CRLSet and Mozilla OneCRL.' },
  { id: 'subdomain_cert_expiry_watcher', section: 'transport', title: 'Secondary Subdomain Certificate Horizon & Continuity Check', recommendation: 'Automate ACME renewal across all secondary API and regional subdomains.' },
  { id: 'cms_zero_signer_saml_guard', section: 'transport', title: 'Zero-Signer Cryptographic Envelope & Assertion Guard', recommendation: 'Require non-empty cryptographic signer counts on all SSO/SAML assertion routes.' },
  { id: 'gateway_mtls_client_cert_audit', section: 'transport', title: 'Enterprise Gateway Client Certificate Authentication Posture', recommendation: 'Enforce strict mTLS chain validation at the edge before forwarding identity headers.' },
  { id: 'pqc_hybrid_kem_negotiation_lock', section: 'transport', title: 'Post-Quantum Hybrid Key Exchange Enforcement (Harvest-Now Defense)', recommendation: 'Maintain hybrid post-quantum key exchange support across all TLS 1.3 listeners.' },
  { id: 'container_ca_bundle_attestation', section: 'transport', title: 'Backend Trust Store Revocation Hygiene & Bundle Attestation', recommendation: 'Pin outbound webhook and mTLS trust stores to current revocation bundles.' },

  // #91–#100: supply chain, CI/CD and developer tooling
  { id: 'cicd_regex_overflow_rce_shield', section: 'headers', title: 'CI/CD Pipeline Webhook & Regex Overflow Shield', recommendation: 'Verify webhook signatures and cap payload size and regex work on CI/CD webhook routes.' },
  { id: 'ide_extension_c2_telemetry_guard', section: 'headers', title: 'Compromised AI IDE Extension C2 Beacon & Key Guard', recommendation: 'Audit developer workstation extensions and enforce outbound C2 beacon blocks.' },
  { id: 'platform_deploy_secret_leak_detector', section: 'headers', title: 'Cloud Deployment Platform Token & Environment Leak Guard', recommendation: 'Keep deployment tokens scoped to sealed CI runners and rotate periodically.' },
  { id: 'dependency_confusion_manifest_guard', section: 'headers', title: 'Private Namespace & Dependency Confusion Manifest Guard', recommendation: 'Block public access to lockfiles and pin internal scopes in registry configs.' },
  { id: 'webhook_hmac_sha256_replay_seal', section: 'headers', title: 'Cryptographic Webhook Signature & Replay Window Seal', recommendation: 'Verify HMAC-SHA256 signatures and 300-second replay windows at the edge.' },
  { id: 'pypi_npm_startup_hook_guard', section: 'headers', title: 'Runtime Dependency Startup Hook Integrity Posture', recommendation: 'Build production containers from locked, provenance-verified dependency trees.' },
  { id: 'container_orchestrator_port_isolation', section: 'headers', title: 'Container Orchestrator Agent & Control-Plane Port Isolation', recommendation: 'Isolate orchestrator control planes behind zero-trust private networks.' },
  { id: 'polyglot_upload_magic_byte_guard', section: 'headers', title: 'Polyglot Media Upload & Magic-Byte Execution Firewall', recommendation: 'Enforce strict magic-byte inspection and binary CDR at the CDN edge.' },
  { id: 'devops_station_stepup_auth_enforcer', section: 'headers', title: 'Privileged Administrative Session Step-Up Auth Posture', recommendation: 'Enforce cryptographic step-up authentication on privileged administrative actions.' },
  { id: 'vault_merkle_sha256_certification', section: 'headers', title: 'Self-Serve Remediation Evidence Record', recommendation: 'Keep a dated record of each fix and the re-scan that confirmed it for compliance audits.' },

  // #101–#116: November 2026 CVE wave, agent frameworks, edge appliances & isolation
  { id: 'apache_http2_rce_banner_shield', section: 'headers', title: 'Apache HTTP/2 Mod_HTTP2 Memory Corruption Shield', recommendation: 'Upgrade Apache HTTP Server to version 2.4.71 or higher to patch CVE-2026-119618, or disable mod_http2.' },
  { id: 'nodejs_november_cve_banner_shield', section: 'headers', title: 'Node.js November 2026 Vulnerability & Banner Exposure Shield', recommendation: 'Upgrade Node.js to patched branches (22.23.5+, 24.22.3+, or 26.13.1+) to remediate CVE-2026-111497 and strip X-Powered-By.' },
  { id: 'apache_mod_php_sapi_isolation', section: 'headers', title: 'Apache mod_php SAPI Architecture & Process Isolation', recommendation: 'Migrate from prefork mod_php to PHP-FPM with event MPM to isolate execution contexts (CVE-2026-109619).' },
  { id: 'wordpress_bookit_sqli_shield', section: 'headers', title: 'WordPress BookIt Plugin SQL Injection Shield', recommendation: 'Update the BookIt plugin to version 2.6.0.7 or higher, or block public access to plugin readme.txt files (CVE-2026-62048).' },
  { id: 'jenkins_proxy_cred_exposure', section: 'headers', title: 'Jenkins Control Plane Proxy & Credential Exposure Shield', recommendation: 'Upgrade Jenkins to 2.588 or higher (CVE-2026-117625) and restrict public access to /api/json.' },
  { id: 'flowise_agent_flow_exposure', section: 'ai_surface', title: 'Flowise Agent Workflow Definition & Secret Leak Shield', recommendation: 'Require authentication on Flowise /api/v1/chatflows routes to prevent workflow leakage (CVE-2026-40933).' },
  { id: 'praisonai_unauth_agent_surface', section: 'ai_surface', title: 'PraisonAI Unauthenticated Multi-Agent Surface Shield', recommendation: 'Authenticate the PraisonAI /agents API and isolate agent backstories and tool declarations (CVE-2026-44338).' },
  { id: 'vllm_inference_telemetry_exposure', section: 'ai_surface', title: 'vLLM Distributed Inference Telemetry & Engine Exposure', recommendation: 'Isolate vLLM inference instances behind authenticated API gateways and strip engine telemetry (CVE-2026-115914, CVE-2026-44222).' },
  { id: 'ai_inference_ipc_port_isolation', section: 'ai_surface', title: 'AI Inference & Vector IPC Socket Port Isolation', recommendation: 'Bind LMCache ZMQ (5555), DB-GPT (5670), and Ollama (11434) to private loopback or isolated VPC networks (CVE-2026-105192, CVE-2026-77932).' },
  { id: 'analytical_store_port_isolation', section: 'headers', title: 'Analytical & In-Memory Store Port Isolation', recommendation: 'Firewall Redis (6379) and ClickHouse (8123, 9000) ports from the public internet (CVE-2026-116366, CVE-2026-81934).' },
  { id: 'sip_voip_control_port_isolation', section: 'transport', title: 'SIP & VoIP Telephony Control Port Isolation', recommendation: 'Block public FreeSWITCH Event Socket (8021) and unencrypted SIP (5060); require SIP over TLS (5061) with mutual authentication (CVE-2026-116779).' },
  { id: 'outbound_smb_ntlm_egress_posture', section: 'transport', title: 'SMB & MSRPC NetBIOS Egress Containment Posture', recommendation: 'Block SMB (445), NetBIOS (139), and MSRPC (135) to prevent NTLM reflection and credential coercion (CVE-2026-124194).' },
  { id: 'edge_appliance_management_exposure', section: 'transport', title: 'Edge Appliance & Remote Access Management Exposure', recommendation: 'Place edge VPN, firewall, and remote desktop management interfaces behind zero-trust access controls.' },
  { id: 'atlassian_jetbrains_mgmt_exposure', section: 'headers', title: 'Atlassian & JetBrains Administrative Surface Exposure', recommendation: 'Restrict Jira, Confluence, and JetBrains Hub public access behind SSO and disable unauthenticated REST endpoints (CVE-2026-21589, CVE-2026-123294).' },
  { id: 'mcp_sdk_transport_oauth_guard', section: 'ai_surface', title: 'Model Context Protocol OAuth 2.1 Transport Authorization Guard', recommendation: 'Publish RFC 8414 OAuth authorization server metadata at /.well-known/oauth-authorization-server with valid HTTPS endpoints (CVE-2026-104850).' },
  { id: 'ai_assistant_workspace_policy_exposure', section: 'ai_surface', title: 'AI Assistant Workspace Rules & System Prompt Exposure', recommendation: 'Prevent public web server access to AI agent workspace policy files (/AGENTS.md, /CLAUDE.md, /.cursorrules).' },
];

export const V6_PROBE_PATHS = [
  '/.well-known/oauth-protected-resource',
  '/.well-known/agent-card.json',
  '/health/readiness',
  '/rest/settings',
  '/api/v1/version',
  '/v1/models',
  '/.gitlab-ci.yml',
  '/Jenkinsfile',
  '/.circleci/config.yml',
  '/.vercel/project.json',
  '/.netlify/state.json',
  '/yarn.lock',
  '/.yarnrc.yml',
  '/wp-content/plugins/bookit/readme.txt',
  '/api/json',
  '/api/v1/chatflows',
  '/agents',
  '/rest/api/2/serverInfo',
  '/hub/api/rest/settings/public',
  '/.well-known/oauth-authorization-server',
  '/AGENTS.md',
  '/CLAUDE.md',
  '/.cursorrules',
] as const;
