import { NextRequest, NextResponse } from 'next/server';
import { sanitizeAndValidateDomain } from '@/lib/security/network-guard';
import { FIX_PACK, FLEET_DEFENSE } from '@/lib/offer';
import { isPolarCheckoutUrl, polarApiBase, polarApiToken } from '@/lib/polar-api';

const POLAR_TIMEOUT_MS = 8000;
const ALLOWED_PLANS = new Set<string>([FIX_PACK.plan, 'fix_pack_49', 'starter_pass', FLEET_DEFENSE.plan]);
const REF_RE = /^[a-zA-Z0-9_.-]{2,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BOT_UA_RE = /Barracuda|Mimecast|Proofpoint|SafeLinks|URLDefense|Amazonbot|GPTBot|ClaudeBot|PerplexityBot|GoogleOther|HeadlessChrome|BingPreview|Slackbot/i;

// GET /api/billing/polar/checkout?plan=fix_pack_19|starter_pass|fleet_149&domain=...&email=...&ref=...
export async function GET(req: NextRequest) {
  const ua = req.headers.get('user-agent') || '';
  const purpose = (req.headers.get('purpose') || req.headers.get('sec-purpose') || '').toLowerCase();
  // A missing domain stays null: defaulting it to stealthmark.io filed the sale under our own site.
  const rawDomain = req.nextUrl.searchParams.get('domain');
  const domain = rawDomain ? sanitizeAndValidateDomain(rawDomain) : null;
  if (rawDomain && !domain) {
    return NextResponse.json({ error: 'invalid_domain' }, { status: 400 });
  }

  // Prevent corporate mail link scanners and browser prefetch from creating phantom Polar checkouts
  if (BOT_UA_RE.test(ua) || purpose.includes('prefetch') || purpose.includes('preview')) {
    return NextResponse.redirect(`https://stealthmark.io/scan${domain ? `?domain=${encodeURIComponent(domain)}` : ''}`, 302);
  }

  const plan = req.nextUrl.searchParams.get('plan') || FIX_PACK.plan;
  if (!ALLOWED_PLANS.has(plan)) {
    return NextResponse.json({ error: 'invalid_plan' }, { status: 400 });
  }

  const rawRef = (req.nextUrl.searchParams.get('ref') || '').trim().toLowerCase();
  const cleanRef = REF_RE.test(rawRef) ? rawRef : undefined;
  const rawEmail = (req.nextUrl.searchParams.get('email') || '').trim().toLowerCase();
  const customerEmail = EMAIL_RE.test(rawEmail) ? rawEmail : undefined;

  const token = polarApiToken();
  if (!token) {
    console.error('[Fix Pack Checkout] POLAR_ACCESS_TOKEN / POLAR_API_KEY is not configured');
    return NextResponse.json({ error: 'checkout_unavailable' }, { status: 503 });
  }

  const targetProductId =
    plan === FLEET_DEFENSE.plan
      ? FLEET_DEFENSE.productId
      : plan === 'starter_pass'
      ? FIX_PACK.starterProductId
      : FIX_PACK.productId;

  // Starter Pass ($9 USD Unlimited Re-Scans) is billed at $9.00 USD; Fix Pack ($49 USD) supports the grant discount
  const autoApplyDiscount = plan === FIX_PACK.plan || plan === 'fix_pack_49';

  try {
    const res = await fetch(`${polarApiBase()}/v1/checkouts/`, {
      method: 'POST',
      headers: {
        Authorization: ['Bearer', token].join(' '),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        products: [targetProductId],
        ...(autoApplyDiscount && FIX_PACK.discountId ? { discount_id: FIX_PACK.discountId } : {}),
        ...(customerEmail ? { customer_email: customerEmail } : {}),
        success_url: `https://stealthmark.io/scan?${domain ? `domain=${encodeURIComponent(domain)}&` : ''}checkout_id={CHECKOUT_ID}`,
        metadata: {
          ...(domain ? { audited_domain: domain } : {}),
          plan_tier: plan,
          ...(cleanRef ? { referrer_code: cleanRef } : {}),
        },
      }),
      signal: AbortSignal.timeout(POLAR_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; url?: unknown; net_amount?: number };
    if (res.ok && isPolarCheckoutUrl(body.url)) {
      const checkoutUrl = String(body.url);
      // Async real-time log + Telegram alert when a real human initiates checkout
      void (async () => {
        try {
          const fs = await import('fs/promises');
          const logRow = JSON.stringify({
            ts: new Date().toISOString(),
            event: 'polar_checkout_initiated',
            domain,
            plan,
            amount_cents: body.net_amount || (plan === 'starter_pass' ? Math.round(FIX_PACK.starterPriceUsd * 100) : plan === FLEET_DEFENSE.plan ? 14900 : 2450),
            checkout_id: body.id || null,
            checkout_url: checkoutUrl,
          });
          await fs.appendFile('/var/cache/stealthmark-web/polar_checkout_attempts.jsonl', logRow + '\n').catch(() => {});
          console.log('[POLAR_CHECKOUT_INITIATED]', logRow);

          const tgToken = process.env.TELEGRAM_BOT_TOKEN;
          const tgChat = process.env.TELEGRAM_CHAT_ID;
          if (tgToken && tgChat) {
            const priceText = plan === 'starter_pass' ? `${FIX_PACK.starterPriceLabel} USD` : plan === FLEET_DEFENSE.plan ? '$149/mo' : '$24.50 USD';
            const msg = `💳 *Intento de Pago en Polar.sh*\n• *Dominio:* \`${domain || 'sin dominio'}\`\n• *Plan:* \`${plan}\` (${priceText})\n• *Checkout ID:* \`${body.id || 'n/a'}\``;
            await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: tgChat, text: msg, parse_mode: 'Markdown' }),
              signal: AbortSignal.timeout(4000),
            }).catch(() => {});
          }
        } catch {
          // non-blocking telemetry
        }
      })();
      return NextResponse.redirect(checkoutUrl, 303);
    }
    console.error(`[Fix Pack Checkout] Polar answered ${res.status} without a checkout URL`);
  } catch (err: unknown) {
    console.error('[Fix Pack Checkout] Polar checkout request failed:', err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ error: 'checkout_unavailable' }, { status: 503 });
}
