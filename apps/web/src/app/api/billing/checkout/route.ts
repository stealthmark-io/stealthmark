import { NextRequest, NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/auth';
import { getOrgSession } from '@/lib/session';
import { findPackById, isCreditPackId, type CreditPack } from '@/lib/polar-products';

const POLAR_CHECKOUTS_URL = 'https://api.polar.sh/v1/checkouts/';
const POLAR_TIMEOUT_MS = 8000;
const SUCCESS_URL = 'https://stealthmark.io/dashboard?credits=purchased';

function isPolarCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'polar.sh' || url.hostname.endsWith('.polar.sh'));
  } catch {
    return false;
  }
}

async function createPolarCheckout(
  apiKey: string,
  pack: CreditPack,
  orgId: string,
  email: string,
): Promise<string | null> {
  try {
    const res = await fetch(POLAR_CHECKOUTS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        products: [pack.id],
        customer_email: email,
        external_customer_id: orgId,
        metadata: { org_id: orgId, pack: pack.pack },
        success_url: SUCCESS_URL,
      }),
      signal: AbortSignal.timeout(POLAR_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[Billing Checkout] Polar answered ${res.status}; using the static checkout link`);
      return null;
    }
    const body = (await res.json()) as { url?: unknown };
    return isPolarCheckoutUrl(body.url) ? body.url : null;
  } catch (err: unknown) {
    console.warn('[Billing Checkout] Polar checkout request failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// GET /api/billing/checkout?pack=starter|growth|scale - session-scoped credit pack purchase
export async function GET(req: NextRequest) {
  const pack = req.nextUrl.searchParams.get('pack');
  if (!isCreditPackId(pack)) {
    return NextResponse.json({ error: 'invalid_pack' }, { status: 400 });
  }

  const session = await getOrgSession();
  if (!session) {
    const resume = encodeURIComponent(`/api/billing/checkout?pack=${pack}`);
    return NextResponse.redirect(new URL(`/login?next=${resume}`, getAppUrl(req)), 302);
  }

  const apiKey = process.env.POLAR_API_KEY;
  if (!apiKey) {
    console.error('[Billing Checkout] POLAR_API_KEY is not configured');
    return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 });
  }

  const creditPack = findPackById(pack);
  const checkoutUrl = await createPolarCheckout(apiKey, creditPack, session.orgId, session.user.email);
  return NextResponse.redirect(checkoutUrl ?? creditPack.checkoutUrl, 302);
}
