'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  DollarSign,
  ExternalLink,
  Globe,
  Lock,
  Mail,
  RefreshCw,
  Shield,
  Sparkles,
  Users,
} from 'lucide-react';

interface FounderMetricsResponse {
  timestamp: string;
  revenue: {
    totalOrders: number;
    totalRevenueUsd: string;
    orders: Array<{
      polar_order_id: string;
      product_id: string;
      credits_events: number;
      amount_cents: number;
      payment_method: string;
      network: string | null;
      created_at: string;
    }>;
  };
  leads: {
    scanLeads: Array<{
      id: string;
      email: string;
      domain: string;
      source: string;
      followup_sent: boolean;
      converted: boolean;
      created_at: string;
    }>;
    users: Array<{
      email: string;
      provider: string;
      created_at: string;
    }>;
  };
  telemetry: {
    totalEvents: number;
    recentEvents: Array<{
      event_type: string;
      agent_id: string;
      path: string;
      created_at: string;
    }>;
  };
  resend: {
    configured: boolean;
    summary: {
      delivered: number;
      opened: number;
      clicked: number;
      bounced: number;
      total: number;
    };
    emails: Array<{
      id: string;
      to: string;
      subject: string;
      status: string;
      created_at: string;
    }>;
  };
  portfolio: Array<{
    name: string;
    url: string;
    status: number;
    ok: boolean;
    latencyMs: number;
  }>;
}

export function FounderCommandCenter() {
  const [data, setData] = useState<FounderMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/founder/metrics', { cache: 'no-store' });
      if (res.ok) {
        const json = (await res.json()) as FounderMetricsResponse;
        setData(json);
      }
    } catch {
      // Ignore transient errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const timer = setInterval(fetchMetrics, 30000);
    return () => clearInterval(timer);
  }, [fetchMetrics]);

  if (!data && loading) {
    return (
      <div className="p-5 rounded-2xl bg-[#0a0d16]/90 border border-indigo-500/30 text-xs font-mono text-slate-300 flex items-center justify-between">
        <span>⚡ Loading Zero-Trust Founder Command Center...</span>
        <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <section className="rounded-2xl bg-gradient-to-br from-[#0a0e1a] via-[#070911] to-[#0b0816] border border-cyan-500/30 shadow-2xl shadow-cyan-950/30 p-5 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30">
            <Shield className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
                Founder Command Center
              </h2>
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <Lock className="w-2.5 h-2.5" /> Zero-Trust SuperAdmin
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              Real-Time Sales, Outbound Resend Emails, /scan Leads &amp; Multi-Project Telemetry
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchMetrics}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-mono text-cyan-300 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-mono text-slate-300 cursor-pointer"
          >
            {expanded ? 'Minimize' : 'Expand'}
          </button>
        </div>
      </div>

      {expanded && (
        <>
          {/* Top KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="p-4 rounded-xl bg-black/40 border border-white/10 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                <span>REVENUE (POLAR + CRYPTO)</span>
                <DollarSign className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-extrabold text-white font-mono">
                ${data.revenue.totalRevenueUsd}
              </div>
              <div className="text-[11px] text-emerald-400 font-mono">
                {data.revenue.totalOrders} Paid Order(s)
              </div>
            </div>

            <div className="p-4 rounded-xl bg-black/40 border border-white/10 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                <span>RESEND EMAILS (LAST 35)</span>
                <Mail className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-2xl font-extrabold text-white font-mono">
                {data.resend.summary.delivered} Delivered
              </div>
              <div className="text-[11px] text-cyan-300 font-mono">
                Opened: {data.resend.summary.opened} · Clicked: {data.resend.summary.clicked} · Bounced: {data.resend.summary.bounced}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-black/40 border border-white/10 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                <span>/SCAN LEADS &amp; USERS</span>
                <Users className="w-4 h-4 text-purple-400" />
              </div>
              <div className="text-2xl font-extrabold text-white font-mono">
                {data.leads.scanLeads.length} Leads
              </div>
              <div className="text-[11px] text-purple-300 font-mono">
                {data.leads.users.length} Registered Users
              </div>
            </div>

            <div className="p-4 rounded-xl bg-black/40 border border-white/10 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                <span>AGENT &amp; /SCAN EVENTS</span>
                <Activity className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-extrabold text-white font-mono">
                {data.telemetry.totalEvents}
              </div>
              <div className="text-[11px] text-amber-300 font-mono">
                Verified Supabase Telemetry
              </div>
            </div>
          </div>

          {/* Portfolio Live Status */}
          <div className="space-y-2">
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-cyan-400" />
              <span>Portfolio Live Uptime &amp; Edge Latency</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              {data.portfolio.map((site) => (
                <a
                  key={site.url}
                  href={site.url}
                  target="_blank"
                  rel="noreferrer"
                  className="p-3 rounded-xl bg-black/50 border border-white/10 hover:border-cyan-500/40 transition flex flex-col justify-between gap-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white truncate">{site.name}</span>
                    <ExternalLink className="w-3 h-3 text-slate-400 shrink-0" />
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className={site.ok ? 'text-emerald-400' : 'text-rose-400'}>
                      {site.ok ? `● ${site.status} OK` : '● DOWN'}
                    </span>
                    <span className="text-slate-400">{site.latencyMs}ms</span>
                  </div>
                </a>
              ))}
            </div>
          </div>

          {/* Captured Leads & Users Table (scan_leads + users) */}
          <div className="p-4 rounded-xl bg-black/50 border border-purple-500/25 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                <span>Captured Emails in /scan (scan_leads) &amp; Registered Users</span>
              </h3>
              <span className="text-[11px] font-mono text-slate-400">
                {data.leads.scanLeads.length} Scan Leads · {data.leads.users.length} Users
              </span>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
              {data.leads.scanLeads.length === 0 && data.leads.users.length === 0 ? (
                <p className="text-xs text-slate-400 font-mono">
                  No scan leads captured yet. Every email entered in /scan (2-finding teaser or unlock modal) appears here in real time.
                </p>
              ) : (
                <>
                  {data.leads.scanLeads.map((lead) => (
                    <div
                      key={lead.id}
                      className="p-2.5 rounded-lg bg-purple-500/[0.05] border border-purple-500/20 flex items-center justify-between gap-2 text-xs font-mono"
                    >
                      <div className="min-w-0">
                        <div className="text-white font-semibold truncate">
                          {lead.email}{' '}
                          <span className="text-cyan-400">→ {lead.domain}</span>
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Source: {lead.source} · {lead.created_at?.slice(0, 19).replace('T', ' ')} UTC
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                          lead.converted
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : lead.followup_sent
                            ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                            : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {lead.converted ? 'PAID' : lead.followup_sent ? 'FOLLOWUP SENT' : 'NEW LEAD'}
                      </span>
                    </div>
                  ))}
                  {data.leads.users.map((u, i) => (
                    <div
                      key={`${u.email}-${i}`}
                      className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5 flex items-center justify-between gap-2 text-xs font-mono"
                    >
                      <div className="min-w-0">
                        <div className="text-white font-semibold truncate">{u.email}</div>
                        <div className="text-[10px] text-slate-400">
                          Console Auth ({u.provider}) · {u.created_at?.slice(0, 19).replace('T', ' ')} UTC
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                        USER
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Two-Column Tables: Live Resend Emails & Recent /scan + Agent Traffic */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Resend Outbound Table */}
            <div className="p-4 rounded-xl bg-black/50 border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5" />
                  <span>Live Outbound &amp; Transactional Emails (Resend)</span>
                </h3>
                <span className="text-[11px] font-mono text-slate-400">
                  Last {data.resend.emails.length}
                </span>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                {data.resend.emails.length === 0 ? (
                  <p className="text-xs text-slate-400 font-mono">
                    Add RESEND_API_KEY in Vercel env to stream live email events here, or view via CLI.
                  </p>
                ) : (
                  data.resend.emails.map((em) => (
                    <div
                      key={em.id}
                      className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5 flex items-center justify-between gap-2 text-xs font-mono"
                    >
                      <div className="min-w-0">
                        <div className="text-white font-semibold truncate">{em.to}</div>
                        <div className="text-[11px] text-slate-400 truncate">{em.subject}</div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                          em.status === 'delivered' || em.status === 'opened' || em.status === 'clicked'
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                        }`}
                      >
                        {em.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Live /scan & Agent Stream */}
            <div className="p-4 rounded-xl bg-black/50 border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Live /scan Visits &amp; AI Agent Hits</span>
                </h3>
                <span className="text-[11px] font-mono text-slate-400">
                  Last {data.telemetry.recentEvents.length}
                </span>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                {data.telemetry.recentEvents.map((ev, idx) => (
                  <div
                    key={`${ev.created_at}-${idx}`}
                    className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5 flex items-center justify-between gap-2 text-xs font-mono"
                  >
                    <div className="min-w-0">
                      <div className="text-white font-semibold truncate">
                        {ev.agent_id}{' '}
                        <span className="text-cyan-400">{ev.path}</span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {ev.created_at?.slice(0, 19).replace('T', ' ')} UTC
                      </div>
                    </div>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
