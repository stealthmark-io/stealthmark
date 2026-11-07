-- Hall of Fame (/leaderboard): opt-in list of domains that graded A or A+ in a fresh audit and were confirmed from a
-- mailbox at the domain. Only the web server writes it, through service_role; the page reads it server side.
-- No email address, IP or person is stored: the row is the domain and its audit result.
-- Until this runs, /leaderboard shows "opens soon" and the claim route answers 503 without sending any email.
-- Run it once in the Supabase SQL editor (role postgres). Nothing in this repo applies migrations automatically.

BEGIN;

-- 1. One row per domain; a new confirmed claim replaces the previous audit.
CREATE TABLE public.hall_of_fame (
  domain       text PRIMARY KEY CHECK (domain ~ '^[a-z0-9.-]{4,253}$'),
  grade        text NOT NULL CHECK (grade IN ('A+', 'A')),
  score        smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  audited_at   timestamptz NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now()
);

-- 2. The page lists audits from the last 90 days, best score first.
CREATE INDEX hall_of_fame_audited_at_idx ON public.hall_of_fame (audited_at);

-- 3. Same posture as P0-C (20261023): RLS on, no client-role privileges, service_role only.
ALTER TABLE public.hall_of_fame ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hall_of_fame FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hall_of_fame TO service_role;

COMMIT;

-- 4. Verification (run after the statements above).
-- Expect anon_select = false, auth_select = false, service_insert = true, rls = true:
-- SELECT has_table_privilege('anon', 'public.hall_of_fame', 'SELECT') AS anon_select,
--        has_table_privilege('authenticated', 'public.hall_of_fame', 'SELECT') AS auth_select,
--        has_table_privilege('service_role', 'public.hall_of_fame', 'INSERT') AS service_insert,
--        (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.hall_of_fame'::regclass) AS rls;
--
-- Expect 0 rows on a fresh table:
-- SELECT count(*) FROM public.hall_of_fame;

-- 5. Rollback (removes every listing; /leaderboard goes back to "opens soon"):
-- DROP TABLE public.hall_of_fame;
