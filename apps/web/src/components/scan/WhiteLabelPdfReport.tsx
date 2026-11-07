'use client';

import React from 'react';
import {
  computeExecutiveScorecard,
  SECTION_TITLES,
  statusLabel,
  type AuditCheckItem,
  type AuditReport,
  type ExecutiveScorecard,
} from '@/lib/readiness-report';
import { CLOUDFLARE_WAF_RULE } from '@/lib/fix-pack-deliverables';

interface WhiteLabelPdfReportProps {
  report: AuditReport;
  agencyName?: string;
  agencyEmail?: string;
  clientName?: string;
  visualWafRule?: string;
}

const STATUS_CLASSES: Record<AuditCheckItem['status'], string> = {
  pass: 'text-emerald-700 bg-emerald-50',
  warn: 'text-amber-700 bg-amber-50',
  fail: 'text-red-700 bg-red-50',
  error: 'text-red-700 bg-red-50',
  info: 'text-sky-700 bg-sky-50',
  not_assessed: 'text-slate-600 bg-slate-100',
};

const PILLAR_NAMES: Record<keyof ExecutiveScorecard['pillars'], string> = {
  infrastructure: 'Infrastructure (Transport, TLS & DNS)',
  web_runtime: 'Web Runtime (Defense Headers)',
  ai_governance: 'AI Governance (Crawl Policy & AI Discovery Surface)',
};

// Rendered only from a server-unlocked report: every row maps a real check, and a check that did not run
// prints NOT ASSESSED instead of PASS (D-7).
export const WhiteLabelPdfReport: React.FC<WhiteLabelPdfReportProps> = ({
  report,
  agencyName = '',
  agencyEmail = '',
  clientName = '',
  visualWafRule = '',
}) => {
  const issuerName = agencyName.trim() || 'StealthMark Security Team';
  const issuerContact = agencyEmail.trim() || 'security@stealthmark.io';
  const recipientName = clientName.trim() || report.domain;
  const auditDate = report.audited_at.split('T')[0];
  const wafRule = visualWafRule || CLOUDFLARE_WAF_RULE;

  const scorecard = computeExecutiveScorecard(report);
  const counts = report.summary.counts;
  const checks = Object.entries(report.sections).flatMap(([key, items]) =>
    items.map((item) => ({ ...item, pillar: SECTION_TITLES[key]?.title ?? key }))
  );
  const priorityFixes = [
    ...checks.filter((item) => item.status === 'fail' || item.status === 'error'),
    ...checks.filter((item) => item.status === 'warn'),
  ];

  return (
    <div className="hidden print:block bg-white text-slate-900 font-sans text-xs leading-relaxed">
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 12mm;
          }
          body {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            background-color: #ffffff !important;
          }
          .page-break {
            page-break-before: always;
            break-before: page;
          }
        }
      `}</style>

      {/* PAGE 1: EXECUTIVE SUMMARY & FINANCIAL RISK */}
      <div className="min-h-[265mm] flex flex-col justify-between">
        <div>
          <div className="flex justify-between items-start border-b-2 border-slate-900 pb-4 mb-6">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                EXECUTIVE &amp; FORENSIC ATTACK SURFACE REPORT (PASSIVE)
              </p>
              <h1 className="text-2xl font-extrabold text-slate-900 mt-1">{issuerName}</h1>
              <p className="text-xs text-slate-600">SecOps Contact: {issuerContact}</p>
            </div>
            <div className="text-right">
              <span className="inline-block bg-slate-900 text-white text-[10px] font-bold px-2.5 py-1 rounded">
                CONFIDENTIAL — EXECUTIVE USE
              </span>
              <p className="text-xs text-slate-600 mt-1">Audit date: {auditDate}</p>
              <p className="text-xs font-semibold text-slate-800">Target: {report.domain}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-6 bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div>
              <p className="text-[10px] uppercase text-slate-500 font-bold">Audited Entity</p>
              <p className="text-base font-bold text-slate-900 mt-0.5">{recipientName}</p>
              <p className="text-xs text-slate-600">Domain: {report.domain}</p>
              <p className="text-xs text-slate-600">Checks run: {checks.length - (counts.not_assessed ?? 0)} of {checks.length}</p>
            </div>
            <div className="border-x border-slate-200 px-4">
              <p className="text-[10px] uppercase text-slate-500 font-bold">Perimeter Grade</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-3xl font-black text-slate-900">{scorecard.grade}</span>
                <span className="text-sm font-bold text-slate-600">({scorecard.score} / 100)</span>
              </div>
              <p className="text-[11px] text-slate-600 mt-1">{scorecard.label}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500 font-bold">Findings</p>
              <p className="text-base font-bold text-red-700 mt-0.5">
                {counts.fail + counts.error} Failing | {counts.warn} Warnings
              </p>
              <p className="text-xs text-slate-600">
                {counts.pass} passed · {counts.not_assessed ?? 0} not assessed
              </p>
            </div>
          </div>

          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 mb-2">
            1. Risk Diagnostic &amp; Remediation
          </h2>
          <p className="text-xs text-slate-700 mb-4 text-justify">
            This passive evaluation checks the surface that automated reconnaissance bots see
            (including <code>zgrab</code>, <code>masscan</code>, and <code>nuclei</code>) prior to ransomware or credential
            stuffing campaigns. Leaving ports like <strong>3389 RDP</strong> or <strong>1433 SQL Server</strong> accessible
            to the internet or leaking origin IPs represents an immediate threat vector. Checks that could not run are
            reported as NOT ASSESSED and never count as passed.
          </p>

          <table className="w-full border-collapse border border-slate-300 text-xs mb-6">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="p-2 text-left">Deliverable</th>
                <th className="p-2 text-left">Scope</th>
                <th className="p-2 text-right">Availability</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-emerald-50">
                <td className="p-2 font-bold text-emerald-900">
                  Cloudflare Edge Rule &amp; Worker
                </td>
                <td className="p-2 text-emerald-800">
                  Cloudflare WAF custom rule + edge Worker you deploy in your own Cloudflare account
                </td>
                <td className="p-2 text-right font-black text-emerald-900">Included in this report</td>
              </tr>
            </tbody>
          </table>

          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 mb-2">
            2. Core Security Pillars Status
          </h2>
          <div className="space-y-3">
            {(Object.keys(PILLAR_NAMES) as (keyof ExecutiveScorecard['pillars'])[]).map((key) => (
              <div key={key} className="p-3 border border-slate-200 rounded">
                <p className="font-bold text-slate-900">
                  {PILLAR_NAMES[key]}: {scorecard.pillars[key].status}
                </p>
                <p className="text-slate-700 mt-0.5">
                  {scorecard.pillars[key].pass} checks passed, {scorecard.pillars[key].issues} need attention.
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-300 pt-3 flex justify-between text-[10px] text-slate-500">
          <span>Generated by StealthMark v2.1 Engine — {issuerName}</span>
          <span>Page 1 of 3</span>
        </div>
      </div>

      {/* PAGE 2: FORENSIC MATRIX */}
      <div className="page-break min-h-[265mm] flex flex-col justify-between">
        <div>
          <div className="flex justify-between items-center border-b border-slate-300 pb-2 mb-4">
            <h2 className="text-base font-extrabold text-slate-900">
              {checks.length}-Point Forensic Security Matrix ({report.domain})
            </h2>
            <span className="text-[10px] font-bold text-slate-500">{issuerName}</span>
          </div>

          <table className="w-full border-collapse border border-slate-300 text-[10.5px]">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="p-1.5 text-left w-14">Code</th>
                <th className="p-1.5 text-left w-24">Pillar</th>
                <th className="p-1.5 text-left">Control Item</th>
                <th className="p-1.5 text-center w-16">Status</th>
                <th className="p-1.5 text-left">Detail / Finding</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((item) => (
                <tr key={item.id} className="border-b border-slate-200">
                  <td className="p-1.5 font-mono font-bold text-slate-700">{item.id}</td>
                  <td className="p-1.5 text-slate-600">{item.pillar}</td>
                  <td className="p-1.5 font-medium text-slate-900">
                    {item.title}
                    {item.owaspGate && (
                      <span className="block text-[9px] font-normal text-slate-500">
                        OWASP {item.owaspGate.code} · {item.owaspGate.label.en}
                      </span>
                    )}
                  </td>
                  <td className="p-1.5 text-center font-bold">
                    <span className={`${STATUS_CLASSES[item.status]} px-1.5 py-0.5 rounded`}>{statusLabel(item.status)}</span>
                  </td>
                  <td className="p-1.5 text-slate-600">{item.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {report.limitations.length > 0 && (
            <div className="mt-4 text-[10px] text-slate-600">
              <p className="font-bold uppercase text-slate-800">Scope &amp; limitations</p>
              <ul className="list-disc pl-4 mt-1 space-y-0.5">
                {report.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="border-t border-slate-300 pt-3 flex justify-between text-[10px] text-slate-500">
          <span>Technical Attack Surface Audit — {report.domain}</span>
          <span>Page 2 of 3</span>
        </div>
      </div>

      {/* PAGE 3: REMEDIATION GUIDE & WAF RULES */}
      <div className="page-break min-h-[265mm] flex flex-col justify-between">
        <div>
          <div className="flex justify-between items-center border-b border-slate-300 pb-2 mb-4">
            <h2 className="text-base font-extrabold text-slate-900">
              5-Minute Remediation Plan
            </h2>
            <span className="text-[10px] font-bold text-slate-500">{issuerName}</span>
          </div>

          {priorityFixes.length > 0 && (
            <div className="mb-5">
              <h3 className="text-xs font-bold uppercase text-slate-900 mb-1">Priority Fixes</h3>
              <ol className="list-decimal pl-4 space-y-1 text-[10.5px] text-slate-700">
                {priorityFixes.map((item) => (
                  <li key={item.id}>
                    <strong>
                      {item.id} · {item.title} ({statusLabel(item.status)})
                    </strong>
                    : {item.recommendation || item.detail}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="mb-5">
            <h3 className="text-xs font-bold uppercase text-slate-900 mb-1">
              Step 1: Cloudflare WAF Custom Rule (Allowlists E-Commerce Webhooks)
            </h3>
            <p className="text-[11px] text-slate-600 mb-2">
              Apply in <strong>Cloudflare &rarr; Security &rarr; WAF &rarr; Custom Rules &rarr; Edit Expression</strong> with action <strong>Block</strong>:
            </p>
            <pre className="bg-slate-900 text-emerald-400 p-3 rounded font-mono text-[10px] whitespace-pre-wrap break-all border border-slate-800">
              {wafRule}
            </pre>
          </div>

          <div className="mb-5">
            <h3 className="text-xs font-bold uppercase text-slate-900 mb-1">
              Step 2: Isolate Critical Infrastructure Ports
            </h3>
            <pre className="bg-slate-100 text-slate-800 p-3 rounded font-mono text-[10px] whitespace-pre-wrap border border-slate-300">
{`# Linux (UFW) — Block public DB & cache ports:
sudo ufw deny in on eth0 to any port 3306,5432,6379,27017 proto tcp

# Windows Server (PowerShell Admin) — Block public RDP 3389 and SQL 1433:
New-NetFirewallRule -DisplayName "Block Public RDP & SQL" -Direction Inbound -LocalPort 3389,1433 -Protocol TCP -Action Block`}
            </pre>
          </div>

          <div className="mb-6">
            <h3 className="text-xs font-bold uppercase text-slate-900 mb-1">
              Step 3: AI Crawler Policy (/robots.txt)
            </h3>
            <pre className="bg-slate-100 text-slate-800 p-3 rounded font-mono text-[10px] whitespace-pre-wrap border border-slate-300">
{`# Allow real-time search grounding agents
User-agent: OAI-SearchBot
Allow: /
Disallow: /api/
Disallow: /admin/

# Block unauthorized bulk scraping for training
User-agent: GPTBot
User-agent: CCBot
Disallow: /`}
            </pre>
          </div>

          <div className="bg-slate-50 border border-slate-300 rounded-lg p-4 mt-6">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs font-bold text-slate-900">Passive Attack Surface Audit</p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Prepared by: <strong>{issuerName}</strong> | Contact: <strong>{issuerContact}</strong>
                </p>
                <p className="text-[10px] text-slate-500 mt-1">
                  Issued by StealthMark Security Team &lt;security@stealthmark.io&gt;
                </p>
              </div>
              <div className="text-right">
                <span className="inline-block bg-emerald-900 text-white text-[10px] font-bold px-3 py-1.5 rounded">
                  VERIFIED BY STEALTHMARK v2.1
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-300 pt-3 flex justify-between text-[10px] text-slate-500">
          <span>Confidential security report for {recipientName}</span>
          <span>Page 3 of 3</span>
        </div>
      </div>
    </div>
  );
};
