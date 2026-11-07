-- ═══════════════════════════════════════════════════════════════
-- STEALTHMARK - CREDIT PACKS (Polar one-time orders -> organizations.credit_balance_events)
-- Idempotent and additive. Run in the Supabase SQL editor after 20261001_metering.sql.
-- Safe to run more than once. Applied by the founder, never by code.
-- ═══════════════════════════════════════════════════════════════

-- 1. Order ledger. polar_order_id as primary key makes webhook retries idempotent.
CREATE TABLE IF NOT EXISTS credit_orders (
    polar_order_id text PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    product_id text NOT NULL,
    credits_events integer NOT NULL,
    amount_cents integer,
    currency text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_orders_org_idx ON credit_orders (org_id, created_at DESC);

-- 2. Atomic top-up. Returns the new balance, or NULL when the organization does not exist.
CREATE OR REPLACE FUNCTION add_org_credits(p_org_id uuid, p_credits integer) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  new_balance integer;
BEGIN
  UPDATE organizations
     SET credit_balance_events = credit_balance_events + p_credits,
         billing_mode = 'credits',
         updated_at = now()
   WHERE id = p_org_id
  RETURNING credit_balance_events INTO new_balance;
  RETURN new_balance;
END;
$$;

-- 3. Grants (the web webhook writes through PostgREST as service_role; DELETE lets it undo an order row when the top-up fails so Polar can retry)
GRANT SELECT, INSERT, DELETE ON credit_orders TO service_role;
GRANT EXECUTE ON FUNCTION add_org_credits(uuid, integer) TO service_role;

-- 4. Verification (run after the statements above; expect 1 row, 1 row and both privileges true)
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'credit_orders' ORDER BY ordinal_position;
-- SELECT proname FROM pg_proc WHERE proname = 'add_org_credits';
-- SELECT has_table_privilege('service_role', 'public.credit_orders', 'INSERT') AS orders_insert,
--        has_function_privilege('service_role', 'public.add_org_credits(uuid, integer)', 'EXECUTE') AS fn_execute;
