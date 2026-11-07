import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Web & AI-Surface Readiness Auditor | StealthMark',
  alternates: { canonical: '/scan' },
  description:
    'Passive readiness inspection for web domains: observable TLS transport, DNS security records, AI crawl policies (robots.txt), agent manifests, and defense headers. Checks that cannot be evaluated are marked "not assessed" instead of guessed.',
  keywords: [
    'AI readiness audit',
    'Passive web scanner',
    'robots.txt AI rules',
    'llms.txt',
    'agent.json',
    'DNS CAA SPF DMARC',
    'Security headers audit',
  ],
  openGraph: {
    title: 'Web & AI-Surface Readiness Auditor | StealthMark',
    description:
      'Inspect public observable signals for AI agent discovery, crawl policy and security headers. Zero arbitrary scores.',
    type: 'website',
  },
};

export default function ScanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
