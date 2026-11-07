import { vi } from 'vitest';
import * as adminSupabase from '../../lib/supabase/admin';

// Every column of public.credit_orders, from supabase/migrations/20261001_credits.sql,
// 20261018_recalibrate_quotas_and_crypto.sql and 2026101802_add_a2a_referrals.sql. There is no
// status column: an insert that names a column missing here fails, and the sale goes unrecorded.
const CREDIT_ORDER_COLUMNS = new Set([
  'polar_order_id',
  'org_id',
  'product_id',
  'credits_events',
  'amount_cents',
  'currency',
  'created_at',
  'payment_method',
  'tx_hash',
  'network',
  'referrer_code',
  'commission_cents',
]);

type DbError = { code: string } | null;

export interface LedgerState {
  existing?: Record<string, unknown> | null;
  lookupError?: DbError;
  insertError?: DbError;
}

/** Stands in for the service-role client's credit_orders table and returns its query builder, so a test can read the calls. */
export function fakeLedger({ existing = null, lookupError = null, insertError = null }: LedgerState = {}) {
  const ledger = {
    select: vi.fn().mockReturnThis(),
    or: vi.fn<(filter: string) => unknown>().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: lookupError }),
    insert: vi
      .fn<(row: Record<string, unknown>) => Promise<{ data: null; error: DbError }>>()
      .mockResolvedValue({ data: null, error: insertError }),
  };
  const client = {
    from: (table: string) => {
      if (table !== 'credit_orders') throw new Error(`fakeLedger: unexpected table ${table}`);
      return ledger;
    },
  };
  vi.spyOn(adminSupabase, 'createSupabaseAdminClient').mockReturnValue(client as never);
  return ledger;
}

/** The columns an inserted row names that credit_orders does not have. */
export function unknownColumns(row: Record<string, unknown> | undefined): string[] {
  return Object.keys(row ?? {}).filter((column) => !CREDIT_ORDER_COLUMNS.has(column));
}
