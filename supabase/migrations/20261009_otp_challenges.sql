-- ═══════════════════════════════════════════════════════════════
-- STEALTHMARK - EMAIL OTP CHALLENGES (server-side state for the native email login)
-- Idempotent and additive: no DROP, no data rewrite. Safe to run more than once.
-- Run in the Supabase SQL editor BEFORE deploying the web revision that stores OTP challenges here.
-- Without this table the native email-code login answers 503 (it never falls back to client-held state).
-- ═══════════════════════════════════════════════════════════════

-- 1. One row per issued code. Only the HMAC of the code is stored.
CREATE TABLE IF NOT EXISTS otp_challenges (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email          text        NOT NULL,
    code_hash      text        NOT NULL,
    attempts       integer     NOT NULL DEFAULT 0,
    requested_ip   text,
    -- floor(epoch seconds / 60) of the request. UNIQUE (email, window_start) allows one code per email per minute,
    -- enforced by the database so a burst of parallel requests cannot bypass the cooldown.
    window_start   bigint      NOT NULL,
    expires_at     timestamptz NOT NULL,
    consumed_at    timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT otp_challenges_email_window_uniq UNIQUE (email, window_start)
);

-- 2. Lookups: latest active challenge of an email, hourly send counters per email and per address.
CREATE INDEX IF NOT EXISTS otp_challenges_email_created_idx
    ON otp_challenges (email, created_at DESC);
CREATE INDEX IF NOT EXISTS otp_challenges_ip_created_idx
    ON otp_challenges (requested_ip, created_at DESC)
    WHERE requested_ip IS NOT NULL;

-- 3. Row level security on with no policies: anon and authenticated roles can never read or write codes.
-- The web server reads and writes with the service role, which bypasses RLS.
ALTER TABLE otp_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON otp_challenges FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON otp_challenges TO service_role;

-- 4. Retention (optional, run by hand or schedule): challenges are useless after a day.
-- DELETE FROM otp_challenges WHERE created_at < now() - interval '1 day';

-- 5. Verification (expect 1 row for the table, 1 for rowsecurity = true)
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'otp_challenges';
-- SELECT has_table_privilege('service_role', 'public.otp_challenges', 'INSERT') AS otp_insert,
--        has_table_privilege('anon', 'public.otp_challenges', 'SELECT') AS anon_select; -- expect true / false
