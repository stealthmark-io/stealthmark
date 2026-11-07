import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Console | StealthMark',
  description:
    'The StealthMark console: agent activity, API keys, usage and billing.',
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
