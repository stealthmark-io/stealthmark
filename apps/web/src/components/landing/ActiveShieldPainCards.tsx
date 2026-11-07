import React from 'react';
import Link from 'next/link';
import { ShieldAlert, Lock, Cpu, Zap, ArrowRight, CheckCircle2 } from 'lucide-react';
import { FIX_PACK } from '@/lib/offer';

const PAIN_CARDS = [
  {
    tag: 'VECTOR 01 · IDENTITY & MFA RELAY',
    title: 'Adversary-in-the-Middle (AiTM) & Session Replay',
    problem:
      'Modern phishing kits (Evilginx2, Modlishka, Muraena) proxy your login page in real time, relay MFA codes, and steal session cookies to hijack accounts effortlessly.',
    solution:
      'StealthMark Worker v5.1 enforces cryptographic TLS/JA4 Session Binding (__Host-sm_bind) and 48h VPN Zero-Day Gates (SonicWall SMA 1000, Cisco ASA, Ivanti) at the edge—invalidating stolen cookies the millisecond they are replayed.',
    badge: 'Mitigated by Edge Worker v5.1 (JA4 Binding)',
    color: 'border-rose-500/35 bg-rose-950/10',
    accent: 'text-rose-400',
  },
  {
    tag: 'VECTOR 02 · CLIENT-SIDE DOM & WEAPONIZED PDFS',
    title: 'Weaponized PDF Uploads, DOM Cloning & Autofill Traps',
    problem:
      'Malicious PDF resumes/invoices execute /JavaScript or /Launch commands or inject hidden AI prompts, while third-party scripts inject opacity:0 <input> traps to harvest credentials.',
    solution:
      'Our Edge PDF CDR Inspector blocks executable PDF dictionaries & prompt injections in <1ms, while our <3KB Client-Side RASP (stealthmark-client-shield.js) locks your UI to your domain signature and neutralizes hidden autofill inputs.',
    badge: 'Mitigated by PDF CDR + Client RASP (<3KB)',
    color: 'border-amber-500/35 bg-amber-950/10',
    accent: 'text-amber-400',
  },
  {
    tag: 'VECTOR 03 · NODE2SHELL, SSRF & AGENTIC MCP',
    title: 'Node2Shell Brotli RCE, SSRF & Exposed MCP (/_next/mcp)',
    problem:
      'Crafted Content-Encoding: br payloads trigger Node2Shell (CVE-2026-111497) RCE, SSRF callbacks target cloud metadata (169.254.169.254 / IPv6 fd00:ec2::254), and unauthenticated /_next/mcp routes expose AI agents.',
    solution:
      'Edge Worker v5.1 virtually patches Node2Shell Brotli streams, blocks IPv4/IPv6 SSRF metadata & DNS-rebinding probes, and traps scanners on /.env, /.git/config & /_next/mcp.',
    badge: 'Mitigated by Worker v5.1 + 60-Point Audit',
    color: 'border-cyan-500/35 bg-cyan-950/10',
    accent: 'text-cyan-400',
  },
];

const THREE_PILLARS = [
  {
    icon: ShieldAlert,
    step: 'LAYER 1 · PASSIVE RECON & CLI V5.1',
    title: '60-Point Passive Recon + Viral CLI (doctor & pdf-check)',
    bullets: [
      'Identity & Cookie Hardening: __Host- prefixes, SameSite=Strict, and FIDO2/WebAuthn posture.',
      'Local Host & PDF Auditing: Run `npx @stealthmark/cli doctor` (SUID, Node2Shell, TeamViewer) & `pdf-check`.',
      'Post-Quantum & Subdomain Takeover: TLS 1.3 hybrid key exchange (X25519MLKEM768) & dangling CNAME checks.',
    ],
  },
  {
    icon: Lock,
    step: 'LAYER 2 · EDGE WORKER V5.1',
    title: 'Active Edge Shield (stealthmark-worker-v5.1.js)',
    bullets: [
      'JA4 Session Binding & 48h VPN Gate: Protects sessions plus SonicWall (/amc/), Cisco (/+CSCOE+/) & Ivanti.',
      'Node2Shell & Anti-SSRF Guard: Blocks inbound Brotli RCE (CVE-2026-111497) and IPv4/IPv6 metadata SSRF.',
      'Static PDF CDR Firewall: Rejects uploaded PDFs with /JavaScript, /Launch, XXE, or AI prompt injections.',
    ],
  },
  {
    icon: Cpu,
    step: 'LAYER 3 · BROWSER RASP (<3KB)',
    title: 'Client-Side DOM Firewall (stealthmark-client-shield.js)',
    bullets: [
      'Cryptographic Domain Lock: Disables forms and alerts telemetry if your UI is cloned on a phishing domain.',
      'Autofill Trap Neutralizer: Real-time MutationObserver blocks hidden <input> credential harvesting.',
      'WebRTC STUN/TURN Firewall: Wraps RTCPeerConnection to strip unauthorized ICE servers behind VPNs.',
    ],
  },
];

export function ActiveShieldPainCards() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 space-y-14 py-12">
      {/* Threat Landscape Header */}
      <div className="text-center max-w-3xl mx-auto space-y-3">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono font-semibold uppercase tracking-wider">
          <span>The 2026 Threat Landscape · Why Static Headers Fail</span>
        </div>
        <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight">
          AI-Generated Phishing Changed the Game.{' '}
          <span className="text-cyan-400">Your Perimeter Needs Active RASP.</span>
        </h2>
        <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
          Attackers deploy reverse-proxy phishing (AiTM), WebRTC IP-leak scripts, and invisible DOM autofill traps in seconds. Traditional scanners only check if <code className="text-slate-200 font-mono">X-Frame-Options</code> is present—StealthMark v2.0 ships the active edge and browser code to neutralize them.
        </p>
      </div>

      {/* 3 Pain Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {PAIN_CARDS.map((card) => (
          <div
            key={card.title}
            className={`p-6 rounded-2xl border ${card.color} backdrop-blur-xl flex flex-col justify-between space-y-5 shadow-xl`}
          >
            <div className="space-y-3">
              <div className={`text-[10px] font-mono font-bold uppercase tracking-widest ${card.accent}`}>
                {card.tag}
              </div>
              <h3 className="text-lg font-extrabold text-white leading-snug">{card.title}</h3>
              <div className="space-y-2.5 text-xs leading-relaxed">
                <p className="text-slate-300">
                  <strong className="text-rose-300">The Threat:</strong> {card.problem}
                </p>
                <p className="text-slate-200">
                  <strong className="text-emerald-300">StealthMark v2 Fix:</strong> {card.solution}
                </p>
              </div>
            </div>
            <div className="pt-3 border-t border-white/10 flex items-center justify-between text-[11px] font-mono">
              <span className="text-emerald-400 font-semibold">✓ {card.badge}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 3 Layers of Active Shield Pro */}
      <div className="rounded-3xl bg-[#0B0F19]/90 border border-white/10 p-6 sm:p-10 space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-emerald-400 font-bold">
              Architecture of a Grade A+ Domain
            </div>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-white mt-1">
              Three Layers of Defense. One 60-Second Deployment.
            </h3>
          </div>
          <Link
            href="/scan"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition shrink-0"
          >
            <Zap className="w-4 h-4" />
            <span>
              Scan &amp; Unlock the {FIX_PACK.label} ({FIX_PACK.starterPriceLabel} per domain)
            </span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {THREE_PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <div key={pillar.title} className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.07] space-y-3">
                <div className="flex items-center gap-2 text-cyan-400 font-mono text-[10px] font-bold uppercase tracking-wider">
                  <Icon className="w-4 h-4" />
                  <span>{pillar.step}</span>
                </div>
                <h4 className="text-base font-bold text-white">{pillar.title}</h4>
                <ul className="space-y-2 text-xs text-slate-300 leading-relaxed">
                  {pillar.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
