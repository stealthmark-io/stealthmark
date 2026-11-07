import React from 'react';
import Link from 'next/link';
import { Navbar, Footer } from '@/components/landing';
import { getLiveDomainPosture } from '@/lib/live-domain-posture';
import { FIX_PACK } from '@/lib/offer';

export const dynamic = 'force-dynamic';

export default async function VerifyDomainPage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain } = await params;
  const posture = await getLiveDomainPosture(decodeURIComponent(domain || ''));
  const isOptimal = posture.grade === 'A+' || posture.grade === 'A';

  const gradeBorder = isOptimal
    ? 'border-emerald-500/40 shadow-emerald-950/25'
    : posture.grade === 'B' || posture.grade === 'C'
    ? 'border-amber-500/40 shadow-amber-950/20'
    : 'border-rose-500/40 shadow-rose-950/25';

  const gradeText = isOptimal
    ? 'text-emerald-400'
    : posture.grade === 'B' || posture.grade === 'C'
    ? 'text-amber-400'
    : 'text-rose-400';

  const embedSnippet = `<!-- StealthMark Live Security Trust Badge -->
<a href="https://stealthmark.io/verify/${posture.domain}?utm_source=trust_badge" target="_blank" rel="noopener noreferrer" title="Verify Real-Time Security Posture on StealthMark">
  <img src="https://stealthmark.io/api/badge/${posture.domain}.svg" alt="StealthMark Security Posture - Grade ${posture.grade}" width="256" height="32" loading="lazy" />
</a>`;

  return (
    <div className="min-h-screen bg-[#070A12] text-slate-100 flex flex-col">
      <Navbar />
      <main className="flex-1 pt-28 pb-20 px-6">
        <div className="max-w-3xl mx-auto">
          {/* Live Certificate Card */}
          <div className={`rounded-2xl bg-[#0D1322] border ${gradeBorder} p-7 md:p-10 shadow-2xl`}>
            {!isOptimal && (
              <div className="mb-5 p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-mono text-rose-200">
                  <strong className="text-rose-400 uppercase">⚠️ UNVERIFIED PERIMETER POSTURE:</strong> Active Shield JA4 Session Binding &amp; Client-Side RASP are not yet verified on <strong>{posture.domain}</strong>.
                </div>
                <Link
                  href={`/scan?domain=${encodeURIComponent(posture.domain)}`}
                  className="px-3 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-400 text-slate-950 font-mono font-bold text-xs transition shrink-0"
                >
                  Remediate &amp; Verify ({FIX_PACK.starterPriceLabel}) →
                </Link>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-6">
              <div>
                <span className={`inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest ${gradeText}`}>
                  <span className={`h-2 w-2 rounded-full ${isOptimal ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`} />
                  {isOptimal ? 'Live Cryptographic Verification · Active Shield' : 'Passive External Surface Observation'}
                </span>
                <h1 className="text-2xl md:text-3xl font-bold text-white mt-2 break-all">
                  {posture.domain}
                </h1>
                <p className="text-xs font-mono text-slate-400 mt-1">
                  {posture.label} · {posture.passCount} PASSING CONTROLS VERIFIED
                </p>
              </div>
              <div className="bg-black/40 border border-white/10 rounded-xl px-5 py-3 text-center">
                <div className="text-xs font-mono text-slate-300 uppercase">External Grade</div>
                <div className={`text-3xl font-extrabold font-mono ${gradeText}`}>
                  {posture.grade}
                </div>
              </div>
            </div>

            {/* Live Badge Preview */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-black/40 border border-white/5">
              <div className="text-xs font-mono text-slate-300">
                Live SVG Trust Badge (<code className="text-cyan-400">/api/badge/{posture.domain}.svg</code>):
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/badge/${encodeURIComponent(posture.domain)}.svg`}
                alt={`StealthMark Security Badge for ${posture.domain}`}
                width={256}
                height={32}
                className="rounded"
              />
            </div>

            {/* Verified Controls Grid (Redacted for non-owners on non-A+ sites) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6 text-sm">
              <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className={`${isOptimal ? 'text-emerald-400' : 'text-cyan-400'} font-mono text-xs uppercase mb-1`}>
                  {isOptimal ? '✓ Edge Session & Transport Lock' : '🔒 Transport & Session Posture'}
                </div>
                <div className="font-semibold text-white">TLS 1.3, HSTS Preload &amp; JA4 Session Binding</div>
                <p className="text-slate-400 text-xs mt-1">
                  {isOptimal
                    ? 'Strict transport and session cookies verified against AiTM replay and downgrade vectors.'
                    : 'Detailed transport findings are redacted publicly for responsible disclosure. Domain owners can inspect and remediate in /scan.'}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className={`${isOptimal ? 'text-emerald-400' : 'text-cyan-400'} font-mono text-xs uppercase mb-1`}>
                  {isOptimal ? '✓ Client-Side RASP & CSP' : '🔒 Client-Side DOM & CSP Surface'}
                </div>
                <div className="font-semibold text-white">Anti-Cloning &amp; Autofill Trap Shield</div>
                <p className="text-slate-400 text-xs mt-1">
                  {isOptimal
                    ? 'Strict CSP, X-Frame-Options DENY, and Permissions-Policy hardware lock verified.'
                    : 'Specific header gaps are redacted on public verification pages to prevent third-party enumeration.'}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className={`${posture.pillars.ai_governance.issues === 0 ? 'text-emerald-400' : 'text-cyan-400'} font-mono text-xs uppercase mb-1`}>
                  {posture.pillars.ai_governance.issues === 0 ? '✓ Agentic & MCP Surface' : '🔒 Agentic & Crawler Governance'}
                </div>
                <div className="font-semibold text-white">AI Crawler &amp; MCP Route Protection</div>
                <p className="text-slate-400 text-xs mt-1">
                  Audited for unauthorized MCP discovery (<code>/_next/mcp</code>), <code>robots.txt</code> AI directives, and prompt-injection hygiene.
                </p>
              </div>
              <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-emerald-400 font-mono text-xs uppercase mb-1">✓ Autonomous Posture</div>
                <div className="font-semibold text-white">Peacetime Monitoring (DEFCON 5 Baseline)</div>
                <p className="text-slate-400 text-xs mt-1">
                  In standard military DEFCON scale, DEFCON 5 represents normal peacetime baseline monitoring; DEFCON 1 is emergency mutation freeze.
                </p>
              </div>
            </div>

            {/* Methodology & Responsible Disclosure Notice */}
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-[11px] font-mono text-slate-400 leading-relaxed">
              <strong className="text-slate-200">Responsible Disclosure &amp; Methodology:</strong> This certificate reflects non-intrusive passive observation of public HTTP response headers, DNS records, and TLS handshakes (5-minute cache TTL). To protect unverified third-party domains from attacker reconnaissance, individual failing vectors and exploit paths are strictly redacted on this public page.
            </div>

            {/* Embed Snippet for Domain Owners */}
            <div className="mt-6 p-4 rounded-xl bg-black/50 border border-slate-800">
              <div className="text-xs font-mono text-slate-300 mb-2">
                Embed this live verification badge in your website footer or GitHub README:
              </div>
              <pre className="text-[11px] font-mono text-cyan-300 overflow-x-auto whitespace-pre-wrap break-all bg-slate-950/90 p-3 rounded-lg border border-white/5">
                {embedSnippet}
              </pre>
            </div>

            <div className="text-xs font-mono text-slate-400 flex flex-wrap justify-between gap-2 pt-5 mt-6 border-t border-slate-800">
              <span>Engine: StealthMark v2.0 ({posture.totalChecks}-Point Passive Recon)</span>
              <span>Observed: {posture.auditedAt.slice(0, 19).replace('T', ' ')} UTC</span>
            </div>
          </div>

          {/* Viral Acquisition Upsell Box */}
          <div className="mt-10 rounded-2xl bg-gradient-to-r from-emerald-950/60 via-[#0D1322] to-[#0D1322] border border-emerald-500/30 p-8 text-center">
            <span className="inline-block px-3 py-1 rounded-full text-[11px] font-mono font-bold uppercase bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 mb-3">
              {FIX_PACK.label} · {FIX_PACK.starterPriceLabel} one-time per domain
            </span>
            <h2 className="text-xl md:text-2xl font-bold text-white">
              {isOptimal
                ? 'Want to protect your own domain and earn the StealthMark A+ Badge?'
                : `Own ${posture.domain}? Remediate your perimeter and unlock Grade A+`}
            </h2>
            <p className="text-slate-300 text-sm mt-2 max-w-xl mx-auto">
              Deploy the complete <strong>{FIX_PACK.label}</strong> (Cloudflare Worker + Client RASP + WAF Rule + live badge snippet + White-Label PDF) for{' '}
              <strong className="text-white">{FIX_PACK.starterPriceLabel} USD one-time</strong> per domain.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-4">
              <Link
                href={`/scan?domain=${encodeURIComponent(posture.domain)}`}
                className="px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition"
              >
                Inspect &amp; Remediate {posture.domain} →
              </Link>
              <Link
                href="/scan"
                className="px-6 py-3 rounded-xl border border-slate-700 hover:border-slate-500 text-white font-semibold text-sm transition"
              >
                Scan Your Own Domain Free
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
