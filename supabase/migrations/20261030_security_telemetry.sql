-- StealthMark October 2026 Hardened Security Telemetry Schema
-- Mitigates CVE-2026-116818 & CVE-2026-116812 via strict length & type constraints

CREATE TABLE IF NOT EXISTS public.stealthmark_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  workspace_id UUID NOT NULL,
  client_ip INET NOT NULL,
  ja4_fingerprint VARCHAR(64),
  canonical_path TEXT NOT NULL CHECK (char_length(canonical_path) <= 2048),
  raw_host VARCHAR(255) NOT NULL,
  threat_score SMALLINT NOT NULL CHECK (threat_score BETWEEN 0 AND 100),
  classification VARCHAR(32) NOT NULL,
  matched_flags TEXT[] NOT NULL DEFAULT '{}',
  risk_weight_applied SMALLINT NOT NULL DEFAULT 1,
  was_blocked BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_sm_sec_workspace_time ON public.stealthmark_security_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sm_sec_flags_gin ON public.stealthmark_security_events USING GIN (matched_flags);

ALTER TABLE public.stealthmark_security_events ENABLE ROW LEVEL SECURITY;
