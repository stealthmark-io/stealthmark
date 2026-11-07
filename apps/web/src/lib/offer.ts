/** Full scans each domain gets free before re-scan results lock. */
export const FREE_SCANS_PER_DOMAIN = 20;

/** Days a domain unlock keeps re-scans unlimited. */
export const UNLOCK_DAYS = 30;

export const FIX_PACK = {
  priceUsd: 0,
  discountedPriceUsd: 0.99,
  starterPriceUsd: 0.99,
  starterPriceLabel: '$0.99',
  starterDiscountedUsd: 0.99,
  starterDiscountedLabel: '$0.99',
  discountPercent: 100,
  discountId: process.env.POLAR_DISCOUNT_ID_BLACKOCTOBER || '5072c65e-5333-4596-af15-6f300c8ea7af',
  label: 'Fix Pack',
  plan: 'fix_pack_19',
  productId: process.env.POLAR_PRODUCT_ID_FIX_19 || '006b9191-a4fd-4121-949c-a8d899ff827d',
  starterProductId: process.env.POLAR_PRODUCT_ID_STARTER || '18a27e56-8407-4cad-96ad-e5f833b3be71',
} as const;

export const FLEET_DEFENSE = {
  priceUsd: 0.99,
  priceLabel: '$0.99',
  intervalLabel: 'optional donation',
  label: 'Community Support Donation ($0.99 USD / $0.99 USDC)',
  plan: 'starter_pass',
  productId: process.env.POLAR_PRODUCT_ID_STARTER || '18a27e56-8407-4cad-96ad-e5f833b3be71',
} as const;

export const DONATION_OPTIONS = {
  usdcAmount: '0.99 USDC',
  stablecoinAmount: '0.99 USDC / USDT',
  polarUsdAmount: '$0.99 USD',
  baseUsdcWallet: '0xc8dc4ecb93c4c665Fad07E1261F5f7D60e3C6E0F',
  polarCheckoutPath: '/api/billing/polar/checkout?plan=starter_pass',
  polarCheckoutUrl: 'https://buy.polar.sh/polar_cl_toVEHysd64E3OWPwKz8oJbqWEPsSDHVJjX9cD0JW0O5',
} as const;

export const CRYPTO_WALLETS = {
  eth: '0xc8dc4ecb93c4c665Fad07E1261F5f7D60e3C6E0F',
  evm: '0xc8dc4ecb93c4c665Fad07E1261F5f7D60e3C6E0F',
  polygon: '0xc8dc4ecb93c4c665Fad07E1261F5f7D60e3C6E0F',
  arbitrum: '0xc8dc4ecb93c4c665Fad07E1261F5f7D60e3C6E0F',
  bsc: '0xc8dc4ecb93c4c665Fad07E1261F5f7D60e3C6E0F',
  base: '0xc8dc4ecb93c4c665Fad07E1261F5f7D60e3C6E0F',
  btc: 'bc1qvaz9ly5x5re3lmm70gtn6du86djant8mkj64x5',
  solana: '49sNhYNVSFxBuMPh5S2EC6Wkyay7mBWEPVv7pcyHJDxu',
  tron: 'TYgGahN7wK9NtUVFZaXCwZqktaYmkuNxD8',
} as const;
