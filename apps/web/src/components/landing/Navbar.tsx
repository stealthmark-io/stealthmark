"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { StealthMarkLogo } from "@/components/StealthMarkLogo";
import { useLanguage, Language } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";

export function Navbar() {
  const { language, setLanguage, t } = useLanguage();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const languages: { code: Language; label: string }[] = [
    { code: "en", label: "EN" },
    { code: "es", label: "ES" },
    { code: "pt", label: "PT" },
  ];

  return (
    <div className="sticky top-0 z-50">
      <header className="border-b border-white/[0.08] bg-[#060709]/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex flex-nowrap items-center justify-between gap-4">
          <div className="flex flex-nowrap items-center gap-6 min-w-0">
            <Link href="/" className="flex items-center gap-2.5 group shrink-0 whitespace-nowrap">
              <div className="relative shrink-0">
                <StealthMarkLogo className="w-8 h-8 transition-transform duration-300 group-hover:scale-105" />
              </div>
              <span className="font-bold text-lg tracking-tight text-white whitespace-nowrap">
                StealthMark
              </span>
              <span className="hidden sm:inline-block text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/[0.04] text-cyan-300 border border-white/[0.10] font-semibold tracking-wider uppercase whitespace-nowrap shrink-0">
                v5.1
              </span>
            </Link>

            <nav className="hidden lg:flex flex-nowrap items-center gap-5 text-sm font-medium text-slate-400 shrink-0">
              <Link
                href="/scan"
                className="text-slate-200 hover:text-white transition flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                <span>{t.nav.scanner}</span>
              </Link>
              <Link
                href="/#forensic-audit"
                className="hover:text-white transition whitespace-nowrap shrink-0"
              >
                Forensics
              </Link>
              <Link
                href="/#research"
                className="text-emerald-300/90 hover:text-emerald-200 transition font-mono text-xs whitespace-nowrap shrink-0"
              >
                Advisories
              </Link>
              <Link
                href="/#pricing"
                className="hover:text-white transition whitespace-nowrap shrink-0"
              >
                {t.nav.pricing}
              </Link>
              <Link
                href="/leaderboard"
                className="hidden xl:inline-block hover:text-white transition whitespace-nowrap shrink-0"
              >
                Leaderboard
              </Link>
              <Link
                href="/docs"
                className="hover:text-white transition whitespace-nowrap shrink-0"
              >
                Docs
              </Link>
              <Link
                href="/trust"
                className="hidden xl:inline-block hover:text-white transition whitespace-nowrap shrink-0"
              >
                Trust
              </Link>
            </nav>
          </div>

          <div className="flex flex-nowrap items-center gap-2 sm:gap-2.5 shrink-0">
            {/* Typographic Monospace Language Switcher (Zero Emoji Flags) */}
            <div
              role="group"
              aria-label="Language selector"
              className="inline-flex flex-nowrap items-center rounded-md bg-white/[0.03] border border-white/[0.08] p-0.5 font-mono text-[11px] shrink-0"
            >
              {languages.map((lang) => {
                const active = language === lang.code;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => setLanguage(lang.code)}
                    className={`px-2 py-1 rounded transition cursor-pointer whitespace-nowrap shrink-0 ${
                      active
                        ? "bg-white/[0.10] text-white font-semibold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {lang.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-nowrap items-center gap-2 shrink-0">
              <Link
                href="/enterprise/contact"
                className="hidden xl:inline-flex items-center justify-center h-8 px-3 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.10] text-xs font-mono text-slate-200 transition whitespace-nowrap shrink-0"
              >
                Request Audit
              </Link>
              <Link href="/scan" className="shrink-0">
                <Button
                  size="sm"
                  variant="gradient"
                  className="rounded-md px-3.5 sm:px-4 text-xs font-semibold cursor-pointer text-white shadow-lg shadow-cyan-500/20 whitespace-nowrap shrink-0"
                >
                  Run 60-Pt Scan
                </Button>
              </Link>

              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Toggle mobile menu"
                aria-expanded={mobileMenuOpen}
                className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 transition cursor-pointer shrink-0"
              >
                {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-white/10 bg-[#080a0f]/95 backdrop-blur-2xl px-4 py-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-150">
            <nav className="grid grid-cols-2 gap-2 text-xs font-medium text-slate-300">
              <Link
                href="/scan"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-md bg-white/[0.04] border border-white/[0.08] text-white font-semibold flex items-center gap-1.5"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                {t.nav.scanner}
              </Link>
              <Link
                href="/#forensic-audit"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-md hover:bg-white/5 text-slate-200 transition"
              >
                Forensics
              </Link>
              <Link
                href="/#research"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-md hover:bg-white/5 text-emerald-300 font-mono transition"
              >
                Advisories &amp; CVEs
              </Link>
              <Link
                href="/#pricing"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-md hover:bg-white/5 hover:text-white transition"
              >
                {t.nav.pricing}
              </Link>
              <Link
                href="/leaderboard"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-md hover:bg-white/5 text-slate-200 transition"
              >
                Leaderboard
              </Link>
              <Link
                href="/docs"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-md hover:bg-white/5 text-slate-200 transition"
              >
                Docs
              </Link>
              <Link
                href="/trust"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-md hover:bg-white/5 text-slate-200 transition"
              >
                Trust &amp; Security
              </Link>
              <Link
                href="/enterprise/contact"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-md bg-white/[0.04] border border-white/[0.08] text-slate-200 font-mono"
              >
                Request Audit
              </Link>
            </nav>
          </div>
        )}
      </header>
    </div>
  );
}
