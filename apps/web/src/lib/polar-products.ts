export type CreditPackId = 'starter' | 'growth' | 'scale';

export interface CreditPack {
  id: string;
  pack: CreditPackId;
  name: string;
  credits: number;
  priceUsd: number;
  checkoutUrl: string;
}

export const CREDIT_PACKS: readonly CreditPack[] = [
  {
    id: '18a27e56-8407-4cad-96ad-e5f833b3be71',
    pack: 'starter',
    name: 'Starter',
    credits: 15_000,
    priceUsd: 9,
    checkoutUrl: 'https://buy.polar.sh/polar_cl_wHjwo1hp0hgPfh5Vf5g0f59C4NuY7BMMnlzPD0GNUT0',
  },
  {
    id: '310f8f11-b9f9-4442-8a52-4babbef16b95',
    pack: 'growth',
    name: 'Growth',
    credits: 60_000,
    priceUsd: 29,
    checkoutUrl: 'https://buy.polar.sh/polar_cl_mYp4oCnZY89elcupgf91wcGA1mvvXJvMD27uR40fWlp',
  },
  {
    id: 'e7c75042-3c37-4f06-9c9d-2e4738f765e7',
    pack: 'scale',
    name: 'Scale',
    credits: 250_000,
    priceUsd: 79,
    checkoutUrl: 'https://buy.polar.sh/polar_cl_0dmrfD6A0k2SZTxJ9BGw5YAGqocuiUkMZ3oSC04CGBD',
  },
];

/** Retired credit products no longer sold (0 orders). A late order.paid for them still credits the org. */
export const LEGACY_CREDIT_PRODUCTS: readonly { id: string; credits: number }[] = [
  { id: 'ae5303ba-3cc7-4c9e-a8f4-0d5b654fd305', credits: 2_500 },
];

/** Archived Pro/Business subscription products. Their webhooks stay handled as a downgrade path. */
export const LEGACY_SUBSCRIPTION_PRODUCT_IDS: readonly string[] = [
  '4a376252-688d-4cee-a98f-abc16834884d',
  'ed4121a3-743a-4979-b1e8-b43b7cc91614',
  'ad05a29d-4556-4fc7-8307-219c35e81736',
  '70503dc3-f840-4985-8231-726d24d8492b',
];

export function isCreditPackId(value: unknown): value is CreditPackId {
  return value === 'starter' || value === 'growth' || value === 'scale';
}

export function findPackById(pack: CreditPackId): CreditPack {
  const found = CREDIT_PACKS.find((entry) => entry.pack === pack);
  if (!found) throw new Error(`unknown credit pack: ${pack}`);
  return found;
}

export function findPackByProductId(productId: string | null | undefined): CreditPack | null {
  if (!productId) return null;
  return CREDIT_PACKS.find((entry) => entry.id === productId || entry.pack === productId) ?? null;
}

export function isLegacySubscriptionProduct(productId: string | null | undefined): boolean {
  return !!productId && LEGACY_SUBSCRIPTION_PRODUCT_IDS.includes(productId);
}

export interface ProductLike {
  id?: unknown;
  metadata?: unknown;
}

function positiveInteger(value: unknown): number | null {
  const numeric = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof numeric === 'number' && Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

/**
 * Credits granted by a product:
 * For known catalog product IDs or packs (starter, growth, scale) and retired credit products, the static code catalog
 * strictly PREVAILS over legacy Polar metadata so manual dashboard edits aren't required.
 * For unknown or custom product IDs, Polar metadata credits_events is evaluated.
 */
export function creditsForProduct(product: ProductLike | null | undefined, productIdFallback?: string): number | null {
  const productId = typeof product?.id === 'string' ? product.id : productIdFallback;
  if (isLegacySubscriptionProduct(productId)) {
    return null;
  }

  const catalogPack = findPackByProductId(productId);
  if (catalogPack) {
    return catalogPack.credits;
  }

  const legacyPack = LEGACY_CREDIT_PRODUCTS.find((entry) => entry.id === productId);
  if (legacyPack) {
    return legacyPack.credits;
  }

  const metadata = product?.metadata;
  if (metadata && typeof metadata === 'object') {
    const record = metadata as Record<string, unknown>;
    if (typeof record.pack === 'string' && isCreditPackId(record.pack)) {
      return findPackById(record.pack).credits;
    }
    if (record.kind === undefined || record.kind === 'credit_pack') {
      const fromMetadata = positiveInteger(record.credits_events);
      if (fromMetadata !== null) return fromMetadata;
    }
  }

  return null;
}

export function pricePer1k(pack: CreditPack | { priceUsd: number; credits: number }): string {
  return (pack.priceUsd / (pack.credits / 1000)).toFixed(3);
}
