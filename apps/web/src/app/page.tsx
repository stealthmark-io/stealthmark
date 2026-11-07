import React from "react";
import type { Metadata } from "next";
import {
  Navbar,
  CybersecurityHero,
  ActiveShieldPainCards,
  MarqueeEcosystem,
  AuditorShowcase,
  Footer,
  DefconShieldCards,
  EnterpriseForensicCard,
  CybersecurityAuditTiers,
} from "@/components/landing";
import { VesperStage } from "@/components/canvas/VesperStage";
import { StealthMascot } from "@/components/StealthMascot";
import { StealthMarkV5FeatureGrid } from "@/components/landing/StealthMarkV5FeatureGrid";
import { SecurityResearchAdvisories } from "@/components/landing/SecurityResearchAdvisories";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function StealthMarkLanding() {
  return (
    <div className="min-h-screen bg-transparent text-slate-100 flex flex-col selection:bg-cyan-500/30 selection:text-white relative overflow-x-hidden">
      {/* Vesper Spatial 3D WebGL Layer (65,000 GPU particles: Orb -> Spiral Galaxy -> Brain Cortex on scroll) */}
      <VesperStage />

      <div className="relative z-10 flex flex-col min-h-screen">
        <Navbar />

        <main className="flex-1 space-y-20 sm:space-y-28 pb-24 relative z-10">
          <CybersecurityHero />
          <SecurityResearchAdvisories />
          <StealthMarkV5FeatureGrid />
          <ActiveShieldPainCards />
          <AuditorShowcase />
          <EnterpriseForensicCard />
          <CybersecurityAuditTiers />
          <DefconShieldCards />
          <MarqueeEcosystem />
        </main>

        <Footer />
      </div>

      <StealthMascot variant="floating" />
    </div>
  );
}
