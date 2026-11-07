import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contact Enterprise | StealthMark',
  description:
    'Tell StealthMark which domains and stack you want assessed. Custom-scope Red Team and Blue Team engagements are quoted per scope.',
  alternates: { canonical: '/enterprise/contact' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
