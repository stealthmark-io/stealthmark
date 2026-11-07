'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Zap,
  Bot,
  Clock,
  DollarSign,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Cpu,
  Fingerprint,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TouchableTooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import type { HitlAction } from '@/lib/hitl-store';

export function HitlApprovalPanel() {
  const [pendingActions, setPendingActions] = useState<HitlAction[]>([]);
  const [recentHistory, setRecentHistory] = useState<HitlAction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchActions = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/hitl/pending');
      const data = await res.json();
      if (data.success) {
        setPendingActions(data.pending || []);
        setRecentHistory(data.recentHistory || []);
      }
    } catch {
      // Silent error fallback
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActions();
    // Poll every 10 seconds for new agent requests
    const interval = setInterval(fetchActions, 10000);
    return () => clearInterval(interval);
  }, [fetchActions]);

  const handleApprove = async (action: HitlAction) => {
    setProcessingId(action.id);
    try {
      const res = await fetch('/api/hitl/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvalId: action.id,
          operatorEmail: 'operator@stealthmark.io',
          notes: 'Manually verified via Dashboard Operator Console',
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast({
          title: '⚡ Action Approved & Released',
          description: `Order released to origin backend in ${data.releaseLatencyMs}ms (Target SLA < 8ms).`,
          type: 'success',
        });
        await fetchActions();
      } else {
        toast({
          title: 'Approval Error',
          description: data.error || 'Failed to approve action',
          type: 'error',
        });
      }
    } catch {
      toast({
        title: 'Network Error',
        description: 'Failed to communicate with HITL gateway',
        type: 'error',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (action: HitlAction) => {
    setProcessingId(action.id);
    try {
      const res = await fetch('/api/hitl/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvalId: action.id,
          operatorEmail: 'operator@stealthmark.io',
          reason: 'Declined by Security Lead (Policy Threshold Exceeded)',
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast({
          title: '✖ Action Rejected & Halted',
          description: `HALT signal dispatched to agent runtime (${action.agentName}).`,
          type: 'info',
        });
        await fetchActions();
      } else {
        toast({
          title: 'Rejection Error',
          description: data.error || 'Failed to reject action',
          type: 'error',
        });
      }
    } catch {
      toast({
        title: 'Network Error',
        description: 'Failed to communicate with HITL gateway',
        type: 'error',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleSimulate = async (type: 'checkout' | 'rescale' | 'delete') => {
    setIsSimulating(true);
    try {
      const res = await fetch('/api/hitl/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (data.success) {
        toast({
          title: '🤖 Incoming Agent Action Simulated',
          description: `${data.action.agentName} requested ${data.action.action}. Placed in HITL queue.`,
          type: 'success',
        });
        await fetchActions();
      }
    } catch {
      toast({
        title: 'Simulation Error',
        description: 'Failed to generate simulated action',
        type: 'error',
      });
    } finally {
      setIsSimulating(false);
    }
  };

  const totalValue = pendingActions.reduce((acc, a) => acc + (a.estimatedValueUsd || 0), 0);
  const highRiskCount = pendingActions.filter((a) => a.riskScore >= 70).length;

  return (
    <Card className="bg-[#0B0F19] border-white/10 p-5 rounded-2xl relative overflow-hidden space-y-5">
      {/* Decorative gradient accents */}
      <div className="absolute top-0 right-0 w-80 h-80 bg-amber-500/[0.04] rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-cyan-500/[0.04] rounded-full blur-3xl pointer-events-none" />

      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/[0.08] pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Fingerprint className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                Human-in-the-Loop (HITL) Gate
                {pendingActions.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                    {pendingActions.length} Pending
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                1-tap cryptographic authorization for high-value or destructive autonomous agent actions.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick Simulation Buttons */}
          <div className="flex items-center gap-1.5 bg-black/40 p-1 rounded-xl border border-white/10 text-xs">
            <span className="text-[10px] font-mono text-slate-400 px-2">Simulate:</span>
            <button
              type="button"
              onClick={() => handleSimulate('checkout')}
              disabled={isSimulating}
              className="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] font-mono font-semibold transition cursor-pointer disabled:opacity-50"
            >
              + Cart Buy
            </button>
            <button
              type="button"
              onClick={() => handleSimulate('rescale')}
              disabled={isSimulating}
              className="px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[11px] font-mono font-semibold transition cursor-pointer disabled:opacity-50"
            >
              + Rescale
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchActions}
            disabled={isLoading}
            className="border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-black/30 border border-white/[0.06] p-3.5 rounded-xl">
          <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
            <span>Queue Length</span>
            <Clock className="w-3.5 h-3.5 text-slate-500" />
          </div>
          <div className="text-xl font-bold font-mono text-white mt-1">
            {pendingActions.length} <span className="text-xs text-slate-500 font-normal">actions</span>
          </div>
        </div>

        <div className="bg-black/30 border border-white/[0.06] p-3.5 rounded-xl">
          <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
            <span>Pending Value</span>
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
            ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        <div className="bg-black/30 border border-white/[0.06] p-3.5 rounded-xl">
          <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
            <span>High Risk ({'>'}70)</span>
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className={`text-xl font-bold font-mono mt-1 ${highRiskCount > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
            {highRiskCount} <span className="text-xs text-slate-500 font-normal">flagged</span>
          </div>
        </div>

        <div className="bg-black/30 border border-white/[0.06] p-3.5 rounded-xl">
          <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
            <span>Release Latency SLA</span>
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-xl font-bold font-mono text-cyan-400 mt-1">
            &lt; 8.0 <span className="text-xs text-slate-500 font-normal">ms</span>
          </div>
        </div>
      </div>

      {/* Pending Actions List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-mono text-slate-400 px-1">
          <span className="font-semibold text-slate-300">Active Requests Awaiting Authorization</span>
          <span>HTTP 202 Handshake Active</span>
        </div>

        {pendingActions.length === 0 ? (
          <div className="p-8 rounded-2xl bg-black/30 border border-white/[0.06] text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-200">Zero Pending HITL Actions</p>
              <p className="text-xs text-slate-500 mt-0.5">
                All autonomous agent requests within standard DEFCON policy boundaries have been fulfilled.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSimulate('checkout')}
              className="border-white/10 bg-white/5 hover:bg-white/10 text-cyan-300 cursor-pointer text-xs"
            >
              <Zap className="w-3.5 h-3.5 mr-1" />
              Simulate High-Value Action ($599.00 USD)
            </Button>
          </div>
        ) : (
          pendingActions.map((action) => {
            const isExpanded = expandedId === action.id;
            const isProcessing = processingId === action.id;

            return (
              <div
                key={action.id}
                className="p-4 rounded-xl bg-black/40 border border-white/10 hover:border-amber-500/30 transition-all space-y-3"
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="w-4 h-4" />
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-white tracking-tight">{action.action}</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-white/10 text-slate-300 border border-white/10">
                          {action.agentName}
                        </span>
                        {action.kyaPassport?.verified && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                            <CheckCircle2 className="w-2.5 h-2.5" /> KYA L{action.kyaPassport.level}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
                        <span>Target: {action.endpoint}</span>
                        <span>•</span>
                        <span className="text-emerald-400 font-semibold">
                          ${action.estimatedValueUsd.toFixed(2)} USD
                        </span>
                        <span>•</span>
                        <span
                          className={`font-semibold ${
                            action.riskScore >= 75
                              ? 'text-rose-400'
                              : action.riskScore >= 50
                              ? 'text-amber-400'
                              : 'text-slate-400'
                          }`}
                        >
                          Risk: {action.riskScore}/100
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleReject(action)}
                      disabled={isProcessing}
                      className="border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5 mr-1" />
                      Reject
                    </Button>

                    <Button
                      variant="gradient"
                      size="sm"
                      onClick={() => handleApprove(action)}
                      disabled={isProcessing}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs cursor-pointer shadow-lg shadow-emerald-900/30"
                    >
                      <Zap className="w-3.5 h-3.5 mr-1" />
                      {isProcessing ? 'Releasing...' : 'Approve & Release'}
                    </Button>
                  </div>
                </div>

                {/* Collapsible Payload & Token Details */}
                <div className="border-t border-white/[0.06] pt-2">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : action.id)}
                    className="text-[11px] font-mono text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                  >
                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    <span>{isExpanded ? 'Hide Payload & Security Context' : 'View Payload & Security Context'}</span>
                  </button>

                  {isExpanded && (
                    <div className="mt-2 p-3 rounded-lg bg-black/60 border border-white/5 font-mono text-[11px] space-y-2">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-400">
                        <div>
                          <span className="block text-[10px] text-slate-500 uppercase">Approval ID</span>
                          <span className="text-white">{action.id}</span>
                        </div>
                        <div>
                          <span className="block text-[10px] text-slate-500 uppercase">Guard Latency</span>
                          <span className="text-cyan-400">{action.guardLatencyMs} ms</span>
                        </div>
                        <div>
                          <span className="block text-[10px] text-slate-500 uppercase">Expires In</span>
                          <span className="text-amber-400">
                            {Math.max(0, Math.round((new Date(action.expiresAt).getTime() - Date.now()) / 60000))} mins
                          </span>
                        </div>
                        <div>
                          <span className="block text-[10px] text-slate-500 uppercase">Category</span>
                          <span className="text-purple-300">{action.riskCategory}</span>
                        </div>
                      </div>

                      <div>
                        <span className="block text-[10px] text-slate-500 uppercase mb-1">Payload Parameters</span>
                        <pre className="p-2 rounded bg-black/80 border border-white/5 text-slate-300 overflow-x-auto text-[10px]">
                          {JSON.stringify(action.parameters, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Resolved History Snapshot */}
      {recentHistory.length > 0 && (
        <div className="border-t border-white/[0.08] pt-4 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span className="text-slate-300 font-semibold">Audit Trail &amp; Recent Resolutions</span>
            <span>Cryptographic Log</span>
          </div>

          <div className="space-y-1.5">
            {recentHistory.slice(0, 3).map((hist) => (
              <div
                key={hist.id}
                className="flex items-center justify-between p-2.5 rounded-lg bg-black/20 border border-white/[0.04] text-xs font-mono"
              >
                <div className="flex items-center gap-2">
                  {hist.status === 'approved' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : hist.status === 'rejected' ? (
                    <XCircle className="w-3.5 h-3.5 text-rose-400" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                  )}
                  <span className="text-slate-300">{hist.action}</span>
                  <span className="text-slate-500">by {hist.agentName}</span>
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                      hist.status === 'approved'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : hist.status === 'rejected'
                        ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                    }`}
                  >
                    {hist.status}
                  </span>
                  {hist.releaseLatencyMs && (
                    <span className="text-[10px] text-cyan-400">
                      ⚡ {hist.releaseLatencyMs}ms
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
