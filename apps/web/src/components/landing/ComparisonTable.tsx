'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Check, X, Minus, FileText, ShieldAlert, BarChart3, Sparkles } from 'lucide-react';

type Support = 'yes' | 'partial' | 'no';

interface Cell {
  support: Support;
  text: string;
}

interface ComparisonRow {
  feature: string;
  logs: Cell;
  cdn: Cell;
  analytics: Cell;
  stealthmark: Cell;
}

const ROWS: readonly ComparisonRow[] = [
  {
    feature: 'Sees declared AI agents',
    logs: { support: 'partial', text: 'Yes, if you write and maintain the User-Agent patterns yourself' },
    cdn: { support: 'partial', text: 'Often, on traffic that goes through that CDN' },
    analytics: { support: 'no', text: 'Usually not: page-tag analytics do not run for crawlers that skip JavaScript' },
    stealthmark: { support: 'yes', text: 'Yes: GPTBot, ClaudeBot, PerplexityBot and other agents that declare themselves' },
  },
  {
    feature: 'Per-agent view',
    logs: { support: 'partial', text: 'Only with your own queries and dashboards' },
    cdn: { support: 'partial', text: 'Depends on the vendor and the plan' },
    analytics: { support: 'no', text: 'Rarely: bots are filtered out or lumped together' },
    stealthmark: { support: 'yes', text: 'Requests, blocked attempts (recorded up to 500 per hour per organization), last seen and top pages for each agent' },
  },
  {
    feature: 'Observe / manifest / block policy',
    logs: { support: 'no', text: 'No: logs record, they cannot act' },
    cdn: { support: 'partial', text: 'Allow and block rules, set in the CDN dashboard' },
    analytics: { support: 'no', text: 'No: analytics only report' },
    stealthmark: { support: 'yes', text: 'Choose per site: observe, serve an agent manifest, or return a 403' },
  },
  {
    feature: 'Works on any host',
    logs: { support: 'yes', text: 'Yes: wherever you can read the logs' },
    cdn: { support: 'no', text: 'Only on traffic served through that one CDN' },
    analytics: { support: 'yes', text: 'Yes: a script tag works anywhere' },
    stealthmark: { support: 'yes', text: 'Any host that runs your Next.js, Express or Fastify app' },
  },
  {
    feature: 'Pricing',
    logs: { support: 'yes', text: 'Free, plus your time and log storage' },
    cdn: { support: 'partial', text: 'Included in, or an add-on to, the CDN plan' },
    analytics: { support: 'partial', text: 'Free or a monthly subscription' },
    stealthmark: { support: 'yes', text: '250 agent events free every month, then prepaid credits with no subscription' },
  },
  {
    feature: 'SDK license',
    logs: { support: 'no', text: 'Not applicable' },
    cdn: { support: 'no', text: 'Closed, managed by the vendor' },
    analytics: { support: 'partial', text: 'Varies by product' },
    stealthmark: { support: 'yes', text: 'Apache-2.0 SDK: detection runs inside your own app' },
  },
  {
    feature: 'Agents that pose as a normal browser',
    logs: { support: 'no', text: 'No: nothing in the request says it is an agent' },
    cdn: { support: 'partial', text: 'Bot-management tiers try to catch them; that is their strength' },
    analytics: { support: 'no', text: 'No' },
    stealthmark: { support: 'no', text: 'No: only agents that identify themselves are recognized' },
  },
];

function SupportIcon({ support, accent }: { support: Support; accent: string }) {
  if (support === 'yes') {
    return <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-label="Yes" />;
  }
  if (support === 'partial') {
    return <Minus className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${accent}`} aria-label="Partly" />;
  }
  return <X className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" aria-label="No" />;
}

function AlternativeCell({ cell, accent }: { cell: Cell; accent: string }) {
  return (
    <td className="p-4 sm:p-5 text-slate-400 text-xs">
      <div className="flex items-start gap-1.5">
        <SupportIcon support={cell.support} accent={accent} />
        <span>{cell.text}</span>
      </div>
    </td>
  );
}

export function ComparisonTable() {
  return (
    <section id="comparison" className="max-w-6xl mx-auto px-4 sm:px-6 space-y-8 py-14 scroll-mt-24 relative">
      <div id="benchmark" className="absolute -top-24 pointer-events-none" />
      <div className="text-center max-w-2xl mx-auto space-y-3">
        <Badge variant="info" className="uppercase tracking-widest text-[10px] font-mono text-cyan-300">
          How it compares
        </Badge>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          StealthMark vs. the tools you already have
        </h2>
        <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
          Your logs, your CDN and your analytics each cover part of the picture. StealthMark covers one thing: which AI
          agents declare themselves on your site, and what you let them do.
        </p>
      </div>

      <div className="bento-card rounded-3xl overflow-hidden border border-white/10 bg-[#0d1017]/85 backdrop-blur-xl shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm min-w-[960px]">
            <thead>
              <tr className="border-b border-white/10 bg-[#090c13]">
                <th className="p-4 sm:p-5 font-semibold text-slate-400 w-[16%]">Capability</th>
                <th className="p-4 sm:p-5 font-semibold text-amber-300/90 w-[21%]">
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Grep your logs</span>
                  </div>
                  <span className="block text-[10px] text-slate-500 font-mono font-normal mt-0.5">
                    Server or CDN access logs
                  </span>
                </th>
                <th className="p-4 sm:p-5 font-semibold text-rose-300/90 w-[21%]">
                  <div className="flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>CDN bot rules</span>
                  </div>
                  <span className="block text-[10px] text-slate-500 font-mono font-normal mt-0.5">
                    Your CDN&apos;s bot and crawler controls
                  </span>
                </th>
                <th className="p-4 sm:p-5 font-semibold text-indigo-300/90 w-[21%]">
                  <div className="flex items-center gap-1.5">
                    <BarChart3 className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span>Generic analytics</span>
                  </div>
                  <span className="block text-[10px] text-slate-500 font-mono font-normal mt-0.5">
                    Page-tag web analytics
                  </span>
                </th>
                <th className="p-4 sm:p-5 font-bold text-white bg-cyan-950/30 border-l border-cyan-500/30 w-[21%]">
                  <div className="flex items-center gap-1.5 text-cyan-300">
                    <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span>StealthMark</span>
                  </div>
                  <span className="block text-[10px] text-emerald-400 font-mono font-semibold mt-0.5">
                    Agent visibility and policy
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] text-slate-300">
              {ROWS.map((row) => (
                <tr key={row.feature} className="hover:bg-white/[0.02] transition">
                  <td className="p-4 sm:p-5 font-semibold text-white">{row.feature}</td>
                  <AlternativeCell cell={row.logs} accent="text-amber-400" />
                  <AlternativeCell cell={row.cdn} accent="text-rose-300" />
                  <AlternativeCell cell={row.analytics} accent="text-indigo-300" />
                  <td className="p-4 sm:p-5 text-cyan-200 text-xs font-medium bg-cyan-950/15 border-l border-cyan-500/30">
                    <div className="flex items-start gap-1.5">
                      <SupportIcon support={row.stealthmark.support} accent="text-cyan-300" />
                      <span>{row.stealthmark.text}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-center text-[11px] text-slate-500 max-w-2xl mx-auto leading-relaxed">
        Comparison is qualitative and describes the general category, not a specific product. Check your own CDN and
        analytics vendor for what they offer today.
      </p>
    </section>
  );
}
