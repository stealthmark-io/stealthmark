"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowRight, Globe, Search, Zap } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { CtaButtons } from "./Cta";

export function Hero() {
  const [domainInput, setDomainInput] = useState("");
  const { t } = useLanguage();
  const { hero } = t;
  const pills = [
    { title: hero.bento1Title, desc: hero.bento1Desc },
    { title: hero.bento2Title, desc: hero.bento2Desc },
    { title: hero.bento3Title, desc: hero.bento3Desc },
    { title: hero.bento4Title, desc: hero.bento4Desc },
  ];

  const triggerOrbPulse = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("vesper:pulse"));
    }
  };

  return (
    <section className="relative pt-12 sm:pt-20 px-4 sm:px-6 max-w-5xl mx-auto text-center space-y-8">
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-xs font-mono font-semibold text-cyan-300 backdrop-blur-md shadow-lg shadow-cyan-950/30">
          <Zap className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="tracking-wider uppercase">{hero.pill}</span>
        </div>
      </div>

      <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white leading-[1.08]">
        {hero.h1Part1}{" "}
        <span className="block mt-1 shimmer-gradient">{hero.h1Part2}</span>
      </h1>

      <p className="text-base sm:text-lg lg:text-xl text-slate-300/90 max-w-3xl mx-auto leading-relaxed font-normal">
        {hero.desc}
      </p>

      {/* Interactive Quick Domain Audit Bar */}
      <div className="max-w-xl mx-auto space-y-3 pt-2">
        <form
          action="/scan"
          method="GET"
          onFocus={triggerOrbPulse}
          className="flex flex-col sm:flex-row items-center gap-2 p-1.5 sm:p-2 rounded-2xl sm:rounded-full bg-[#0B0D14]/75 border border-cyan-500/30 shadow-2xl shadow-cyan-950/50 backdrop-blur-xl focus-within:border-[#4FFFB0]/60 focus-within:ring-2 focus-within:ring-[#4FFFB0]/20 transition-all"
        >
          <div className="flex items-center gap-2.5 px-3.5 py-1.5 w-full sm:flex-1 text-slate-400">
            <Globe className="w-4 h-4 text-cyan-400 shrink-0" />
            <input
              type="text"
              name="domain"
              value={domainInput}
              onChange={(e) => {
                setDomainInput(e.target.value);
                triggerOrbPulse();
              }}
              placeholder="Enter domain to audit (e.g. yoursite.com)"
              className="w-full bg-transparent text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none font-mono"
            />
          </div>
          <Button
            type="submit"
            variant="gradient"
            size="sm"
            className="w-full sm:w-auto rounded-full font-semibold px-5 py-2.5 shadow-lg shadow-cyan-500/20 text-xs sm:text-sm flex items-center justify-center gap-2 shrink-0 cursor-pointer"
          >
            <Search className="w-4 h-4 text-cyan-200" />
            <span>Audit Domain</span>
            <ArrowRight className="w-3.5 h-3.5 text-cyan-200" />
          </Button>
        </form>

        <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-400 font-mono">
          <span className="text-slate-500">Quick audit:</span>
          {["stealthmark.io", "openai.com", "anthropic.com"].map((target) => (
            <Link
              key={target}
              href={`/scan?domain=${encodeURIComponent(target)}`}
              onMouseEnter={triggerOrbPulse}
              className="px-2.5 py-0.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] hover:text-[#4FFFB0] border border-white/[0.08] transition cursor-pointer backdrop-blur-md"
            >
              {target}
            </Link>
          ))}
        </div>
      </div>

      <CtaButtons className="pt-2" />

      <ol className="pt-8 flex flex-col sm:flex-row items-stretch sm:items-start justify-center gap-2 sm:gap-1 max-w-4xl mx-auto text-left list-none">
        {pills.map((pill, i) => (
          <React.Fragment key={pill.title}>
            <li
              onMouseEnter={triggerOrbPulse}
              className="flex-1 bento-card px-4 py-3 rounded-2xl space-y-1 bg-[#0B0D14]/55 backdrop-blur-xl border border-white/[0.08] hover:border-[#4FFFB0]/35 transition-all"
            >
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-xs font-bold text-cyan-300 uppercase tracking-wider">
                {pill.title}
              </span>
              <p className="text-[11px] text-slate-400 leading-normal">{pill.desc}</p>
            </li>
            {i < pills.length - 1 && (
              <li aria-hidden="true" className="hidden sm:flex items-center self-center text-slate-600">
                <ArrowRight className="w-4 h-4" />
              </li>
            )}
          </React.Fragment>
        ))}
      </ol>
    </section>
  );
}
