import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, CheckCircle2 } from 'lucide-react';
import { CopyEmail } from '@/components/ui/copy-email';
import { DONATION_OPTIONS, FIX_PACK, FREE_SCANS_PER_DOMAIN } from '@/lib/offer';

export const metadata: Metadata = {
  title: 'Refund & Cancellation Policy — StealthMark',
  description: 'StealthMark 14-day satisfaction and refund policy for the one-time Fix Pack.',
  alternates: { canonical: '/refund' },
};

export default function RefundPage() {
  return (
    <div className="min-h-screen bg-[#060709] text-slate-200 py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <Link href="/" className="inline-flex items-center gap-2 text-xs font-mono text-cyan-400 hover:text-cyan-300 transition">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to StealthMark
        </Link>

        <div className="space-y-3 border-b border-white/10 pb-6">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 font-mono text-xs font-semibold border border-cyan-500/20">
            <RefreshCw className="w-3.5 h-3.5" />
            Customer Satisfaction
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Refund &amp; Cancellation Policy
          </h1>
          <p className="text-xs text-slate-400 font-mono">
            Last Updated: October 31, 2026 · Release v5.1.0 · Effective Immediately
          </p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-slate-300">
          <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 space-y-2">
            <div className="flex items-center gap-2 font-bold text-base text-white">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              14-Day Refund Window · Zero Recurring Subscriptions
            </div>
            <p className="text-xs text-slate-300 leading-normal">
              The StealthMark v5.1 <strong>{FIX_PACK.label}</strong> ({FIX_PACK.starterPriceLabel} USD one-time per domain) is a single one-time purchase with zero recurring billing. If the generated Cloudflare Worker, WAF rule, or other Fix Pack files do not resolve your audited findings, you may request a full refund within 14 calendar days.
            </p>
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">1. No Subscriptions or Automatic Renewals</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-300">
              <li><strong>One-Time Checkout Only:</strong> Every {FIX_PACK.label} is paid once per domain, by card through our Merchant of Record, <strong>Polar (polar.sh)</strong>, or with {DONATION_OPTIONS.stablecoinAmount} on-chain. You will never be charged a monthly or annual renewal fee.</li>
              <li><strong>Free 60-Point Scanner:</strong> Running passive scans on <code className="font-mono text-cyan-300">/scan</code> is free and requires no credit card; the full report is free for the first {FREE_SCANS_PER_DOMAIN} scans of each domain.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">2. Refund Eligibility</h2>
            <ul className="list-disc pl-5 space-y-2 text-slate-300">
              <li>
                <strong>{FIX_PACK.label} ({FIX_PACK.starterPriceLabel} USD):</strong> Eligible for a 100% refund within 14 calendar days if the scan report or the generated Fix Pack files (WAF rule, Worker, shield script) failed to work as described on your target stack.
              </li>
              <li>
                <strong>Enterprise Security Assessments:</strong> Governed by the milestones and terms specified in your signed Statement of Work (SoW).
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">3. How to Request a Refund</h2>
            <p>
              Provide your Polar order ID or checkout email address through either channel:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-300">
              <li>Direct Billing Desk: <CopyEmail address="support@stealthmark.io" className="text-cyan-400" /> (subject: StealthMark refund request)</li>
              <li>Merchant of Record Help Desk: <a href="https://polar.sh" target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">polar.sh</a></li>
            </ul>
            <p className="pt-1 text-xs text-slate-400 font-mono">
              Approved refunds are credited back to the original payment instrument within 3 to 5 business days.
            </p>
          </section>
        </div>

        <div className="pt-8 border-t border-white/10 text-center text-xs text-slate-500">
          © 2026 StealthMark. All rights reserved. Merchant of Record processing powered by Polar (polar.sh).
        </div>
      </div>
    </div>
  );
}
