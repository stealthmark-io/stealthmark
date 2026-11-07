-- Hall of Fame removals (Proyecto-io §86.5 #21 and #22). The web server now confirms and removes listings through the two
-- functions below, which take a per-domain transaction lock, so a confirmation and a removal of one domain run one at a time:
--   #21: a removal cancels every confirmation link issued up to its own link's issue time, so a link still sitting in a
--        mailbox cannot list the domain again; and an older removal link no longer takes down a listing from a newer claim.
--   #22: an older audit never replaces a newer one, even when two confirmations arrive at once.
-- hall_of_fame_removals stores a removed domain and a timestamp, nothing else. Each removal deletes the rows more than
-- 2 days old, and writes none for a link issued that long ago: confirmation links last 24 hours (CLAIM_TTL_SECONDS in
-- apps/web/src/lib/hall-of-fame.ts), so by then every link such a row would block has expired. A replayed link writes
-- nothing.
-- The web build before this change (2548def) keeps working with these objects in place, so run this before deploying.
-- Run it once in the Supabase SQL editor (role postgres). Nothing in this repo applies migrations automatically.

BEGIN;

-- 1. Issue time of the confirmation link behind each listing; NULL for a listing confirmed before this change.
ALTER TABLE public.hall_of_fame ADD COLUMN claimed_at timestamptz;

-- 2. One row per removed domain: confirmation links issued at or before revoked_through no longer list it.
CREATE TABLE public.hall_of_fame_removals (
  domain          text PRIMARY KEY CHECK (domain ~ '^[a-z0-9.-]{4,253}$'),
  revoked_through timestamptz NOT NULL
);

-- 3. Same posture as hall_of_fame (20261028): RLS on, no client-role privileges, service_role only.
ALTER TABLE public.hall_of_fame_removals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hall_of_fame_removals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hall_of_fame_removals TO service_role;

-- 4. Lists a confirmed claim unless the domain was removed after its link was issued. Returns 'listed' or 'removed'.
--    p_issued_at is the link's issue time (NULL counts as removed by any removal); p_claimed_at is stored as claimed_at.
--    A link whose audit is no newer than the listed one returns 'listed' and changes nothing.
CREATE FUNCTION public.hall_of_fame_confirm(
  p_domain     text,
  p_grade      text,
  p_score      integer,
  p_audited_at timestamptz,
  p_issued_at  timestamptz,
  p_claimed_at timestamptz
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('hall_of_fame:' || p_domain, 0));
  IF EXISTS (
    SELECT 1 FROM public.hall_of_fame_removals r
    WHERE r.domain = p_domain AND (p_issued_at IS NULL OR r.revoked_through >= p_issued_at)
  ) THEN
    RETURN 'removed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hall_of_fame h WHERE h.domain = p_domain AND h.audited_at >= p_audited_at) THEN
    RETURN 'listed';
  END IF;
  INSERT INTO public.hall_of_fame AS h (domain, grade, score, audited_at, confirmed_at, claimed_at)
  VALUES (p_domain, p_grade, p_score, p_audited_at, now(), p_claimed_at)
  ON CONFLICT (domain) DO UPDATE
    SET grade = EXCLUDED.grade,
        score = EXCLUDED.score,
        audited_at = EXCLUDED.audited_at,
        confirmed_at = EXCLUDED.confirmed_at,
        claimed_at = EXCLUDED.claimed_at
    WHERE h.audited_at < EXCLUDED.audited_at;
  RETURN 'listed';
END;
$$;

-- 5. Takes the listing down and cancels the confirmation links issued up to p_issued_at (now() for a link from before
--    this change). Returns 'superseded', and changes nothing, when the listing came from a claim issued after the link.
--    It prunes before it writes, and writes no removals row when one already covers the link or the link is over 2 days old.
CREATE FUNCTION public.hall_of_fame_remove(p_domain text, p_issued_at timestamptz)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_claimed_at timestamptz;
  v_through    timestamptz := COALESCE(p_issued_at, now());
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('hall_of_fame:' || p_domain, 0));
  SELECT h.claimed_at INTO v_claimed_at FROM public.hall_of_fame h WHERE h.domain = p_domain;
  IF FOUND AND v_claimed_at IS NOT NULL AND (p_issued_at IS NULL OR v_claimed_at > p_issued_at) THEN
    RETURN 'superseded';
  END IF;
  DELETE FROM public.hall_of_fame WHERE domain = p_domain;
  DELETE FROM public.hall_of_fame_removals WHERE revoked_through < now() - interval '2 days';
  IF v_through >= now() - interval '2 days' AND NOT EXISTS (
    SELECT 1 FROM public.hall_of_fame_removals r WHERE r.domain = p_domain AND r.revoked_through >= v_through
  ) THEN
    INSERT INTO public.hall_of_fame_removals AS r (domain, revoked_through)
    VALUES (p_domain, v_through)
    ON CONFLICT (domain) DO UPDATE SET revoked_through = GREATEST(r.revoked_through, EXCLUDED.revoked_through);
  END IF;
  RETURN 'removed';
END;
$$;

-- 6. Only the web server (service_role) calls them. PostgreSQL grants EXECUTE to PUBLIC by default, and Supabase's
--    default privileges grant it to anon and authenticated.
REVOKE ALL ON FUNCTION public.hall_of_fame_confirm(text, text, integer, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hall_of_fame_remove(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hall_of_fame_confirm(text, text, integer, timestamptz, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.hall_of_fame_remove(text, timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 7. Verification (run after the statements above).
-- Expect false in the four client_* columns and true in the other five:
-- SELECT has_function_privilege('anon', 'public.hall_of_fame_confirm(text, text, integer, timestamptz, timestamptz, timestamptz)', 'EXECUTE') AS client_anon_confirm,
--        has_function_privilege('authenticated', 'public.hall_of_fame_confirm(text, text, integer, timestamptz, timestamptz, timestamptz)', 'EXECUTE') AS client_auth_confirm,
--        has_function_privilege('anon', 'public.hall_of_fame_remove(text, timestamptz)', 'EXECUTE') AS client_anon_remove,
--        has_function_privilege('authenticated', 'public.hall_of_fame_remove(text, timestamptz)', 'EXECUTE') AS client_auth_remove,
--        has_function_privilege('service_role', 'public.hall_of_fame_confirm(text, text, integer, timestamptz, timestamptz, timestamptz)', 'EXECUTE') AS service_confirm,
--        has_function_privilege('service_role', 'public.hall_of_fame_remove(text, timestamptz)', 'EXECUTE') AS service_remove,
--        has_function_privilege('service_role', 'pg_catalog.pg_advisory_xact_lock(bigint)', 'EXECUTE') AS service_lock,
--        has_function_privilege('service_role', 'pg_catalog.hashtextextended(text, bigint)', 'EXECUTE') AS service_hash,
--        has_table_privilege('service_role', 'public.hall_of_fame_removals', 'INSERT') AS service_insert;
--
-- Expect anon_select = false, auth_select = false, rls = true:
-- SELECT has_table_privilege('anon', 'public.hall_of_fame_removals', 'SELECT') AS anon_select,
--        has_table_privilege('authenticated', 'public.hall_of_fame_removals', 'SELECT') AS auth_select,
--        (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.hall_of_fame_removals'::regclass) AS rls;
--
-- Expect two rows, both with prosecdef = false and empty_search_path = true:
-- SELECT proname, prosecdef, proconfig = ARRAY['search_path=""'] AS empty_search_path FROM pg_proc
-- WHERE pronamespace = 'public'::regnamespace AND proname IN ('hall_of_fame_confirm', 'hall_of_fame_remove');
--
-- Expect with_claim_time = 0 right after this migration, and removals = 0:
-- SELECT (SELECT count(*) FROM public.hall_of_fame WHERE claimed_at IS NOT NULL) AS with_claim_time,
--        (SELECT count(*) FROM public.hall_of_fame_removals) AS removals;

-- 8. Rollback. The web build before this change (2548def) works with these objects in place, so rolling the web back
-- needs no SQL; without the new build, removals stop cancelling confirmation links (#21 reopens). To drop the objects,
-- roll the web back first, then:
-- DROP FUNCTION public.hall_of_fame_confirm(text, text, integer, timestamptz, timestamptz, timestamptz);
-- DROP FUNCTION public.hall_of_fame_remove(text, timestamptz);
-- DROP TABLE public.hall_of_fame_removals;
-- ALTER TABLE public.hall_of_fame DROP COLUMN claimed_at;
--
-- After any time on 2548def, and before deploying the new build again, run this with the time of the rollback: a listing
-- 2548def confirms keeps the claimed_at of the claim it replaced, and the new build would answer 'superseded' to the
-- removal link in its email.
-- UPDATE public.hall_of_fame SET claimed_at = NULL WHERE confirmed_at >= '<rollback time>';
