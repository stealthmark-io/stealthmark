import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Hall of Fame & Public Index | StealthMark',
  alternates: { canonical: '/leaderboard' },
  description:
    'Domains that earned an A or A+ in a fresh StealthMark audit and chose to be listed, plus the Public Index: dated editions of aggregate counts of DNS, TLS, header and AI-readiness checks that never name a domain.',
  keywords: [
    'StealthMark Hall of Fame',
    'AI readiness leaderboard',
    'Website security grade',
    'Public Index',
    'llms.txt adoption',
    'DMARC adoption',
  ],
  openGraph: {
    title: 'Hall of Fame & Public Index | StealthMark',
    description:
      'Opt-in list of domains graded A or A+ by the StealthMark auditor, and an aggregate index that never names a domain.',
    type: 'website',
  },
};

export default function LeaderboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
