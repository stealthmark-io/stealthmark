import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { CopyEmail } from '@/components/ui/copy-email';
import { DONATION_OPTIONS, FIX_PACK, FREE_SCANS_PER_DOMAIN, UNLOCK_DAYS } from '@/lib/offer';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';

export const metadata: Metadata = {
  title: 'Terms of Service — StealthMark',
  description: 'StealthMark Terms of Service for the 60-point passive perimeter scanner, the Fix Pack, and Enterprise Security Assessments.',
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#060709] text-slate-200 py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <Link href="/" className="inline-flex items-center gap-2 text-xs font-mono text-cyan-400 hover:text-cyan-300 transition">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to StealthMark
        </Link>

        <div className="space-y-3 border-b border-white/10 pb-6">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 font-mono text-xs font-semibold border border-cyan-500/20">
            <ShieldCheck className="w-3.5 h-3.5" />
            Legal Infrastructure
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Terms of Service
          </h1>
          <p className="text-xs text-slate-400 font-mono">
            Last Updated: October 31, 2026 · Release v5.1.0 · Effective Immediately
          </p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-slate-300">
          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">1. Agreement to Terms</h2>
            <p>
              By accessing or using the StealthMark v5.1 {SCAN_CHECK_COUNT}-point passive perimeter scanner, the Fix Pack (Cloudflare WAF rule, Cloudflare Worker, client-side RASP shield script, live badge snippet and white-label PDF report), CLI (<code className="font-mono text-cyan-300">@stealthmark/cli</code>), or related APIs (collectively, the &quot;Service&quot;), you agree to be bound by these Terms of Service. If you do not agree to all terms, you may not access or use the Service.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">2. Description of Service</h2>
            <p>
              StealthMark provides non-intrusive, passive external cybersecurity reconnaissance across {SCAN_CHECK_COUNT} controls (TLS 1.2/1.3, DNS/SPF/DMARC/CAA, Shodan InternetDB passive open ports and CVEs, HTTP security headers, exposed dotfiles, client JS bundle secret patterns, and OWASP Top 10:2025 gates), alongside a one-time per-domain Fix Pack (Cloudflare WAF rule, Cloudflare Worker, client-side RASP shield script, live badge snippet and white-label PDF report). StealthMark performs strictly passive external observations and never executes destructive or intrusive exploitation payloads.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">3. Merchant of Record &amp; Payment Processing</h2>
            <p>
              Our card order process and billing is conducted by our online reseller and Merchant of Record, <strong>Polar</strong> (Polar Software Inc. / polar.sh). Polar handles all customer inquiries, tax management, and invoicing for card orders. When paying by card for a StealthMark Fix Pack, you agree to comply with Polar&apos;s Terms of Service and Privacy Policy. On-chain payments are verified by transaction hash and do not go through Polar.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">4. Service Tiers &amp; Billing</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-300">
              <li><strong>Free {SCAN_CHECK_COUNT}-Point Perimeter Recon ($0):</strong> Evaluates any public domain across {SCAN_CHECK_COUNT} passive controls and displays the Executive Grade (A+ to F), OWASP Top 10:2025 gate status, and the full report with a fix recommendation for every finding, free for the first {FREE_SCANS_PER_DOMAIN} scans of each domain. After {FREE_SCANS_PER_DOMAIN} scans of the same domain, new scan results for that domain lock until the domain is unlocked.</li>
              <li><strong>{FIX_PACK.label}:</strong> {FIX_PACK.starterPriceLabel} USD one-time payment per domain (by card through Polar, or {DONATION_OPTIONS.stablecoinAmount} on-chain) that unlocks the Fix Pack files for that domain (Cloudflare WAF rule, Cloudflare Worker, client-side RASP shield script, live badge snippet and white-label PDF report) and unlimited re-scans of it for {UNLOCK_DAYS} days. It is a one-time purchase with zero recurring subscription.</li>
              <li><strong>Enterprise Security Assessment:</strong> Custom-scoped Red Team reconnaissance, API/Cloud architecture security review, and Blue Team edge WAF hardening under a separate mutual NDA and statement of work, quoted per scope through the <Link href="/enterprise/contact" className="text-cyan-400 hover:underline">enterprise contact form</Link>.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">5. Acceptable Use &amp; Authorization</h2>
            <p>You agree not to use StealthMark to:</p>
            <ul className="list-disc pl-5 space-y-1 text-slate-300">
              <li>Facilitate distributed denial of service (DDoS) attacks, brute-force attacks, or unauthorized exploitation of third-party systems.</li>
              <li>Bypass rate limits or scrape proprietary remediation blueprints and WAF rules for commercial resale outside authorized agency client engagements.</li>
            </ul>
            <p>
              StealthMark reserves the right to rate-limit or block abusive automated scanning traffic violating this policy.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">6. Availability &amp; Disclaimer</h2>
            <p>
              The automated scanner and Fix Pack deliverables are provided on an &quot;as is&quot; and &quot;as available&quot; basis based on publicly observable network signals at the time of the scan. Custom SLA commitments apply only to Enterprise engagements under a signed agreement.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">7. Contact Information</h2>
            <p>
              For legal inquiries or terms clarification, please contact our support desk at <CopyEmail address="support@stealthmark.io" className="text-cyan-400" /> or our security desk at <CopyEmail address="security@stealthmark.io" className="text-cyan-400" />.
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
