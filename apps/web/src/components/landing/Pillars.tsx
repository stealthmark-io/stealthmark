"use client";

import React from "react";
import { Eye, FileJson, Radar, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/context/LanguageContext";
import { SectionHeading } from "./SectionHeading";

export function Pillars() {
  const { t } = useLanguage();
  const copy = t.landing.pillars;
  const ladder = [
    { level: copy.declared, shipped: true },
    { level: copy.verified, shipped: false },
    { level: copy.signed, shipped: false },
  ];
  const policies = [
    { name: "observe", desc: copy.policyObserve, isDefault: true },
    { name: "manifest", desc: copy.policyManifest, isDefault: false },
    { name: "block", desc: copy.policyBlock, isDefault: false },
  ];

  return (
    <section id="pillars" className="max-w-6xl mx-auto px-4 sm:px-6 space-y-8 scroll-mt-24">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

      <div className="grid sm:grid-cols-2 gap-4">
        <Card hoverEffect="none" className="p-6 space-y-4">
          <PillarHead icon={<Radar className="w-5 h-5" />} name={copy.detect.name} question={copy.detect.question} />
          <p className="text-sm text-slate-300 leading-relaxed">{copy.detect.desc}</p>
          <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-2">
            <div className="text-[11px] font-mono font-semibold uppercase tracking-widest text-slate-400">
              {copy.ladderTitle}
            </div>
            <ul className="space-y-1.5 list-none">
              {ladder.map(({ level, shipped }) => (
                <li key={level.name} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-slate-200">
                    <span className="font-semibold text-white">{level.name}</span>
                    <span className="text-slate-400"> · {level.how}</span>
                  </span>
                  <Badge variant={shipped ? "success" : "neutral"} className="shrink-0">
                    {level.status}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card hoverEffect="none" className="p-6 space-y-4">
          <PillarHead icon={<Eye className="w-5 h-5" />} name={copy.observe.name} question={copy.observe.question} />
          <p className="text-sm text-slate-300 leading-relaxed">{copy.observe.desc}</p>
        </Card>

        <Card hoverEffect="none" className="p-6 space-y-4">
          <PillarHead
            icon={<ShieldCheck className="w-5 h-5" />}
            name={copy.authorize.name}
            question={copy.authorize.question}
          />
          <p className="text-sm text-slate-300 leading-relaxed">{copy.authorize.desc}</p>
          <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-2">
            <div className="text-[11px] font-mono font-semibold uppercase tracking-widest text-slate-400">
              {copy.policiesTitle}
            </div>
            <ul className="space-y-1.5 list-none">
              {policies.map((policy) => (
                <li key={policy.name} className="text-xs text-slate-300">
                  <code className="font-mono font-semibold text-cyan-300">{policy.name}</code>
                  {policy.isDefault && <span className="text-slate-500"> ({copy.defaultTag})</span>}
                  <span className="text-slate-400"> · {policy.desc}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card hoverEffect="none" className="p-6 space-y-4">
          <PillarHead
            icon={<FileJson className="w-5 h-5" />}
            name={copy.manifest.name}
            question={copy.manifest.question}
          />
          <p className="text-sm text-slate-300 leading-relaxed">{copy.manifest.desc}</p>
        </Card>
      </div>
    </section>
  );
}

interface PillarHeadProps {
  icon: React.ReactNode;
  name: string;
  question: string;
}

function PillarHead({ icon, name, question }: PillarHeadProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0">
        {icon}
      </div>
      <div>
        <h3 className="text-lg font-bold text-white leading-tight">{name}</h3>
        <div className="text-xs text-slate-400">{question}</div>
      </div>
    </div>
  );
}
