"use client";

import React from "react";
import {
  Navbar,
  CybersecurityAuditTiers,
  EnterpriseForensicCard,
  Footer,
} from "@/components/landing";

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#060709] text-slate-100 flex flex-col selection:bg-cyan-500/30 selection:text-white relative bg-grid-pattern overflow-x-hidden">
      {/* Ambient Radial Glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] ambient-glow-purple pointer-events-none" />
      <div className="absolute top-24 left-1/2 -translate-x-1/2 w-[600px] h-[300px] ambient-glow-cyan pointer-events-none" />

      {/* Navbar */}
      <Navbar />

      {/* Main Body */}
      <main className="flex-1 pt-12 pb-24 relative z-10 space-y-16">
        <CybersecurityAuditTiers />
        <EnterpriseForensicCard />
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
