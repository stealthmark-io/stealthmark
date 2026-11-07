"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/LanguageContext";

export function CtaButtons({ className = "" }: { className?: string }) {
  const { t } = useLanguage();

  return (
    <div className={`flex flex-col sm:flex-row items-center justify-center gap-3.5 ${className}`}>
      <Link href="/dashboard" className="w-full sm:w-auto">
        <Button
          size="lg"
          variant="gradient"
          className="w-full sm:w-auto rounded-full shadow-xl shadow-cyan-600/25 text-base px-7 cursor-pointer"
        >
          <Zap className="w-4 h-4 text-cyan-300 shrink-0" />
          <span>{t.landing.cta.primary}</span>
          <ArrowRight className="w-4 h-4 text-cyan-200 shrink-0" />
        </Button>
      </Link>

      <Link href="/docs" className="w-full sm:w-auto">
        <Button
          size="lg"
          variant="secondary"
          className="w-full sm:w-auto rounded-full text-base px-6 border-white/15 hover:border-cyan-500/40 hover:bg-white/10 cursor-pointer text-slate-200"
        >
          <BookOpen className="w-4 h-4 text-slate-400 shrink-0" />
          <span>{t.landing.cta.secondary}</span>
        </Button>
      </Link>
    </div>
  );
}

export function Cta() {
  const { t } = useLanguage();

  return (
    <section className="max-w-4xl mx-auto px-4 sm:px-6 text-center py-12">
      <div className="p-8 sm:p-14 rounded-3xl border border-cyan-500/30 bg-gradient-to-b from-cyan-950/30 via-[#0e0a1c] to-[#080612] space-y-6 backdrop-blur-2xl shadow-[0_0_60px_rgba(0,210,254,0.15)]">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
          {t.landing.cta.closingTitle}
        </h2>
        <p className="text-sm sm:text-base text-slate-300 max-w-2xl mx-auto leading-relaxed">
          {t.landing.cta.closingDesc}
        </p>
        <CtaButtons className="pt-2" />
      </div>
    </section>
  );
}
