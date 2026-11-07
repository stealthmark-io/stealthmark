"use client";

import Link from "next/link";
import { ArrowLeft, ExternalLink, Sparkles } from "lucide-react";
import { StealthMarkLogo } from "@/components/StealthMarkLogo";
import { Button } from "@/components/ui/button";
import type { AuthUser } from "@/lib/auth";
import { flags } from "@/lib/flags";
import { BillingQuotaChip } from "../components";
import type { UserPlan } from "./dashboard-helpers";
import { DefconBadge } from "./DefconBadge";
import { UserChip } from "./UserChip";

interface DashboardHeaderProps {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  defconLevel: number;
  userPlan: UserPlan;
  onManageBilling: () => void;
  onOpenSentinel: () => void;
  onSignIn: () => void;
  onLogout: () => void;
}

export function DashboardHeader({
  user,
  isAuthenticated,
  isSuperAdmin,
  defconLevel,
  userPlan,
  onManageBilling,
  onOpenSentinel,
  onSignIn,
  onLogout,
}: DashboardHeaderProps) {
  return (
    <header className="border-b border-white/[0.08] bg-[#060709]/90 backdrop-blur-xl sticky top-0 z-40 px-3 sm:px-6 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 shrink-0">
          <Link href="/" className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Landing</span>
          </Link>

          <div className="h-4 w-px bg-white/10" />

          <Link href="/" className="flex items-center gap-2 group">
            <StealthMarkLogo className="w-6 h-6 group-hover:scale-105 transition duration-200" />
            <span className="font-bold text-white text-sm sm:text-base tracking-tight">StealthMark</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-semibold hidden md:inline">
              Gateway Console
            </span>
          </Link>
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          {/* Synchronized DEFCON Shield Badge with Touchable Explanatory Popover */}
          {flags.defcon && <DefconBadge defconLevel={defconLevel} />}

          {/* Polar Subscription & Quota Chip */}
          <div className="hidden lg:block">
            <BillingQuotaChip
              usedTransactions={userPlan.usedTransactions}
              maxTransactions={userPlan.maxTransactions}
              planName={userPlan.planName}
              priceMonthly={userPlan.priceMonthly}
              status={userPlan.status}
              variant="compact"
              portalUrl={userPlan.portalUrl}
              isGuest={!isAuthenticated}
              onManageClick={onManageBilling}
              liveQuota
            />
          </div>

          {isSuperAdmin && (
            <Link href="/admin">
              <Button size="sm" variant="secondary" className="text-xs px-2.5 py-1 rounded-xl bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20 cursor-pointer flex items-center gap-1 font-mono font-bold">
                <span>👑 Founder</span>
              </Button>
            </Link>
          )}

          {flags.sentinel && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onOpenSentinel}
              className="text-xs px-2.5 py-1 rounded-xl bg-cyan-500/10 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 cursor-pointer flex items-center gap-1.5 font-mono font-bold"
              title="Launch In-Console AI Sentinel Copilot"
            >
              <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
              <span className="hidden sm:inline">AI Sentinel</span>
            </Button>
          )}

          <Link href="/docs">
            <Button size="sm" variant="ghost" className="text-xs inline-flex cursor-pointer">
              <span>Docs</span>
              <ExternalLink className="w-3.5 h-3.5 ml-1" />
            </Button>
          </Link>

          {isAuthenticated && user ? (
            <UserChip user={user} isSuperAdmin={isSuperAdmin} onLogout={onLogout} />
          ) : (
            <Button
              size="sm"
              variant="gradient"
              onClick={onSignIn}
              className="text-xs px-3.5 rounded-full cursor-pointer"
            >
              <span>Sign In</span>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
