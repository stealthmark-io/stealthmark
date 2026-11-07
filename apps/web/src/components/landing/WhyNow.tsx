"use client";

import React from "react";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useLanguage } from "@/context/LanguageContext";
import { SectionHeading } from "./SectionHeading";

interface FlowProps {
  label: string;
  steps: string[];
  highlightLast?: boolean;
  firstNote?: string;
}

function Flow({ label, steps, highlightLast = false, firstNote }: FlowProps) {
  return (
    <Card variant={highlightLast ? "glow" : "default"} hoverEffect="none" className="p-5 sm:p-6 space-y-4">
      <div className="text-xs font-mono font-semibold tracking-widest uppercase text-slate-400">{label}</div>
      <ol className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 list-none">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          const accent = highlightLast && isLast;
          return (
            <React.Fragment key={step}>
              <li
                className={`px-3.5 py-2 rounded-xl border text-sm font-semibold ${
                  accent
                    ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                    : "border-white/10 bg-white/[0.04] text-slate-200"
                }`}
              >
                {step}
                {i === 0 && firstNote && (
                  <span className="block text-[11px] font-normal text-slate-400">{firstNote}</span>
                )}
              </li>
              {!isLast && (
                <li aria-hidden="true" className="flex justify-center text-slate-600">
                  <ArrowRight className="w-4 h-4 rotate-90 sm:rotate-0" />
                </li>
              )}
            </React.Fragment>
          );
        })}
      </ol>
    </Card>
  );
}

export function WhyNow() {
  const { t } = useLanguage();
  const copy = t.landing.whyNow;

  return (
    <section id="why-now" className="max-w-5xl mx-auto px-4 sm:px-6 space-y-8 scroll-mt-24">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} />
      <div className="grid md:grid-cols-2 gap-4">
        <Flow label={copy.traditionalLabel} steps={copy.traditionalFlow} />
        <Flow label={copy.agenticLabel} steps={copy.agenticFlow} highlightLast firstNote={copy.agentExamples} />
      </div>
      <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-3xl mx-auto text-center">{copy.body}</p>
    </section>
  );
}
