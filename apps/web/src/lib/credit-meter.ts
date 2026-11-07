import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { hashApiKey } from '@/lib/api-keys';

const API_KEY_RE = /^sk_live_[0-9a-fA-F]{32}$/;
const CAS_ATTEMPTS = 2;

export type ChargeResult =
  | { ok: true; orgId: string; charged: number }
  | { ok: false; reason: 'invalid_key' | 'insufficient_credits' | 'unavailable' | 'conflict' };

export type KeyCheck =
  | { ok: true; orgId: string }
  | { ok: false; reason: 'invalid_key' | 'unavailable' };

interface OrgBillingRow {
  plan: string | null;
  billing_mode: string | null;
  credit_balance_events: number | null;
}

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

async function readOrg(supabase: AdminClient, orgId: string): Promise<OrgBillingRow | 'missing' | null> {
  const { data, error } = await supabase
    .from('organizations')
    .select('plan, billing_mode, credit_balance_events')
    .eq('id', orgId)
    .maybeSingle();
  if (error) return null;
  return data ? (data as OrgBillingRow) : 'missing';
}

async function findKeyOrg(supabase: AdminClient, key: string): Promise<KeyCheck> {
  const { data, error } = await supabase
    .from('api_keys')
    .select('org_id')
    .eq('key_hash', hashApiKey(key))
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, reason: 'unavailable' };
  if (!data) return { ok: false, reason: 'invalid_key' };
  return { ok: true, orgId: (data as { org_id: string }).org_id };
}

/** Writes `next` only if the balance is still `expected`; true when exactly one row changed, null on a DB error. */
async function compareAndSetBalance(
  supabase: AdminClient,
  orgId: string,
  expected: number,
  next: number
): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('organizations')
    .update({ credit_balance_events: next } as never)
    .eq('id', orgId)
    .eq('credit_balance_events', expected)
    .select('credit_balance_events');
  if (error) return null;
  return Array.isArray(data) && data.length === 1;
}

/**
 * Charges `cost` credits to the org behind an API key with a compare-and-set on the balance,
 * so two concurrent requests can never spend the same credits. Enterprise orgs are charged 0.
 */
export async function chargePaidKey(rawKey: string | null, cost: number): Promise<ChargeResult> {
  const trimmed = rawKey?.trim() ?? '';
  if (!API_KEY_RE.test(trimmed)) return { ok: false, reason: 'invalid_key' };

  const supabase = createSupabaseAdminClient();
  if (!supabase) return { ok: false, reason: 'unavailable' };

  const key = await findKeyOrg(supabase, trimmed);
  if (!key.ok) return key;
  const { orgId } = key;

  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const org = await readOrg(supabase, orgId);
    if (org === null) return { ok: false, reason: 'unavailable' };
    if (org === 'missing') return { ok: false, reason: 'invalid_key' };
    if (org.billing_mode === 'enterprise' || org.plan === 'enterprise') {
      return { ok: true, orgId, charged: 0 };
    }

    const balance = Number(org.credit_balance_events ?? 0);
    if (balance < cost) return { ok: false, reason: 'insufficient_credits' };

    const swapped = await compareAndSetBalance(supabase, orgId, balance, balance - cost);
    if (swapped === null) return { ok: false, reason: 'unavailable' };
    if (swapped) return { ok: true, orgId, charged: cost };
  }
  return { ok: false, reason: 'conflict' };
}

/** Read-only check that `rawKey` is an active API key; charges nothing. */
export async function verifyPaidKey(rawKey: string | null): Promise<KeyCheck> {
  const trimmed = rawKey?.trim() ?? '';
  if (!API_KEY_RE.test(trimmed)) return { ok: false, reason: 'invalid_key' };

  const supabase = createSupabaseAdminClient();
  if (!supabase) return { ok: false, reason: 'unavailable' };
  return findKeyOrg(supabase, trimmed);
}

/** Gives back credits charged for a request whose upstream failed. Logs when the refund cannot be applied. */
export async function refundCharge(orgId: string, amount: number): Promise<boolean> {
  if (amount <= 0) return true;
  const supabase = createSupabaseAdminClient();
  if (supabase) {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      const org = await readOrg(supabase, orgId);
      if (org === null || org === 'missing') break;
      const balance = Number(org.credit_balance_events ?? 0);
      const swapped = await compareAndSetBalance(supabase, orgId, balance, balance + amount);
      if (swapped === null) break;
      if (swapped) return true;
    }
  }
  console.error(`[credit-meter] Refund of ${amount} credits to org ${orgId} could not be applied`);
  return false;
}
