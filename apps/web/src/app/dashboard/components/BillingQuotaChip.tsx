'use client';

import React from 'react';
import { AlertTriangle, CreditCard, ExternalLink, RefreshCw, Zap } from 'lucide-react';
import { nextPeriodMonth, type BillingMode, type QuotaLevel, type QuotaResponse } from '@/lib/quota';
import { useQuota } from '../views/useQuota';

const CREDITS_TOP_UP_URL = '/pricing#pricing';

export const QUOTA_EXCEEDED_COPY = 'Ingestion paused until next period or credits top-up. Your site keeps running.';

const MODE_LABELS: Record<BillingMode, string> = {
  free: 'Free',
  credits: 'Credits',
  enterprise: 'Enterprise',
};

const LEVEL_STYLES: Record<QuotaLevel, { text: string; bar: string; dot: string; badge: string; label: string }> = {
  ok: {
    text: 'text-cyan-300',
    bar: 'bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400',
    dot: 'bg-emerald-400',
    badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    label: 'Active',
  },
  warning: {
    text: 'text-amber-300',
    bar: 'bg-gradient-to-r from-amber-400 to-orange-400',
    dot: 'bg-amber-400',
    badge: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    label: 'Near limit',
  },
  exceeded: {
    text: 'text-red-300',
    bar: 'bg-red-500',
    dot: 'bg-red-500',
    badge: 'bg-red-500/10 text-red-300 border-red-500/30',
    label: 'Paused',
  },
};

function formatEvents(value: number): string {
  return value.toLocaleString('en-US');
}

function formatResetDate(periodMonth: string): string {
  return new Date(`${nextPeriodMonth(periodMonth)}T00:00:00.000Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function usageSummary(quota: QuotaResponse): string {
  if (quota.cap === null) return `${formatEvents(quota.used)} events, no cap`;
  return `${formatEvents(quota.used)} / ${formatEvents(quota.cap)} events (${quota.percent}%)`;
}

function footerSummary(quota: QuotaResponse): string {
  if (quota.remaining === null) return 'No monthly cap';
  if (quota.mode === 'credits') return `${formatEvents(quota.remaining)} credit events left`;
  return `${formatEvents(quota.remaining)} events left, resets ${formatResetDate(quota.period_month)}`;
}

function QuotaBar({ quota, className }: { quota: QuotaResponse; className: string }) {
  if (quota.cap === null) return null;
  return (
    <div
      role="progressbar"
      aria-label="Agent events used this period"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={quota.percent}
      className={`bg-black/60 rounded-full overflow-hidden border border-white/10 ${className}`}
    >
      <div
        data-level={quota.level}
        className={`h-full rounded-full transition-all duration-500 ${LEVEL_STYLES[quota.level].bar}`}
        style={{ width: `${quota.percent}%` }}
      />
    </div>
  );
}

function QuotaCta({ mode, portalUrl, className }: { mode: BillingMode; portalUrl: string; className: string }) {
  if (mode === 'free') {
    return (
      <a href={portalUrl} className={className}>
        <span>Upgrade</span>
        <Zap className="w-3 h-3 text-cyan-300" />
      </a>
    );
  }
  if (mode === 'credits') {
    return (
      <a href={CREDITS_TOP_UP_URL} className={className}>
        <span>Top up</span>
        <Zap className="w-3 h-3 text-cyan-300" />
      </a>
    );
  }
  return (
    <a href={portalUrl} target="_blank" rel="noopener noreferrer" className={className}>
      <span>Manage</span>
      <ExternalLink className="w-3 h-3" />
    </a>
  );
}

interface QuotaChipViewProps {
  quota: QuotaResponse | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  variant: 'compact' | 'expanded';
  portalUrl: string;
  planName?: string;
}

export function QuotaChipView({ quota, loading, error, onRetry, variant, portalUrl, planName }: QuotaChipViewProps) {
  const compact = variant === 'compact';
  const planDisplay =
    planName && !['Developer', 'Sample data', 'Free'].includes(planName)
      ? planName.replace(' Plan', '')
      : quota ? MODE_LABELS[quota.mode] : '';
  const shell = compact
    ? 'flex items-center gap-2 px-2.5 py-1 rounded-xl bg-white/[0.04] border border-white/10 text-xs'
    : 'p-4 rounded-2xl bg-[#0d1017] border border-white/10 space-y-3 text-left';

  if (!quota && loading) {
    return (
      <div className={shell} aria-busy="true" data-testid="quota-skeleton">
        <div className="h-3.5 w-16 rounded bg-white/10 animate-pulse" />
        <div className={`h-3.5 rounded bg-white/10 animate-pulse ${compact ? 'w-28' : 'w-48'}`} />
      </div>
    );
  }

  if (!quota) {
    return (
      <div className={shell} role="status" data-testid="quota-error">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
        <span className="font-mono text-[11px] text-slate-400">
          {error ? `Quota unavailable (${error})` : 'No quota data'}
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 text-[11px] font-mono text-cyan-400 hover:text-cyan-300 transition cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        )}
      </div>
    );
  }

  const styles = LEVEL_STYLES[quota.level];
  const exceeded = quota.level === 'exceeded';

  if (compact) {
    return (
      <div className={shell} data-level={quota.level} data-testid="quota-chip">
        <div className="flex items-center gap-1.5 font-mono">
          <CreditCard className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-semibold text-white">{planDisplay}</span>
          <span className={`w-1.5 h-1.5 rounded-full ml-0.5 ${styles.dot}`} />
        </div>

        <div className="h-3.5 w-px bg-white/10" />

        <div className="relative group/quota flex items-center gap-1.5 font-mono text-[11px]" title={exceeded ? QUOTA_EXCEEDED_COPY : undefined}>
          <span className={exceeded || quota.level === 'warning' ? styles.text : 'text-slate-300'}>
            {usageSummary(quota)}
          </span>
          <QuotaBar quota={quota} className="w-12 h-1.5" />
          {exceeded && (
            <div role="status" className="pointer-events-none absolute -bottom-12 right-0 z-50 hidden group-hover/quota:flex max-w-xs whitespace-normal rounded-lg bg-[#060709] px-2.5 py-1.5 text-[10px] font-mono text-slate-200 border border-red-500/30 shadow-2xl backdrop-blur-md">
              {QUOTA_EXCEEDED_COPY}
            </div>
          )}
        </div>

        <div className="h-3.5 w-px bg-white/10 hidden sm:block" />

        <QuotaCta
          mode={quota.mode}
          portalUrl={portalUrl}
          className="hidden sm:inline-flex items-center gap-1 text-[11px] font-mono font-medium text-cyan-400 hover:text-cyan-300 transition hover:underline"
        />
      </div>
    );
  }

  return (
    <div className={shell} data-level={quota.level} data-testid="quota-chip">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-cyan-400" />
          <span className="font-semibold text-sm text-white">{planDisplay}</span>
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-semibold ${styles.badge}`}>
            {styles.label}
          </span>
        </div>
        <QuotaCta
          mode={quota.mode}
          portalUrl={portalUrl}
          className="inline-flex items-center gap-1.5 text-xs font-mono font-medium text-cyan-400 hover:text-cyan-300 transition hover:underline"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs font-mono text-slate-400">
          <span>Monthly agent events</span>
          <span className={`font-bold ${styles.text}`}>{usageSummary(quota)}</span>
        </div>
        <QuotaBar quota={quota} className="w-full h-2" />
        <div className="text-[10px] font-mono text-slate-500">{footerSummary(quota)}</div>
      </div>

      {exceeded && (
        <p role="status" className="text-[11px] font-mono text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1.5">
          {QUOTA_EXCEEDED_COPY}
        </p>
      )}
    </div>
  );
}

interface BillingQuotaChipProps {
  liveQuota?: boolean;
  usedTransactions?: number;
  maxTransactions?: number;
  planName?: string;
  priceMonthly?: number;
  status?: string;
  variant?: 'compact' | 'expanded';
  portalUrl?: string;
  isGuest?: boolean;
  onManageClick?: () => void;
}

export function BillingQuotaChip({
  usedTransactions = 0,
  maxTransactions = 10000,
  planName = 'Developer',
  priceMonthly = 0,
  status = 'Active',
  variant = 'compact',
  portalUrl = '/pricing',
  isGuest = false,
  onManageClick,
  liveQuota = false,
}: BillingQuotaChipProps) {
  const useLive = liveQuota && !isGuest;
  const { quota, loading, error, refresh } = useQuota(useLive);

  if (useLive) {
    return <QuotaChipView quota={quota} loading={loading} error={error} onRetry={refresh} variant={variant} portalUrl={portalUrl} planName={planName} />;
  }

  const percentage = Math.min(100, Math.round((usedTransactions / Math.max(1, maxTransactions)) * 100));
  const isFree = priceMonthly === 0;

  if (variant === 'compact') {
    const formattedMax = maxTransactions >= 1_000_000
      ? `${(maxTransactions / 1_000_000).toLocaleString()}M`
      : `${(maxTransactions / 1_000).toLocaleString()}k`;

    return (
      <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-white/[0.04] border border-white/10 text-xs">
        {/* Plan Pill */}
        <div className="flex items-center gap-1.5 font-mono">
          <CreditCard className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-semibold text-white">{planName.replace(' Plan', '')}</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-0.5" />
        </div>

        <div className="h-3.5 w-px bg-white/10" />

        {/* Quota Progress */}
        <div className="flex items-center gap-1.5 font-mono text-[11px]">
          <span className="text-slate-300">
            {usedTransactions.toLocaleString()} / {formattedMax} txs
          </span>
          <span className="text-cyan-300 font-semibold">({percentage}%)</span>
        </div>

        <div className="h-3.5 w-px bg-white/10 hidden sm:block" />

        {/* Portal Link / Upgrade CTA / Guest Interceptor */}
        {isGuest ? (
          <div className="relative group/manage hidden sm:inline-flex">
            <button
              type="button"
              onClick={onManageClick}
              className="inline-flex items-center gap-1 text-[11px] font-mono text-cyan-400 hover:text-cyan-300 transition cursor-pointer"
            >
              <span>{isFree ? 'Upgrade' : 'Manage'}</span>
              <ExternalLink className="w-3 h-3" />
            </button>
            <div className="pointer-events-none absolute -bottom-10 right-0 z-50 hidden group-hover/manage:flex items-center whitespace-nowrap rounded-lg bg-[#060709] px-2.5 py-1 text-[10px] font-mono text-slate-200 border border-cyan-500/30 shadow-2xl backdrop-blur-md">
              Sign in to manage your plan or upgrade
            </div>
          </div>
        ) : isFree ? (
          <a
            href={portalUrl}
            className="hidden sm:inline-flex items-center gap-1 text-[11px] font-mono font-medium text-cyan-400 hover:text-cyan-300 transition hover:underline"
          >
            <span>Upgrade</span>
            <Zap className="w-3 h-3 text-cyan-300" />
          </a>
        ) : (
          <a
            href={portalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-1 text-[11px] font-mono text-cyan-400 hover:text-cyan-300 transition hover:underline"
          >
            <span>Manage</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    );
  }

  // Expanded variant (Card format)
  return (
    <div className="p-4 rounded-2xl bg-[#0d1017] border border-white/10 space-y-3 text-left">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-cyan-400" />
          <span className="font-semibold text-sm text-white">{planName}</span>
          <span className="text-xs font-mono text-slate-400">
            {isFree ? 'Free Tier ($0/mo)' : `($${priceMonthly}/mo)`}
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
            {status}
          </span>
        </div>

        {isGuest ? (
          <div className="relative group/manageExp">
            <button
              type="button"
              onClick={onManageClick}
              className="inline-flex items-center gap-1.5 text-xs font-mono text-cyan-400 hover:text-cyan-300 transition cursor-pointer"
            >
              <span>{isFree ? 'Get credits' : 'Manage Billing'}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
            <div className="pointer-events-none absolute -bottom-9 right-0 z-50 hidden group-hover/manageExp:flex items-center whitespace-nowrap rounded-lg bg-[#060709] px-2.5 py-1 text-[10px] font-mono text-slate-200 border border-cyan-500/30 shadow-2xl backdrop-blur-md">
              Sign in to manage your plan or upgrade
            </div>
          </div>
        ) : isFree ? (
          <a
            href={portalUrl}
            className="inline-flex items-center gap-1.5 text-xs font-mono font-medium text-cyan-400 hover:text-cyan-300 transition hover:underline"
          >
            <span>Buy credits</span>
            <Zap className="w-3.5 h-3.5 text-cyan-300" />
          </a>
        ) : (
          <a
            href={portalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-mono text-cyan-400 hover:text-cyan-300 transition hover:underline"
          >
            <span>Manage Billing</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs font-mono text-slate-400">
          <span>Monthly Gateway Quota</span>
          <span className="text-slate-300 font-bold">
            {usedTransactions.toLocaleString()} / {maxTransactions.toLocaleString()} txs ({percentage}%)
          </span>
        </div>
        <div className="w-full h-2 bg-black/60 rounded-full overflow-hidden border border-white/10">
          <div
            className="h-full bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 rounded-full transition-all duration-500"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
          <span>{isFree ? '250 monthly events included free' : 'Credits valid for 12 months'}</span>
          <span>{isFree ? 'Credit packs from $9' : 'Polar credit packs'}</span>
        </div>
      </div>
    </div>
  );
}
