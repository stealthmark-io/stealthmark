import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Building2, CheckCircle2, FileText, Mail, ShieldCheck, Lock, Database } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';
import { FIX_PACK, FREE_SCANS_PER_DOMAIN, UNLOCK_DAYS } from '@/lib/offer';

export const metadata: Metadata = {
  title: 'Enterprise Perimeter & Cloud Security | StealthMark',
  description:
    'Full-scope Red Team surface recon, API security reviews, and Blue Team edge WAF hardening for SaaS and production web infrastructures.',
  alternates: { canonical: '/enterprise' },
};

interface DeliverableItem {
  title: string;
  body: string;
  icon: React.ReactNode;
}

const DELIVERABLES: readonly DeliverableItem[] = [
  {
    title: 'Red Team Perimeter & CVE Assessment (v5.1)',
    body: `Deep reconnaissance across primary domains, subdomains, Shodan open ports, TLS/DNS, exposed .env/sourcemaps, GraphQL/Swagger surfaces, and active 2026 CVEs (including Node2Shell CVE-2026-111497, SonicWall SMA 1000, Cisco ASA CVE-2026-76418 & Ivanti CVE-2026-104935).`,
    icon: <ShieldCheck className="w-5 h-5" aria-hidden />,
  },
  {
    title: 'API, Auth, PDF CDR & Cloud Architecture Review',
    body: 'Technical review of API authentication boundaries, JWT/JA4 cookie session isolation, IPv4/IPv6 SSRF & DNS-rebinding policies, weaponized PDF upload pipelines, and origin exposure.',
    icon: <Database className="w-5 h-5" aria-hidden />,
  },
  {
    title: 'Blue Team Edge Worker v5.1 & A+ Certification',
    body: 'Custom Cloudflare Worker v5.1 WAF rules, per-request cryptographic CSP nonces, <3KB Client RASP, Nginx/Vercel configs, and post-remediation verification.',
    icon: <Lock className="w-5 h-5" aria-hidden />,
  },
];

const BY_CONTRACT: readonly string[] = [
  'Mutual NDA and scoped Rules of Engagement (RoE) signed prior to assessment',
  'Executive & Technical Security Report with CVSS/OWASP Top 10:2025 severity matrix',
  'Production-ready remediation patches (Cloudflare Workers, Next.js middleware, Nginx/DNS)',
  'Post-remediation verification scan to confirm the fixes are in place',
];

interface TierRow {
  tier: string;
  price: string;
  scope: string;
  turnaround: string;
}

const TIER_ROWS: readonly TierRow[] = [
  {
    tier: `Free ${SCAN_CHECK_COUNT}-Point Recon`,
    price: '$0',
    scope: `Automated ${SCAN_CHECK_COUNT}-check passive scan with OWASP Top 10:2025 gates, a score and the full report with fix recommendations, free for the first ${FREE_SCANS_PER_DOMAIN} scans of each domain`,
    turnaround: 'Instant (< 10 seconds)',
  },
  {
    tier: FIX_PACK.label,
    price: `${FIX_PACK.starterPriceLabel} one-time per domain`,
    scope: `Cloudflare WAF rule, Cloudflare Worker, client-side RASP shield script, live badge snippet, white-label PDF report and unlimited re-scans for ${UNLOCK_DAYS} days`,
    turnaround: 'Instant upon checkout',
  },
  {
    tier: 'Enterprise Security Assessment',
    price: 'Custom Scope',
    scope: 'Red Team surface recon + API & Cloud Architecture Security Review + Blue Team edge WAF hardening',
    turnaround: '72 hours (under NDA)',
  },
];

export default function EnterprisePage() {
  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex flex-col selection:bg-cyan-500/30 selection:text-cyan-200">
      <Navbar />

      <main className="flex-1">
        <section className="relative pt-28 pb-20 md:pt-36 md:pb-24 overflow-hidden border-b border-white/[0.06]">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[350px] bg-gradient-to-tr from-emerald-600/15 via-cyan-500/15 to-indigo-600/10 blur-[130px] pointer-events-none rounded-full" />

          <div className="max-w-4xl mx-auto px-4 sm:px-6 relative z-10 space-y-8 text-center">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs font-mono font-semibold tracking-wider uppercase">
              <Building2 className="w-3.5 h-3.5 text-emerald-400" aria-hidden />
              Enterprise Cybersecurity &amp; Perimeter Engineering
            </div>

            <h1 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight leading-[1.1]">
              Red Team Recon, API Security &amp;{' '}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-300 via-cyan-300 to-indigo-300">
                Edge WAF Hardening.
              </span>
            </h1>

            <p className="text-base sm:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
              For SaaS platforms and production cloud infrastructures requiring deeper assurance than an automated scan:
              our security engineering team delivers full-scope perimeter assessments and production edge patches within
              72 hours.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
              <Link
                href="/enterprise/contact"
                className="w-full sm:w-auto"
              >
                <Button
                  variant="gradient"
                  className="w-full sm:w-auto text-sm font-bold py-4 px-8 shadow-xl shadow-cyan-500/20 cursor-pointer flex items-center justify-center gap-2"
                >
                  <Mail className="w-4 h-4" aria-hidden />
                  Request Custom Scope Brief
                  <ArrowRight className="w-4 h-4 ml-1" aria-hidden />
                </Button>
              </Link>
              <Link href="/scan" className="w-full sm:w-auto">
                <Button
                  variant="outline"
                  className="w-full sm:w-auto text-sm font-semibold py-4 px-7 border-white/15 text-slate-300 hover:bg-white/5 cursor-pointer flex items-center justify-center gap-2"
                >
                  <FileText className="w-4 h-4 text-cyan-400" aria-hidden />
                  Run Free 60-Point Surface Scan
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="py-20 max-w-6xl mx-auto px-4 sm:px-6 space-y-10">
          <div className="max-w-3xl space-y-3">
            <Badge variant="info" className="uppercase tracking-widest text-emerald-300 font-mono text-[10px]">
              3-Pillar Security Scope
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">What our engineering team audits</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {DELIVERABLES.map((item) => (
              <div key={item.title} className="p-7 rounded-3xl bg-[#0D1017] border border-white/[0.08] space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  {item.icon}
                </div>
                <h3 className="text-lg font-bold text-white">{item.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="pb-20 max-w-6xl mx-auto px-4 sm:px-6">
          <div className="p-7 rounded-3xl bg-[#0D1017] border border-emerald-500/20 space-y-4">
            <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-emerald-300">
              Included in every Enterprise Security Engagement
            </h2>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {BY_CONTRACT.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-slate-300 leading-relaxed">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="pb-24 max-w-6xl mx-auto px-4 sm:px-6 space-y-6">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">Security Tiers at a Glance</h2>
          <div className="border border-white/10 rounded-2xl overflow-x-auto bg-[#0b0d13]/80">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-[#10141f] text-slate-400 font-mono border-b border-white/10">
                <tr>
                  <th className="p-4">Tier</th>
                  <th className="p-4">Price</th>
                  <th className="p-4">Scope &amp; Deliverables</th>
                  <th className="p-4">Turnaround</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-slate-300">
                {TIER_ROWS.map((row) => (
                  <tr key={row.tier}>
                    <td className="p-4 font-semibold text-white">{row.tier}</td>
                    <td className="p-4 font-mono text-emerald-400">{row.price}</td>
                    <td className="p-4">{row.scope}</td>
                    <td className="p-4 font-mono text-cyan-300">{row.turnaround}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
