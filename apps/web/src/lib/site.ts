export const SDK_NPM_URL = 'https://stealthmark.io/docs';
export const SITE_ORIGIN = 'https://stealthmark.io';

/** Schema.org Organization rendered as JSON-LD in the root layout; startup-program verifiers read foundingDate from it. */
export const ORGANIZATION_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'StealthMark',
  url: SITE_ORIGIN,
  foundingDate: '2026',
  sameAs: [SITE_ORIGIN],
} as const;
