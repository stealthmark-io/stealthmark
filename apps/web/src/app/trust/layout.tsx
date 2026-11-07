import type { Metadata } from 'next';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';

export const metadata: Metadata = {
  title: 'Trust & Security | StealthMark',
  alternates: { canonical: '/trust' },
  description: `How the StealthMark ${SCAN_CHECK_COUNT}-point passive scanner works, which public signals it inspects, what it never collects, how stealthmark.io is hardened and how to report a vulnerability.`,
  keywords: [
    'StealthMark Trust',
    'Passive security scanner',
    'Perimeter security audit',
    'OWASP Top 10:2025',
    'Responsible disclosure',
  ],
  openGraph: {
    title: 'Trust & Security | StealthMark',
    description:
      'What the StealthMark scanner inspects, what it never collects and how to reach the security team.',
    type: 'website',
  },
};

export default function TrustLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
