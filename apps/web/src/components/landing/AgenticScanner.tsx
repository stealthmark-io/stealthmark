'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight, Download, Send, LayoutList } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code-block';
import { useLanguage } from '@/context/LanguageContext';

const TEST_COMMAND = `curl -i -A "GPTBot/1.1" https://your-site.com/
# the response includes:
# x-stealthmark-agent-detected: true`;

export function AgenticScanner() {
  const { t } = useLanguage();
  const s = t.scanner;

  const steps = [
    { icon: Download, title: s.installTitle, desc: s.installDesc },
    { icon: Send, title: s.testTitle, desc: s.testDesc },
    { icon: LayoutList, title: s.seeTitle, desc: s.seeDesc },
  ];

  const consoleColumns = [s.metrics.payload, s.metrics.tokens, s.metrics.waste, s.metrics.waf];

  return (
    <section id="scanner" className="max-w-4xl mx-auto px-4 sm:px-6 space-y-8 py-12 scroll-mt-24">
      <div className="text-center space-y-3">
        <Badge variant="info" className="uppercase tracking-widest text-cyan-300 font-mono text-[10px]">
          {s.badge}
        </Badge>
        <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight">{s.title}</h2>
        <p className="text-xs sm:text-sm text-slate-400 max-w-xl mx-auto leading-relaxed font-sans">{s.subtitle}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 text-left">
        {steps.map(({ icon: Icon, title, desc }, index) => (
          <div key={title} className="bento-card p-5 rounded-2xl space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <Icon className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-mono text-slate-500">0{index + 1}</span>
            </div>
            <div className="text-xs font-bold text-white uppercase tracking-wider">{title}</div>
            <p className="text-[11px] text-slate-400 leading-normal">{desc}</p>
          </div>
        ))}
      </div>

      <CodeBlock code={TEST_COMMAND} language="bash" title="Terminal" />

      <div className="p-5 rounded-2xl bg-[#0d1017]/85 border border-white/10 space-y-3 text-left">
        <div className="text-xs font-mono font-bold uppercase text-slate-300">{s.columnsTitle}</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {consoleColumns.map((label) => (
            <div key={label} className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
              <div className="text-xs font-bold font-mono text-cyan-300">{label}</div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">{s.limits}</p>
      </div>

      <div className="flex flex-col items-center gap-4">
        <Link href="/docs">
          <Button variant="gradient" className="rounded-full px-6 text-sm cursor-pointer">
            <span>{s.btnDocs}</span>
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        </Link>
        <p className="text-[10px] text-slate-500 font-mono text-center max-w-xl leading-relaxed">{s.safeHarbor}</p>
      </div>
    </section>
  );
}
