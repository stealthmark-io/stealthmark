-- ═══════════════════════════════════════════════════════════════
-- STEALTHMARK - AGENT EVENT METERING (Sprint 2: S2.1, S2.2, S2.3, S2.5, S2.6)
-- Idempotent and additive: no DROP, no data rewrite besides the generated column.
-- Run in the Supabase SQL editor. Safe to run more than once.
--
-- period_month deviates from "date_trunc('month', created_at)::date": on timestamptz that
-- expression is only STABLE (depends on the session time zone) and Postgres refuses it in a
-- generated column. Anchoring to UTC makes it IMMUTABLE and gives every service the same month.
-- ═══════════════════════════════════════════════════════════════

-- 1. Ledger: usage_records
ALTER TABLE usage_records
    ADD COLUMN IF NOT EXISTS site_id uuid,
    ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'agent_request',
    ADD COLUMN IF NOT EXISTS units integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'api',
    ADD COLUMN IF NOT EXISTS agent_identifier text,
    ADD COLUMN IF NOT EXISTS period_month date
        GENERATED ALWAYS AS (date_trunc('month', created_at AT TIME ZONE 'UTC')::date) STORED;

CREATE INDEX IF NOT EXISTS usage_records_org_period_idx ON usage_records (org_id, period_month);

-- 2. Quotas: organizations
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'free',
    ADD COLUMN IF NOT EXISTS monthly_event_cap integer NOT NULL DEFAULT 10000,
    ADD COLUMN IF NOT EXISTS credit_balance_events integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quota_alert_80_sent_at timestamptz,
    ADD COLUMN IF NOT EXISTS quota_alert_100_sent_at timestamptz;

-- 3. Grants (additive only; existing privileges are not reduced)
-- The API connects as postgres.* (owner); the gateway writes through PostgREST as service_role.
GRANT SELECT, INSERT ON usage_records TO service_role;
GRANT SELECT, UPDATE ON organizations TO service_role;

-- 4. Verification (run after the statements above; expect 6 + 5 rows and the index)
-- SELECT column_name, data_type, is_generated
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'usage_records'
--    AND column_name IN ('site_id','event_type','units','source','agent_identifier','period_month')
--  ORDER BY column_name;
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'organizations'
--    AND column_name IN ('billing_mode','monthly_event_cap','credit_balance_events','quota_alert_80_sent_at','quota_alert_100_sent_at')
--  ORDER BY column_name;
-- SELECT indexname FROM pg_indexes WHERE tablename = 'usage_records' AND indexname = 'usage_records_org_period_idx';
-- SELECT has_table_privilege('service_role', 'public.usage_records', 'INSERT') AS usage_insert,
--        has_table_privilege('service_role', 'public.organizations', 'UPDATE') AS org_update;

-- 5. Credits consumption for rows the API does not reserve itself.
--    The API decrements credit_balance_events inside its own transaction for source 'middleware' and 'api'.
--    The hosted gateway inserts through PostgREST without that step, so the trigger consumes credits for it.
CREATE OR REPLACE FUNCTION consume_credits_on_usage_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'gateway' THEN
    UPDATE organizations
       SET credit_balance_events = GREATEST(0, credit_balance_events - NEW.units)
     WHERE id = NEW.org_id
       AND billing_mode = 'credits';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS usage_records_consume_credits ON usage_records;
CREATE TRIGGER usage_records_consume_credits
  AFTER INSERT ON usage_records
  FOR EACH ROW EXECUTE FUNCTION consume_credits_on_usage_insert();

-- Verification:
-- SELECT tgname FROM pg_trigger WHERE tgname = 'usage_records_consume_credits';
