import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Lock } from 'lucide-react';
import { CopyEmail } from '@/components/ui/copy-email';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';

export const metadata: Metadata = {
  title: 'Privacy Policy — StealthMark',
  description: 'StealthMark Privacy Policy: how our 60-point passive perimeter scanner processes publicly observable network signals and protects customer data.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#060709] text-slate-200 py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <Link href="/" className="inline-flex items-center gap-2 text-xs font-mono text-cyan-400 hover:text-cyan-300 transition">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to StealthMark
        </Link>

        <div className="space-y-3 border-b border-white/10 pb-6">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-mono text-xs font-semibold border border-emerald-500/20">
            <Lock className="w-3.5 h-3.5" />
            Privacy &amp; Data Protection
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Privacy Policy
          </h1>
          <p className="text-xs text-slate-400 font-mono">
            Last Updated: October 31, 2026 · Release v5.1.0 · Effective Immediately
          </p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-slate-300">
          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">1. Overview &amp; Privacy Commitment</h2>
            <p>
              At StealthMark, we engineer security infrastructure with privacy-by-design. This Privacy Policy details what information our v5.1 {SCAN_CHECK_COUNT}-point passive perimeter scanner, Static PDF CDR Inspector, and Fix Pack service collect, how it is processed, and what we never collect.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">2. What the Scanner Inspects &amp; What It Never Collects</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-300">
              <li><strong>Publicly Observable Signals Only:</strong> HTTP response headers, status codes, TLS 1.2/1.3 certificate metadata, public DNS records (A, AAAA, CNAME, TXT, SPF, DMARC, CAA, DNSSEC), public robots.txt / security.txt / llms.txt manifests, and passively indexed open ports/CVEs from Shodan InternetDB.</li>
              <li><strong>Redacted Secret Detection:</strong> When our scanner detects exposed API key patterns in public JavaScript bundles, the raw secret value is immediately masked and never stored in plaintext.</li>
              <li><strong>Never Collected:</strong> Private customer PII, end-user session cookies from your visitors, private source code, or raw credit card numbers.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">3. Information You Voluntarily Provide</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-300">
              <li><strong>Work Email for Alerts &amp; Requests:</strong> When you enter a work email on <code className="font-mono text-cyan-300">/scan</code> or <code className="font-mono text-cyan-300">/enterprise/contact</code>, we use it solely to deliver your requested scan findings, passive CVE/port radar alerts, or Enterprise scope proposal. Every email includes an instant 1-click unsubscribe link.</li>
              <li><strong>Payment Data:</strong> Card payments are handled directly by our Merchant of Record, <strong>Polar (polar.sh)</strong>. StealthMark never receives or stores raw credit card numbers or CVVs. On-chain USDC/USDT payments are verified from the public transaction hash you submit.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">4. Cookies &amp; Local Storage</h2>
            <p>
              We do not use third-party advertising pixels. When you unlock a domain with the Fix Pack, your browser&apos;s local storage saves the cryptographic unlock token for that audited domain so you can access your Fix Pack files and white-label PDF report without creating an account.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">5. Infrastructure &amp; Sub-Processors</h2>
            <ul className="list-disc pl-5 space-y-1 text-slate-300">
              <li><strong>Google Cloud Platform (us-central1) &amp; Cloudflare:</strong> Host the StealthMark web application, edge WAF, and 60-point scanner gateway.</li>
              <li><strong>Supabase:</strong> Stores scan telemetry and alert subscriptions (US region, TLS encrypted).</li>
              <li><strong>Polar (polar.sh):</strong> Processes one-time Fix Pack card payments as Merchant of Record.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">6. Your Data Rights</h2>
            <p>
              Under GDPR, CCPA, and applicable privacy laws, you have the right to access, correct, or request immediate deletion of your email address or scan records. Write to <CopyEmail address="security@stealthmark.io" className="text-cyan-400" /> or <CopyEmail address="support@stealthmark.io" className="text-cyan-400" /> and we will process your request within 48 hours.
            </p>
          </section>
        </div>

        <div className="pt-8 border-t border-white/10 text-center text-xs text-slate-500">
          © 2026 StealthMark. All rights reserved.
        </div>
      </div>
    </div>
  );
}
