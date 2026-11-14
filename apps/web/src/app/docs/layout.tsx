import type { Metadata } from 'next';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';

export const metadata: Metadata = {
  title: 'Security Docs | StealthMark',
  description:
    `${SCAN_CHECK_COUNT}-point passive perimeter reconnaissance, OWASP Top 10:2025 compliance gates, October 2026 CVE edge defenses, CSP nonces, and Cloudflare / Cloud Armor WAF rules.`,
  alternates: { canonical: '/docs' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
