"use client";

import React from "react";
import { Coins, Fingerprint, Plug } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/context/LanguageContext";
import { SectionHeading } from "./SectionHeading";

export function Roadmap() {
  const { t } = useLanguage();
  const copy = t.landing.roadmap;
  const steps = [
    { step: copy.identity, icon: <Fingerprint className="w-5 h-5" /> },
    { step: copy.capabilities, icon: <Plug className="w-5 h-5" /> },
    { step: copy.payments, icon: <Coins className="w-5 h-5" /> },
  ];

  return (
    <section id="roadmap" className="max-w-5xl mx-auto px-4 sm:px-6 space-y-8 scroll-mt-24">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />
      <ol className="grid md:grid-cols-3 gap-4 list-none">
        {steps.map(({ step, icon }, i) => (
          <li key={step.name}>
            <Card variant="bordered" hoverEffect="none" className="p-5 h-full space-y-3 border-dashed">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 text-cyan-400">
                  {icon}
                  <span className="text-xs font-mono text-slate-500">{i + 1}</span>
                </div>
                <Badge variant="warning">{copy.tag}</Badge>
              </div>
              <h3 className="text-lg font-bold text-white">{step.name}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{step.desc}</p>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}
