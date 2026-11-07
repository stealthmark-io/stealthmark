'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  Lock,
  Database,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  ArrowRight,
  Code2,
  Fingerprint,
  Clock,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';
import { FIX_PACK } from '@/lib/offer';

const SECURITY_EMAIL = 'security@stealthmark.io';

const ENGINE_DOES: readonly string[] = [
  `Executes ${SCAN_CHECK_COUNT} non-intrusive external checks across TLS 1.2/1.3, DNS/SPF/DMARC/CAA, Shodan InternetDB open ports & CVEs, HTTP response headers, exposed dotfiles (/.env, /.git/HEAD), client JS bundles, and 2026 CVE signatures (including Node2Shell CVE-2026-111497, SonicWall SMA 1000, Cisco ASA CVE-2026-76418 & Ivanti CVE-2026-104935).`,
  'Maps every finding to the 10 passive gates of OWASP Top 10:2025 with verifiable HTTP/DNS evidence and issues HMAC-SHA256 x402 Counterparty Trust Receipts (/api/v2/trust-receipt).',
  'Generates stack-specific edge remediation code (Cloudflare Worker v5.1 with JA4 Session Binding, Anti-Node2Shell Brotli Guard, Static Binary PDF CDR Inspector, Anti-SSRF IPv4/IPv6 & 48h VPN Gate, plus <3KB Client RASP, Google Cloud Armor CEL/Terraform, Next.js CSP nonces, and Nginx configs) and board-ready PDF reports.',
  `Unlocks the ${FIX_PACK.label} for a domain (Cloudflare WAF rule, Cloudflare Worker, client-side RASP shield script, live badge snippet and white-label PDF report) for ${FIX_PACK.starterPriceLabel} one-time, and offers free CLI tooling (\`npx @stealthmark/cli doctor\` & \`pdf-check\`).`,
];

const ENGINE_DOES_NOT: readonly string[] = [
  'Never sends destructive, state-mutating, brute-force, or exploitation payloads against audited targets.',
  'Never accesses private internal networks: all scanner requests enforce strict DNS-resolution IP pinning and block RFC 1918, loopback, link-local, and cloud metadata ranges.',
  'Never stores or exfiltrates sensitive secret values found in public bundles—findings report the vector and masked pattern so you can rotate keys safely.',
  'Never requires installing agents, root certificates, or database credentials to run the public 60-point perimeter audit.',
];

const DATA_PROCESSED: readonly string[] = [
  'Publicly returned HTTP response headers, status codes, and TLS certificate metadata',
  'Public DNS records (A, AAAA, CNAME, TXT, SPF, DMARC, CAA, DNSSEC)',
  'Passively indexed open ports and CVEs from Shodan InternetDB',
  'Work email address (only when voluntarily provided, for example to receive alerts or an Enterprise proposal)',
];

const DATA_NEVER: readonly string[] = [
  'Private customer PII or end-user session cookies from your visitors',
  'Unmasked secret values or private keys',
  'Credit card numbers (all fiat checkouts are processed directly by Polar.sh / Stripe)',
];

const PRACTICES: readonly string[] = [
  'Our own domain (stealthmark.io) is continuously audited by our 60-point engine and maintains a verified Grade A+ (100/100 · 0 warnings · 0 failures).',
  'Per-request cryptographic CSP nonces with strict-dynamic, HSTS preload (max-age=63072000), X-Frame-Options DENY, and COOP/CORP isolation enforced on every response.',
  'Outbound auditor requests resolve DNS once, pin the validated public IP (blocking RFC 4291 IPv4-compatible IPv6, Teredo and FQDN trailing-dot targets) and reject XML ENTITY declarations.',
  'Semantic inspection normalizes text with Unicode NFKC, strips hidden zero-width and tag codepoints, and evaluates linear-time O(N) non-backtracking expressions.',
  'Webhook signatures (Polar HMAC / Svix) are cryptographically verified before unlocking any domain.',
  'Custom B2B perimeter & cloud security assessments are conducted under strict mutual NDA with encrypted deliverable handoff.',
];

function Bullets({ items, tone }: { items: readonly string[]; tone: 'yes' | 'no' | 'neutral' }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5 text-sm text-slate-300 leading-relaxed">
          {tone === 'yes' && <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" aria-hidden />}
          {tone === 'no' && <XCircle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" aria-hidden />}
          {tone === 'neutral' && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-2 shrink-0" aria-hidden />}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function SectionHeading({ icon, title, lead }: { icon: React.ReactNode; title: string; lead?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5 text-white">
        <span className="text-cyan-400">{icon}</span>
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">{title}</h2>
      </div>
      {lead && <p className="text-sm text-slate-400 leading-relaxed max-w-3xl">{lead}</p>}
    </div>
  );
}

export default function TrustPage() {
  const [copied, setCopied] = useState(false);

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(SECURITY_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#060709] text-slate-100 flex flex-col selection:bg-cyan-500/30 selection:text-cyan-200">
      <Navbar />

      <main className="flex-1 pt-24 pb-24 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto w-full space-y-16">
        <section className="space-y-5 max-w-3xl">
          <Badge variant="info" size="md">
            <ShieldCheck className="w-3.5 h-3.5" aria-hidden />
            Trust, Methodology &amp; Security Architecture
          </Badge>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white">
            How our {SCAN_CHECK_COUNT}-point scanner and forensic audits operate safely.
          </h1>
          <p className="text-base text-slate-400 leading-relaxed">
            StealthMark is built on verifiable, non-destructive reconnaissance and zero-trust edge engineering. This
            page states plainly how our scanner evaluates your perimeter, how our own infrastructure is hardened to
            Grade A+ (100/100), and how we handle sensitive forensic disclosures.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link href="/scan">
              <Button variant="primary" size="md">
                Run Free {SCAN_CHECK_COUNT}-Point Scan <ArrowRight className="w-4 h-4" aria-hidden />
              </Button>
            </Link>
            <Link href="/docs">
              <Button variant="outline" size="md">Read Security Docs</Button>
            </Link>
          </div>
        </section>

        <section className="space-y-6">
          <SectionHeading
            icon={<Code2 className="w-5 h-5" aria-hidden />}
            title="Non-Intrusive Reconnaissance Boundaries"
            lead="Our automated scanner inspects only publicly observable perimeter signals—zero exploitation, zero brute-forcing, and zero disruption to origin workloads."
          />
          <div className="grid gap-5 md:grid-cols-2">
            <Card variant="default" hoverEffect="none" className="p-6 space-y-4">
              <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-emerald-300">What the engine does</h3>
              <Bullets items={ENGINE_DOES} tone="yes" />
            </Card>
            <Card variant="default" hoverEffect="none" className="p-6 space-y-4">
              <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-rose-300">Strict safety boundaries</h3>
              <Bullets items={ENGINE_DOES_NOT} tone="no" />
            </Card>
          </div>
        </section>

        <section className="space-y-6">
          <SectionHeading
            icon={<Eye className="w-5 h-5" aria-hidden />}
            title="Data Inspected &amp; Privacy Guarantees"
            lead="We inspect only public domain posture metadata and never touch visitor PII."
          />
          <div className="grid gap-5 md:grid-cols-2">
            <Card variant="default" hoverEffect="none" className="p-6 space-y-4">
              <h3 className="flex items-center gap-2 text-sm font-mono font-bold uppercase tracking-wider text-cyan-300">
                <Eye className="w-4 h-4" aria-hidden /> Public signals inspected
              </h3>
              <Bullets items={DATA_PROCESSED} tone="neutral" />
            </Card>
            <Card variant="default" hoverEffect="none" className="p-6 space-y-4">
              <h3 className="flex items-center gap-2 text-sm font-mono font-bold uppercase tracking-wider text-rose-300">
                <EyeOff className="w-4 h-4" aria-hidden /> Never collected
              </h3>
              <Bullets items={DATA_NEVER} tone="no" />
            </Card>
          </div>
        </section>

        <section className="space-y-6">
          <SectionHeading
            icon={<Lock className="w-5 h-5" aria-hidden />}
            title="Our Own Hardening &amp; Engineering Controls"
            lead="We enforce the exact Grade A+ security controls on stealthmark.io that we audit on your domain."
          />
          <Card variant="default" hoverEffect="none" className="p-6">
            <Bullets items={PRACTICES} tone="yes" />
          </Card>
        </section>

        <section className="space-y-4 max-w-3xl">
          <SectionHeading
            icon={<ShieldCheck className="w-5 h-5" aria-hidden />}
            title="Responsible Disclosure &amp; Enterprise Security Contact"
            lead="To report a vulnerability (RFC 9116) or request a scoped B2B Perimeter &amp; Cloud Security Assessment under NDA, contact our security engineering team directly:"
          />
          <div className="flex flex-wrap items-center gap-3">
            <code className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 font-mono text-sm text-cyan-300 select-all">
              {SECURITY_EMAIL}
            </code>
            <Button variant="outline" size="sm" onClick={copyEmail} aria-label="Copy security contact address">
              {copied ? <Check className="w-4 h-4 text-emerald-400" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
