"use client";

import React from "react";
import Link from "next/link";
import { StealthMarkLogo } from "@/components/StealthMarkLogo";
import { Mail, Shield, ExternalLink } from "lucide-react";
import { CopyEmail } from "@/components/ui/copy-email";
import { useLanguage, type Language } from "@/context/LanguageContext";
import { EMAIL_TEMPLATES } from "@/lib/email-templates";
import { FIX_PACK } from "@/lib/offer";

export const ENGLISH_ONLY_NOTE: Record<Exclude<Language, "en">, string> = {
  es: "Documentación técnica y páginas legales están disponibles en inglés.",
  pt: "Documentação técnica e páginas legais estão disponíveis em inglês.",
};

export function Footer() {
  const { language } = useLanguage();
  const englishOnlyNote = language === "en" ? null : ENGLISH_ONLY_NOTE[language];

  return (
    <footer className="border-t border-white/10 bg-[#060709] px-4 sm:px-6 py-14 text-sm text-slate-400">
      <div className="max-w-6xl mx-auto space-y-12">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
          {/* Brand Col */}
          <div className="md:col-span-2 space-y-4">
            <div className="flex items-center gap-3">
              <StealthMarkLogo className="w-8 h-8" />
              <div>
                <span className="font-bold text-white text-lg">StealthMark</span>
                <span className="text-cyan-400 ml-2 text-xs font-mono">v5.1 Perimeter &amp; PDF CDR Security</span>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-400 max-w-sm leading-relaxed">
              60-point passive external perimeter reconnaissance, OWASP Top 10:2025 gates, Edge Worker v5.1 (JA4 Session Binding, Node2Shell CVE-2026-111497 Virtual Patch, Weaponized PDF CDR Inspector, Anti-SSRF IPv4/IPv6 &amp; SonicWall/Cisco/Ivanti 48h Gate), &lt;3KB Client RASP, and viral CLI (<code className="text-cyan-300 font-mono">npx @stealthmark/cli doctor</code> &amp; <code className="text-cyan-300 font-mono">pdf-check</code>) — ({FIX_PACK.label}: {FIX_PACK.starterPriceLabel} USD one-time per domain).
            </p>

            {englishOnlyNote && (
              <p className="text-xs text-amber-300/90 max-w-sm leading-relaxed">{englishOnlyNote}</p>
            )}
          </div>

          {/* Col 1: Platform & Solutions */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
              Platform
            </h4>
            <ul className="space-y-2 text-xs sm:text-sm">
              <li>
                <Link href="/" className="hover:text-white transition">
                  Home
                </Link>
              </li>
              <li>
                <Link href="/#auditor" className="hover:text-white transition">
                  60-Point Auditor
                </Link>
              </li>
              <li>
                <Link href="/#security-matrix" className="hover:text-white transition">
                  60-Point Matrix &amp; CVEs
                </Link>
              </li>
              <li>
                <Link href="/#pricing" className="hover:text-white transition">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/leaderboard" className="hover:text-white transition">
                  Security Leaderboard
                </Link>
              </li>
              <li>
                <Link href="/enterprise" className="hover:text-emerald-400 text-emerald-400/90 font-medium transition">
                  Enterprise Security
                </Link>
              </li>
              <li>
                <Link href="/trust" className="hover:text-cyan-300 transition">
                  Trust &amp; Methodology
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 2: Security & Docs */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
              Resources
            </h4>
            <ul className="space-y-2 text-xs sm:text-sm">
              <li>
                <Link href="/scan" className="hover:text-white transition">
                  60-Point Surface Scanner (/scan)
                </Link>
              </li>
              <li>
                <Link href="/docs" className="hover:text-white transition">
                  Security Documentation (/docs)
                </Link>
              </li>
              <li>
                <Link href="/#forensic-audit" className="hover:text-white transition">
                  Deep Forensic Audit
                </Link>
              </li>
              <li>
                <a
                  href="/.well-known/security.txt"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-white transition flex items-center gap-1.5 font-mono text-xs"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
                  <span>/.well-known/security.txt</span>
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/stealthmark-io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition flex items-center gap-1.5 font-mono text-xs text-slate-300"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
                  <span>GitHub Open-Source (@stealthmark-io)</span>
                </a>
              </li>
              <li>
                <a
                  href="https://www.linkedin.com/company/stealthmark-io/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition flex items-center gap-1.5 font-mono text-xs text-slate-300"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-sky-400" />
                  <span>LinkedIn Official Page</span>
                </a>
              </li>
            </ul>
          </div>

          {/* Col 3: Direct Contact & Support Desk */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
              Contact &amp; Security Desk
            </h4>
            <ul className="space-y-2.5 text-xs sm:text-sm font-mono">
              <li className="text-slate-300">
                <CopyEmail address={EMAIL_TEMPLATES.security.address} icon={<Shield className="w-3.5 h-3.5 text-indigo-400 shrink-0" />} />
              </li>
              <li className="text-slate-300">
                <CopyEmail address={EMAIL_TEMPLATES.support.address} icon={<Mail className="w-3.5 h-3.5 text-emerald-400 shrink-0" />} />
              </li>
            </ul>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/[0.08]" />

        {/* Bottom copyright & legal */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/terms" className="hover:text-slate-300 transition">
              Terms of Service
            </Link>
            <Link href="/privacy" className="hover:text-slate-300 transition">
              Privacy Policy
            </Link>
            <Link href="/refund" className="hover:text-slate-300 transition">
              Refund &amp; Cancellation
            </Link>
            <Link href="/trust" className="hover:text-slate-300 transition">
              Trust &amp; Security
            </Link>
          </div>
          <p className="text-center sm:text-right">
            Founded in 2026 &middot; &copy; 2026 StealthMark. Card payments: Merchant of Record Polar (polar.sh). All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
