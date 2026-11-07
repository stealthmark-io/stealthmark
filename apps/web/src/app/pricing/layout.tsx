import type { Metadata } from 'next';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';
import { FIX_PACK, FREE_SCANS_PER_DOMAIN } from '@/lib/offer';

export const metadata: Metadata = {
  title: 'Security Tiers & Pricing | StealthMark',
  description:
    `Scan any domain free with ${SCAN_CHECK_COUNT} passive checks, no signup: the full report is free for the first ${FREE_SCANS_PER_DOMAIN} scans of each domain. Unlock the ${FIX_PACK.label} for ${FIX_PACK.starterPriceLabel} one-time per domain, or request a custom-scope Red Team or Blue Team engagement.`,
  alternates: { canonical: '/pricing' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
