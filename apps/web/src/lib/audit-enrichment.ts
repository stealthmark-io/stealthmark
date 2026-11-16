import {
  isCloudflareIpv4,
  readBoundedText,
  resolvesToPublicAddressesOnly,
  sanitizeAndValidateDomain,
} from '@/lib/security/network-guard';
import { NOT_ASSESSED_CONTROLS } from '@/lib/scan-controls';
import { buildV6Rows, collectV6Observations, UNOBSERVED_V6 } from '@/lib/scan-v6';
import { findHiddenAgentDirective } from '@/lib/hidden-agent-directives';
import { owaspGateFor } from '@/lib/owasp-gates';

export async function enrichWithInternetDbIfMissing(
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

  if (primaryIp && isCloudflareIpv4(primaryIp)) {
    detail = `${primaryIp} is a shared Cloudflare edge address: InternetDB ports and CVEs for it describe Cloudflare's edge, not this domain's origin server, so origin exposure was not assessed.`;
  } else if (primaryIp) {
    try {
      const idbRes = await fetch(`https://internetdb.shodan.io/${primaryIp}`, {
        headers: {
          'User-Agent': 'StealthMarkAuditor/2.0',
          'Accept-Encoding': 'identity',
        },
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

const PROBE_USER_AGENT = 'StealthMark-Audit-Engine/2.0 (+https://stealthmark.io/scan)';
const MAX_PROBE_REDIRECTS = 3;

async function isPublicProbeHost(host: string): Promise<boolean> {
  return sanitizeAndValidateDomain(host) === host && (await resolvesToPublicAddressesOnly(host));
}

const MAX_FRONT_PAGE_HTML_BYTES = 262_144;

interface FrontPage {
  headers: Record<string, string>;
  /** The first 256 KB of the page when it is HTML, otherwise empty. */
  html: string;
  /** False when the page was longer than 256 KB or the read broke off. */
  complete: boolean;
}

/** #53: hidden text on the front page that addresses AI agents. A pass needs the whole page. */
function hiddenDirectiveVerdict(frontPage: FrontPage | null, notFetched: string): { status: 'pass' | 'warn' | 'info' | 'not_assessed'; detail: string } {
  if (frontPage === null) return { status: 'not_assessed', detail: notFetched };
  if (frontPage.html === '') {
    return { status: 'info', detail: 'The front page is not HTML, so there were no hidden comments, meta tags or elements to inspect.' };
  }
  const hiddenDirective = findHiddenAgentDirective(frontPage.html);
  if (hiddenDirective) return { status: 'warn', detail: `On the front page, ${hiddenDirective}.` };
  if (!frontPage.complete) {
    return {
      status: 'info',
      detail: 'No HTML comment, meta tag, JSON-LD block or hidden element in the first 256 KB of the front page addresses AI agents; the rest of the page was not read.',
    };
  }
  return { status: 'pass', detail: 'No HTML comment, meta tag, JSON-LD block or hidden element on the front page addresses AI agents.' };
}

/** Follows redirects by hand so every hop stays on https:443 and resolves only to public addresses. */
async function probeFrontPage(host: string): Promise<FrontPage | null> {
  let url = new URL(`https://${host}/`);
  for (let hop = 0; hop <= MAX_PROBE_REDIRECTS; hop++) {
    if (url.protocol !== 'https:' || (url.port !== '' && url.port !== '443')) return null;
    if (!(await isPublicProbeHost(url.hostname))) return null;
    let res: Response;
    try {
      res = await fetch(url.href, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(4000),
        headers: {
          'User-Agent': PROBE_USER_AGENT,
          'Accept-Encoding': 'identity',
        },
      });
    } catch {
      return null;
    }
    const isHtml = (res.headers.get('content-type') || '').toLowerCase().includes('text/html');
    const { text: html, complete } = res.ok && isHtml ? await readBoundedText(res, MAX_FRONT_PAGE_HTML_BYTES) : { text: '', complete: true };
    if (!res.ok || !isHtml) await res.body?.cancel().catch(() => undefined);
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      try {
        url = new URL(location, url);
      } catch {
        return null;
      }
      continue;
    }
    if (!res.ok) return null;
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    return { headers, html, complete };
  }
  return null;
}

async function probeNextMcpExposure(host: string): Promise<'exposed' | 'closed' | 'unknown'> {
  try {
    const res = await fetch(`https://${host}/_next/mcp`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(2500),
      headers: {
        'User-Agent': PROBE_USER_AGENT,
        'Accept-Encoding': 'identity',
      },
    });
    if (res.status >= 500) return 'unknown';
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const exposed =
      res.status === 200 &&
      (ct.includes('application/json') || ct.includes('text/event-stream')) &&
      !res.headers.get('www-authenticate');
    return exposed ? 'exposed' : 'closed';
  } catch {
    return 'unknown';
  }
}

function cspDirective(csp: string, name: string): string | null {
  for (const part of csp.split(/[;,]/)) {
    const [directive, ...sources] = part.trim().split(/\s+/);
    if (directive === name) return sources.join(' ');
  }
  return null;
}

const OPEN_SOURCES = new Set(['*', 'https:', 'http:', 'ws:', 'wss:', 'data:', 'blob:']);

function restricts(sources: string | null): boolean {
  return sources !== null && sources.split(/\s+/).every((s) => !OPEN_SOURCES.has(s));
}

export async function enrichWithV2ActiveShieldChecks(cleanDomain: string, data: Record<string, unknown>): Promise<void> {
  if (!data || typeof data.sections !== 'object' || data.sections === null) return;
  const sections = data.sections as Record<string, Array<Record<string, unknown>>>;
  sections.headers = Array.isArray(sections.headers) ? sections.headers : [];
  sections.ai_surface = Array.isArray(sections.ai_surface) ? sections.ai_surface : [];
  sections.dns = Array.isArray(sections.dns) ? sections.dns : [];
  sections.transport = Array.isArray(sections.transport) ? sections.transport : [];

  const hostIsPublic = await isPublicProbeHost(cleanDomain);
  const [frontPage, mcpExposure, v6Network] = hostIsPublic
    ? await Promise.all([
        probeFrontPage(cleanDomain),
        probeNextMcpExposure(cleanDomain),
        collectV6Observations(cleanDomain, PROBE_USER_AGENT),
      ])
    : [null, 'unknown' as const, UNOBSERVED_V6];
  const headersMap = frontPage?.headers ?? null;
  const h = headersMap ?? {};
  const permPolicy = (h['permissions-policy'] || '').toLowerCase().replace(/\s+/g, '');
  const csp = (h['content-security-policy'] || '').toLowerCase();
  const xfo = (h['x-frame-options'] || '').toLowerCase();
  const coop = (h['cross-origin-opener-policy'] || '').toLowerCase().split(';')[0].trim();
  const corp = (h['cross-origin-resource-policy'] || '').toLowerCase().split(';')[0].trim();
  const scriptSrc = cspDirective(csp, 'script-src') ?? cspDirective(csp, 'default-src');
  const NOT_FETCHED = 'The front page could not be read over HTTPS from a public address, so this check was not assessed.';
  const observed = (ok: boolean, passDetail: string, warnDetail: string) =>
    headersMap === null
      ? { status: 'not_assessed', detail: NOT_FETCHED }
      : { status: ok ? 'pass' : 'warn', detail: ok ? passDetail : warnDetail };

  // #46 - Clipboard-Read Lock
  sections.headers.push({
    id: 'clipboard_read_lock',
    section: 'headers',
    title: 'Clipboard Hijacking Lock (Permissions-Policy: clipboard-read)',
    ...observed(
      permPolicy.includes('clipboard-read=()'),
      'Permissions-Policy disables clipboard-read for every origin.',
      'Permissions-Policy does not declare clipboard-read=(); third-party scripts could read clipboard contents.'
    ),
    recommendation: 'Add clipboard-read=() to your Permissions-Policy header.',
  });

  // #47 - Hardware Sensor & Screen Capture Isolation
  sections.headers.push({
    id: 'hardware_sensor_isolation',
    section: 'headers',
    title: 'Hardware Sensor & Capture Isolation (camera / microphone)',
    ...observed(
      permPolicy.includes('camera=()') && permPolicy.includes('microphone=()'),
      'Permissions-Policy disables camera and microphone access.',
      'Permissions-Policy does not lock camera=() and microphone=().'
    ),
    recommendation: 'Declare camera=(), microphone=(), geolocation=(), display-capture=() in Permissions-Policy.',
  });

  // #48 - CSP connect-src
  sections.headers.push({
    id: 'csp_connect_src_exfil',
    section: 'headers',
    title: 'CSP Exfiltration & WebRTC Leak Guard (connect-src)',
    ...observed(
      restricts(cspDirective(csp, 'connect-src') ?? cspDirective(csp, 'default-src')),
      'CSP connect-src (or default-src) limits fetch, XHR and WebSocket calls to listed origins.',
      'CSP has no restrictive connect-src or default-src, so injected scripts can send data to any host.'
    ),
    recommendation: 'Set an explicit connect-src in your Content-Security-Policy that lists only the origins your pages call.',
  });

  // #49 - CSP form-action Lock
  sections.headers.push({
    id: 'csp_form_action_lock',
    section: 'headers',
    title: 'Form Destination Integrity (CSP form-action)',
    ...observed(
      restricts(cspDirective(csp, 'form-action')),
      "CSP form-action restricts form submissions to 'self' or listed origins.",
      'Missing or open form-action directive in CSP; injected forms could submit credentials to external hosts.'
    ),
    recommendation: "Include form-action 'self' in your Content-Security-Policy header.",
  });

  // #50 - Session Cookie AiTM & Subdomain Fixation Resistance
  sections.headers.push({
    id: 'session_cookie_aitm_resistance',
    section: 'headers',
    title: 'Session Cookie AiTM & Subdomain Fixation Resistance (__Host-)',
    status: 'not_assessed',
    detail: NOT_ASSESSED_CONTROLS.session_cookie_aitm_resistance,
    recommendation: 'Use __Host- prefixed session cookies with Secure; HttpOnly; SameSite=Lax or Strict.',
  });

  // #51 - Session Binding & DBSC Readiness
  sections.transport.push({
    id: 'tls_ja4_session_binding',
    section: 'transport',
    title: 'TLS / JA4 Edge Session Binding & DBSC Readiness',
    status: 'not_assessed',
    detail: NOT_ASSESSED_CONTROLS.tls_ja4_session_binding,
    recommendation: 'Evaluate Device Bound Session Credentials (DBSC) to bind sessions to the device that signed in.',
  });

  // #52 - FIDO2 / WebAuthn Passkey Anti-MFA Relay Posture
  sections.headers.push({
    id: 'webauthn_passkey_ror',
    section: 'headers',
    title: 'FIDO2 / WebAuthn Anti-AiTM Relay Posture',
    status: 'not_assessed',
    detail: NOT_ASSESSED_CONTROLS.webauthn_passkey_ror,
    recommendation: 'Enforce publickey-credentials-get=(self) and optionally publish /.well-known/webauthn for ROR.',
  });

  // #53 - Indirect Prompt Injection DOM Hygiene
  sections.ai_surface.push({
    id: 'indirect_prompt_injection_dom',
    section: 'ai_surface',
    title: 'Indirect Prompt Injection & Hidden Agent Directive Hygiene',
    ...hiddenDirectiveVerdict(frontPage, NOT_FETCHED),
    recommendation: 'Sanitize user-supplied OpenGraph, JSON-LD, and HTML comments inspected by autonomous AI browsers.',
  });

  // #54 - Next.js MCP Endpoint Exposure (/_next/mcp)
  sections.ai_surface.push({
    id: 'nextjs_mcp_exposure',
    section: 'ai_surface',
    title: 'Model Context Protocol (/_next/mcp) Unauthenticated Exposure',
    status: mcpExposure === 'exposed' ? 'fail' : mcpExposure === 'closed' ? 'pass' : 'not_assessed',
    detail:
      mcpExposure === 'exposed'
        ? 'CRITICAL: /_next/mcp responded 200 OK without authentication, exposing internal MCP tools to external agents.'
        : mcpExposure === 'closed'
          ? 'The /_next/mcp route is not served without authentication.'
          : 'The /_next/mcp route could not be probed from a public address, so this check was not assessed.',
    recommendation: 'Block /_next/mcp at your WAF or edge, or require OAuth 2.1 bearer tokens on it.',
  });

  // #55 - Post-Quantum Cryptography (PQC Hybrid Key Exchange)
  sections.transport.push({
    id: 'pqc_hybrid_key_exchange',
    section: 'transport',
    title: 'Post-Quantum TLS Key Exchange Readiness (X25519MLKEM768)',
    status: 'not_assessed',
    detail: NOT_ASSESSED_CONTROLS.pqc_hybrid_key_exchange,
    recommendation: 'Keep TLS 1.3 and X25519MLKEM768 hybrid curves enabled on your edge CDN/load balancer.',
  });

  // #56 - Subdomain Takeover Resistance
  sections.dns.push({
    id: 'subdomain_takeover_cname',
    section: 'dns',
    title: 'Dangling CNAME & Subdomain Takeover Resistance',
    status: 'not_assessed',
    detail: NOT_ASSESSED_CONTROLS.subdomain_takeover_cname,
    recommendation: 'Audit and prune stale CNAME records pointing to decommissioned cloud apps before releasing subdomains.',
  });

  // #57 - Anti-AiTM Reverse Proxy & Frame-Ancestors Lock
  sections.headers.push({
    id: 'aitm_reverse_proxy_telemetry',
    section: 'headers',
    title: 'Anti-AiTM Reverse Proxy & Frame-Ancestors Lock',
    ...observed(
      restricts(cspDirective(csp, 'frame-ancestors')) || xfo.includes('deny') || xfo.includes('sameorigin'),
      'Framing is restricted by CSP frame-ancestors or X-Frame-Options.',
      'Missing frame-ancestors / X-Frame-Options lock against transparent phishing overlays.'
    ),
    recommendation: "Set Content-Security-Policy: frame-ancestors 'none' (or 'self').",
  });

  // #58 - Inline Script Restriction & Hidden Autofill Trap Defense
  sections.headers.push({
    id: 'autofill_trap_rasp_posture',
    section: 'headers',
    title: 'Inline Script Restriction & Hidden Autofill Trap Defense',
    ...observed(
      scriptSrc !== null && (!scriptSrc.includes("'unsafe-inline'") || /'(nonce|sha256|sha384|sha512)-/.test(scriptSrc)),
      "CSP script-src (or default-src) blocks inline scripts that are not nonce- or hash-approved.",
      "CSP allows 'unsafe-inline' scripts or sets no script-src, so injected scripts could plant hidden autofill traps."
    ),
    recommendation: "Enforce a nonce- or hash-based script-src and drop 'unsafe-inline'.",
  });

  // #59 - Cross-Origin Isolation Posture (COOP / CORP)
  sections.headers.push({
    id: 'cross_origin_isolation_posture',
    section: 'headers',
    title: 'Cross-Origin Process Isolation Readiness (COOP / CORP)',
    ...observed(
      coop === 'same-origin' && (corp === 'same-origin' || corp === 'same-site'),
      'Cross-Origin-Opener-Policy is same-origin and Cross-Origin-Resource-Policy restricts cross-origin embedding.',
      'Cross-Origin-Opener-Policy (same-origin) or Cross-Origin-Resource-Policy (same-origin / same-site) is missing or weaker than required.'
    ),
    recommendation: 'Configure Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Resource-Policy: same-origin on sensitive routes.',
  });

  // #60 - CSP Violation Reporting Endpoint
  sections.headers.push({
    id: 'defcon_autonomous_response',
    section: 'headers',
    title: 'CSP Violation Reporting Endpoint',
    ...observed(
      cspDirective(csp, 'report-to') !== null || cspDirective(csp, 'report-uri') !== null,
      'CSP declares a report-to or report-uri endpoint for violation reports.',
      'No CSP report-to / report-uri endpoint is configured.'
    ),
    recommendation: 'Add report-to (with a Reporting-Endpoints header) or report-uri to your Content-Security-Policy.',
  });

  // #61–#116 - v6 controls: measured ones from passive probes, the rest not assessed with the reason.
  for (const row of buildV6Rows({ ...v6Network, headers: headersMap }, cleanDomain)) {
    sections[row.section].push({ ...row });
  }

  // Recompute summary.counts and summary.by_section across all SCAN_CHECK_COUNT checks
  if (data.summary && typeof data.summary === 'object') {
    const summary = data.summary as {
      counts?: Record<string, number>;
      by_section?: Record<string, Record<string, number>>;
      total_checks?: number;
    };
    const counts: Record<string, number> = { pass: 0, warn: 0, fail: 0, info: 0, error: 0, not_assessed: 0 };
    const bySection: Record<string, Record<string, number>> = {};
    let total = 0;
    for (const [secKey, secItems] of Object.entries(sections)) {
      if (!Array.isArray(secItems)) continue;
      const secCounts: Record<string, number> = { pass: 0, warn: 0, fail: 0, info: 0, error: 0, not_assessed: 0 };
      for (const item of secItems) {
        const st = String(item.status || 'info');
        counts[st] = (counts[st] || 0) + 1;
        secCounts[st] = (secCounts[st] || 0) + 1;
        // The StealthMark detection row reports our own headers; it is not one of the SCAN_CHECK_COUNT checks.
        if (item.id !== 'stealthmark_active') total += 1;
      }
      bySection[secKey] = secCounts;
    }
    summary.counts = counts;
    summary.by_section = bySection;
    summary.total_checks = total;
  }
}

export function tagOwaspGates(data: Record<string, unknown>): void {
  if (!data || typeof data.sections !== 'object' || data.sections === null) return;
  for (const items of Object.values(data.sections as Record<string, unknown>)) {
    if (!Array.isArray(items)) continue;
    for (const item of items as Array<Record<string, unknown>>) {
      item.owaspGate = owaspGateFor(String(item.id ?? ''));
    }
  }
}
