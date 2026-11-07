'use client';

import React, { useState } from 'react';
import type { CreateKeyResult } from '../views/useDashboardActions';
import {
  CheckCircle2,
  Globe,
  Key,
  Zap,
  ArrowRight,
  Copy,
  Check,
  Sparkles,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FREE_SITE_ALLOWANCE } from '@/lib/plan-copy';

interface ConsoleOnboardingWizardProps {
  onboardedDomain: string;
  onDomainSubmit: (domain: string) => Promise<void> | void;
  hasApiKeys: boolean;
  onGenerateKey: () => Promise<CreateKeyResult>;
  userRealRequests: number;
  onDismiss?: () => void;
  userEmail?: string;
}

export function ConsoleOnboardingWizard({
  onboardedDomain,
  onDomainSubmit,
  hasApiKeys,
  onGenerateKey,
  userRealRequests,
  onDismiss,
  userEmail,
}: ConsoleOnboardingWizardProps) {
  const [domainInput, setDomainInput] = useState(onboardedDomain || '');
  const [isSubmittingDomain, setIsSubmittingDomain] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [hasCopiedKey, setHasCopiedKey] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Step completions:
  // Step 1: Always completed for any authenticated account
  const step1Complete = true;
  // Step 2: Completed if domain is set
  const step2Complete = !!onboardedDomain && onboardedDomain.trim().length > 0;
  // Step 3: Completed if has API keys or just generated one
  const step3Complete = hasApiKeys || !!generatedKey;
  // Step 4: Completed only when an agent event was recorded in the usage ledger
  const step4Complete = userRealRequests > 0;

  const completedCount =
    (step1Complete ? 1 : 0) +
    (step2Complete ? 1 : 0) +
    (step3Complete ? 1 : 0) +
    (step4Complete ? 1 : 0);
  const progressPercent = Math.round((completedCount / 4) * 100);

  const handleDomainSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainInput.trim()) return;
    setIsSubmittingDomain(true);
    try {
      const clean = domainInput.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      await onDomainSubmit(clean);
    } finally {
      setIsSubmittingDomain(false);
    }
  };

  const handleKeyGenerate = async () => {
    setIsGeneratingKey(true);
    try {
      const result = await onGenerateKey();
      if (result.ok) {
        setKeyError(null);
        setGeneratedKey(result.key);
      } else {
        setKeyError(result.reason);
      }
    } finally {
      setIsGeneratingKey(false);
    }
  };

  const handleCopyKey = () => {
    if (!generatedKey) return;
    navigator.clipboard.writeText(generatedKey);
    setHasCopiedKey(true);
    setTimeout(() => setHasCopiedKey(false), 3000);
  };

  if (completedCount === 4 && !isCollapsed) {
    // All done celebration banner
    return (
      <div className="rounded-2xl bg-gradient-to-r from-[#0d1527] via-[#0d1017] to-[#0a1e1e] border border-emerald-500/30 p-4.5 shadow-2xl relative overflow-hidden transition-all">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-tight">
                  Setup Complete
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                  100% SETUP COMPLETE
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">
                <strong className="text-white">{onboardedDomain}</strong> is connected. Agent events appear as soon as your middleware reports them.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="px-3 py-1 text-xs font-mono text-slate-400 hover:text-white transition cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-[#0d1017] border border-cyan-500/30 shadow-2xl overflow-hidden text-left transition-all">
      {/* Top Banner Header */}
      <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-cyan-950/40 via-transparent to-transparent">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">
                Quickstart: Connect Your Site
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-bold">
                {completedCount} OF 4 COMPLETED ({progressPercent}%)
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Add your site, create an API key and wait for the first agent event.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/[0.05] transition cursor-pointer"
            aria-label={isCollapsed ? 'Expand setup' : 'Collapse setup'}
          >
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/[0.05] transition cursor-pointer"
              aria-label="Dismiss setup"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Progress Line */}
      <div className="w-full h-1 bg-white/5">
        <div
          className="h-full bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Steps List */}
      {!isCollapsed && (
        <div className="p-4 sm:p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* STEP 1: Plan & Org Activated */}
          <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/10 space-y-2 relative">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-cyan-400 font-bold uppercase tracking-wider">
                Step 1 · Organization
              </span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            </div>
            <h4 className="text-xs font-bold text-white">Free Plan Active</h4>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              250 agent events per month, {FREE_SITE_ALLOWANCE} and 7-day history included ({userEmail || 'Active Workspace'}).
            </p>
            <div className="text-[10px] font-mono text-emerald-400 font-semibold pt-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Ready</span>
            </div>
          </div>

          {/* STEP 2: Connect Domain */}
          <div className={`p-3.5 rounded-xl border space-y-2 transition ${step2Complete ? 'bg-white/[0.02] border-white/10' : 'bg-cyan-950/20 border-cyan-500/40 shadow-lg'}`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-cyan-400 font-bold uppercase tracking-wider">
                Step 2 · Your Site
              </span>
              {step2Complete ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <Globe className="w-4 h-4 text-cyan-400 shrink-0" />
              )}
            </div>
            <h4 className="text-xs font-bold text-white">Add Your Site</h4>
            {step2Complete ? (
              <div className="space-y-1">
                <div className="font-mono text-xs text-cyan-300 font-semibold truncate">
                  {onboardedDomain}
                </div>
                <div className="text-[10px] font-mono text-emerald-400">● Site added</div>
              </div>
            ) : (
              <form onSubmit={handleDomainSave} className="space-y-1.5">
                <input
                  type="text"
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  placeholder="yourcompany.com"
                  className="w-full px-2.5 py-1 text-xs font-mono rounded-lg bg-black/60 border border-white/10 text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmittingDomain || !domainInput.trim()}
                  className="w-full text-xs h-7 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold font-mono"
                >
                  <span>Add Site</span>
                  <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </form>
            )}
          </div>

          {/* STEP 3: API Key */}
          <div className={`p-3.5 rounded-xl border space-y-2 transition ${step3Complete ? 'bg-white/[0.02] border-white/10' : 'bg-cyan-950/20 border-cyan-500/40 shadow-lg'}`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-cyan-400 font-bold uppercase tracking-wider">
                Step 3 · API Key
              </span>
              {step3Complete ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <Key className="w-4 h-4 text-cyan-400 shrink-0" />
              )}
            </div>
            <h4 className="text-xs font-bold text-white">Your API Key</h4>
            {generatedKey ? (
              <div className="space-y-1.5">
                <div className="p-1.5 rounded bg-black/80 border border-cyan-500/30 flex items-center justify-between gap-1">
                  <span className="text-[10px] font-mono text-cyan-300 truncate">
                    {generatedKey.slice(0, 10)}...{generatedKey.slice(-4)}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyKey}
                    className="p-1 text-slate-400 hover:text-white rounded transition"
                  >
                    {hasCopiedKey ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
                <div className="text-[10px] font-mono text-emerald-400">Key created. Copy it and store it safely.</div>
              </div>
            ) : hasApiKeys ? (
              <div className="space-y-1">
                <div className="text-xs font-mono text-slate-300 font-semibold">Active Key Configured</div>
                <div className="text-[10px] font-mono text-emerald-400">● Key active</div>
              </div>
            ) : (
              <Button
                type="button"
                onClick={handleKeyGenerate}
                disabled={isGeneratingKey}
                size="sm"
                className="w-full text-xs h-7 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold font-mono"
              >
                <span>{isGeneratingKey ? 'Generating...' : 'Generate API Key'}</span>
                <Key className="w-3 h-3 ml-1" />
              </Button>
            )}
            {keyError && !generatedKey && (
              <p role="alert" className="text-[10px] font-mono text-rose-400">Key not created ({keyError})</p>
            )}
          </div>

          {/* STEP 4: First agent event */}
          <div className={`p-3.5 rounded-xl border space-y-2 transition ${step4Complete ? 'bg-white/[0.02] border-white/10' : 'bg-cyan-950/20 border-cyan-500/40 shadow-lg'}`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-cyan-400 font-bold uppercase tracking-wider">
                Step 4 · First Agent Event
              </span>
              {step4Complete ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <Zap className="w-4 h-4 text-amber-400 shrink-0" />
              )}
            </div>
            <h4 className="text-xs font-bold text-white">Wait for an Agent Event</h4>
            {step4Complete ? (
              <div className="space-y-1">
                <div className="text-xs font-mono text-emerald-400 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>Agent event recorded</span>
                </div>
                <div className="text-[10px] font-mono text-slate-400">
                  {userRealRequests.toLocaleString()} agent events this month
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  This step completes when your middleware reports an event. Deploy it with your API key, then request your site
                  with an agent header, for example:
                </p>
                <code className="block text-[10px] font-mono text-cyan-300 bg-black/40 border border-white/10 rounded-lg p-2 break-all select-all">
                  curl -H &quot;Accept: application/agent+json&quot; https://{onboardedDomain.trim() || 'your-site.com'}/
                </code>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
