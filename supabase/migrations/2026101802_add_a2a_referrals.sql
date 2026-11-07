-- Add 10% A2A Agent Referral & Bounty tracking to credit_orders
ALTER TABLE public.credit_orders
  ADD COLUMN IF NOT EXISTS referrer_code TEXT,
  ADD COLUMN IF NOT EXISTS commission_cents INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS credit_orders_referrer_code_idx
  ON public.credit_orders(referrer_code)
  WHERE referrer_code IS NOT NULL;
