export const SDK_NPM_URL = 'https://stealthmark.io/docs';
export const SITE_ORIGIN = 'https://stealthmark.io';
export const GITHUB_ORG_URL = 'https://github.com/stealthmark-io';
export const LINKEDIN_COMPANY_URL = 'https://www.linkedin.com/company/stealthmark-scan/';
export const LINKEDIN_FOUNDER_URL = 'https://www.linkedin.com/in/marcos-cassasnovas/';

/** Schema.org Organization rendered as JSON-LD in the root layout; startup-program verifiers read foundingDate from it. */
export const ORGANIZATION_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'StealthMark',
  url: SITE_ORIGIN,
  foundingDate: '2026',
  sameAs: [SITE_ORIGIN, LINKEDIN_COMPANY_URL, GITHUB_ORG_URL],
  founder: {
    '@type': 'Person',
    name: 'Marcos Cassasnovas',
    url: LINKEDIN_FOUNDER_URL,
    sameAs: [LINKEDIN_FOUNDER_URL],
  },
} as const;
