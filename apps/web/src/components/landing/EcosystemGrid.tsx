"use client";

import React from "react";
import { Database, Receipt, Server } from "lucide-react";
import { IntegrationIcon } from "@/components/IntegrationIcon";

interface Integration {
  name: string;
  role: string;
  icon: React.ReactNode;
}

const INTEGRATIONS: Integration[] = [
  { name: "Next.js", role: "Middleware adapter: @stealthmark/next", icon: <IntegrationIcon id="nextjs" /> },
  {
    name: "Express",
    role: "Middleware adapter: @stealthmark/express",
    icon: (
      <IntegrationIcon>
        <Server className="w-5 h-5 text-slate-300" />
      </IntegrationIcon>
    ),
  },
  { name: "Fastify", role: "Served by the Express adapter", icon: <IntegrationIcon id="fastify" /> },
  { name: "Vercel", role: "Hosts the Next.js app where the middleware runs", icon: <IntegrationIcon id="vercel" /> },
  {
    name: "Supabase",
    role: "Authentication and data behind the console",
    icon: (
      <IntegrationIcon>
        <Database className="w-5 h-5 text-emerald-400" />
      </IntegrationIcon>
    ),
  },
  {
    name: "Polar",
    role: "Checkout and receipts for prepaid credits",
    icon: (
      <IntegrationIcon>
        <Receipt className="w-5 h-5 text-cyan-400" />
      </IntegrationIcon>
    ),
  },
];

export function EcosystemGrid() {
  return (
    <section id="runtimes" className="max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-24">
      <div className="bento-card p-6 sm:p-10 rounded-3xl border border-white/10 bg-[#0d1017]/85 backdrop-blur-xl shadow-2xl space-y-8">
        <div className="text-center space-y-2 max-w-xl mx-auto">
          <div className="text-xs font-mono font-semibold tracking-widest text-cyan-400 uppercase">Works with</div>
          <h3 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Frameworks and services behind StealthMark
          </h3>
        </div>

        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 list-none">
          {INTEGRATIONS.map((item) => (
            <li
              key={item.name}
              className="flex items-center gap-3.5 p-4 rounded-2xl bg-[#0d1017] border border-white/[0.08]"
            >
              {item.icon}
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">{item.name}</div>
                <div className="text-xs text-slate-400">{item.role}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
