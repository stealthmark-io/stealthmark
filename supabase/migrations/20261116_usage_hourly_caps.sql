-- ═══════════════════════════════════════════════════════════════
-- STEALTHMARK - HOURLY CAPS ON METERED EVENTS (Denial of Wallet guard)
-- Idempotent and additive: one index, no DROP, no data rewrite. Safe to run more than once.
-- Run in the Supabase SQL editor AFTER 20261001_metering_hardening.sql.
-- The API revision that reads these counts works without the index; until it exists, each ingest that
-- carries counted or agent_capped events scans the organization's rows instead of one hour of them.
-- ═══════════════════════════════════════════════════════════════

-- On every ingest the API reads, for one organization and the last hour:
--   - the units billed to SDK traffic (hourly ceiling, see billableUnitsInHour in apps/api/src/services/usage.ts)
--   - the agent_capped rows stored (their hourly allowance, see cappedRowsInHour)
-- CONCURRENTLY keeps ingest writes running while the index builds; it cannot run inside a transaction block.
CREATE INDEX CONCURRENTLY IF NOT EXISTS usage_records_org_created_idx
    ON usage_records (org_id, created_at);

-- Verification (expect 1 row, and indisvalid = true)
-- SELECT c.relname, i.indisvalid
--   FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--  WHERE c.relname = 'usage_records_org_created_idx';
