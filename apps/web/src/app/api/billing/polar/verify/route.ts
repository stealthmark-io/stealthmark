import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { clientIp } from '@/lib/client-ip';
import { FIX_PACK, FLEET_DEFENSE } from '@/lib/offer';
import { polarApiBase, polarApiToken } from '@/lib/polar-api';
import { sanitizeAndValidateDomain } from '@/lib/security/network-guard';
import { isScanUnlockConfigured, issueScanUnlockToken } from '@/lib/scan-unlock';
import {
  CLOUDFLARE_WAF_RULE,
  buildEdgeWorker,
  buildClientRaspShield,
  buildLiveBadgeSnippet,
} from '@/lib/fix-pack-deliverables';

const POLAR_TIMEOUT_MS = 8000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const CHECKOUT_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const PG_UNIQUE_VIOLATION = '23505';

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

interface PolarCheckout {
  status?: unknown;
  amount?: unknown;
  total_amount?: unknown;
  product_id?: unknown;
  product?: { id?: unknown } | null;
  metadata?: { audited_domain?: unknown; referrer_code?: unknown } | null;
}

interface PolarOrder {
  checkout_id: unknown;
  status?: unknown;
}

function respond(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt <= now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

async function fetchCheckout(checkoutId: string, token: string): Promise<PolarCheckout | 'not_found' | null> {
  try {
    const res = await fetch(`${polarApiBase()}/v1/checkouts/${encodeURIComponent(checkoutId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(POLAR_TIMEOUT_MS),
    });
    if (res.status === 404 || res.status === 422) return 'not_found';
    if (!res.ok) {
      console.error(`[Fix Pack Verify] Polar answered ${res.status} for checkout lookup`);
      return null;
    }
    return (await res.json()) as PolarCheckout;
  } catch (err: unknown) {
    console.error('[Fix Pack Verify] Polar checkout lookup failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// Polar reads checkout ids as UUIDs, so it also takes one in upper case or without hyphens and answers with the canonical form.
function canonicalCheckoutId(id: string): string {
  return id.toLowerCase().replace(/-/g, '');
}

async function fetchRefundState(checkoutId: string, token: string): Promise<'refunded' | 'clear' | null> {
  try {
    const res = await fetch(`${polarApiBase()}/v1/orders/?checkout_id=${encodeURIComponent(checkoutId)}&limit=10`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(POLAR_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) {
      console.error(`[Fix Pack Verify] ALERT: Polar answered ${res.status} for order lookup; the token needs orders:read, refunds are not being checked`);
      return 'clear';
    }
    if (!res.ok) {
      console.error(`[Fix Pack Verify] Polar answered ${res.status} for order lookup`);
      return null;
    }
    // Only a body that is not JSON counts as no readable order; one that breaks off is a failed lookup.
    const body: unknown = await res.json().catch((err: unknown) => {
      if (err instanceof SyntaxError) return null;
      throw err;
    });
    const items = typeof body === 'object' && body !== null && 'items' in body ? body.items : undefined;
    const wanted = canonicalCheckoutId(checkoutId);
    const orders = Array.isArray(items)
      ? items.filter(
          (order: unknown): order is PolarOrder =>
            typeof order === 'object' &&
            order !== null &&
            'checkout_id' in order &&
            typeof order.checkout_id === 'string' &&
            canonicalCheckoutId(order.checkout_id) === wanted
        )
      : [];
    if (orders.length === 0) {
      console.error(`[Fix Pack Verify] Polar returned no readable order for paid checkout ${checkoutId}; refund not checked`);
      return 'clear';
    }
    return orders.some((order) => order.status === 'refunded' || order.status === 'void') ? 'refunded' : 'clear';
  } catch (err: unknown) {
    console.error('[Fix Pack Verify] Polar order lookup failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// GET /api/billing/polar/verify?checkout_id=... - exchanges a paid Fix Pack checkout for a domain-bound unlock token
export async function GET(req: NextRequest) {
  // D-5: without a client IP the per-IP limiter cannot work, so the request is refused.
  const ip = clientIp(req);
  if (!ip || isRateLimited(ip)) {
    return respond({ verified: false, error: 'rate_limited' }, 429);
  }

  const checkoutId = req.nextUrl.searchParams.get('checkout_id') || req.nextUrl.searchParams.get('session_id');
  if (!checkoutId || !CHECKOUT_ID_RE.test(checkoutId)) {
    return respond({ verified: false, error: 'invalid_checkout_id' }, 400);
  }
  const rawDomain = req.nextUrl.searchParams.get('domain');
  if (rawDomain !== null && !sanitizeAndValidateDomain(rawDomain)) {
    return respond({ verified: false, error: 'invalid_domain' }, 400);
  }

  const token = polarApiToken();
  if (!isScanUnlockConfigured() || !token) {
    console.error('[Fix Pack Verify] SCAN_UNLOCK_SECRET or the Polar token is not configured');
    return respond({ verified: false, error: 'unlock_unavailable' }, 503);
  }

  const checkout = await fetchCheckout(checkoutId, token);
  if (checkout === null) {
    return respond({ verified: false, error: 'polar_unavailable' }, 502);
  }
  if (checkout === 'not_found') {
    return respond({ verified: false, error: 'checkout_not_found' }, 402);
  }

  const productId = typeof checkout.product_id === 'string' ? checkout.product_id : checkout.product?.id;
  if (
    productId !== FIX_PACK.productId &&
    productId !== FLEET_DEFENSE.productId &&
    productId !== FIX_PACK.starterProductId
  ) {
    return respond({ verified: false, error: 'not_a_fix_pack_checkout' }, 402);
  }
  if (checkout.status === 'confirmed') {
    return respond({ verified: false, pending: true }, 202);
  }
  if (checkout.status !== 'succeeded') {
    return respond({ verified: false, error: 'checkout_not_paid' }, 402);
  }

  // A refund leaves the checkout `succeeded`; only its order says the money went back.
  const refundState = await fetchRefundState(checkoutId, token);
  if (refundState === null) {
    return respond({ verified: false, error: 'polar_unavailable' }, 502);
  }
  if (refundState === 'refunded') {
    return respond({ verified: false, error: 'checkout_refunded' }, 402);
  }

  // The unlock is bound to the domain recorded at checkout time, never to the query string.
  const boundDomain =
    typeof checkout.metadata?.audited_domain === 'string'
      ? sanitizeAndValidateDomain(checkout.metadata.audited_domain)
      : null;

  // Every paid checkout is recorded in credit_orders (idempotent on polar_order_id) before the domain check, so a
  // sale without a domain, such as a Fleet checkout, still gets its row and alert. Referral commissions are recorded, not paid out.
  const rawRef =
    typeof checkout.metadata?.referrer_code === 'string'
      ? checkout.metadata.referrer_code.trim().toLowerCase()
      : '';
  const cleanRef = /^[a-z0-9_.-]{2,64}$/.test(rawRef) ? rawRef : null;
  const paidCents =
    typeof checkout.total_amount === 'number'
      ? checkout.total_amount
      : typeof checkout.amount === 'number'
      ? checkout.amount
      : 2450;
  const supabase = createSupabaseAdminClient();
  if (supabase) {
    try {
      const { error: insErr } = await supabase.from('credit_orders').insert({
        polar_order_id: `polar_fixpack_${checkoutId}`,
        org_id: process.env.STEALTHMARK_CONSOLE_ORG_ID || 'ecf26102-eff1-4a45-8bb4-630cba346b4a',
        product_id: FIX_PACK.productId,
        credits_events: 0,
        amount_cents: paidCents,
        currency: 'USD',
        payment_method: 'polar_card',
        network: 'polar_usd',
        tx_hash: checkoutId,
        referrer_code: cleanRef,
        commission_cents: cleanRef ? Math.round(paidCents * 0.30) : 0,
      });
      // A 23505 means an earlier verify already recorded this checkout: no second row and no second sale alert.
      if (!insErr) {
        const tgToken = process.env.TELEGRAM_BOT_TOKEN;
        const tgChat = process.env.TELEGRAM_CHAT_ID;
        if (tgToken && tgChat) {
          const usdStr = (paidCents / 100).toFixed(2);
          fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: tgChat,
              text: `🎉 *VENTA CONFIRMADA EN POLAR.SH*\n• *Dominio:* \`${boundDomain ?? 'sin dominio'}\`\n• *Monto:* *$${usdStr} USD*\n• *Checkout ID:* \`${checkoutId}\``,
              parse_mode: 'Markdown',
            }),
            signal: AbortSignal.timeout(4000),
          }).catch(() => {});
        }
      } else if (insErr.code !== PG_UNIQUE_VIOLATION) {
        console.error(`[Fix Pack Verify] credit_orders insert failed: ${insErr.code}`);
      }
    } catch {
      // Idempotent if already recorded
    }
  }

  if (!boundDomain) {
    console.error(`[Fix Pack Verify] Paid checkout ${checkoutId} has no valid audited_domain metadata`);
    return respond(
      {
        verified: false,
        error: 'domain_binding_missing',
        message: 'Payment received, but it is not linked to a domain. Contact security@stealthmark.io with your receipt.',
      },
      409
    );
  }

  const unlockToken = issueScanUnlockToken({ checkoutId, domain: boundDomain, productId: FIX_PACK.productId });
  if (!unlockToken) {
    return respond({ verified: false, error: 'unlock_unavailable' }, 503);
  }

  return respond(
    {
      verified: true,
      domain: boundDomain,
      unlock_token: unlockToken,
      deliverables: {
        cloudflare_visual_waf_rule: CLOUDFLARE_WAF_RULE,
        cloudflare_worker_code: buildEdgeWorker(boundDomain),
        client_rasp_shield_js: buildClientRaspShield(boundDomain),
        live_badge_html: buildLiveBadgeSnippet(boundDomain),
        whitelabel_pdf_enabled: true,
      },
    },
    200
  );
}
