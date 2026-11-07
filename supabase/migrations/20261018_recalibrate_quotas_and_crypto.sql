-- ═══════════════════════════════════════════════════════════════
-- STEALTHMARK - RECALIBRATE EVENT QUOTAS & CRYPTO PAYMENT RAIL
-- Migration: 20261018_recalibrate_quotas_and_crypto.sql
-- Idempotent and additive. Safe to run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

-- 1. Recalibrate default monthly event cap for organizations
ALTER TABLE organizations
    ALTER COLUMN monthly_event_cap SET DEFAULT 250;

-- 2. Protect StealthMark Sovereign dogfooding organization
-- Ensures internal dogfooding sites never encounter 429 quota_exceeded
UPDATE organizations
   SET billing_mode = 'enterprise',
       monthly_event_cap = 100000,
       updated_at = now()
 WHERE name ILIKE '%StealthMark Sovereign%'
    OR slug IN ('stealthmark', 'stealthmark-sovereign', 'sovereign')
    OR domain = 'stealthmark.io';

-- 3. Recalibrate existing free-tier organizations from 10,000 to 250
-- Only modifies organizations in 'free' billing mode that still have the legacy 10,000 cap
UPDATE organizations
   SET monthly_event_cap = 250,
       updated_at = now()
 WHERE billing_mode = 'free'
   AND monthly_event_cap = 10000
   AND name NOT ILIKE '%StealthMark Sovereign%'
   AND domain IS DISTINCT FROM 'stealthmark.io';

-- 4. Extend credit_orders table for instant crypto rails and idempotency
ALTER TABLE credit_orders
    ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'polar',
    ADD COLUMN IF NOT EXISTS tx_hash text,
    ADD COLUMN IF NOT EXISTS network text;

-- Partial unique index on non-null tx_hash to guarantee on-chain replay protection
CREATE UNIQUE INDEX IF NOT EXISTS credit_orders_tx_hash_idx
    ON credit_orders (lower(tx_hash))
    WHERE tx_hash IS NOT NULL;

-- 5. Verification queries
-- SELECT id, name, billing_mode, monthly_event_cap, credit_balance_events FROM organizations WHERE name ILIKE '%StealthMark Sovereign%' OR domain = 'stealthmark.io';
-- SELECT count(*) AS free_orgs_at_250 FROM organizations WHERE billing_mode = 'free' AND monthly_event_cap = 250;
