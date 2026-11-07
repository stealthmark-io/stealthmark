"use client";

import { useId, useState } from "react";
import { ChevronDown, Lock } from "lucide-react";
import type { ActiveShield } from "./types";

interface ShieldsGridProps {
  shields: ActiveShield[];
  /** Starts with the details open; the console keeps them closed until the reader asks for them. */
  defaultExpanded?: boolean;
}

function statusDotClass(status: string): string {
  if (status === "Active") return "bg-emerald-400";
  if (status === "Default") return "bg-cyan-400";
  return "bg-slate-500";
}

/** Counts per status ("3 active · 1 default · 2 available"), so options that are not enabled are not counted as things the SDK does. */
function statusSummary(shields: ActiveShield[]): string {
  const counts = new Map<string, number>();
  for (const shield of shields) counts.set(shield.status, (counts.get(shield.status) ?? 0) + 1);
  return [...counts].map(([status, count]) => `${count} ${status.toLowerCase()}`).join(" · ");
}

export function ShieldsGrid({ shields, defaultExpanded = false }: ShieldsGridProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const headingId = useId();
  const panelId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl bg-[#0d1017]/80 border border-white/[0.08]"
      data-testid="sdk-behaviors"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <h3 id={headingId} className="w-full sm:w-auto text-sm font-bold text-white tracking-tight">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded((open) => !open)}
            className="flex w-full sm:w-auto items-center gap-2 -mx-1.5 px-1.5 py-0.5 rounded-lg cursor-pointer hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            <Lock className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">What the SDK does</span>
            <span className="text-xs font-mono font-normal text-slate-400 whitespace-nowrap">{statusSummary(shields)}</span>
            <span className="ml-auto sm:ml-2 inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-mono font-normal text-cyan-300" aria-hidden="true">
              {expanded ? "Hide details" : "Show details"}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
            </span>
          </button>
        </h3>

        {!expanded && (
          <ul className="flex flex-wrap items-center gap-1.5" aria-label="SDK behaviors">
            {shields.map((shield) => (
              <li
                key={shield.id}
                className="inline-flex items-center gap-1.5 text-[11px] font-mono text-slate-300 bg-white/[0.04] px-2 py-0.5 rounded-full border border-white/10"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass(shield.status)}`} aria-hidden="true" />
                {shield.name}
                <span className="text-slate-400">· {shield.status.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div id={panelId} hidden={!expanded}>
        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 p-3 border-t border-white/[0.06]">
          {shields.map((shield) => (
            <li key={shield.id} className="rounded-xl bg-white/[0.02] border border-white/[0.06] px-3 py-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-white font-mono">{shield.name}</span>
                <span className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-300">
                  <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass(shield.status)}`} aria-hidden="true" />
                  {shield.status}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">{shield.desc}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
