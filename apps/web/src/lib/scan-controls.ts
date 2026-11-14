/**
 * Controls an external scan cannot observe, with the reason each row gives. The audit route reports every one of them
 * as not_assessed and never as a result; the measured count on the site is derived from this list.
 */
export const NOT_ASSESSED_CONTROLS: Readonly<Record<string, string>> = {
  // Active Shield v2
  session_cookie_aitm_resistance:
    'Session cookies are set after sign-in, which an unauthenticated scan does not reach, so this check was not assessed.',
  tls_ja4_session_binding: 'Session binding cannot be observed from an external scan, so this check was not assessed.',
  webauthn_passkey_ror:
    'Passkey ceremonies run behind sign-in, which an external scan does not reach, so this check was not assessed.',
  pqc_hybrid_key_exchange:
    "This scanner's TLS library (OpenSSL 3.0) cannot offer the X25519MLKEM768 group, so post-quantum readiness was not assessed; confirm it in your edge's TLS settings.",
  subdomain_takeover_cname:
    'Finding dangling CNAMEs needs the full list of subdomains from your DNS zone, which a scan of one domain does not have, so takeover resistance was not assessed.',

  // v6 AI and agent surface
  mcp_session_state_isolation:
    'Session state lives inside the MCP server process; verifying tenant isolation needs two authenticated client sessions, which an external scan does not have.',
  mcp_tool_input_heap_guard:
    'Testing structural input limits means sending oversized tool inputs, an active payload this passive scan never sends.',
  inference_zeromq_pickle_guard:
    'Inference IPC sockets (ZeroMQ, NCCL) live on private networks; confirming they are isolated needs access to the cluster network.',
  indirect_prompt_transit_filter:
    'The filter runs inside your agent pipeline on the content it fetches, which is not visible from outside; hidden directives on your own front page are reported by the indirect prompt injection check.',

  // v6 web runtime
  nextjs_rsc_typedarray_rce_shield:
    'Next.js responses do not reveal the framework version or how server component payloads are validated; confirming the patch level needs the lockfile or the build.',
  server_actions_multipart_dos_guard:
    'Measuring multipart memory limits means sending oversized Server Action requests, a load test this passive scan never runs.',
  image_optimizer_ssrf_librsvg_shield:
    'Testing the image optimizer for SSRF means asking it to fetch chosen URLs, an active probe this scan never sends; the allowed remote patterns live in next.config.',
  php_session_upload_serializer_shield:
    'Session upload progress handling is PHP runtime configuration (session.upload_progress.*) that responses do not reveal.',
  nfkc_unicode_collation_normalizer:
    'Checking normalization means sending crafted Unicode paths and Host headers, an injection probe this scan never sends.',
  null_byte_double_hex_decode_guard:
    'Checking the WAF means sending %00 and double-encoded traversal payloads, which this passive scan never sends.',
  async_json_bignumber_dos_shield:
    'Checking numeric bounds means posting oversized numeric JSON, a DoS-style payload this scan never sends.',
  live_analytics_websocket_sql_guard:
    'Socket frame filtering happens inside authenticated WebSocket sessions, which an external scan does not open.',

  // v6 PKI
  crlset_onecrl_emergency_sync:
    'The revocation lists your edge and backend use are internal trust-store configuration that is not visible from outside.',
  cms_zero_signer_saml_guard:
    'SAML and CMS signature validation runs inside the sign-in flow; testing it needs an identity provider account and crafted assertions.',
  gateway_mtls_client_cert_audit:
    'Client-certificate validation is enforced on internal gateway listeners; confirming it needs a client certificate and access to those listeners.',
  pqc_hybrid_kem_negotiation_lock:
    "Enforcement covers every TLS listener, internal ones included, and this scanner's TLS library (OpenSSL 3.0) cannot offer X25519MLKEM768.",
  container_ca_bundle_attestation:
    'Backend trust stores live inside your containers and outbound clients, which an external scan cannot read.',

  // v6 supply chain
  ide_extension_c2_telemetry_guard:
    'Developer workstation extensions are not reachable from the internet; auditing them needs endpoint access.',
  webhook_hmac_sha256_replay_seal:
    'Verifying signature and replay checks means sending signed and replayed webhooks to your receivers, which needs the shared secret.',
  pypi_npm_startup_hook_guard:
    'Startup hooks (.pth files, npm lifecycle scripts) run inside your build and containers, which an external scan cannot inspect.',
  polyglot_upload_magic_byte_guard:
    'Testing upload filtering means uploading crafted polyglot files, usually behind sign-in, which this passive scan never does.',
  devops_station_stepup_auth_enforcer:
    'Step-up authentication applies to privileged actions behind sign-in, which an unauthenticated scan does not reach.',
  vault_merkle_sha256_certification:
    'The remediation evidence record is kept by your team; an external scan cannot see whether it exists.',
};

/** Controls that always report not_assessed because they need internal access. */
export const SCAN_NOT_ASSESSED_COUNT = Object.keys(NOT_ASSESSED_CONTROLS).length;
