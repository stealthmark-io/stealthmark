'use client';

import React, { useState } from 'react';
import {
  CreditCard,
  Building2,
  Shield,
  ExternalLink,
  Sparkles,
  Globe,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TouchableTooltip } from '@/components/ui/tooltip';
import { ClaimWhitelistModal } from '@/components/landing/ClaimWhitelistModal';
import type { AuthUser } from '@/lib/auth';
import { CREDIT_PACKS, pricePer1k } from '@/lib/polar-products';
import { useQuota } from '../views/useQuota';
import { TIER_CAPS } from '../views/dashboard-helpers';

const PLAN_LABELS: Record<string, string> = {
  free: 'Free plan',
  developer: 'Free plan',
  pro: 'Legacy Pro',
  business: 'Legacy Business',
  enterprise: 'Enterprise',
  scale: 'Scale (250k)',
  growth: 'Growth (60k)',
  starter: 'Starter (15k)',
  credits: 'Prepaid Credits',
};

function planLabel(tier: string): string {
  return PLAN_LABELS[tier] ?? (tier ? tier.toUpperCase() : 'Free plan');
}

interface SettingsPanelProps {
  user: AuthUser | null;
  isAuthenticated: boolean;
  userPlanTier: string;
  userRealRequests: number;
  maxTransactions: number;
  domain: string;
  onPlanUpgradeClick?: (tier: string) => void;
}

export function SettingsPanel({
  user,
  isAuthenticated,
  userPlanTier,
  userRealRequests,
  maxTransactions,
  domain,
  onPlanUpgradeClick,
}: SettingsPanelProps) {
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);

  const { quota } = useQuota(isAuthenticated);

  const effectiveTier = userPlanTier || 'free';
  const mode = quota?.mode || (effectiveTier === 'enterprise' ? 'enterprise' : effectiveTier === 'scale' || effectiveTier === 'growth' || effectiveTier === 'starter' ? 'credits' : 'free');
  const isEnterprise = mode === 'enterprise';
  const isCredits = mode === 'credits';

  const usedTxs = quota?.used ?? userRealRequests;
  const maxTxs = isEnterprise
    ? null
    : (quota?.cap ?? (TIER_CAPS[effectiveTier] || maxTransactions || 250));

  const quotaPercentage = isEnterprise
    ? 0
    : maxTxs && maxTxs > 0
    ? Math.min(100, Math.round((usedTxs / maxTxs) * 100))
    : 0;

  const handleOpenBillingPortal = async () => {
    setIsOpeningPortal(true);
    try {
      const res = await fetch('/api/billing/portal-session', { method: 'POST' });
      const data = await res.json();
      if (data?.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      } else {
        window.open('https://polar.sh/stealthmark-sa/portal', '_blank', 'noopener,noreferrer');
      }
    } catch {
      window.open('https://polar.sh/stealthmark-sa/portal', '_blank', 'noopener,noreferrer');
    } finally {
      setIsOpeningPortal(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Early access / Enterprise contact modal */}
      <ClaimWhitelistModal
        isOpen={isClaimModalOpen}
        onClose={() => setIsClaimModalOpen(false)}
        defaultUseCase="Enterprise: agent control layer"
      />

      {/* Header Overview */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-gradient-to-r from-[#0d1017] via-[#08090e] to-[#0d1017] border border-white/10 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <span className="text-xs font-mono uppercase tracking-wider text-cyan-400 font-bold">
              Account Architecture &amp; Billing
            </span>
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight">Organization Settings &amp; Plans</h2>
          <p className="text-xs text-slate-300">
            Manage your organization profile, credit balance, and team access credentials.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleOpenBillingPortal}
            disabled={isOpeningPortal}
            className="text-xs px-3.5 py-2 rounded-xl border-white/10 hover:border-cyan-500/30 hover:bg-cyan-500/10 cursor-pointer flex items-center gap-1.5"
          >
            {isOpeningPortal ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5 text-cyan-400" />}
            <span>Polar Billing Portal</span>
            <ExternalLink className="w-3 h-3 ml-0.5 text-slate-400" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* LEFT 2 COLS: Profile & Subscription Details */}
        <div className="lg:col-span-2 space-y-8">
          {/* SUBSCRIPTION & QUOTA USAGE CARD */}
          <div className="p-6 sm:p-7 rounded-3xl bg-[#0D1017] border border-white/10 shadow-xl space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-300">
                  <CreditCard className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight">Credits &amp; Agent Event Quota</h3>
                  <TouchableTooltip
                    title="Merchant of Record Architecture"
                    badge="Polar.sh Verified"
                    badgeColor="cyan"
                    side="bottom"
                    align="start"
                    docLink="/trust"
                    content="Billing, international sales taxes, EU VAT compliance, and payment security are executed through Polar.sh as the official Merchant of Record. PCI-DSS Level 1 compliant."
                  >
                    <p className="text-xs text-slate-400 hover:text-cyan-300 transition flex items-center gap-1 cursor-pointer">
                      <span>Merchant of Record powered by Polar.sh</span>
                      <span className="text-[10px] text-cyan-400 font-mono">ⓘ</span>
                    </p>
                  </TouchableTooltip>
                </div>
              </div>

              {/* Tier Pill & Customer Portal Action */}
              <div className="flex items-center gap-2">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-mono font-bold uppercase tracking-wider border ${
                    isEnterprise
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                      : effectiveTier === 'scale'
                      ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300'
                      : effectiveTier === 'growth' || effectiveTier === 'starter' || isCredits
                      ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300'
                      : effectiveTier === 'business' || effectiveTier === 'pro'
                      ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                      : 'bg-white/5 border-white/10 text-slate-300'
                  }`}
                >
                  {isEnterprise ? 'Enterprise' : planLabel(effectiveTier)}
                </span>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOpenBillingPortal}
                  disabled={isOpeningPortal}
                  className="text-xs px-2.5 py-1 rounded-xl border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 cursor-pointer font-mono font-semibold flex items-center gap-1.5"
                  title="Open Polar.sh Customer Portal to download invoices and manage payment methods"
                >
                  {isOpeningPortal ? <Loader2 className="w-3 h-3 animate-spin" /> : <CreditCard className="w-3 h-3" />}
                  <span>Manage Billing</span>
                  <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
                </Button>
              </div>
            </div>

            {/* Quota Progress Bar */}
            <div className="p-4 rounded-2xl bg-black/40 border border-white/[0.08] space-y-2.5">
              {isEnterprise ? (
                <>
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-300">
                      Agent events this month: <strong className="text-white">{usedTxs.toLocaleString()}</strong> events
                    </span>
                    <span className="font-bold text-emerald-400">
                      Unlimited (No Cap)
                    </span>
                  </div>

                  {/* Visual Bar */}
                  <div className="w-full h-2.5 rounded-full bg-white/10 overflow-hidden relative">
                    <div
                      className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400"
                      style={{ width: '100%' }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 font-mono">
                    <span>Enterprise SLA Dogfooding</span>
                    <span className="text-emerald-400">Ingestion always active</span>
                  </div>
                </>
              ) : isCredits ? (
                <>
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-300">
                      Agent events consumed: <strong className="text-white">{usedTxs.toLocaleString()}</strong> /{' '}
                      {(maxTxs ?? 250000).toLocaleString('en-US')} total credits
                    </span>
                    <span className={`font-bold ${quotaPercentage > 85 ? 'text-amber-400' : 'text-cyan-400'}`}>
                      {quotaPercentage}% Used
                    </span>
                  </div>

                  {/* Visual Bar */}
                  <div className="w-full h-2.5 rounded-full bg-white/10 overflow-hidden relative">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        quotaPercentage > 85
                          ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                          : 'bg-gradient-to-r from-indigo-500 via-cyan-400 to-emerald-400'
                      }`}
                      style={{ width: `${Math.max(2, quotaPercentage)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 font-mono">
                    <span>Remaining balance: {(quota?.remaining ?? Math.max(0, (maxTxs ?? 250000) - usedTxs)).toLocaleString()} events</span>
                    <span className="text-emerald-400">Prepaid credits valid for 12 months</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-300">
                      Agent events this month: <strong className="text-white">{usedTxs.toLocaleString()}</strong> /{' '}
                      {(maxTxs ?? 250).toLocaleString('en-US')} events
                    </span>
                    <span className={`font-bold ${quotaPercentage >= 100 ? 'text-rose-400' : quotaPercentage > 85 ? 'text-amber-400' : 'text-cyan-400'}`}>
                      {quotaPercentage}% Used
                    </span>
                  </div>

                  {/* Visual Bar */}
                  <div className="w-full h-2.5 rounded-full bg-white/10 overflow-hidden relative">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        quotaPercentage > 85
                          ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                          : 'bg-gradient-to-r from-indigo-500 via-cyan-400 to-emerald-400'
                      }`}
                      style={{ width: `${Math.max(2, quotaPercentage)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 font-mono">
                    <span>Free allowance resets: 1st of every month</span>
                    <span className="text-emerald-400">Your site keeps running at the limit</span>
                  </div>
                </>
              )}
            </div>

            {/* Credit Packs */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-white">Buy credits</span>
                <span className="font-mono text-slate-400">One-time &middot; valid 12 months &middot; no subscription</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {CREDIT_PACKS.map((pack) => (
                  <div
                    key={pack.pack}
                    className="p-4 rounded-2xl border bg-white/[0.02] border-white/10 hover:border-white/20 transition-all flex flex-col justify-between gap-3"
                  >
                    <div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-white">{pack.name}</span>
                        <span className="font-mono text-cyan-400 font-bold">${pack.priceUsd}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        {pack.credits.toLocaleString('en-US')} agent events &middot; ${pricePer1k(pack)} / 1k
                      </p>
                    </div>
                    <a href={`/api/billing/checkout?pack=${pack.pack}`} className="block">
                      <Button size="sm" variant={pack.pack === 'growth' ? 'gradient' : 'outline'} className="w-full text-xs py-2 rounded-xl cursor-pointer">
                        <span>Buy {pack.name}</span>
                      </Button>
                    </a>
                  </div>
                ))}
              </div>
            </div>

            {/* Custom Enterprise Banner */}
            <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/20 via-[#0d1017] to-cyan-950/20 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="space-y-0.5">
                <div className="font-bold text-white flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" /> Need more volume or custom terms?
                </div>
                <div className="text-slate-400 text-[11px]">
                  Enterprise is arranged by contact. Tell us your volume and requirements.
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setIsClaimModalOpen(true)}
                className="text-xs px-3.5 rounded-xl border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 cursor-pointer shrink-0"
              >
                Inquire Enterprise
              </Button>
            </div>
          </div>

          {/* ACCOUNT CARD (read only: nothing here is editable until it is backed by the API) */}
          <div className="p-6 sm:p-7 rounded-3xl bg-[#0D1017] border border-white/10 shadow-xl space-y-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-300">
                <Building2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">Account</h3>
                <p className="text-xs text-slate-400">The identity this organization is billed and alerted under</p>
              </div>
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <dt className="text-slate-400 font-medium">Owner</dt>
                <dd className="text-white font-mono truncate">{isAuthenticated && user ? user.name || user.email : 'Sign in to see your account'}</dd>
              </div>
              <div className="space-y-1">
                <dt className="text-slate-400 font-medium">Account email</dt>
                <dd className="text-white font-mono truncate">{isAuthenticated && user ? user.email : '—'}</dd>
              </div>
            </dl>

            <div className="pt-2 flex flex-col gap-1.5 text-[11px] text-slate-400">
              <div className="flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-cyan-400" />
                <span>Registered site: <strong>{domain || 'none yet'}</strong></span>
              </div>
              <p>Quota alerts at 80% and 100% are sent to the account email.</p>
            </div>
          </div>
        </div>

        {/* RIGHT COL: Event reporting note */}
        <div className="space-y-6">
          <div className="p-6 rounded-3xl bg-[#0D1017] border border-white/10 shadow-xl space-y-5">
            {/* Non-blocking event reporting note with touchable explanatory popover */}
            <TouchableTooltip
              title="Event Reporting Never Blocks Your Site"
              badge="Non-blocking"
              badgeColor="emerald"
              side="top"
              align="end"
              docLink="/trust"
              content={
                <div className="space-y-1.5 text-xs">
                  <p>
                    The middleware reports agent events in the background and never waits on StealthMark to answer a request. If StealthMark cannot be reached, your site keeps answering as usual.
                  </p>
                  <p className="text-[10px] text-slate-400 font-mono">
                    • Same page for humans • No DNS change • No origin rewrite
                  </p>
                </div>
              }
            >
              <div className="p-3.5 rounded-2xl bg-emerald-950/20 border border-emerald-500/20 text-emerald-300/90 text-[11px] leading-relaxed space-y-1 hover:border-emerald-500/40 transition cursor-pointer">
                <div className="font-bold flex items-center gap-1.5 text-emerald-400">
                  <Shield className="w-3.5 h-3.5" /> Your site keeps running
                  <span className="text-[10px] font-mono text-emerald-400/70 ml-auto">Tap to inspect ↗</span>
                </div>
                <p>
                  Agent events are reported in the background. An unreachable StealthMark API never stops your site from answering.
                </p>
              </div>
            </TouchableTooltip>
          </div>
        </div>
      </div>

    </div>
  );
}
