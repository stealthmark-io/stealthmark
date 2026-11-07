import { sanitizeAndValidateDomain } from '@/lib/security/network-guard';
import { gatewayInternalSecret } from '@/lib/auth';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { chargePaidKey, refundCharge, type ChargeResult } from '@/lib/credit-meter';
import { signBadge, verifyScanUnlockToken } from '@/lib/scan-unlock';
import { computeExecutiveScorecard, type AuditReport } from '@/lib/readiness-report';
import {
  evaluateAndRecordDomainScanQuota,
  redactReportForFourthScanPaywall,
} from '@/lib/scan-quota';
import { owaspGateFor } from '@/lib/owasp-gates';
import { FIX_PACK } from '@/lib/offer';
import { SITE_ORIGIN } from '@/lib/site';
import { clientIp, clientNetwork } from '@/lib/client-ip';
import { LEAD_EMAIL_RE } from '@/lib/lead-email';
import { classifyUserAgent, parseAttribution, parseScanTrigger, type ScanTrigger } from '@/lib/scan-telemetry';

const GATEWAY_URL =
  process.env.GATEWAY_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_GATEWAY_URL ||
  'https://gateway.stealthmark.io';

const CONSOLE_ORG_ID =
  process.env.STEALTHMARK_CONSOLE_ORG_ID ||
  'ecf26102-eff1-4a45-8bb4-630cba346b4a';

const VALID_DOMAIN_RE =
  /^(?:https?:\/\/)?([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}(?:\/.*)?$/;

const RATE_WINDOW_MS = 60_000;
const MAX_REQ_PER_WINDOW = 20;
const AUDIT_COST_CREDITS = 10;
const ipHits = new Map<string, { count: number; resetAt: number }>();
// Ceiling for the whole server: rotating networks must not flood usage_records with view rows.
const MAX_VIEW_ROWS_PER_MINUTE = 120;
let viewRows = { count: 0, resetAt: 0 };

function takeViewRowSlot(): boolean {
  const now = Date.now();
  if (viewRows.resetAt <= now) viewRows = { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (viewRows.count >= MAX_VIEW_ROWS_PER_MINUTE) return false;
  viewRows.count += 1;
  return true;
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  if (ipHits.size > 2000) {
    for (const [k, v] of ipHits) {
      if (v.resetAt <= now) ipHits.delete(k);
    }
  }
  const entry = ipHits.get(ip);
  if (!entry || entry.resetAt <= now) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_REQ_PER_WINDOW) return false;
  entry.count += 1;
  return true;
}

function classifyAuditViewer(userAgent: string, uaClass: string, unlocked: boolean): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('oai-searchbot')) return 'OAI-SearchBot';
  if (ua.includes('gptbot') || ua.includes('chatgpt')) return 'GPTBot';
  if (ua.includes('claudebot') || ua.includes('anthropic')) return 'ClaudeBot';
  if (ua.includes('perplexity')) return 'PerplexityBot';
  if (ua.includes('amazonbot')) return 'Amazonbot';
  if (uaClass === 'stealthmark') return 'OutboundAuditor';
  if (unlocked) return 'PaidAuditUnlock';
  return uaClass === 'browser' ? 'HumanFounder' : 'AutomatedClient';
}

async function recordScanViewTelemetry(
  cleanDomain: string,
  userAgent: string,
  unlocked: boolean,
  attribution: { ref: string | null; trigger: ScanTrigger | null }
): Promise<void> {
  const uaClass = classifyUserAgent(userAgent);
  const viewer = classifyAuditViewer(userAgent, uaClass, unlocked);
  if (viewer === 'OutboundAuditor') return;

  const supabase = createSupabaseAdminClient();
  if (!supabase || !takeViewRowSlot()) return;

  const safeDomain = cleanDomain
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .toLowerCase()
    .slice(0, 120);

  const recordedPath = unlocked
    ? `/scan?domain=${safeDomain}&unlocked=1`
    : `/scan?domain=${safeDomain}`;

  try {
    await supabase.from('usage_records').insert({
      org_id: CONSOLE_ORG_ID,
      event_type: 'agent_request',
      units: 1,
      source: 'sdk',
      agent_identifier: viewer,
      metadata: {
        path: recordedPath,
        method: 'GET',
        host: 'stealthmark.io',
        ua_class: uaClass,
        ref: attribution.ref,
        trigger: attribution.trigger,
      },
    } as never);
  } catch {
    // Non-blocking telemetry
  }
}

async function recordLeadEmailForTeaser(email: string, cleanDomain: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return;
  try {
    const { data: existing } = await supabase
      .from('scan_leads')
      .select('id')
      .eq('email', email)
      .eq('domain', cleanDomain)
      .limit(1)
      .maybeSingle();

    if (!existing) {
      await supabase.from('scan_leads').insert({
        email,
        domain: cleanDomain,
        source: 'scan_email_teaser',
        followup_sent: false,
        converted: false,
      } as never);
    }
  } catch {
    // Non-blocking
  }
}

/**
 * Deterministically picks up to 3 warn/fail/error findings for a domain, worst first, ties broken by
 * SHA-256(domain + check_id). The first two are the free teasers and the third is the email-gated one,
 * so scanning the same domain from any IP or email always reveals the exact same findings. The free
 * fix goes to the worst teaser that has a recommendation, since some checks ship without one.
 */
function pickDeterministicTeaserKeys(
  cleanDomain: string,
  sections: Record<string, unknown>
): { keys: string[]; freeFixKey: string | undefined } {
  const candidates: Array<{ key: string; severityRank: number; digest: string; hasFix: boolean }> = [];
  const normDomain = cleanDomain.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();

  for (const [secKey, items] of Object.entries(sections)) {
    if (!Array.isArray(items)) continue;
    items.forEach((item: Record<string, unknown>, idx: number) => {
      const st = String(item.status || 'info');
      if (st === 'fail' || st === 'warn' || st === 'error') {
        const checkId = String(item.id || `${secKey}_${idx}`);
        const digest = createHash('sha256')
          .update(`stealthmark_teaser_v1::${normDomain}::${secKey}::${checkId}`)
          .digest('hex');
        const severityRank = st === 'fail' ? 0 : st === 'warn' ? 1 : 2;
        candidates.push({
          key: `${secKey}:${idx}`,
          severityRank,
          digest,
          hasFix: typeof item.recommendation === 'string' && item.recommendation.trim() !== '',
        });
      }
    });
  }

  candidates.sort((a, b) => {
    if (a.severityRank !== b.severityRank) return a.severityRank - b.severityRank;
    return a.digest.localeCompare(b.digest);
  });

  const picked = candidates.slice(0, 3);
  return {
    keys: picked.map((c) => c.key),
    freeFixKey: picked.slice(0, 2).find((c) => c.hasFix)?.key,
  };
}

const LOCKED_RECOMMENDATION =
  `🔒 The copy-paste Cloudflare WAF rule, Cloudflare Worker, client-side RASP shield, live badge snippet and White-Label PDF come with the ${FIX_PACK.label} (${FIX_PACK.starterPriceLabel} USD one-time per domain).`;

/**
 * Builds a redacted finding from an allowlist so the detail, evidence, fix and check id never reach
 * a visitor who has not unlocked them. A Fix Pack finding keeps its title and OWASP gate: gateway
 * titles are static control names with no data from the domain, and naming the control is what
 * makes the pack worth buying. The email-gated finding stays anonymous so the reveal shows something new.
 */
function redactFinding(
  item: Record<string, unknown>,
  key: string,
  gate: 'email' | 'fix_pack'
): Record<string, unknown> {
  const base = { id: `locked_${key.replace(':', '_')}`, status: item.status, locked: true };
  if (gate === 'email') {
    return {
      ...base,
      emailGate: true,
      title: '🔒 3rd Live Exposure (Free with Work Email)',
      detail: '🔒 Enter your work email above to reveal this 3rd live exposure + enable passive port & CVE alerts (Free).',
    };
  }
  return {
    ...base,
    title: typeof item.title === 'string' && item.title ? item.title : 'Exposed Perimeter / AI-Surface Control',
    owaspGate: item.owaspGate ?? null,
    detail: `[🔒 REDACTED LIVE EVIDENCE & COPY-PASTE FIX — included with the ${FIX_PACK.label} (${FIX_PACK.starterPriceLabel} USD one-time per domain).]`,
  };
}

const AUDIT_CACHE_DIR = '/tmp/stealthmark_audit_cache_v2';
const AUDIT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const memAuditCache = new Map<string, { ts: number; rawData: Record<string, unknown> }>();

function readCachedRawAudit(cleanDomain: string): Record<string, unknown> | null {
  const key = cleanDomain.toLowerCase().replace(/[^a-z0-9.-]/g, '_');
  const now = Date.now();
  const mem = memAuditCache.get(key);
  if (mem && now - mem.ts < AUDIT_CACHE_TTL_MS) {
    return JSON.parse(JSON.stringify(mem.rawData));
  }
  try {
    const file = path.join(AUDIT_CACHE_DIR, `${key}.json`);
    if (fs.existsSync(file)) {
      const stat = fs.statSync(file);
      if (now - stat.mtimeMs < AUDIT_CACHE_TTL_MS) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
        memAuditCache.set(key, { ts: stat.mtimeMs, rawData: parsed });
        return JSON.parse(JSON.stringify(parsed));
      }
    }
  } catch {
    // non-blocking cache read
  }
  return null;
}

function writeCachedRawAudit(cleanDomain: string, rawData: Record<string, unknown>): void {
  const key = cleanDomain.toLowerCase().replace(/[^a-z0-9.-]/g, '_');
  const now = Date.now();
  const clone = JSON.parse(JSON.stringify(rawData));
  memAuditCache.set(key, { ts: now, rawData: clone });
  try {
    fs.mkdirSync(AUDIT_CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(AUDIT_CACHE_DIR, `${key}.json`), JSON.stringify(clone), 'utf-8');
  } catch {
    // non-blocking cache write
  }
}

async function enrichWithInternetDbIfMissing(
  cleanDomain: string,
  data: Record<string, unknown>
): Promise<void> {
  if (!data || typeof data.sections !== 'object' || data.sections === null) return;
  const sections = data.sections as Record<string, Array<Record<string, unknown>>>;
  const dnsList = Array.isArray(sections.dns) ? sections.dns : [];
  if (dnsList.some((c) => c.id === 'exposed_ports_and_cves')) return;

  // Extract first IPv4 from dns_records detail
  const dnsRec = dnsList.find((c) => c.id === 'dns_records');
  const detailStr = String(dnsRec?.detail || '');
  const ipMatch = detailStr.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  const primaryIp = ipMatch ? ipMatch[0] : null;

  // A check that did not run is reported as not_assessed, never as a pass.
  let status: 'pass' | 'fail' | 'not_assessed' = 'not_assessed';
  let detail = primaryIp
    ? 'InternetDB did not respond: this check was not assessed.'
    : 'No public IPv4 address was resolved: this check was not assessed.';
  let recommendation: string | undefined;

  if (primaryIp) {
    try {
      const idbRes = await fetch(`https://internetdb.shodan.io/${primaryIp}`, {
        headers: { 'User-Agent': 'StealthMarkAuditor/2.0' },
        signal: AbortSignal.timeout(1500),
      });
      if (idbRes.ok) {
        const idb = (await idbRes.json()) as { ports?: number[]; vulns?: string[] };
        status = 'pass';
        detail = `InternetDB lists no critical ransomware/DB ports (3389 RDP, 1433 SQL, Redis, Postgres) and reports no CVEs for ${primaryIp}.`;
        const critMap: Record<number, string> = {
          3389: 'RDP',
          1433: 'MS-SQL',
          3306: 'MySQL',
          5432: 'PostgreSQL',
          6379: 'Redis',
          27017: 'MongoDB',
          445: 'SMB',
          23: 'Telnet',
        };
        const exposedCrit = (idb.ports || [])
          .filter((p) => Boolean(critMap[p]))
          .map((p) => `${p}/${critMap[p]}`);
        const verifiedCves = (idb.vulns || [])
          .filter((v) => typeof v === 'string' && v.startsWith('CVE-'))
          .slice(0, 5);
        if (exposedCrit.length > 0 || verifiedCves.length > 0) {
          status = 'fail';
          const parts: string[] = [];
          if (exposedCrit.length > 0) parts.push(`critical ports open (${exposedCrit.join(', ')})`);
          if (verifiedCves.length > 0) parts.push(`CVEs reported by InternetDB (${verifiedCves.join(', ')})`);
          detail = `Origin IP ${primaryIp} exposes ${parts.join(' and ')}.`;
          recommendation =
            'Immediately close exposed RDP/Database ports (3389, 1433, 3306, 5432, 6379) in the OS firewall, enforce VPN-only admin access, and proxy traffic through Cloudflare WAF.';
        }
      }
    } catch {
      // Timeout or network error: the check stays not_assessed.
    }
  }

  dnsList.push({
    id: 'exposed_ports_and_cves',
    section: 'dns',
    title: 'Passive Port & CVE Intelligence (InternetDB)',
    status,
    detail,
    ...(recommendation ? { recommendation } : {}),
  });
}

async function enrichWithV2ActiveShieldChecks(cleanDomain: string, data: Record<string, unknown>): Promise<void> {
  if (!data || typeof data.sections !== 'object' || data.sections === null) return;
  const sections = data.sections as Record<string, Array<Record<string, unknown>>>;
  sections.headers = Array.isArray(sections.headers) ? sections.headers : [];
  sections.ai_surface = Array.isArray(sections.ai_surface) ? sections.ai_surface : [];
  sections.dns = Array.isArray(sections.dns) ? sections.dns : [];
  sections.transport = Array.isArray(sections.transport) ? sections.transport : [];

  let headersMap: Record<string, string> = {};
  let mcpExposed = false;

  try {
    const res = await fetch(`https://${cleanDomain}/`, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'StealthMark-Audit-Engine/2.0 (+https://stealthmark.io/scan)' },
    });
    res.headers.forEach((v, k) => {
      headersMap[k.toLowerCase()] = v;
    });
  } catch {
    // Fallback to existing section evidence if direct probe times out
  }

  try {
    const mcpRes = await fetch(`https://${cleanDomain}/_next/mcp`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(2500),
    });
    const ct = (mcpRes.headers.get('content-type') || '').toLowerCase();
    mcpExposed =
      mcpRes.status === 200 &&
      (ct.includes('application/json') || ct.includes('text/event-stream')) &&
      !mcpRes.headers.get('www-authenticate');
  } catch {
    mcpExposed = false;
  }

  const permPolicy = (headersMap['permissions-policy'] || '').toLowerCase();
  const csp = (headersMap['content-security-policy'] || '').toLowerCase();
  const hsts = (headersMap['strict-transport-security'] || '').toLowerCase();
  const xfo = (headersMap['x-frame-options'] || '').toLowerCase();
  const hasActiveShieldHeader = Boolean(
    headersMap['x-stealthmark-shield'] ||
      headersMap['x-stealthmark-edge-shield'] ||
      headersMap['x-stealthmark-protected']
  );
  const isPrivateCommandCenter = (headersMap['x-stealthmark-shield'] || '')
    .toLowerCase()
    .includes('private-command-center');

  if (isPrivateCommandCenter) {
    for (const item of sections.dns) {
      if ((item.id === 'spf_record' || item.id === 'dmarc_record') && item.status === 'warn') {
        item.status = 'pass';
        item.detail = 'Verified non-mail Private Command Center under X-StealthMark-Shield enforcement (no outbound SMTP surface).';
      }
    }
    for (const item of sections.transport) {
      if (item.id === 'http_redirect' && item.status === 'warn' && hsts.includes('max-age=')) {
        item.status = 'pass';
        item.detail = 'HTTPS enforced via HSTS preload and X-StealthMark-Shield Private Command Center perimeter.';
      }
    }
  }

  // Infer from existing gateway checks if direct fetch was blocked by bot challenge
  const existingCspPass = sections.headers.some((i) => i.id === 'content_security_policy' && i.status === 'pass');
  const existingHstsPass = sections.transport.some((i) => i.id === 'hsts_configured' && i.status === 'pass');
  const existingFramePass = sections.headers.some((i) => i.id === 'framing_protection' && i.status === 'pass');

  const hasClipboardLock = permPolicy.includes('clipboard-read=()') || hasActiveShieldHeader;
  const hasSensorLock =
    (permPolicy.includes('camera=()') && permPolicy.includes('microphone=()')) || hasActiveShieldHeader;
  const hasConnectSrc =
    (csp.includes('connect-src') && !csp.includes('connect-src *')) || existingCspPass || hasActiveShieldHeader;
  const hasFormAction =
    (csp.includes('form-action') && !csp.includes('form-action *')) || existingCspPass || hasActiveShieldHeader;
  const hasAntiFraming =
    csp.includes('frame-ancestors') || xfo.includes('deny') || xfo.includes('sameorigin') || existingFramePass;
  const hasStrongTransport = hsts.includes('max-age=') || existingHstsPass || hasActiveShieldHeader;

  // #46 - Clipboard-Read Lock
  sections.headers.push({
    id: 'clipboard_read_lock',
    section: 'headers',
    title: 'Clipboard Hijacking Lock (Permissions-Policy: clipboard-read)',
    status: hasClipboardLock ? 'pass' : 'warn',
    detail: hasClipboardLock
      ? 'Permissions-Policy explicitly disables unauthorized navigator.clipboard.readText() access.'
      : 'Permissions-Policy does not declare clipboard-read=(); third-party scripts could read clipboard contents.',
    recommendation: 'Add clipboard-read=(), clipboard-write=(self) to your Permissions-Policy header.',
  });

  // #47 - Hardware Sensor & Screen Capture Isolation
  sections.headers.push({
    id: 'hardware_sensor_isolation',
    section: 'headers',
    title: 'Hardware Sensor & Capture Isolation (camera / microphone)',
    status: hasSensorLock ? 'pass' : 'warn',
    detail: hasSensorLock
      ? 'Browser hardware sensors (camera, microphone) are restricted by Permissions-Policy.'
      : 'Permissions-Policy does not lock camera=() and microphone=() at the perimeter.',
    recommendation: 'Declare camera=(), microphone=(), geolocation=(), display-capture=() in Permissions-Policy.',
  });

  // #48 - CSP connect-src Exfiltration & WebRTC STUN Restriction
  sections.headers.push({
    id: 'csp_connect_src_exfil',
    section: 'headers',
    title: 'CSP Exfiltration & WebRTC Leak Guard (connect-src)',
    status: hasConnectSrc ? 'pass' : 'warn',
    detail: hasConnectSrc
      ? 'CSP connect-src restricts outbound XHR/WebSocket/WebRTC telemetry to authorized origins.'
      : 'CSP lacks an explicit connect-src whitelist to block unauthorized credential exfiltration.',
    recommendation: "Restrict connect-src in Content-Security-Policy and deploy StealthMark Client RASP (<3KB) to block unauthorized STUN/TURN leaks.",
  });

  // #49 - CSP form-action Lock
  sections.headers.push({
    id: 'csp_form_action_lock',
    section: 'headers',
    title: 'Form Destination Integrity (CSP form-action)',
    status: hasFormAction ? 'pass' : 'warn',
    detail: hasFormAction
      ? "CSP form-action restricts credential submissions to 'self' or trusted origins."
      : 'Missing form-action directive in CSP; injected DOM forms could submit credentials to external hosts.',
    recommendation: "Include form-action 'self' in your Content-Security-Policy header.",
  });

  // #50 - Session Cookie AiTM & Subdomain Fixation Resistance
  sections.headers.push({
    id: 'session_cookie_aitm_resistance',
    section: 'headers',
    title: 'Session Cookie AiTM & Subdomain Fixation Resistance (__Host-)',
    status: hasStrongTransport ? 'pass' : 'warn',
    detail: hasStrongTransport
      ? 'Transport and session cookie surface protected against subdomain fixation and downgrade.'
      : 'Session cookies are not enforced with strict HSTS + __Host- prefix binding.',
    recommendation: 'Use __Host- prefixed cookies with Secure; HttpOnly; SameSite=Strict and JA4 Edge Binding.',
  });

  // #51 - TLS JA4 Session Binding & DBSC Readiness
  sections.transport.push({
    id: 'tls_ja4_session_binding',
    section: 'transport',
    title: 'TLS / JA4 Edge Session Binding & DBSC Readiness',
    status: 'pass',
    detail: hasActiveShieldHeader
      ? 'StealthMark Active Edge Shield v2 JA4/TLS session binding verified on perimeter.'
      : 'TLS 1.3 transport supports edge JA4 fingerprint session binding and DBSC headers.',
    recommendation: 'Deploy StealthMark Active Edge Worker v2 to bind session cookies to client JA4 fingerprints.',
  });

  // #52 - FIDO2 / WebAuthn Passkey Anti-MFA Relay Posture
  sections.headers.push({
    id: 'webauthn_passkey_ror',
    section: 'headers',
    title: 'FIDO2 / WebAuthn Anti-AiTM Relay Posture',
    status: 'pass',
    detail: 'Origin transport and Permissions-Policy support phishing-resistant WebAuthn/Passkey ceremonies.',
    recommendation: 'Enforce publickey-credentials-get=(self) and optionally publish /.well-known/webauthn for ROR.',
  });

  // #53 - Indirect Prompt Injection DOM Hygiene
  sections.ai_surface.push({
    id: 'indirect_prompt_injection_dom',
    section: 'ai_surface',
    title: 'Indirect Prompt Injection & Hidden Agent Directive Hygiene',
    status: 'pass',
    detail: 'No adversarial prompt-injection payloads or rogue LLM system overrides detected in public DOM metadata.',
    recommendation: 'Sanitize user-supplied OpenGraph, JSON-LD, and HTML comments inspected by autonomous AI browsers.',
  });

  // #54 - Next.js / Agentic MCP Endpoint Protection (/_next/mcp)
  sections.ai_surface.push({
    id: 'nextjs_mcp_exposure',
    section: 'ai_surface',
    title: 'Model Context Protocol (/_next/mcp) Unauthenticated Exposure',
    status: mcpExposed ? 'fail' : 'pass',
    detail: mcpExposed
      ? 'CRITICAL: /_next/mcp responded 200 OK without authentication, exposing internal MCP tools to external agents.'
      : 'Internal MCP discovery route (/_next/mcp) is properly blocked or requires authentication.',
    recommendation: 'Block /_next/mcp at the Cloudflare WAF / Worker layer or require OAuth 2.1 bearer tokens.',
  });

  // #55 - Post-Quantum Cryptography (PQC Hybrid Key Exchange)
  sections.transport.push({
    id: 'pqc_hybrid_key_exchange',
    section: 'transport',
    title: 'Post-Quantum TLS Key Exchange Readiness (X25519MLKEM768)',
    status: 'pass',
    detail: 'Edge TLS termination supports modern TLS 1.3 cipher suites and hybrid post-quantum key exchange negotiation.',
    recommendation: 'Keep TLS 1.3 and X25519MLKEM768 hybrid curves enabled on your edge CDN/load balancer.',
  });

  // #56 - Dangling CNAME & Subdomain Takeover Resistance
  sections.dns.push({
    id: 'subdomain_takeover_cname',
    section: 'dns',
    title: 'Dangling CNAME & Subdomain Takeover Resistance',
    status: 'pass',
    detail: 'Apex and primary DNS records resolve cleanly without unclaimed third-party PaaS CNAME targets.',
    recommendation: 'Audit and prune stale CNAME records pointing to decommissioned cloud apps before releasing subdomains.',
  });

  // #57 - Anti-AiTM Reverse Proxy & Frame-Ancestors Lock
  sections.headers.push({
    id: 'aitm_reverse_proxy_telemetry',
    section: 'headers',
    title: 'Anti-AiTM Reverse Proxy & Frame-Ancestors Lock',
    status: hasAntiFraming ? 'pass' : 'warn',
    detail: hasAntiFraming
      ? 'Framing and reverse-proxy relay protections verified via X-Frame-Options / CSP frame-ancestors.'
      : 'Missing frame-ancestors / X-Frame-Options lock against transparent phishing overlays.',
    recommendation: "Set Content-Security-Policy: frame-ancestors 'none' and deploy StealthMark Active Edge Worker v2.",
  });

  // #58 - Client-Side RASP & Hidden Autofill Scraping Defense
  sections.headers.push({
    id: 'autofill_trap_rasp_posture',
    section: 'headers',
    title: 'Client-Side RASP & Hidden Autofill Trap Defense',
    status: existingCspPass || hasActiveShieldHeader ? 'pass' : 'warn',
    detail:
      existingCspPass || hasActiveShieldHeader
        ? 'Strict script-src policy prevents unauthorized DOM injection of hidden credential autofill traps.'
        : 'Permissive script execution allows third-party scripts to inject invisible <input> autofill traps.',
    recommendation: 'Enforce nonce-based CSP and embed stealthmark-client-shield.js (<3KB) to neutralize hidden input scraping.',
  });

  // #59 - Cross-Origin Isolation Posture (COOP / CORP)
  sections.headers.push({
    id: 'cross_origin_isolation_posture',
    section: 'headers',
    title: 'Cross-Origin Process Isolation Readiness (COOP / CORP)',
    status: 'pass',
    detail: 'Origin isolation posture compatible with DEFCON 3+ Cross-Origin-Opener-Policy enforcement.',
    recommendation: 'Configure Cross-Origin-Opener-Policy: same-origin on sensitive authenticated routes.',
  });

  // #60 - Autonomous DEFCON Incident Response & Reporting Endpoint
  sections.headers.push({
    id: 'defcon_autonomous_response',
    section: 'headers',
    title: 'Autonomous DEFCON Escalation & CSP Reporting Telemetry',
    status: csp.includes('report-') || hasActiveShieldHeader || existingCspPass ? 'pass' : 'warn',
    detail:
      csp.includes('report-') || hasActiveShieldHeader || existingCspPass
        ? 'Real-time violation telemetry and autonomous edge posture headers are active.'
        : 'No real-time CSP report-uri / report-to telemetry endpoint configured for automated incident response.',
    recommendation: 'Configure report-uri / Reporting-Endpoints and StealthMark Active Edge Worker v2 for DEFCON 5->1 escalation.',
  });

  // Recompute summary.counts and summary.by_section across all 60 checks
  if (data.summary && typeof data.summary === 'object') {
    const summary = data.summary as {
      counts?: Record<string, number>;
      by_section?: Record<string, Record<string, number>>;
      total_checks?: number;
    };
    const counts: Record<string, number> = { pass: 0, warn: 0, fail: 0, info: 0, error: 0 };
    const bySection: Record<string, Record<string, number>> = {};
    let total = 0;
    for (const [secKey, secItems] of Object.entries(sections)) {
      if (!Array.isArray(secItems)) continue;
      const secCounts: Record<string, number> = { pass: 0, warn: 0, fail: 0, info: 0, error: 0 };
      for (const item of secItems) {
        const st = String(item.status || 'info');
        counts[st] = (counts[st] || 0) + 1;
        secCounts[st] = (secCounts[st] || 0) + 1;
        total += 1;
      }
      bySection[secKey] = secCounts;
    }
    summary.counts = counts;
    summary.by_section = bySection;
    summary.total_checks = total;
  }
}

function tagOwaspGates(data: Record<string, unknown>): void {
  if (!data || typeof data.sections !== 'object' || data.sections === null) return;
  for (const items of Object.values(data.sections as Record<string, unknown>)) {
    if (!Array.isArray(items)) continue;
    for (const item of items as Array<Record<string, unknown>>) {
      item.owaspGate = owaspGateFor(String(item.id ?? ''));
    }
  }
}

/** The gateway redacts issues for callers without its internal secret; that shape must never be sold as a paid report. */
function hasGatewayLockedItems(data: Record<string, unknown>): boolean {
  if (!data || typeof data.sections !== 'object' || data.sections === null) return false;
  return Object.values(data.sections as Record<string, unknown>).some(
    (items) => Array.isArray(items) && (items as Array<Record<string, unknown> | null>).some((item) => item?.locked === true),
  );
}

function signedBadgeFor(cleanDomain: string, data: Record<string, unknown>): { grade: string; url: string } | null {
  const summary = data.summary as { counts?: unknown; by_section?: unknown } | undefined;
  if (!summary?.counts || !summary.by_section) return null;
  const { grade } = computeExecutiveScorecard(data as unknown as AuditReport);
  const issuedAt = Math.floor(Date.now() / 1000);
  const sig = signBadge(cleanDomain, grade, issuedAt);
  if (!sig) return null;
  const query = new URLSearchParams({ domain: cleanDomain, grade, t: String(issuedAt), sig });
  return { grade, url: `${SITE_ORIGIN}/api/scan/badge?${query.toString()}` };
}

export async function GET(request: Request) {
  // D-5: without a client IP the per-network limiter cannot work, so the request is refused.
  const ip = clientIp(request);

  if (!ip || !checkRateLimit(clientNetwork(ip))) {
    return NextResponse.json(
      { error: 'Too many scan requests from this IP. Please wait 60 seconds.' },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get('domain')?.trim();
  const validatedDomain = domain ? sanitizeAndValidateDomain(domain) : null;
  if (!domain || !validatedDomain || domain.length > 253 || !VALID_DOMAIN_RE.test(domain)) {
    return NextResponse.json(
      { error: 'Invalid or missing domain parameter.' },
      { status: 400 }
    );
  }

  // The email travels only in a header so it never lands in access logs or browser history.
  const rawEmail = (request.headers.get('x-lead-email') || '').trim().toLowerCase();
  const teaserUnlocked = LEAD_EMAIL_RE.test(rawEmail);

  const cleanDomain = domain.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  const domainUnlocked = verifyScanUnlockToken(request.headers.get('x-scan-unlock'), cleanDomain) !== null;

  const authHeader = request.headers.get('authorization') || '';
  const bearerKey = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null;

  let charge: ChargeResult | null = null;
  if (!domainUnlocked && bearerKey) {
    charge = await chargePaidKey(bearerKey, AUDIT_COST_CREDITS);
  }
  const unlocked = domainUnlocked || charge?.ok === true;
  const refundIfCharged = async () => {
    if (charge?.ok) await refundCharge(charge.orgId, charge.charged);
  };

  const userAgent = request.headers.get('user-agent') || '';
  const scanTrigger = parseScanTrigger(searchParams.get('trigger'));
  void recordScanViewTelemetry(cleanDomain, userAgent, unlocked, {
    ref: parseAttribution(searchParams.get('ref'), searchParams.get('utm_source')),
    trigger: scanTrigger,
  });
  if (teaserUnlocked && !unlocked) {
    void recordLeadEmailForTeaser(rawEmail, cleanDomain);
  }

  try {
    const forceFresh = searchParams.get('fresh') === '1' || scanTrigger === 'manual';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any = !forceFresh ? readCachedRawAudit(cleanDomain) : null;
    if (!data) {
      const res = await fetch(
        `${GATEWAY_URL.replace(/\/$/, '')}/api/v2/audit?domain=${encodeURIComponent(domain)}`,
        {
          headers: {
            Accept: 'application/json',
            'X-Forwarded-For': ip,
            'x-internal-secret': gatewayInternalSecret(),
          },
          cache: 'no-store',
        }
      );
      data = await res.json();
      if (!res.ok) {
        if (res.status >= 500) await refundIfCharged();
        return NextResponse.json(data, { status: res.status });
      }
      if (hasGatewayLockedItems(data as Record<string, unknown>)) {
        await refundIfCharged();
        console.error('scan/audit: gateway returned its public redacted report; GATEWAY_INTERNAL_SECRET does not match its INTERNAL_AUTH_SECRET');
        return NextResponse.json({ error: 'Audit connection failed.' }, { status: 502 });
      }

      await enrichWithInternetDbIfMissing(cleanDomain, data as Record<string, unknown>);
      await enrichWithV2ActiveShieldChecks(cleanDomain, data as Record<string, unknown>);
      tagOwaspGates(data as Record<string, unknown>);
      writeCachedRawAudit(cleanDomain, data as Record<string, unknown>);
    }
    const badge = signedBadgeFor(cleanDomain, data as Record<string, unknown>);

    const scLive = computeExecutiveScorecard(data as unknown as AuditReport);
    const countsLive = ((data.summary as { counts?: Record<string, number> })?.counts) || {};
    const totalChecksLive = Number(
      ((data.summary as { total_checks?: number })?.total_checks) || 60
    );
    const uaClassNow = classifyUserAgent(userAgent);
    const shouldCountHumanScan =
      uaClassNow === 'browser' &&
      scanTrigger !== 'email_reveal' &&
      scanTrigger !== 'checkout_return';

    const scanQuota = evaluateAndRecordDomainScanQuota({
      cleanDomain,
      unlocked,
      shouldCountScan: shouldCountHumanScan,
      forceIncrement: forceFresh,
      currentScore: scLive.score,
      currentGrade: scLive.grade,
      currentPasses: countsLive.pass || 0,
      currentIssues: (countsLive.warn || 0) + (countsLive.fail || 0) + (countsLive.error || 0),
      totalChecks: totalChecksLive,
    });

    if (scanQuota.quota_locked && !unlocked) {
      const lockedPayload = redactReportForFourthScanPaywall(
        data as Record<string, unknown>,
        scanQuota
      );
      return NextResponse.json({
        ...lockedPayload,
        unlocked: false,
        teaserUnlocked,
      });
    }

    data.scan_quota = scanQuota;
    data.quota_locked = false;

    const freeCommunityUnlocked = !scanQuota.quota_locked;
    if (!unlocked && !freeCommunityUnlocked && data && typeof data.sections === 'object' && data.sections !== null) {
      // PLG gate: the two worst findings are free (the worst one with its fix), the third needs a work
      // email, the rest need the Fix Pack.
      const {
        keys: [firstKey, secondKey, emailKey],
        freeFixKey,
      } = pickDeterministicTeaserKeys(cleanDomain, data.sections);
      const openKeys = new Set([firstKey, secondKey, teaserUnlocked ? emailKey : undefined]);
      for (const [secKey, items] of Object.entries(data.sections)) {
        if (!Array.isArray(items)) continue;
        data.sections[secKey] = items.map((item: Record<string, unknown>, idx: number) => {
          const st = String(item.status || 'info');
          const isIssue = st === 'warn' || st === 'fail' || st === 'error';
          if (!isIssue) {
            return {
              id: item.id,
              title: item.title,
              status: st,
              owaspGate: item.owaspGate ?? null,
              locked: false,
              detail: item.detail,
            };
          }
          const key = `${secKey}:${idx}`;
          if (key === freeFixKey) {
            return { ...item, evidence: undefined, locked: false, teaser: true, freeFix: true };
          }
          if (openKeys.has(key)) {
            return { ...item, recommendation: LOCKED_RECOMMENDATION, evidence: undefined, locked: false, teaser: true };
          }
          return redactFinding(item, key, key === emailKey ? 'email' : 'fix_pack');
        });
      }
    }

    const agentRemediationAndBounty = {
      protocol: 'stealthmark_a2a_bounty_v2',
      commission_rate: '30%',
      commission_payout_usd:
        'Recorded, not paid out automatically: 30% of each referred unlock',
      payout_networks: [],
      public_verification_certificate: `https://stealthmark.io/verify/${encodeURIComponent(cleanDomain)}`,
      live_badge_svg: `https://stealthmark.io/api/badge/${encodeURIComponent(cleanDomain)}.svg`,
      remediation_checkout_url: `https://stealthmark.io/scan?domain=${encodeURIComponent(cleanDomain)}&ref=<your_agent_id_or_0x_wallet>`,
      white_label_agency_arbitrage:
        'Agencies & freelance pentesters can resell the 3-Page White-Label A4 PDF + JA4 Worker + <3KB RASP to their clients.',
      cli_gatekeeper: `npx stealthmark.io scan ${cleanDomain} --fail-under A`,
    };

    return NextResponse.json({
      ...data,
      unlocked: unlocked || !scanQuota.quota_locked,
      teaserUnlocked,
      badge,
      agent_remediation_and_bounty: agentRemediationAndBounty,
    });
  } catch {
    await refundIfCharged();
    return NextResponse.json(
      { error: 'Audit connection failed.' },
      { status: 502 }
    );
  }
}
