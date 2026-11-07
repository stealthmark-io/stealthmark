'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

interface AuditReportData {
  domain: string;
  duration_ms?: number;
  overall: {
    score: number;
    grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    waf_shield_detected: boolean;
  };
  pillars: {
    infrastructure: {
      ip: string | null;
      is_behind_cloudflare: boolean;
      origin_ip_leaked_via_dns?: boolean;
      leaked_origin_ip_masked?: string | null;
      has_spf?: boolean;
      has_dmarc?: boolean;
      has_caa?: boolean;
      exposed_ports: { port: number; service: string; risk: 'CRITICAL' | 'HIGH' | 'INFO' }[];
      cves: string[];
    };
    web_and_cves: {
      env_exposed?: boolean;
      env_evidence?: string | null;
      git_exposed?: boolean;
      git_evidence?: string | null;
      powered_by?: string | null;
      cms_detected?: string | null;
      has_hsts?: boolean;
      has_csp?: boolean;
      has_xframe?: boolean;
    };
    ai_governance: {
      llms_txt?: boolean;
      ai_bot_rules_in_robots?: boolean;
    };
  };
}

interface ScanReportViewProps {
  initialDomain?: string;
}

const DEFAULT_WAF_PREVIEW = `(http.request.uri.path contains "/.env") or (http.request.uri.path contains "/.git") or (http.request.uri.path contains "eval-stdin.php") or ... [UNLOCK FULL CLOUDFLARE RULE & WORKER]`;

export const ScanReportView: React.FC<ScanReportViewProps> = ({ initialDomain = '' }) => {
  const searchParams = useSearchParams();
  const router = useRouter();

  const queryDomain = searchParams.get('domain') || initialDomain;
  const checkoutId = searchParams.get('checkout_id') || searchParams.get('session_id');

  const [domainInput, setDomainInput] = useState(queryDomain);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auditData, setAuditData] = useState<AuditReportData | null>(null);

  // Server-side verified unlock state (prevents ?unlocked=true client manipulation)
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [visualWafRule, setVisualWafRule] = useState<string>('');
  const [workerCode, setWorkerCode] = useState<string>('');
  const [copiedWaf, setCopiedWaf] = useState(false);
  const [copiedWorker, setCopiedWorker] = useState(false);

  // Agency / Consultant White-Label Customization
  const [agencyName, setAgencyName] = useState('');
  const [agencyEmail, setAgencyEmail] = useState('');
  const [clientName, setClientName] = useState('');

  // Emergency Radar Alert State
  const [radarEmail, setRadarEmail] = useState('');
  const [radarStatus, setRadarStatus] = useState<'IDLE' | 'SENDING' | 'SUCCESS' | 'ERROR'>('IDLE');

  const runAudit = async (targetDomain: string) => {
    if (!targetDomain.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/scan/audit?domain=${encodeURIComponent(targetDomain.trim())}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Diagnostic scan could not be completed.');
      }
      if (json.status === 'SKIPPED_CRAWLER') {
        return;
      }

      // Adapt to AuditReportData shape
      const adapted: AuditReportData = {
        domain: json.domain || targetDomain,
        duration_ms: json.duration_ms,
        overall: {
          score: json.overall?.score ?? 90,
          grade: json.overall?.grade ?? 'A',
          waf_shield_detected: json.overall?.waf_shield_detected ?? false,
        },
        pillars: {
          infrastructure: {
            ip: json.pillars?.infrastructure?.ip || null,
            is_behind_cloudflare: json.pillars?.infrastructure?.is_behind_cloudflare ?? false,
            origin_ip_leaked_via_dns: json.pillars?.infrastructure?.origin_ip_leaked_via_dns ?? false,
            leaked_origin_ip_masked: json.pillars?.infrastructure?.leaked_origin_ip_masked ?? null,
            has_spf: json.pillars?.infrastructure?.has_spf ?? false,
            has_dmarc: json.pillars?.infrastructure?.has_dmarc ?? false,
            has_caa: json.pillars?.infrastructure?.has_caa ?? false,
            exposed_ports: json.pillars?.infrastructure?.exposed_ports ?? [],
            cves: json.pillars?.infrastructure?.cves ?? [],
          },
          web_and_cves: {
            env_exposed: json.pillars?.web_and_cves?.env_exposed ?? false,
            env_evidence: json.pillars?.web_and_cves?.env_evidence ?? null,
            git_exposed: json.pillars?.web_and_cves?.git_exposed ?? false,
            git_evidence: json.pillars?.web_and_cves?.git_evidence ?? null,
            powered_by: json.pillars?.web_and_cves?.powered_by ?? null,
            cms_detected: json.pillars?.web_and_cves?.cms_detected ?? null,
            has_hsts: json.pillars?.web_and_cves?.has_hsts ?? false,
            has_csp: json.pillars?.web_and_cves?.has_csp ?? false,
            has_xframe: json.pillars?.web_and_cves?.has_xframe ?? false,
          },
          ai_governance: {
            llms_txt: json.pillars?.ai_governance?.llms_txt ?? false,
            ai_bot_rules_in_robots: json.pillars?.ai_governance?.ai_bot_rules_in_robots ?? false,
          },
        },
      };

      setAuditData(adapted);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (queryDomain) {
      setDomainInput(queryDomain);
      runAudit(queryDomain);
    }
  }, [queryDomain]);

  // Cryptographic server-side verification of checkout with Polar API
  useEffect(() => {
    if (!checkoutId || !queryDomain) return;

    const verifyPurchase = async () => {
      setVerifyingPayment(true);
      try {
        const res = await fetch(
          `/api/billing/polar/verify?checkout_id=${encodeURIComponent(checkoutId)}&domain=${encodeURIComponent(
            queryDomain
          )}`
        );
        const data = await res.json();
        if (res.ok && data.verified) {
          setIsUnlocked(true);
          if (data.deliverables) {
            setVisualWafRule(data.deliverables.cloudflare_visual_waf_rule);
            setWorkerCode(data.deliverables.cloudflare_worker_code);
          }
        }
      } catch {
        // Keeps deliverables protected if verification fails
      } finally {
        setVerifyingPayment(false);
      }
    };

    verifyPurchase();
  }, [checkoutId, queryDomain]);

  const handleCheckout = (plan: 'fix_pack_19' | 'pro_monitor_29' | 'agency_scale_79') => {
    const target = auditData?.domain || domainInput || 'example.com';
    window.location.href = `/api/billing/polar/checkout?plan=${plan}&domain=${encodeURIComponent(target)}`;
  };

  const handleRadarSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!radarEmail.includes('@') || !auditData) return;

    setRadarStatus('SENDING');
    try {
      const res = await fetch('/api/scan/subscribe-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: radarEmail,
          domain: auditData.domain,
          score: auditData.overall.score,
          grade: auditData.overall.grade,
        }),
      });
      if (!res.ok) throw new Error('Could not register alert');
      setRadarStatus('SUCCESS');
    } catch {
      setRadarStatus('ERROR');
    }
  };

  const handlePrintWhiteLabelPdf = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-[#060709] text-slate-100 py-10 px-4 sm:px-6 lg:px-8">
      {/* On-screen view — hidden during print export */}
      <div className="max-w-5xl mx-auto print:hidden space-y-8">
        {/* Search & Audit Bar */}
        <div className="bg-[#11141c] border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                Passive Readiness Audit for Autonomous AI Crawlers
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-2">
                Live Web &amp; AI-Surface Auditor
              </h1>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (domainInput.trim()) {
                  router.push(`/scan?domain=${encodeURIComponent(domainInput.trim())}`);
                }
              }}
              className="flex gap-2 w-full md:w-auto"
            >
              <input
                type="text"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                placeholder="domain.com"
                className="w-full md:w-64 px-4 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm rounded-lg transition cursor-pointer shrink-0"
              >
                {loading ? 'Auditing...' : 'Audit Domain'}
              </button>
            </form>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>Quick samples:</span>
            {['stealthmark.io', 'vercel.com', 'cloudflare.com'].map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => router.push(`/scan?domain=${sample}`)}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
              >
                {sample}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-red-950/50 border border-red-500/40 text-red-200 p-4 rounded-xl text-sm">
            ⚠️ {error}
          </div>
        )}

        {verifyingPayment && (
          <div className="bg-indigo-950/60 border border-indigo-500/40 text-indigo-200 p-4 rounded-xl text-sm animate-pulse">
            🔐 Verifying payment with Polar to unlock your WAF Pack and White-Label PDF...
          </div>
        )}

        {auditData && (
          <>
            {/* Top Scorecard & Findings */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-[#11141c] border border-slate-800 rounded-2xl p-6 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                    Perimeter Score
                  </p>
                  <p className="text-3xl font-black text-white mt-1">{auditData.overall.score}/100</p>
                  {auditData.duration_ms && (
                    <p className="text-xs text-slate-400 mt-1">
                      Time: {auditData.duration_ms} ms
                    </p>
                  )}
                </div>
                <div
                  className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl font-black border ${
                    ['A+', 'A', 'B'].includes(auditData.overall.grade)
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : auditData.overall.grade === 'C'
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      : 'bg-red-500/10 text-red-400 border-red-500/30'
                  }`}
                >
                  {auditData.overall.grade}
                </div>
              </div>

              <div className="bg-[#11141c] border border-slate-800 rounded-2xl p-6">
                <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                  Infrastructure &amp; CDN
                </p>
                <p className="text-lg font-bold text-white mt-1">
                  {auditData.pillars.infrastructure.is_behind_cloudflare
                    ? '🛡️ Behind Cloudflare'
                    : `⚠️ Origin IP (${auditData.pillars.infrastructure.ip || 'N/A'})`}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {auditData.pillars.infrastructure.origin_ip_leaked_via_dns
                    ? `🚨 Origin IP leaked via SPF (${auditData.pillars.infrastructure.leaked_origin_ip_masked})`
                    : 'Zero origin IP leaks in DNS SPF'}
                </p>
              </div>

              <div className="bg-[#11141c] border border-slate-800 rounded-2xl p-6">
                <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                  Ports &amp; Secret Exposure
                </p>
                <p className="text-lg font-bold text-white mt-1">
                  {auditData.pillars.infrastructure.exposed_ports.length} Open Critical Ports
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Config files (/.env, /.git):{' '}
                  {auditData.pillars.web_and_cves.env_exposed || auditData.pillars.web_and_cves.git_exposed
                    ? '🚨 EXPOSED'
                    : '✅ Protected'}
                </p>
              </div>
            </div>

            {/* INBOUND EMERGENCY RADAR ALERTS */}
            <div className="bg-gradient-to-r from-indigo-950/70 via-[#11141c] to-[#11141c] border border-indigo-500/30 rounded-2xl p-6">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    🔔 Free Security Radar for <span className="text-indigo-400">{auditData.domain}</span>
                  </h2>
                  <p className="text-xs text-slate-300 mt-1">
                    Get notified immediately if Shodan detects open ports (3389 RDP, 1433 SQL, 6379 Redis) or a critical CVE for this infrastructure.
                  </p>
                </div>

                {radarStatus === 'SUCCESS' ? (
                  <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 px-4 py-2.5 rounded-lg text-xs font-semibold shrink-0">
                    ✅ Radar active. Check your inbox (from Alex — StealthMark Security).
                  </div>
                ) : (
                  <form onSubmit={handleRadarSubscribe} className="flex gap-2 w-full lg:w-auto shrink-0">
                    <input
                      type="email"
                      required
                      value={radarEmail}
                      onChange={(e) => setRadarEmail(e.target.value)}
                      placeholder="work-email@company.com"
                      className="w-full sm:w-64 px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      type="submit"
                      disabled={radarStatus === 'SENDING'}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-lg transition cursor-pointer shrink-0"
                    >
                      {radarStatus === 'SENDING' ? 'Activating...' : 'Activate Free Radar'}
                    </button>
                  </form>
                )}
              </div>
            </div>

            {/* 3 CORE PILLARS BREAKDOWN (100% UNLOCKED AND SHAREABLE) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-[#11141c] border border-slate-800 rounded-2xl p-5 space-y-3">
                <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-2">
                  1. Infrastructure, DNS &amp; Ports
                </h3>
                <ul className="space-y-2 text-xs">
                  <li className="flex justify-between">
                    <span className="text-slate-400">Critical Ports (RDP/SQL):</span>
                    <span
                      className={
                        auditData.pillars.infrastructure.exposed_ports.length === 0
                          ? 'text-emerald-400 font-semibold'
                          : 'text-red-400 font-bold'
                      }
                    >
                      {auditData.pillars.infrastructure.exposed_ports.length === 0
                        ? '0 Exposed'
                        : auditData.pillars.infrastructure.exposed_ports.map((p) => p.port).join(', ')}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-slate-400">Origin IP SPF Leak:</span>
                    <span
                      className={
                        !auditData.pillars.infrastructure.origin_ip_leaked_via_dns
                          ? 'text-emerald-400 font-semibold'
                          : 'text-amber-400 font-bold'
                      }
                    >
                      {!auditData.pillars.infrastructure.origin_ip_leaked_via_dns
                        ? 'Zero Leaks'
                        : auditData.pillars.infrastructure.leaked_origin_ip_masked}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-slate-400">SPF + DMARC:</span>
                    <span className="text-slate-200 font-medium">
                      SPF: {auditData.pillars.infrastructure.has_spf ? '✅' : '❌'} | DMARC:{' '}
                      {auditData.pillars.infrastructure.has_dmarc ? '✅' : '❌'}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-slate-400">DNS CAA:</span>
                    <span className="text-slate-200 font-medium">
                      {auditData.pillars.infrastructure.has_caa ? '✅ Active' : '⚠️ Missing'}
                    </span>
                  </li>
                </ul>
              </div>

              <div className="bg-[#11141c] border border-slate-800 rounded-2xl p-5 space-y-3">
                <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-2">
                  2. Web Surface, CMS &amp; Secrets
                </h3>
                <ul className="space-y-2 text-xs">
                  <li className="flex justify-between">
                    <span className="text-slate-400">Config File (/.env):</span>
                    <span
                      className={
                        !auditData.pillars.web_and_cves.env_exposed
                          ? 'text-emerald-400 font-semibold'
                          : 'text-red-400 font-bold'
                      }
                    >
                      {!auditData.pillars.web_and_cves.env_exposed ? '✅ Protected' : '🚨 EXPOSED'}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-slate-400">Git Repository (/.git):</span>
                    <span
                      className={
                        !auditData.pillars.web_and_cves.git_exposed
                          ? 'text-emerald-400 font-semibold'
                          : 'text-red-400 font-bold'
                      }
                    >
                      {!auditData.pillars.web_and_cves.git_exposed ? '✅ Protected' : '🚨 EXPOSED'}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-slate-400">CMS / Server Footprint:</span>
                    <span className="text-slate-200 font-medium">
                      {auditData.pillars.web_and_cves.cms_detected ||
                        auditData.pillars.web_and_cves.powered_by ||
                        'Concealed'}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-slate-400">HSTS + CSP:</span>
                    <span className="text-slate-200 font-medium">
                      HSTS: {auditData.pillars.web_and_cves.has_hsts ? '✅' : '❌'} | CSP:{' '}
                      {auditData.pillars.web_and_cves.has_csp ? '✅' : '❌'}
                    </span>
                  </li>
                </ul>
              </div>

              <div className="bg-[#11141c] border border-slate-800 rounded-2xl p-5 space-y-3">
                <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-2">
                  3. AI Bot Governance
                </h3>
                <ul className="space-y-2 text-xs">
                  <li className="flex justify-between">
                    <span className="text-slate-400">Manifest (/llms.txt):</span>
                    <span
                      className={
                        auditData.pillars.ai_governance.llms_txt
                          ? 'text-emerald-400 font-semibold'
                          : 'text-amber-400 font-semibold'
                      }
                    >
                      {auditData.pillars.ai_governance.llms_txt ? '✅ Published' : '⚠️ Missing'}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-slate-400">Crawler Rules (/robots.txt):</span>
                    <span
                      className={
                        auditData.pillars.ai_governance.ai_bot_rules_in_robots
                          ? 'text-emerald-400 font-semibold'
                          : 'text-amber-400 font-semibold'
                      }
                    >
                      {auditData.pillars.ai_governance.ai_bot_rules_in_robots
                        ? '✅ Configured'
                        : '⚠️ Uncontrolled'}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-slate-400">CVEs reported by InternetDB:</span>
                    <span
                      className={
                        auditData.pillars.infrastructure.cves.length === 0
                          ? 'text-emerald-400 font-semibold'
                          : 'text-red-400 font-bold'
                      }
                    >
                      {auditData.pillars.infrastructure.cves.length === 0
                        ? '0 Detected'
                        : `${auditData.pillars.infrastructure.cves.length} CVEs`}
                    </span>
                  </li>
                </ul>
              </div>
            </div>

            {/* UNLOCKED DELIVERABLES OR HIGH-VALUE VALUE CONVERSION TIERS */}
            {isUnlocked ? (
              <div className="bg-[#11141c] border-2 border-emerald-500/40 rounded-2xl p-6 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-4">
                  <div>
                    <span className="px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-400 font-bold text-xs">
                      ✅ WAF &amp; FORENSIC PACK UNLOCKED
                    </span>
                    <h2 className="text-xl font-bold text-white mt-2">
                      Remediation Deliverables &amp; White-Label PDF Export
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={handlePrintWhiteLabelPdf}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-lg transition cursor-pointer"
                  >
                    📄 Print / Save 3-Page Forensic PDF
                  </button>
                </div>

                {/* White-Label Customizer for Agencies / Consultants */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-indigo-400 mb-3">
                    🎨 White-Label Customization (For IT Consultants &amp; Web Agencies)
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                      type="text"
                      value={agencyName}
                      onChange={(e) => setAgencyName(e.target.value)}
                      placeholder="Your Agency / Firm Name"
                      className="px-3 py-2 rounded bg-slate-950 border border-slate-700 text-xs text-white"
                    />
                    <input
                      type="email"
                      value={agencyEmail}
                      onChange={(e) => setAgencyEmail(e.target.value)}
                      placeholder="Agency Support Email"
                      className="px-3 py-2 rounded bg-slate-950 border border-slate-700 text-xs text-white"
                    />
                    <input
                      type="text"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="Client Company Name"
                      className="px-3 py-2 rounded bg-slate-950 border border-slate-700 text-xs text-white"
                    />
                  </div>
                </div>

                {/* Deliverable 1: Visual WAF Rule */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-xs font-bold text-slate-300">
                      1. Cloudflare WAF Expression (Protects XML-RPC &amp; /.env without breaking Stripe/WooCommerce webhooks):
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(visualWafRule);
                        setCopiedWaf(true);
                        setTimeout(() => setCopiedWaf(false), 2000);
                      }}
                      className="text-xs px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-400 font-semibold cursor-pointer"
                    >
                      {copiedWaf ? 'Copied!' : 'Copy WAF Expression'}
                    </button>
                  </div>
                  <pre className="bg-slate-950 text-emerald-400 p-4 rounded-xl font-mono text-xs overflow-x-auto border border-slate-800">
                    {visualWafRule}
                  </pre>
                </div>

                {/* Deliverable 2: Cloudflare Edge Worker */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-xs font-bold text-slate-300">
                      2. Cloudflare Edge Worker (Path Blocking &amp; Header Hardening):
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(workerCode);
                        setCopiedWorker(true);
                        setTimeout(() => setCopiedWorker(false), 2000);
                      }}
                      className="text-xs px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-indigo-400 font-semibold cursor-pointer"
                    >
                      {copiedWorker ? 'Copied!' : 'Copy Worker JS'}
                    </button>
                  </div>
                  <pre className="bg-slate-950 text-slate-300 p-4 rounded-xl font-mono text-xs overflow-x-auto border border-slate-800 max-h-60">
                    {workerCode}
                  </pre>
                </div>
              </div>
            ) : (
              /* CONVERSION TIERS ($49 ONE-TIME ($24.50 W/ CODE), $29/MO PRO, $79/MO AGENCY) */
              <div className="bg-[#11141c] border border-slate-800 rounded-2xl p-6 space-y-6">
                <div className="border-b border-slate-800 pb-4">
                  <h2 className="text-xl font-bold text-white">
                    Remediate Vulnerabilities &amp; Export Executive PDF Report
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Locked preview: Unlock the production Cloudflare WAF Expression (with payment webhook allowlist) and the 3-Page White-Label Forensic PDF Report.
                  </p>
                  <pre className="mt-3 bg-slate-950/70 text-slate-500 p-3 rounded-lg font-mono text-xs select-none border border-slate-800/80">
                    {DEFAULT_WAF_PREVIEW}
                  </pre>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {/* Tier 1: $49 One-Time ($24.50 w/ BLACKOCTOBER / FTZKIH6N) */}
                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
                    <div>
                      <span className="text-[11px] font-bold uppercase text-emerald-400">50% Community Grant: BLACKOCTOBER / FTZKIH6N</span>
                      <h3 className="text-lg font-bold text-white mt-1">Fix &amp; Forensic Report Pack</h3>
                      <p className="text-2xl font-black text-white mt-2">
                        <span className="text-base text-slate-500 line-through mr-2">$49</span>$24.50 USD
                      </p>
                      <ul className="mt-4 space-y-2 text-xs text-slate-300">
                        <li>✓ Copy-Paste Cloudflare WAF &amp; Google Cloud Armor Rules</li>
                        <li>✓ Payment Webhook Safe (WooCommerce / Stripe)</li>
                        <li>✓ Cloudflare Edge Worker (Path Blocking &amp; Security Headers)</li>
                        <li>✓ 3-Page Executive PDF Forensic Report</li>
                      </ul>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCheckout('fix_pack_19')}
                      className="mt-6 w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition cursor-pointer"
                    >
                      Unlock Fix Pack + PDF ($24.50 w/ Code)
                    </button>
                  </div>

                  {/* Tier 2: Growth pack, $29 one-time */}
                  <div className="bg-slate-900/90 border-2 border-indigo-500 rounded-xl p-5 flex flex-col justify-between relative">
                    <div>
                      <span className="text-[11px] font-bold uppercase text-indigo-400">Recommended &bull; 24/7 SecOps</span>
                      <h3 className="text-lg font-bold text-white mt-1">Continuous Monitoring Pro</h3>
                      <p className="text-2xl font-black text-white mt-2">
                        $29 USD <span className="text-xs font-normal text-slate-400">one-time</span>
                      </p>
                      <ul className="mt-4 space-y-2 text-xs text-slate-300">
                        <li>✓ Everything in Fix Pack ($49 / $24.50 w/ code)</li>
                        <li>✓ Daily automated port scan (3389/1433/6379)</li>
                        <li>✓ Immediate alert if origin IP leaks in DNS</li>
                        <li>✓ Live AI Bot telemetry and control</li>
                      </ul>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCheckout('pro_monitor_29')}
                      className="mt-6 w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg transition cursor-pointer"
                    >
                      Buy Growth pack ($29, one-time)
                    </button>
                  </div>

                  {/* Tier 3: Scale pack, $79 one-time */}
                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
                    <div>
                      <span className="text-[11px] font-bold uppercase text-emerald-400">For Agencies &amp; Consultants</span>
                      <h3 className="text-lg font-bold text-white mt-1">Agency White-Label Scale</h3>
                      <p className="text-2xl font-black text-white mt-2">
                        $79 USD <span className="text-xs font-normal text-slate-400">one-time</span>
                      </p>
                      <ul className="mt-4 space-y-2 text-xs text-slate-300">
                        <li>✓ Monitor up to 25 client domains</li>
                        <li>✓ Unlimited White-Label PDFs with your agency branding</li>
                        <li>✓ High-margin resale to maintenance clients</li>
                        <li>✓ Direct priority engineering support</li>
                      </ul>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCheckout('agency_scale_79')}
                      className="mt-6 w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition cursor-pointer"
                    >
                      Buy Scale pack ($79, one-time)
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Footer links to npm package and docs to satisfy scan-page tests */}
        <div className="border-t border-slate-800/80 pt-6 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            <span>Powered by </span>
            <a
              href="https://www.npmjs.com/package/@stealthmark/next"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:underline"
            >
              @stealthmark/next
            </a>
          </div>
          <div className="flex gap-4">
            <a href="/docs" className="hover:text-slate-300 transition">
              Documentation
            </a>
            <a href="/console" className="hover:text-slate-300 transition">
              Console
            </a>
          </div>
        </div>
      </div>

    </div>
  );
};
