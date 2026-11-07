-- ═══════════════════════════════════════════════════════════════
-- STEALTHMARK - METERING HARDENING (ingest no longer trusts the client)
-- Idempotent and additive: no DROP, no data rewrite. Safe to run more than once.
-- Run in the Supabase SQL editor AFTER 20261001_metering.sql.
-- Deploy this before (or together with) the API revision that reads/writes usage_records.event_id:
-- the ingest endpoint queries that column whenever a batch carries an event_id.
-- ═══════════════════════════════════════════════════════════════

-- 1. Client idempotency key (optional per event, sent by the SDK as event_id)
ALTER TABLE usage_records
    ADD COLUMN IF NOT EXISTS event_id uuid;

-- A repeated (org_id, event_id) is skipped by the API (ON CONFLICT DO NOTHING) and reported as a duplicate.
-- Rows without an event_id (gateway rows, older SDKs) are outside the index.
CREATE UNIQUE INDEX IF NOT EXISTS usage_records_org_event_id_uidx
    ON usage_records (org_id, event_id)
    WHERE event_id IS NOT NULL;

-- 2. Quota SUM: covering index so the per-ingest SUM(units) for one org-month is an index-only scan.
-- The query is unchanged (see sumPeriodUnits in apps/api/src/services/quota.ts); only the access path improves.
CREATE INDEX IF NOT EXISTS usage_records_org_period_units_idx
    ON usage_records (org_id, period_month) INCLUDE (units);

-- 3. Hourly cap on free rows: the API counts agent_blocked rows per org in the last hour on every ingest.
CREATE INDEX IF NOT EXISTS usage_records_org_blocked_created_idx
    ON usage_records (org_id, created_at)
    WHERE event_type = 'agent_blocked';

-- 4. Grants. The API connects as postgres.* (owner); the gateway writes through PostgREST as service_role.
-- Indexes and the new column inherit the table privileges, but re-assert them so a fresh environment is complete.
GRANT SELECT, INSERT ON usage_records TO service_role;

-- 5. Verification (expect 1 column row and 3 index rows)
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'usage_records' AND column_name = 'event_id';
-- SELECT indexname FROM pg_indexes
--  WHERE tablename = 'usage_records'
--    AND indexname IN ('usage_records_org_event_id_uidx','usage_records_org_period_units_idx','usage_records_org_blocked_created_idx')
--  ORDER BY indexname;
-- SELECT has_table_privilege('service_role', 'public.usage_records', 'INSERT') AS usage_insert;
