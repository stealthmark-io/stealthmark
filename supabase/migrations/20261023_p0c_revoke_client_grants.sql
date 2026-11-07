-- P0-C (SEC-01, decision D-2): the browser never reads public tables or calls RPCs with the anon key,
-- and every server write goes through service_role, so anon and authenticated keep no privileges in public.
-- Measured in production on 2026-10-23: anon and authenticated could EXECUTE add_org_credits (anyone holding
-- the public anon key could mint credits), and authenticated still held table grants. RLS stays on in all 15 tables.
-- Run it once in the Supabase SQL editor (role postgres). Nothing in this repo applies migrations automatically.

BEGIN;

-- 1. Credit top-ups only from the Polar webhook (service_role).
REVOKE EXECUTE ON FUNCTION public.add_org_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_org_credits(uuid, integer) TO service_role;

-- 2. No table privileges for client roles; service_role and postgres keep theirs.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- 3. Tables that postgres creates later in public no longer grant anon or authenticated by default.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

COMMIT;

-- 4. Verification (run after the statements above).
-- Expect anon_exec = false, auth_exec = false, service_exec = true:
-- SELECT has_function_privilege('anon', 'public.add_org_credits(uuid, integer)', 'EXECUTE') AS anon_exec,
--        has_function_privilege('authenticated', 'public.add_org_credits(uuid, integer)', 'EXECUTE') AS auth_exec,
--        has_function_privilege('service_role', 'public.add_org_credits(uuid, integer)', 'EXECUTE') AS service_exec;
--
-- Expect 0 rows:
-- SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
--  WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated');
--
-- Expect true for each table the webhook and routes write (credit_orders, organizations, scan_leads, api_keys):
-- SELECT has_table_privilege('service_role', 'public.scan_leads', 'UPDATE') AS scan_leads_update,
--        has_table_privilege('service_role', 'public.organizations', 'UPDATE') AS organizations_update,
--        has_table_privilege('service_role', 'public.credit_orders', 'INSERT') AS credit_orders_insert;
--
-- Lists any other public function a client role can still execute (review each one; not changed here):
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));

-- 5. Rollback (only if a client-side read breaks; it restores the exposure SEC-01 describes):
-- GRANT EXECUTE ON FUNCTION public.add_org_credits(uuid, integer) TO anon, authenticated;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
