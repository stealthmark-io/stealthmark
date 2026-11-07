"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowRight, Globe, Search, Mail, CheckCircle2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { SCAN_CHECK_COUNT } from "@/lib/readiness-report";
import { FIX_PACK } from "@/lib/offer";

interface SamplePreview {
  domain: string;
  grade: string;
  score: number;
  passCount: number;
  warnCount: number;
  failCount: number;
  highlights: string[];
}

const SAMPLE_PREVIEWS: Record<string, SamplePreview> = {
  "stealthmark.io": {
    domain: "stealthmark.io",
    grade: "A+",
    score: 100,
    passCount: 60,
    warnCount: 0,
    failCount: 0,
    highlights: [
      "Per-request CSP nonce + JA4 TLS Session Cookie Binding",
      "Client-Side RASP (<3KB) Anti-Cloning & Autofill Trap Guard active",
      "0 exposed Shodan database/RDP ports · /_next/mcp locked",
      "10/10 OWASP Top 10:2025 gates & 60/60 v2.0 checks verified",
    ],
  },
  "openai.com": {
    domain: "openai.com",
    grade: "B",
    score: 84,
    passCount: 48,
    warnCount: 8,
    failCount: 2,
    highlights: [
      "Cloudflare Edge TLS 1.3 + HSTS enforced + SPF/DMARC active",
      "Missing Clipboard-Read Lock & Reporting-Endpoints telemetry",
      "AI agent surface & robots.txt policy rules verified",
      "Run live 60-point audit to inspect full header & RASP posture",
    ],
  },
  "anthropic.com": {
    domain: "anthropic.com",
    grade: "C",
    score: 72,
    passCount: 42,
    warnCount: 10,
    failCount: 1,
    highlights: [
      "Strict HTTPS transport + DNS CAA & DMARC enforcement",
      "Clean frontend JS bundles · 0 exposed Shodan infrastructure ports",
      "Missing CSP form-action lock & Client-Side Autofill RASP headers",
      "Run live 60-point audit to inspect full header & RASP posture",
    ],
  },
  "google.com": {
    domain: "google.com",
    grade: "A-",
    score: 91,
    passCount: 54,
    warnCount: 4,
    failCount: 1,
    highlights: [
      "Global TLS 1.3 + CAA (pki.goog) + strict SPF/DMARC enforcement",
      "0 exposed management ports · hardened origin edge posture",
      "Custom framing & cross-origin policy headers detected",
      "Run live 60-point audit to inspect full header & RASP posture",
    ],
  },
};

const HERO_COPY = {
  en: {
    pill: `STEALTHMARK v5.1 · ${SCAN_CHECK_COUNT}-POINT RECON + PDF CDR, ANTI-SSRF & RASP ENGINE`,
    h1Part1: "Stop AI Phishing, Weaponized PDFs, SSRF,",
    h1Part2: "and 48h VPN Exploits in 60 Seconds.",
    desc: `Audit any domain across ${SCAN_CHECK_COUNT} passive controls—then deploy our Cloudflare Edge Shield v5.1 (JA4 Binding, Node2Shell Brotli Guard, Weaponized PDF CDR, Anti-SSRF IPv4/IPv6 & SonicWall/Cisco/Ivanti Gate) + <3KB Client RASP (${FIX_PACK.label}: ${FIX_PACK.starterPriceLabel} one-time per domain).`,
    ctaPrimary: `Run Free ${SCAN_CHECK_COUNT}-Point v5.1 Audit`,
    ctaSecondary: "Contact Security Engineering",
    placeholder: "Enter domain to audit (e.g. yourcompany.com)",
    btnAudit: `Run ${SCAN_CHECK_COUNT}-Point v5.1 Scan`,
    pills: [
      { title: "v5.1 Passive Recon", desc: `${SCAN_CHECK_COUNT} checks across TLS, DNS, MCP, SSRF & OWASP 2025` },
      { title: "Edge Worker v5.1", desc: "JA4 Binding, Node2Shell, SonicWall/Cisco Gate & Anti-SSRF" },
      { title: "Weaponized PDF CDR", desc: "Blocks /JavaScript, /Launch & AI Prompt Injection in CVs" },
      { title: "Client RASP + CLI v5.1", desc: "<3KB Browser Shield + npx stealthmark doctor & pdf-check" },
    ],
  },
  es: {
    pill: `STEALTHMARK v5.1 · MOTOR DE ${SCAN_CHECK_COUNT} CONTROLES + PDF CDR, ANTI-SSRF & CLIENT RASP`,
    h1Part1: "Frená Phishing AiTM, PDFs Maliciosos, SSRF",
    h1Part2: "y Exploits VPN de 48h en 60 Segundos.",
    desc: `Auditá cualquier dominio en ${SCAN_CHECK_COUNT} controles pasivos y desplegá el Cloudflare Worker v5.1 (JA4 Binding, Anti-Node2Shell, Inspector CDR de PDFs, Anti-SSRF IPv4/IPv6 y Escudo SonicWall/Cisco/Ivanti) + Client RASP <3KB (${FIX_PACK.label}: ${FIX_PACK.starterPriceLabel} pago único por dominio).`,
    ctaPrimary: `Correr Auditoría Gratis v5.1 (${SCAN_CHECK_COUNT} Puntos)`,
    ctaSecondary: "Contactar Ingeniería de Seguridad",
    placeholder: "Ingresá el dominio a auditar (ej. tuempresa.com)",
    btnAudit: `Auditar v5.1 (${SCAN_CHECK_COUNT} Puntos)`,
    pills: [
      { title: "Recon v5.1", desc: `${SCAN_CHECK_COUNT} chequeos en TLS, DNS, /_next/mcp, SSRF y OWASP 2025` },
      { title: "Worker v5.1 Activo", desc: "JA4 Binding, Node2Shell, SonicWall/Cisco Gate y Anti-SSRF" },
      { title: "Inspector PDF CDR", desc: "Bloquea /JavaScript, /Launch e Inyección de Prompts en CVs" },
      { title: "RASP + CLI v5.1", desc: "<3KB Browser Shield + npx stealthmark doctor & pdf-check" },
    ],
  },
  pt: {
    pill: `STEALTHMARK v5.1 · MOTOR DE ${SCAN_CHECK_COUNT} CONTROLES + PDF CDR, ANTI-SSRF & CLIENT RASP`,
    h1Part1: "Bloqueie Phishing AiTM, PDFs Maliciosos, SSRF",
    h1Part2: "e Exploits VPN de 48h em 60 Segundos.",
    desc: `Audite qualquer domínio em ${SCAN_CHECK_COUNT} controles passivos e implante o Cloudflare Worker v5.1 (JA4 Binding, Anti-Node2Shell, PDF CDR, Anti-SSRF IPv4/IPv6 e Escudo SonicWall/Cisco/Ivanti) + Client RASP <3KB (${FIX_PACK.label}: ${FIX_PACK.starterPriceLabel} pagamento único por domínio).`,
    ctaPrimary: `Rodar Auditoria Grátis v5.1 (${SCAN_CHECK_COUNT} Pontos)`,
    ctaSecondary: "Falar com Engenharia de Segurança",
    placeholder: "Digite o domínio para auditar (ex. suaempresa.com)",
    btnAudit: `Auditar v5.1 (${SCAN_CHECK_COUNT} Pontos)`,
    pills: [
      { title: "Recon v5.1", desc: `${SCAN_CHECK_COUNT} checagens em TLS, DNS, /_next/mcp, SSRF e OWASP 2025` },
      { title: "Worker v5.1 Ativo", desc: "JA4 Binding, Node2Shell, SonicWall/Cisco Gate e Anti-SSRF" },
      { title: "Inspetor PDF CDR", desc: "Bloqueia /JavaScript, /Launch e Prompt Injection em CVs" },
      { title: "RASP + CLI v5.1", desc: "<3KB Browser Shield + npx stealthmark doctor & pdf-check" },
    ],
  },
} as const;

export function CybersecurityHero() {
  const [domainInput, setDomainInput] = useState("");
  const [selectedSample, setSelectedSample] = useState<string>("stealthmark.io");
  const { language } = useLanguage();
  const copy = HERO_COPY[language] ?? HERO_COPY.en;
  const activePreview = SAMPLE_PREVIEWS[selectedSample] ?? SAMPLE_PREVIEWS["stealthmark.io"];

  const triggerOrbPulse = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("vesper:pulse"));
    }
  };

  const handleCardPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
  };

  return (
    <section className="relative pt-6 sm:pt-10 px-4 sm:px-6 max-w-4xl mx-auto text-center space-y-4 sm:space-y-5">
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.10] border-t-white/[0.18] text-[10px] sm:text-xs font-mono font-medium text-slate-200 backdrop-blur-md">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
          <span className="tracking-wider uppercase">{copy.pill}</span>
        </div>
      </div>

      <h1 className="text-2xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-white leading-[1.12] max-w-3xl mx-auto text-center">
        {copy.h1Part1}{" "}
        <span className="block mt-1 shimmer-gradient">{copy.h1Part2}</span>
      </h1>

      <p className="text-xs sm:text-sm md:text-base text-slate-300/90 max-w-2xl mx-auto leading-relaxed font-normal text-center">
        {copy.desc}
      </p>

      {/* Unified Domain Audit Bar + Instant Sample Preview — Immediately visible above the fold */}
      <div className="max-w-2xl mx-auto space-y-2.5 pt-1">
        <form
          action="/scan"
          method="GET"
          onFocus={triggerOrbPulse}
          className="flex flex-col sm:flex-row items-center gap-2 p-1.5 rounded-xl bg-[#0B0E14]/95 border border-cyan-400/30 border-t-cyan-300/40 shadow-2xl shadow-cyan-950/30 backdrop-blur-xl focus-within:border-cyan-400 transition-all"
        >
          <div className="flex items-center gap-2.5 px-3.5 py-2 w-full sm:flex-1 text-slate-400">
            <Globe className="w-4 h-4 text-cyan-400 shrink-0" />
            <input
              type="text"
              name="domain"
              value={domainInput}
              onChange={(e) => {
                setDomainInput(e.target.value);
                triggerOrbPulse();
              }}
              placeholder={copy.placeholder}
              className="w-full bg-transparent text-xs sm:text-sm text-white placeholder-slate-400 focus:outline-none font-mono text-center sm:text-left"
            />
          </div>
          <Button
            type="submit"
            size="sm"
            variant="gradient"
            className="w-full sm:w-auto rounded-lg font-semibold px-5 py-2.5 text-xs sm:text-sm flex items-center justify-center gap-2 shrink-0 cursor-pointer text-white shadow-lg shadow-cyan-500/20"
          >
            <Search className="w-4 h-4 text-white" />
            <span>{copy.btnAudit}</span>
            <ArrowRight className="w-3.5 h-3.5 text-white" />
          </Button>
        </form>

        <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 text-[11px] text-slate-400 font-mono">
          <span className="text-slate-500">Instant sample preview:</span>
          {Object.keys(SAMPLE_PREVIEWS).map((target) => {
            const isSelected = selectedSample === target;
            return (
              <button
                key={target}
                type="button"
                onClick={() => {
                  setSelectedSample(target);
                  setDomainInput(target);
                  triggerOrbPulse();
                }}
                className={`px-2.5 py-1 rounded-md border transition cursor-pointer ${
                  isSelected
                    ? "bg-white/[0.10] border-cyan-400/40 text-white"
                    : "bg-white/[0.03] border-white/[0.08] text-slate-400 hover:text-white"
                }`}
              >
                {target}
              </button>
            );
          })}
        </div>

        {/* Instant Interactive Mini-Report Preview (Zero Page Reload Needed) */}
        <div
          onPointerMove={handleCardPointerMove}
          className="bento-card rounded-xl p-3.5 sm:p-4 text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3.5"
        >
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-mono text-xs font-bold text-white">{activePreview.domain}</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-[11px] font-mono font-bold text-emerald-300">
                GRADE {activePreview.grade} · {activePreview.score}/100
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {activePreview.passCount} PASS · {activePreview.warnCount} WARN · {activePreview.failCount} FAIL
              </span>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-300">
              {activePreview.highlights.map((h) => (
                <li key={h} className="flex items-center gap-1.5 truncate">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span className="truncate">{h}</span>
                </li>
              ))}
            </ul>
          </div>
          <Link
            href={`/scan?domain=${encodeURIComponent(activePreview.domain)}`}
            className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.12] text-xs font-mono font-semibold text-white transition"
          >
            <span>Open {SCAN_CHECK_COUNT}-Point Report</span>
            <ArrowRight className="w-3.5 h-3.5 text-cyan-300" />
          </Link>
        </div>
      </div>

      {/* Secondary Executive CTA */}
      <div className="flex flex-wrap items-center justify-center gap-4 pt-0.5 text-xs font-mono text-slate-400">
        <Link
          href="/enterprise/contact"
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-md bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.10] text-slate-200 transition"
        >
          <Mail className="w-3.5 h-3.5 text-cyan-400" />
          <span>{copy.ctaSecondary}</span>
        </Link>
      </div>

      <ol className="pt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 max-w-4xl mx-auto text-left list-none">
        {copy.pills.map((pill) => (
          <li
            key={pill.title}
            onPointerMove={handleCardPointerMove}
            onMouseEnter={triggerOrbPulse}
            className="bento-card px-4 py-3 rounded-xl space-y-1"
          >
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              <span className="text-xs font-mono font-semibold text-white uppercase tracking-wider">
                {pill.title}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">{pill.desc}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
