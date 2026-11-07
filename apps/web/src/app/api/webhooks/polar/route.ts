import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { verifyStandardWebhook } from '@/lib/polar-webhook';
import { creditsForProduct, isLegacySubscriptionProduct } from '@/lib/polar-products';
import { FIX_PACK } from '@/lib/offer';
import { sanitizeAndValidateDomain } from '@/lib/security/network-guard';
import { readBodyText } from '@/lib/request-body';

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

interface PolarMetadata {
  org_id?: unknown;
  [key: string]: unknown;
}

interface PolarEventData {
  id?: string;
  paid?: boolean;
  status?: string;
  currency?: string;
  total_amount?: number;
  net_amount?: number;
  amount?: number;
  metadata?: PolarMetadata | null;
  checkout?: { metadata?: PolarMetadata | null } | null;
  customer?: { email?: string; external_id?: string | null } | null;
  user?: { email?: string } | null;
  customer_email?: string;
  product_id?: string;
  product?: { id?: string; name?: string; metadata?: unknown } | null;
}

interface PolarEventPayload {
  type?: string;
  event?: string;
  data?: PolarEventData;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PG_UNIQUE_VIOLATION = '23505';
const MAX_WEBHOOK_BYTES = 1024 * 1024;

function acknowledged(eventType: string | undefined, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: true, received: true, event: eventType, ...extra });
}

function orderIsPaid(eventType: string | undefined, data: PolarEventData): boolean {
  if (eventType === 'order.paid') return true;
  return data.paid === true || data.status === 'paid';
}

function metadataOrgId(data: PolarEventData): string | null {
  for (const metadata of [data.metadata, data.checkout?.metadata]) {
    const candidate = metadata?.org_id;
    if (typeof candidate === 'string' && UUID_PATTERN.test(candidate)) return candidate;
  }
  return null;
}

async function organizationExists(supabase: AdminClient, orgId: string): Promise<boolean> {
  const { data, error } = await supabase.from('organizations').select('id').eq('id', orgId).limit(1).maybeSingle();
  if (error) throw new Error(`organization lookup failed: ${error.message}`);
  return !!data;
}

async function orgIdByUserEmail(supabase: AdminClient, email: string): Promise<string | null> {
  const candidates = email === email.toLowerCase() ? [email] : [email, email.toLowerCase()];
  for (const candidate of candidates) {
    const { data, error } = await supabase.from('users').select('org_id').eq('email', candidate).limit(1).maybeSingle();
    if (error) throw new Error(`user lookup failed: ${error.message}`);
    const orgId = (data as { org_id?: string | null } | null)?.org_id;
    if (orgId) return orgId;
  }
  return null;
}

async function resolveOrgId(supabase: AdminClient, data: PolarEventData): Promise<string | null> {
  const fromMetadata = metadataOrgId(data);
  if (fromMetadata && (await organizationExists(supabase, fromMetadata))) return fromMetadata;

  const externalId = data.customer?.external_id;
  if (typeof externalId === 'string' && UUID_PATTERN.test(externalId) && (await organizationExists(supabase, externalId))) {
    return externalId;
  }

  const email = data.customer?.email || data.customer_email || data.user?.email;
  return email ? orgIdByUserEmail(supabase, email) : null;
}

function orderAmountCents(data: PolarEventData): number | null {
  const amount = data.total_amount ?? data.net_amount ?? data.amount;
  return typeof amount === 'number' && Number.isInteger(amount) ? amount : null;
}

async function provisionCreditOrder(
  supabase: AdminClient,
  eventType: string | undefined,
  data: PolarEventData,
  credits: number,
): Promise<NextResponse> {
  const orderId = data.id;
  if (!orderId) {
    console.warn('[Polar Webhook] Credit order without an order id ignored');
    return acknowledged(eventType, { unresolved: true });
  }

  const orgId = await resolveOrgId(supabase, data);
  if (!orgId) {
    console.warn(`[Polar Webhook] Order ${orderId} could not be matched to an organization; no credits granted`);
    return NextResponse.json({ success: true, received: true, event: eventType, unresolved: true }, { status: 202 });
  }

  const productId = data.product?.id || data.product_id || '';
  const insert = await supabase.from('credit_orders').insert({
    polar_order_id: orderId,
    org_id: orgId,
    product_id: productId,
    credits_events: credits,
    amount_cents: orderAmountCents(data),
    currency: data.currency ?? null,
  });
  if (insert.error) {
    if (insert.error.code === PG_UNIQUE_VIOLATION) return acknowledged(eventType, { duplicate: true });
    throw new Error(`credit_orders insert failed: ${insert.error.message}`);
  }

  const topUp = await supabase.rpc('add_org_credits', { p_org_id: orgId, p_credits: credits });
  if (topUp.error || topUp.data === null) {
    const reason = topUp.error?.message ?? 'organization not found';
    const rollback = await supabase.from('credit_orders').delete().eq('polar_order_id', orderId);
    if (rollback.error) {
      console.error(`[Polar Webhook] Order ${orderId} recorded but credits not applied and rollback failed: ${rollback.error.message}`);
    }
    throw new Error(`add_org_credits failed: ${reason}`);
  }

  return acknowledged(eventType, { credited: credits, balance: topUp.data });
}

function auditedDomain(data: PolarEventData): string | null {
  for (const metadata of [data.metadata, data.checkout?.metadata]) {
    const candidate = metadata?.audited_domain;
    if (typeof candidate === 'string') return sanitizeAndValidateDomain(candidate);
  }
  return null;
}

// The Fix Pack grants no credits (D-1): the unlock comes from /api/billing/polar/verify, so the webhook only
// records the conversion and never blocks Polar on a scan_leads failure.
async function recordFixPackOrder(supabase: AdminClient, eventType: string | undefined, data: PolarEventData) {
  const domain = auditedDomain(data);
  console.info(`[Polar Webhook] Fix Pack order ${data.id ?? 'unknown'} paid for ${domain ?? 'an unbound domain'}`);
  if (!domain) return acknowledged(eventType, { fix_pack: true, unresolved: true });

  const { error } = await supabase.from('scan_leads').update({ converted: true } as never).eq('domain', domain);
  if (error) console.error(`[Polar Webhook] Fix Pack order ${data.id ?? 'unknown'} not marked as converted: ${error.message}`);
  return acknowledged(eventType, { fix_pack: true });
}

async function downgradeLegacySubscriber(supabase: AdminClient, data: PolarEventData): Promise<void> {
  const email = data.customer?.email || data.user?.email || data.customer_email;
  if (!email) return;
  const { error } = await supabase
    .from('users')
    .update({ plan: 'developer', updated_at: new Date().toISOString() })
    .eq('email', email);
  if (error) throw new Error(`users downgrade failed: ${error.message}`);
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.POLAR_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[Polar Webhook] POLAR_WEBHOOK_SECRET is not configured; rejecting delivery');
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 500 });
  }

  try {
    const rawBody = await readBodyText(req, MAX_WEBHOOK_BYTES);
    if (rawBody === null) {
      console.warn('[Polar Webhook] Rejected delivery larger than 1 MB');
      return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
    }
    const id = req.headers.get('webhook-id');
    const timestamp = req.headers.get('webhook-timestamp');
    const signatureHeader = req.headers.get('webhook-signature');

    if (!id || !timestamp || !signatureHeader) {
      return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
    }

    const verified = verifyStandardWebhook({
      secret: webhookSecret,
      id,
      timestamp,
      signatureHeader,
      rawBody,
    });
    if (!verified) {
      console.warn('[Polar Webhook] Rejected delivery with invalid or expired signature');
      return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
    }

    let payload: PolarEventPayload;
    try {
      payload = JSON.parse(rawBody) as PolarEventPayload;
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const eventType = payload.type || payload.event;
    const data = payload.data;

    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      console.error('[Polar Webhook] Supabase admin client is not configured');
      return NextResponse.json({ error: 'database_not_configured' }, { status: 500 });
    }

    if (!data) return acknowledged(eventType);

    if (eventType === 'order.paid' || eventType === 'order.created') {
      if (!orderIsPaid(eventType, data)) return acknowledged(eventType);
      const productId = data.product?.id || data.product_id;
      if (productId === FIX_PACK.productId) return await recordFixPackOrder(supabase, eventType, data);

      const credits = creditsForProduct(data.product, data.product_id);
      if (credits === null) {
        if (!isLegacySubscriptionProduct(productId)) {
          console.error(`[Polar Webhook] ALERT: paid order ${data.id ?? 'unknown'} for unmapped product ${productId ?? 'unknown'}; nothing was provisioned`);
        }
        return acknowledged(eventType, { unmapped: true });
      }
      return await provisionCreditOrder(supabase, eventType, data, credits);
    }

    if (eventType === 'subscription.canceled' || eventType === 'subscription.revoked') {
      const productId = data.product?.id || data.product_id;
      if (!productId || isLegacySubscriptionProduct(productId)) await downgradeLegacySubscriber(supabase, data);
    }

    return acknowledged(eventType);
  } catch (err: unknown) {
    console.error('[Polar Webhook Error]:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'webhook_processing_failed' }, { status: 500 });
  }
}
