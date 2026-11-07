"use client";

import React, { useState } from "react";
import { Calculator, Coins } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CREDIT_PACKS, pricePer1k, type CreditPack } from "@/lib/polar-products";

export const FREE_MONTHLY_EVENTS = 250;
export const CREDIT_VALIDITY_MONTHS = 12;

export interface PackCoverage {
  pack: CreditPack;
  /** How many months the credits last at the given monthly volume (not capped by validity). */
  months: number;
  /** True when the pack outlasts its 12 month validity, so part of it would expire unused. */
  outlastsValidity: boolean;
  /** Pack price divided by the months it is actually used, capped by the validity window. */
  usdPerMonth: number;
}

export function packCoverage(monthlyEvents: number, pack: CreditPack): PackCoverage {
  const volume = Math.max(1, Math.floor(monthlyEvents));
  const months = pack.credits / volume;
  const usedMonths = Math.min(months, CREDIT_VALIDITY_MONTHS);
  return {
    pack,
    months,
    outlastsValidity: months > CREDIT_VALIDITY_MONTHS,
    usdPerMonth: pack.priceUsd / usedMonths,
  };
}

function formatMonths(coverage: PackCoverage): string {
  if (coverage.outlastsValidity) return `${CREDIT_VALIDITY_MONTHS}+ months (credits expire after 12)`;
  return `${coverage.months.toFixed(1)} months`;
}

export function RoiCalculator() {
  const [monthlyEvents, setMonthlyEvents] = useState<number>(10_000);
  const coverages = CREDIT_PACKS.map((pack) => packCoverage(monthlyEvents, pack));
  const freeCovers = monthlyEvents <= FREE_MONTHLY_EVENTS;

  return (
    <section id="calculator" className="max-w-5xl mx-auto px-4 sm:px-6 py-14 space-y-8 scroll-mt-24">
      <div className="text-center max-w-xl mx-auto space-y-2">
        <Badge variant="info" className="uppercase tracking-wider">
          <Calculator className="w-3.5 h-3.5 mr-1 text-cyan-400" />
          <span>Credit estimator</span>
        </Badge>
        <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">How far do credits go?</h2>
        <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
          Pick how many AI agent requests your site gets in a month. This is plain arithmetic on the public pack
          prices, not a savings claim.
        </p>
      </div>

      <div className="bento-card p-6 sm:p-10 rounded-3xl border border-white/10 space-y-8 max-w-4xl mx-auto">
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <label htmlFor="requests-slider" className="text-sm font-semibold text-white">
              AI agent requests per month:
            </label>
            <span className="text-2xl font-bold font-mono text-cyan-300">
              {monthlyEvents.toLocaleString("en-US")} <span className="text-xs font-normal text-slate-400">events/mo</span>
            </span>
          </div>

          <input
            id="requests-slider"
            type="range"
            min={250}
            max={1000000}
            step={250}
            value={monthlyEvents}
            onChange={(e) => setMonthlyEvents(Number(e.target.value))}
            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />

          <div className="flex justify-between text-[11px] font-mono text-slate-500">
            <span>250</span>
            <span>50,000</span>
            <span>250,000</span>
            <span>1,000,000</span>
          </div>
        </div>

        {freeCovers && (
          <div className="p-4 rounded-2xl bg-emerald-950/20 border border-emerald-500/30 text-xs text-emerald-200">
            The free tier includes {FREE_MONTHLY_EVENTS.toLocaleString("en-US")} agent events a month, so this volume
            costs $0.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {coverages.map((coverage) => (
            <div
              key={coverage.pack.pack}
              data-testid={`coverage-${coverage.pack.pack}`}
              className="p-5 rounded-2xl bg-cyan-950/20 border border-cyan-500/20 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-cyan-400 font-mono">
                  {coverage.pack.name}
                </span>
                <span className="text-[11px] font-semibold text-slate-300">${coverage.pack.priceUsd} one-time</span>
              </div>
              <div className="space-y-1.5 pt-2 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">Credits:</span>
                  <span className="font-mono font-bold text-cyan-200">
                    {coverage.pack.credits.toLocaleString("en-US")}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">Price per 1k:</span>
                  <span className="font-mono font-bold text-cyan-200">${pricePer1k(coverage.pack)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">Lasts:</span>
                  <span className="font-mono font-bold text-cyan-200 text-right">{formatMonths(coverage)}</span>
                </div>
                <div className="flex justify-between gap-2 pt-2 border-t border-white/[0.06]">
                  <span className="text-slate-300 font-medium">Effective cost:</span>
                  <span className="font-mono font-extrabold text-sm text-emerald-400">
                    ${coverage.usdPerMonth.toFixed(2)} / mo
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-start gap-2 text-[11px] text-slate-400 font-mono">
          <Coins className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>
            1 credit = 1 agent event. Human visits and blocked requests are never charged. Credits are valid for 12
            months from purchase.
          </span>
        </div>
      </div>
    </section>
  );
}
