import type { Metadata } from 'next';
import { SITE_ORIGIN } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Security Advisories & Coordinated Disclosures | StealthMark',
  description:
    'Published community vulnerability advisories, open-source security patches, and embargo-safe coordinated disclosure track record across Web3 L1s, HackerOne, Bugcrowd, and AI agent runtimes.',
  alternates: { canonical: `${SITE_ORIGIN}/advisories` },
};

export default function AdvisoriesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
