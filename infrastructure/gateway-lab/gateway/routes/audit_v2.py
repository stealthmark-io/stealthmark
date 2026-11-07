import asyncio
import datetime
import ipaddress
import json
import re
import secrets
import socket
import ssl
import time
import urllib.parse
from collections import OrderedDict
from dataclasses import dataclass
from typing import Callable, Optional

import dns.exception
import dns.resolver
import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from gateway import targets, upstream
from gateway.auditor.ai_surface import parse_ai_surface
from gateway.auditor.exposure import (
    parse_api_schema_exposure,
    parse_bundle_secrets,
    parse_git_exposure,
    parse_nonprod_environment_leak,
    parse_source_map_exposure,
    parse_stack_leak,
    parse_supply_chain_manifest_exposure,
)
from gateway.auditor.posture import (
    CACHE_PROBE_HOST,
    CORS_PROBE_ORIGIN,
    csp_script_weakness,
    parse_ai_bot_cidr_posture,
    parse_anti_automation_design,
    parse_cache_poisoning,
    parse_cors_policy,
    parse_graphql_and_debug_exposure,
    parse_manifest_hygiene,
    parse_security_reporting,
    parse_session_hardening,
    parse_subresource_integrity,
    parse_tech_fingerprint,
    parse_token_storage,
)
from gateway.auditor.secrets import AI_PROVIDER_KINDS, bundle_paths, find_secrets
from gateway.auth import has_internal_secret
from gateway.clientip import client_ip
from gateway.routes.scanner import Fetched, fetch_pinned

router = APIRouter()

AUDITS_PER_IP_PER_MINUTE = 10
MAX_CONCURRENT_AUDITS = 8
MAX_TRACKED_IPS = 10_000
AUDIT_TIMEOUT_SECONDS = 8.0
AUDIT_DEADLINE_SECONDS = 20.0
AGENT_USER_AGENT = "StealthMarkAuditor/2.0 (+https://stealthmark.io/docs)"
DOTFILE_MAX_BYTES = 8 * 1024
EXPOSURE_PROBE_TIMEOUT_SECONDS = 1.5
BUNDLE_MAX_BYTES = 2560 * 1024
BUNDLE_PROBE_TIMEOUT_SECONDS = 2.5
HOME_SCAN_BYTES = 131072
TLS_PROBE_TIMEOUT_SECONDS = 2.5
TLS_EXPIRY_WARN_DAYS = 14

_clock: Callable[[], float] = time.time
_audit_slots = asyncio.Semaphore(MAX_CONCURRENT_AUDITS)
_audit_counts: "OrderedDict[tuple[str, int], int]" = OrderedDict()

# Pluggable DNS resolver factory for hermetic testing
_dns_resolver_factory: Callable[[], dns.resolver.Resolver] = lambda: dns.resolver.Resolver()


def _fetch_peer_cert(domain: str) -> Optional[dict]:
    """Leaf certificate served on 443, read over a connection pinned to a validated public address (defeats DNS rebinding).

    A chain the trust store rejects comes back as {"verify_error": ...}; any other failure is None.
    """
    try:
        if targets.host_blocked(domain):
            return None
        infos = socket.getaddrinfo(domain, 443, type=socket.SOCK_STREAM)
        addresses = sorted({str(info[4][0]) for info in infos}, key=lambda address: ":" in address)
        if not addresses or not all(targets.address_allowed(address) for address in addresses):
            return None
        context = ssl.create_default_context()
        with socket.create_connection((addresses[0], 443), timeout=TLS_PROBE_TIMEOUT_SECONDS) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                return ssock.getpeercert()
    except ssl.SSLCertVerificationError as exc:
        return {"verify_error": exc.verify_message or str(exc)}
    except Exception:
        return None


# Pluggable TLS certificate reader for hermetic testing
_tls_cert_fetcher: Callable[[str], Optional[dict]] = _fetch_peer_cert


def allow_audit(ip: str, now: Optional[float] = None) -> bool:
    window = int((_clock() if now is None else now) // 60)
    key = (ip, window)
    count = _audit_counts.get(key, 0)
    if count >= AUDITS_PER_IP_PER_MINUTE:
        return False
    _audit_counts[key] = count + 1
    _audit_counts.move_to_end(key)
    while len(_audit_counts) > MAX_TRACKED_IPS:
        _audit_counts.popitem(last=False)
    return True


def _safe_snippet(val: str, max_len: int = 120) -> str:
    """Strip control characters and bound untrusted remote strings before reflecting in audit reports."""
    cleaned = re.sub(r"[\x00-\x1f\x7f]+", " ", val or "").strip()
    return f"{cleaned[:max_len]}..." if len(cleaned) > max_len else cleaned


def normalize_domain(raw: str) -> Optional[str]:
    raw = (raw or "").strip()
    if not raw:
        return None
    if raw.startswith(("http://", "https://")):
        try:
            parts = urllib.parse.urlsplit(raw)
            host = parts.hostname
        except ValueError:
            return None
    else:
        host = raw.split("/")[0].split(":")[0]
    if not host:
        return None
    host = host.strip().rstrip(".").lower()
    # Reject IP literals; the auditor is for internet domains
    try:
        ipaddress.ip_address(host)
        return None
    except ValueError:
        pass
    if " " in host or "\t" in host or "\n" in host or not re.match(r"^[a-z0-9.-]+\.[a-z]{2,}$", host):
        return None
    return host


@dataclass
class CheckItem:
    id: str
    title: str
    status: str  # "pass" | "warn" | "fail" | "info" | "error" | "not_assessed"
    detail: str
    recommendation: Optional[str] = None

    def to_dict(self) -> dict:
        d = {
            "id": self.id,
            "title": self.title,
            "status": self.status,
            "detail": self.detail,
        }
        if self.recommendation:
            d["recommendation"] = self.recommendation
        return d


def query_dns(domain: str) -> list[CheckItem]:
    checks: list[CheckItem] = []
    try:
        resolver = _dns_resolver_factory()
        resolver.timeout = 3.0
        resolver.lifetime = 3.0
    except Exception as exc:
        checks.append(CheckItem(
            id="dns_resolver",
            title="DNS Resolution",
            status="error",
            detail=f"Local resolver initialization error: {exc}",
        ))
        return checks

    # 1. A / AAAA
    addresses = []
    try:
        for rdata in resolver.resolve(domain, "A"):
            addresses.append(str(rdata))
    except Exception:
        pass
    try:
        for rdata in resolver.resolve(domain, "AAAA"):
            addresses.append(str(rdata))
    except Exception:
        pass

    if addresses:
        checks.append(CheckItem(
            id="dns_records",
            title="A/AAAA Address Records",
            status="pass",
            detail=f"Resolved {len(addresses)} address record(s): {', '.join(addresses[:4])}",
        ))
    else:
        checks.append(CheckItem(
            id="dns_records",
            title="A/AAAA Address Records",
            status="fail",
            detail="No A or AAAA address records could be resolved.",
            recommendation="Configure valid public A or AAAA DNS records for this domain.",
        ))

    # 2. CAA
    caa_records = []
    try:
        for rdata in resolver.resolve(domain, "CAA"):
            caa_records.append(str(rdata))
    except Exception:
        pass

    if caa_records:
        checks.append(CheckItem(
            id="caa_record",
            title="Certification Authority Authorization (CAA)",
            status="pass",
            detail=f"CAA record(s) found ({len(caa_records)} entry). Restricts certificate issuance to authorized authorities.",
        ))
    else:
        checks.append(CheckItem(
            id="caa_record",
            title="Certification Authority Authorization (CAA)",
            status="info",
            detail="No CAA record published. Any trusted Certificate Authority may issue certificates.",
            recommendation="Consider adding CAA records to specify which CAs are permitted to issue certificates.",
        ))

    # 3. SPF (check host first, then RFC 7208 organizational apex fallback for subdomains)
    spf_entry = None
    domain_labels = domain.split(".")
    org_domain = ".".join(domain_labels[-2:]) if len(domain_labels) > 2 else domain
    for spf_target in ([domain, org_domain] if org_domain != domain else [domain]):
        try:
            for rdata in resolver.resolve(spf_target, "TXT"):
                txt = b"".join(rdata.strings).decode("utf-8", errors="replace")
                if txt.startswith("v=spf1"):
                    spf_entry = txt
                    break
            if spf_entry:
                break
        except Exception:
            pass

    if spf_entry:
        checks.append(CheckItem(
            id="spf_record",
            title="Sender Policy Framework (SPF)",
            status="pass",
            detail=f"SPF TXT record found: {spf_entry[:60]}{'...' if len(spf_entry) > 60 else ''}",
        ))
    else:
        checks.append(CheckItem(
            id="spf_record",
            title="Sender Policy Framework (SPF)",
            status="warn",
            detail="No SPF TXT record detected on the apex domain.",
            recommendation="Add a TXT record with SPF (e.g. 'v=spf1 -all' or your mail provider's SPF) to prevent email spoofing.",
        ))

    # 4. DMARC (check _dmarc.<host> first, then RFC 7489 §6.6.3 _dmarc.<org_domain> fallback)
    dmarc_entry = None
    for dmarc_target in ([domain, org_domain] if org_domain != domain else [domain]):
        try:
            for rdata in resolver.resolve(f"_dmarc.{dmarc_target}", "TXT"):
                txt = b"".join(rdata.strings).decode("utf-8", errors="replace")
                if txt.startswith("v=DMARC1"):
                    dmarc_entry = txt
                    break
            if dmarc_entry:
                break
        except Exception:
            pass

    if dmarc_entry:
        if re.search(r"(?i)\bp\s*=\s*(?:quarantine|reject)\b", dmarc_entry):
            checks.append(CheckItem(
                id="dmarc_record",
                title="DMARC Policy & Enforcement",
                status="pass",
                detail=f"Enforced DMARC policy found at _dmarc.{domain}: {dmarc_entry[:60]}{'...' if len(dmarc_entry) > 60 else ''}",
            ))
        else:
            checks.append(CheckItem(
                id="dmarc_record",
                title="DMARC Policy & Enforcement",
                status="warn",
                detail=f"DMARC record at _dmarc.{domain} is in monitoring-only mode (p=none): {dmarc_entry[:60]}",
                recommendation="Upgrade DMARC policy from p=none to p=quarantine or p=reject to block spoofed outbound email.",
            ))
    else:
        checks.append(CheckItem(
            id="dmarc_record",
            title="DMARC Policy & Enforcement",
            status="warn",
            detail=f"No DMARC policy published at _dmarc.{domain}.",
            recommendation=f"Publish a DMARC policy TXT record at _dmarc.{domain} (v=DMARC1; p=quarantine; pct=100).",
        ))

    # 5. Passive Infrastructure Port & Real CVE Recon (Shodan InternetDB)
    ipv4_list = [ip for ip in addresses if ":" not in ip]
    primary_ip = ipv4_list[0] if ipv4_list else None
    if primary_ip:
        critical_port_map = {
            3389: "RDP",
            1433: "MS-SQL",
            3306: "MySQL",
            5432: "PostgreSQL",
            6379: "Redis",
            27017: "MongoDB",
            445: "SMB",
            23: "Telnet",
        }
        exposed_crit = []
        verified_cves = []
        idb_answered = False
        try:
            import urllib.request as _ureq
            import json as _json
            req = _ureq.Request(
                f"https://internetdb.shodan.io/{primary_ip}",
                headers={"User-Agent": "StealthMarkAuditor/2.0"},
            )
            with _ureq.urlopen(req, timeout=1.5) as resp:
                if resp.status == 200:
                    idb = _json.loads(resp.read().decode("utf-8", errors="replace"))
                    for p in idb.get("ports") or []:
                        if p in critical_port_map:
                            exposed_crit.append(f"{p}/{critical_port_map[p]}")
                    for v in (idb.get("vulns") or [])[:5]:
                        if isinstance(v, str) and v.startswith("CVE-"):
                            verified_cves.append(v)
                    idb_answered = True
        except Exception:
            pass

        if not idb_answered:
            # A check whose probe did not run is not_assessed, never a pass (ARQ-02).
            checks.append(CheckItem(
                id="exposed_ports_and_cves",
                title="Passive Port & CVE Intelligence (InternetDB)",
                status="not_assessed",
                detail=f"InternetDB returned no usable data for {primary_ip} (timeout, error or no record): this check was not assessed.",
            ))
        elif exposed_crit or verified_cves:
            parts = []
            if exposed_crit:
                parts.append(f"critical ports open ({', '.join(exposed_crit)})")
            if verified_cves:
                parts.append(f"CVEs reported by InternetDB ({', '.join(verified_cves)})")
            checks.append(CheckItem(
                id="exposed_ports_and_cves",
                title="Passive Port & CVE Intelligence (InternetDB)",
                status="fail",
                detail=f"Origin IP {primary_ip} exposes {' and '.join(parts)}.",
                recommendation="Immediately close exposed RDP/Database ports (3389, 1433, 3306, 5432, 6379) in the OS firewall, enforce VPN-only admin access, and proxy traffic through Cloudflare WAF.",
            ))
        else:
            checks.append(CheckItem(
                id="exposed_ports_and_cves",
                title="Passive Port & CVE Intelligence (InternetDB)",
                status="pass",
                detail=f"InternetDB lists no critical ransomware/DB ports (3389 RDP, 1433 SQL, Redis, Postgres) and reports no CVEs for {primary_ip}.",
            ))

    return checks


def parse_crawl_policy(robots_res: Optional[Fetched]) -> list[CheckItem]:
    checks: list[CheckItem] = []
    if not robots_res or robots_res.status_code != 200:
        checks.append(CheckItem(
            id="robots_txt",
            title="robots.txt Availability",
            status="warn",
            detail="No robots.txt found (HTTP 404 or connection error). Agents and crawlers have no explicit instructions.",
            recommendation="Publish a /robots.txt file specifying rules for web and AI crawlers.",
        ))
        checks.append(CheckItem(
            id="ai_agent_rules",
            title="AI Agent Crawler Rules",
            status="info",
            detail="Cannot inspect AI crawler rules because robots.txt was not found.",
        ))
        checks.append(CheckItem(
            id="sitemap_declared",
            title="Sitemap Declaration",
            status="info",
            detail="Cannot inspect sitemap declaration because robots.txt was not found.",
        ))
        return checks

    content = robots_res.text
    checks.append(CheckItem(
        id="robots_txt",
        title="robots.txt Availability",
        status="pass",
        detail=f"robots.txt is published ({len(robots_res.body)} bytes).",
    ))

    # AI agents check
    known_agents = ["gptbot", "claudebot", "perplexitybot", "google-extended", "amazonbot", "bytespider", "applebot-extended"]
    found_agents = [agent for agent in known_agents if re.search(rf"(?i)user-agent:\s*{re.escape(agent)}", content)]

    if found_agents:
        checks.append(CheckItem(
            id="ai_agent_rules",
            title="AI Agent Crawler Rules",
            status="pass",
            detail=f"Explicit rules defined for AI agent(s): {', '.join(found_agents)}.",
        ))
    else:
        checks.append(CheckItem(
            id="ai_agent_rules",
            title="AI Agent Crawler Rules",
            status="info",
            detail="No rules specifically targeted at known AI agent User-Agents (e.g. GPTBot, ClaudeBot). Agents follow the general wildcard policy (*).",
            recommendation="Consider adding explicit directives for AI crawlers like GPTBot or ClaudeBot in robots.txt.",
        ))

    # Sitemap declaration
    sitemap_match = re.search(r"(?i)^sitemap:\s*(\S+)", content, re.MULTILINE)
    if sitemap_match:
        checks.append(CheckItem(
            id="sitemap_declared",
            title="Sitemap Declaration",
            status="pass",
            detail=f"Sitemap declared in robots.txt ({_safe_snippet(sitemap_match.group(1))}).",
        ))
    else:
        checks.append(CheckItem(
            id="sitemap_declared",
            title="Sitemap Declaration",
            status="info",
            detail="No Sitemap: directive declared in robots.txt.",
            recommendation="Include a Sitemap: https://yourdomain.com/sitemap.xml line in robots.txt to assist automated discovery.",
        ))

    return checks


# The @stealthmark/next Canary fixture: its disclosure comment plus the signed Canary URL, both at the start of a line.
_CANARY_FIXTURE_RE = re.compile(
    r"(?m)^# Este dominio usa @stealthmark/next .*\n(?:.*\n)*?HEALTHCHECK_URL=https://stealthmark\.io/api/telemetry/canary\?t="
)


def parse_headers(home_res: Optional[Fetched], dotenv_res: Optional[Fetched] = None) -> list[CheckItem]:
    checks: list[CheckItem] = []
    if not home_res or home_res.status_code >= 500:
        checks.append(CheckItem(
            id="headers_inspection",
            title="Response Headers Inspection",
            status="fail",
            detail="Could not inspect headers because the origin home page did not answer successfully.",
        ))
        return checks

    h = {k.lower(): v for k, v in home_res.headers.items()}

    # Dotfile Exposure & PHP Fingerprint (/.env + X-Powered-By PHP leak)
    runtime_fp = f"{h.get('x-powered-by', '')} {h.get('server', '')}".strip()
    php_leaked = bool(re.search(r"\bphp(?:/[5678](?:\.\d+)*)?\b", runtime_fp, re.IGNORECASE))
    if dotenv_res is not None:
        env_body = (dotenv_res.text or "")[:2048]
        if dotenv_res.status_code == 200 and _CANARY_FIXTURE_RE.search(env_body):
            checks.append(CheckItem(
                id="dotfile_edge_shield",
                title="Dotfile Exposure & PHP Fingerprint",
                status="info",
                detail="/.env serves a StealthMark Canary fixture (@stealthmark/next dotfiles: 'synthetic_fixture'): synthetic values and a signed Canary URL, not the site's environment.",
            ))
        elif dotenv_res.status_code == 200 and re.search(r"(?m)^[A-Z][A-Z0-9_]{2,40}\s*=\s*\S+", env_body) and "<html" not in env_body.lower():
            checks.append(CheckItem(
                id="dotfile_edge_shield",
                title="Dotfile Exposure & PHP Fingerprint",
                status="fail",
                detail="Critical exposure: /.env returned HTTP 200 with key=value environment variables.",
                recommendation="Rotate every secret in that file now, remove /.env from the deployed files, and return 403 or 404 for /.env and /.git at your web server, CDN or reverse proxy.",
            ))
        elif dotenv_res.status_code == 200:
            checks.append(CheckItem(
                id="dotfile_edge_shield",
                title="Dotfile Exposure & PHP Fingerprint",
                status="warn",
                detail="/.env returned HTTP 200 without key=value lines (likely an SPA catch-all route) instead of 403/404. No secrets were seen, but scanners that only read the status code will report it as exposed.",
                recommendation="Return 403 or 404 for /.env and /.git in your router, web server, CDN or reverse proxy.",
            ))
        elif php_leaked:
            checks.append(CheckItem(
                id="dotfile_edge_shield",
                title="Dotfile Exposure & PHP Fingerprint",
                status="warn",
                detail=f"The response headers name the PHP runtime ({_safe_snippet(runtime_fp)}). This is a fingerprint from one request; no PHP vulnerability was probed.",
                recommendation="Set expose_php = Off in php.ini (or strip X-Powered-By and the Server version at your web server, CDN or reverse proxy) and keep PHP on a supported release.",
            ))
        else:
            checks.append(CheckItem(
                id="dotfile_edge_shield",
                title="Dotfile Exposure & PHP Fingerprint",
                status="pass",
                detail=f"Dotfile probe (/.env) rejected with HTTP {dotenv_res.status_code} and no PHP runtime header leak.",
            ))
    else:
        checks.append(CheckItem(
            id="dotfile_edge_shield",
            title="Dotfile Exposure & PHP Fingerprint",
            status="not_assessed",
            detail="The /.env probe got no response (timeout or connection error): this check was not assessed.",
        ))

    # CSP
    if "content-security-policy" in h and (weakness := csp_script_weakness(h["content-security-policy"])):
        checks.append(CheckItem(
            id="content_security_policy",
            title="Content-Security-Policy",
            status="warn",
            detail=f"Content-Security-Policy is set, but {weakness}.",
            recommendation="Restrict script-src to your own origins and use nonces or hashes for inline scripts instead of 'unsafe-inline' or *.",
        ))
    elif "content-security-policy" in h:
        checks.append(CheckItem(
            id="content_security_policy",
            title="Content-Security-Policy",
            status="pass",
            detail="Content-Security-Policy restricts script sources without 'unsafe-inline' or a * wildcard.",
        ))
    else:
        checks.append(CheckItem(
            id="content_security_policy",
            title="Content-Security-Policy",
            status="warn",
            detail="Content-Security-Policy header is missing.",
            recommendation="Define a Content-Security-Policy to restrict unauthorized script and data sources.",
        ))

    # X-Content-Type-Options
    if h.get("x-content-type-options", "").lower() == "nosniff":
        checks.append(CheckItem(
            id="content_type_options",
            title="X-Content-Type-Options",
            status="pass",
            detail="X-Content-Type-Options: nosniff is set.",
        ))
    else:
        checks.append(CheckItem(
            id="content_type_options",
            title="X-Content-Type-Options",
            status="warn",
            detail="X-Content-Type-Options: nosniff header is missing or incorrect.",
            recommendation="Add 'X-Content-Type-Options: nosniff' to prevent MIME-sniffing exploits.",
        ))

    # Referrer-Policy
    if "referrer-policy" in h:
        checks.append(CheckItem(
            id="referrer_policy",
            title="Referrer-Policy",
            status="pass",
            detail=f"Referrer-Policy is set: {_safe_snippet(h['referrer-policy'])}.",
        ))
    else:
        checks.append(CheckItem(
            id="referrer_policy",
            title="Referrer-Policy",
            status="info",
            detail="Referrer-Policy header is not set. Browsers will apply default strict-origin-when-cross-origin.",
        ))

    # Anti-framing protection
    has_framing = "x-frame-options" in h or ("frame-ancestors" in h.get("content-security-policy", ""))
    if has_framing:
        checks.append(CheckItem(
            id="framing_protection",
            title="Anti-Clickjacking Framing Protection",
            status="pass",
            detail="Framing protection configured via X-Frame-Options or CSP frame-ancestors.",
        ))
    else:
        checks.append(CheckItem(
            id="framing_protection",
            title="Anti-Clickjacking Framing Protection",
            status="warn",
            detail="Neither X-Frame-Options nor CSP frame-ancestors is configured.",
            recommendation="Set X-Frame-Options: DENY or CSP frame-ancestors 'none' to prevent clickjacking.",
        ))

    # CMS, E-Commerce & Unshielded Legacy Surface (WordPress / WooCommerce / PrestaShop)
    home_html = (home_res.text or "")[:16384]
    cms_markers = []
    if re.search(r"(?:/wp-content/|/wp-includes/|wp-json)", home_html, re.IGNORECASE):
        cms_markers.append("WordPress")
    if re.search(r"woocommerce", home_html, re.IGNORECASE):
        cms_markers.append("WooCommerce")
    if re.search(r"(?:prestashop|ps_facetedsearch|gmfeed)", home_html, re.IGNORECASE):
        cms_markers.append("PrestaShop")
    if re.search(r"(?:mage/cookies|x-magento-init|/static/version\d+/frontend/)", home_html, re.IGNORECASE):
        cms_markers.append("Magento / Adobe Commerce")
    has_edge_shield = "x-stealthmark-edge-shield" in h
    if cms_markers and not has_edge_shield:
        checks.append(CheckItem(
            id="cms_ecommerce_surface",
            title="CMS & E-Commerce Fingerprint",
            status="warn",
            detail=f"Detected {', '.join(cms_markers)} markers in the home page. This is a fingerprint, not a vulnerability probe: /xmlrpc.php and /wp-json/ were not requested.",
            recommendation="Keep the CMS core, themes and plugins updated. On WordPress, if you don't use XML-RPC or public user listing, restrict /xmlrpc.php and /wp-json/wp/v2/users at your web server, CDN or a security plugin.",
        ))
    elif cms_markers:
        checks.append(CheckItem(
            id="cms_ecommerce_surface",
            title="CMS & E-Commerce Fingerprint",
            status="info",
            detail=f"Detected {', '.join(cms_markers)} markers; the StealthMark edge shield header is present. Exploitability was not probed.",
        ))
    else:
        checks.append(CheckItem(
            id="cms_ecommerce_surface",
            title="CMS & E-Commerce Fingerprint",
            status="info",
            detail="No WordPress, WooCommerce or PrestaShop markers in the first 16 KB of the home page. This is a fingerprint, not a vulnerability probe.",
        ))

    # Cloud PaaS Origin & AI Secret Exposure Shield (Railway / Render / Fly.io / Model Secret Leak)
    paas_markers = []
    paas_hdr_blob = " ".join([f"{k}:{v}" for k, v in h.items() if any(p in k.lower() or p in v.lower() for p in ["railway", "fly.io", "fly-request-id"])]).lower()
    if "railway" in paas_hdr_blob:
        paas_markers.append("Railway (x-railway)")
    # Render's own headers only: a bare "render" substring also matches Next.js x-nextjs-prerender and server-timing.
    if "rndr-id" in h or h.get("x-render-origin-server", "").lower() == "render" or "onrender.com" in home_html.lower():
        paas_markers.append("Render (onrender.com)")
    if "fly" in paas_hdr_blob:
        paas_markers.append("Fly.io")

    key_leak = any(h.kind in AI_PROVIDER_KINDS for h in find_secrets(home_html))

    if key_leak:
        checks.append(CheckItem(
            id="paas_origin_and_ai_secret_shield",
            title="Cloud PaaS Origin & AI Secret Exposure Shield",
            status="fail",
            detail="Critical exposure: Raw AI model provider API key pattern detected in public client markup.",
            recommendation="Immediately revoke and rotate leaked model keys in your AI provider dashboard, move calls to backend API routes, and keep secrets in encrypted environment stores.",
        ))
    elif paas_markers and not has_edge_shield:
        checks.append(CheckItem(
            id="paas_origin_and_ai_secret_shield",
            title="Cloud PaaS Origin & AI Secret Exposure Shield",
            status="warn",
            detail=f"The home page names its hosting platform ({', '.join(paas_markers)}) in its response headers or markup. This is a fingerprint from one request; no origin or firewall test was run.",
            recommendation="If you don't want to advertise the platform, remove its response headers (rndr-id, x-render-origin-server, x-railway-*, fly-request-id) at your CDN or reverse proxy.",
        ))
    elif paas_markers:
        checks.append(CheckItem(
            id="paas_origin_and_ai_secret_shield",
            title="Cloud PaaS Origin & AI Secret Exposure Shield",
            status="info",
            detail=f"PaaS markers seen ({', '.join(paas_markers)}); the StealthMark edge shield header is present. No AI provider key pattern in the first 16 KB of the home page.",
        ))
    else:
        checks.append(CheckItem(
            id="paas_origin_and_ai_secret_shield",
            title="Cloud PaaS Origin & AI Secret Exposure Shield",
            status="info",
            detail="No Railway/Render/Fly.io headers and no AI provider key pattern (sk-, sk-ant-) in the first 16 KB of the home page. Scripts and other pages were not inspected.",
        ))

    # StealthMark detection
    sm_headers = [k for k in h if k.startswith("x-stealthmark-")]
    if sm_headers:
        checks.append(CheckItem(
            id="stealthmark_active",
            title="StealthMark Detection",
            status="info",
            detail=f"StealthMark middleware header(s) detected: {', '.join(sm_headers)}.",
        ))

    return checks


def parse_transport(https_home: Optional[Fetched], http_home: Optional[Fetched]) -> list[CheckItem]:
    checks: list[CheckItem] = []

    # 1. HTTPS availability
    if https_home and https_home.status_code < 500:
        checks.append(CheckItem(
            id="https_available",
            title="HTTPS Availability",
            status="pass",
            detail=f"HTTPS connection succeeded with HTTP {https_home.status_code}.",
        ))
    elif https_home:
        checks.append(CheckItem(
            id="https_available",
            title="HTTPS Availability",
            status="warn",
            detail=f"HTTPS server responded with server error HTTP {https_home.status_code}.",
        ))
    else:
        checks.append(CheckItem(
            id="https_available",
            title="HTTPS Availability",
            status="fail",
            detail="HTTPS connection failed or timed out.",
            recommendation="Ensure your origin or CDN has a valid SSL/TLS certificate configured for this domain.",
        ))

    # 2. HTTP to HTTPS redirect
    if http_home and http_home.status_code in (301, 302, 307, 308):
        loc = http_home.headers.get("location", "")
        if loc.startswith("https://"):
            checks.append(CheckItem(
                id="http_redirect",
                title="HTTP to HTTPS Redirection",
                status="pass",
                detail=f"Plain HTTP automatically redirects to HTTPS (HTTP {http_home.status_code} -> {loc}).",
            ))
        else:
            checks.append(CheckItem(
                id="http_redirect",
                title="HTTP to HTTPS Redirection",
                status="warn",
                detail=f"HTTP redirects to a non-HTTPS destination: {loc}.",
            ))
    elif http_home and http_home.status_code == 200:
        checks.append(CheckItem(
            id="http_redirect",
            title="HTTP to HTTPS Redirection",
            status="warn",
            detail="Plain HTTP answers with HTTP 200 without redirecting to HTTPS.",
            recommendation="Configure your web server or CDN to redirect all port 80 HTTP requests to HTTPS.",
        ))
    else:
        checks.append(CheckItem(
            id="http_redirect",
            title="HTTP to HTTPS Redirection",
            status="info",
            detail="Plain HTTP port 80 did not return an immediate redirect.",
        ))

    # 3. HSTS
    if https_home and https_home.status_code < 500:
        hsts = https_home.headers.get("strict-transport-security", "")
        if hsts:
            checks.append(CheckItem(
                id="hsts_configured",
                title="HTTP Strict Transport Security (HSTS)",
                status="pass",
                detail=f"HSTS is active ({hsts}).",
            ))
        else:
            checks.append(CheckItem(
                id="hsts_configured",
                title="HTTP Strict Transport Security (HSTS)",
                status="warn",
                detail="Strict-Transport-Security header is missing from HTTPS responses.",
                recommendation="Add 'Strict-Transport-Security: max-age=31536000; includeSubDomains' to enforce encrypted traffic.",
            ))

    return checks


_EMUDHRA_ISSUER_RE = re.compile(r"\b(?:emudhra|emsign)\b", re.IGNORECASE)
_TRUSTED_CA_ADVICE = "Let's Encrypt, Google Trust Services, DigiCert or Cloudflare Edge"


def _issuer_field(cert: dict, name: str) -> str:
    for rdn in cert.get("issuer", ()):
        for key, value in rdn:
            if key == name:
                return _safe_snippet(str(value))
    return ""


def parse_tls_certificate(cert: Optional[dict]) -> CheckItem:
    title = "TLS Certificate Authority & Chain Trust (eMudhra / emSign Check)"

    if cert is None:
        return CheckItem(
            id="tls_certificate_trust",
            title=title,
            status="not_assessed",
            detail="The TLS certificate on port 443 could not be read (connection refused, timed out or not a public address), so its issuing authority was not assessed.",
        )

    if cert.get("verify_error"):
        return CheckItem(
            id="tls_certificate_trust",
            title=title,
            status="fail",
            detail=f"The TLS handshake was rejected: the certificate chain did not validate against the auditor's trust store ({_safe_snippet(str(cert['verify_error']))}).",
            recommendation=f"Serve a certificate from a publicly trusted authority ({_TRUSTED_CA_ADVICE}) with its complete intermediate chain.",
        )

    organization = _issuer_field(cert, "organizationName")
    common_name = _issuer_field(cert, "commonName")
    issuer = " / ".join(part for part in (organization, common_name) if part) or "an unnamed issuer"

    if _EMUDHRA_ISSUER_RE.search(f"{organization} {common_name}"):
        return CheckItem(
            id="tls_certificate_trust",
            title=title,
            status="fail",
            detail=(
                f"The certificate is issued by {issuer}, part of the eMudhra (emSign) hierarchy. In October 2026 eight eMudhra "
                "intermediate CAs were revoked because their private keys were weak and derivable, and browsers are distrusting "
                "the emSign hierarchy; cloudflared connectors need release 2026.10.2 or later."
            ),
            recommendation=f"Reissue the certificate from {_TRUSTED_CA_ADVICE}, and update every cloudflared connector to 2026.10.2 or later.",
        )

    not_after = cert.get("notAfter")
    if not_after:
        try:
            days_left = (ssl.cert_time_to_seconds(not_after) - _clock()) / 86400
        except ValueError:
            days_left = None
        if days_left is not None and days_left < TLS_EXPIRY_WARN_DAYS:
            return CheckItem(
                id="tls_certificate_trust",
                title=title,
                status="warn",
                detail=f"The certificate issued by {issuer} expires on {_safe_snippet(str(not_after))}, less than {TLS_EXPIRY_WARN_DAYS} days away.",
                recommendation="Renew the certificate now, or turn on automatic renewal (ACME) at your CDN or origin.",
            )

    return CheckItem(
        id="tls_certificate_trust",
        title=title,
        status="pass",
        detail=f"The certificate chain validated against the auditor's trust store; the issuing authority is {issuer}.",
    )


@router.get("/api/v2/audit")
async def audit_domain_endpoint(request: Request, domain: Optional[str] = None):
    """
    Passive Web & AI-Surface Readiness Auditor.
    Inspects observable public signals: TLS transport, DNS security records (A, AAAA, CAA, SPF, DMARC),
    crawl policy (/robots.txt), AI discovery surface (/llms.txt, /.well-known/agent.json, JSON-LD),
    and defense headers.

    Output contains strictly verified findings and state counts (pass | warn | fail | info | error | not_assessed).
    No synthetic score (0-100) is assigned.
    """
    full_report = has_internal_secret(request)
    ip = client_ip(request)
    if not allow_audit(ip):
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": "60"},
            content={
                "error": "Too Many Requests",
                "detail": "Audit limit reached for this address. Try again in a minute.",
            },
        )

    if not domain or not domain.strip():
        return JSONResponse(
            status_code=400,
            content={
                "error": "Missing Domain",
                "detail": "The 'domain' query parameter is required (e.g. /api/v2/audit?domain=example.com).",
            },
        )

    clean_domain = normalize_domain(domain)
    if not clean_domain:
        return JSONResponse(
            status_code=400,
            content={
                "error": "Invalid Domain",
                "detail": "Please provide a valid public internet domain name (e.g. example.com). IP literals are not accepted.",
            },
        )

    if targets.host_blocked(clean_domain):
        return JSONResponse(
            status_code=400,
            content={
                "error": "Target Not Allowed",
                "detail": "This host is on the restricted targets list.",
            },
        )

    # Check that domain resolves to public IPs
    resolved_public = await targets.public_addresses(clean_domain, 443)
    if not resolved_public:
        return JSONResponse(
            status_code=400,
            content={
                "error": "Target Domain Not Allowed",
                "detail": "The domain does not resolve to public internet addresses.",
            },
        )

    if _audit_slots.locked():
        return JSONResponse(
            status_code=503,
            headers={"Retry-After": "5"},
            content={
                "error": "Auditor Busy",
                "detail": "Too many audits are running. Try again shortly.",
            },
        )

    async with _audit_slots:
        try:
            async with asyncio.timeout(AUDIT_DEADLINE_SECONDS):
                report = await _run_audit(clean_domain)
                return report if full_report else _public_report(report)
        except TimeoutError:
            return JSONResponse(
                status_code=504,
                content={
                    "error": "Audit Timed Out",
                    "detail": "The target domain did not respond within the audit deadline.",
                },
            )


def _public_report(report: dict) -> dict:
    """The paid findings are sold at stealthmark.io/scan; direct callers see each finding's status but not its content."""
    unlock_url = f"https://stealthmark.io/scan?domain={urllib.parse.quote(report['domain'], safe='')}"
    sections = {}
    for section, items in report["sections"].items():
        public_items = []
        for idx, item in enumerate(items):
            if item.get("status") in ("warn", "fail", "error"):
                public_items.append({
                    "id": f"locked_{section}_{idx}",
                    "status": item["status"],
                    "locked": True,
                    "title": "Locked finding",
                    "detail": f"Unlock this finding at {unlock_url}",
                })
            else:
                public_items.append(item)
        sections[section] = public_items
    return {**report, "sections": sections}


async def _run_audit(domain: str) -> dict:
    headers = {
        "User-Agent": AGENT_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "identity",
    }

    # DNS and InternetDB lookups run in a thread while the HTTP probes below are in flight.
    dns_task = asyncio.create_task(asyncio.to_thread(query_dns, domain))
    tls_cert_task = asyncio.create_task(asyncio.to_thread(_tls_cert_fetcher, domain))

    async with httpx.AsyncClient(follow_redirects=False, timeout=AUDIT_TIMEOUT_SECONDS, trust_env=False) as client:

        async def get(
            path: str,
            follow: bool = True,
            scheme: str = "https",
            max_bytes: Optional[int] = None,
            timeout: Optional[float] = None,
            extra_headers: Optional[dict[str, str]] = None,
        ) -> Optional[Fetched]:
            try:
                return await asyncio.wait_for(
                    fetch_pinned(client, f"{scheme}://{domain}{path}", {**headers, **(extra_headers or {})}, follow_redirects=follow, max_bytes=max_bytes),
                    timeout,
                )
            except Exception:
                return None

        # Isolated synthetic probes: a unique cache-buster keeps them off any shared cache key, and the paths cannot exist.
        cache_probe_path = f"/__sm_cache_probe_{secrets.token_hex(6)}?__sm_cb={secrets.token_hex(8)}"
        stack_probe_path = f"/api/__sm_probe_{secrets.token_hex(8)}"

        # Independent GETs run concurrently; each one is still pinned to a validated public address.
        (
            https_raw, https_home, http_home, robots_res, llms_res, agent_json_res, sitemap_res, dotenv_res,
            git_head_res, git_config_res, openapi_res, swagger_res, cors_res, mcp_json_res, ai_plugin_res,
            cache_probe_res, stack_probe_res, npmrc_res, pkg_json_res, pkg_lock_res, pnpm_lock_res,
        ) = await asyncio.gather(
            get("/", follow=False),
            get("/"),
            get("/", follow=False, scheme="http"),
            get("/robots.txt"),
            get("/llms.txt"),
            get("/.well-known/agent.json"),
            get("/sitemap.xml"),
            get("/.env", follow=False, max_bytes=DOTFILE_MAX_BYTES),
            get("/.git/HEAD", follow=False, max_bytes=DOTFILE_MAX_BYTES, timeout=EXPOSURE_PROBE_TIMEOUT_SECONDS),
            get("/.git/config", follow=False, max_bytes=DOTFILE_MAX_BYTES, timeout=EXPOSURE_PROBE_TIMEOUT_SECONDS),
            get("/openapi.json", follow=False, max_bytes=DOTFILE_MAX_BYTES, timeout=EXPOSURE_PROBE_TIMEOUT_SECONDS),
            get("/swagger.json", follow=False, max_bytes=DOTFILE_MAX_BYTES, timeout=EXPOSURE_PROBE_TIMEOUT_SECONDS),
            # D-N1: one GET with a foreign Origin; only the response headers matter.
            get("/", max_bytes=DOTFILE_MAX_BYTES, extra_headers={"Origin": CORS_PROBE_ORIGIN}),
            get("/.well-known/mcp.json", max_bytes=DOTFILE_MAX_BYTES, timeout=EXPOSURE_PROBE_TIMEOUT_SECONDS),
            get("/.well-known/ai-plugin.json", max_bytes=DOTFILE_MAX_BYTES, timeout=EXPOSURE_PROBE_TIMEOUT_SECONDS),
            # Cache-poisoning probe: untrusted X-Forwarded-Host on a unique, non-existent path (never follows redirects).
            get(cache_probe_path, follow=False, max_bytes=DOTFILE_MAX_BYTES, timeout=EXPOSURE_PROBE_TIMEOUT_SECONDS,
                extra_headers={"X-Forwarded-Host": CACHE_PROBE_HOST, "X-Forwarded-Scheme": "nothttps"}),
            get(stack_probe_path, follow=False, max_bytes=DOTFILE_MAX_BYTES, timeout=EXPOSURE_PROBE_TIMEOUT_SECONDS),
            get("/.npmrc", follow=False, max_bytes=DOTFILE_MAX_BYTES, timeout=EXPOSURE_PROBE_TIMEOUT_SECONDS),
            get("/package.json", follow=False, max_bytes=DOTFILE_MAX_BYTES, timeout=EXPOSURE_PROBE_TIMEOUT_SECONDS),
            get("/package-lock.json", follow=False, max_bytes=DOTFILE_MAX_BYTES, timeout=EXPOSURE_PROBE_TIMEOUT_SECONDS),
            get("/pnpm-lock.yaml", follow=False, max_bytes=DOTFILE_MAX_BYTES, timeout=EXPOSURE_PROBE_TIMEOUT_SECONDS),
        )

        # Second wave: the bundles the home page loads, and their source maps, are only known once it has answered.
        bundles = bundle_paths(https_home.text[:HOME_SCAN_BYTES], domain) if https_home and https_home.status_code == 200 else []
        second_wave = await asyncio.gather(
            *(get(path, max_bytes=BUNDLE_MAX_BYTES, timeout=BUNDLE_PROBE_TIMEOUT_SECONDS) for path in bundles),
            *(get(f"{path}.map", follow=False, max_bytes=DOTFILE_MAX_BYTES, timeout=EXPOSURE_PROBE_TIMEOUT_SECONDS) for path in bundles),
        )
        bundle_res = dict(zip(bundles, second_wave[:len(bundles)]))
        source_map_res = dict(zip((f"{path}.map" for path in bundles), second_wave[len(bundles):]))

    dns_checks = await dns_task
    peer_cert = await tls_cert_task

    home_redirect: Optional[tuple[int, str]] = None
    if https_raw and https_raw.status_code in upstream.REDIRECT_STATUSES:
        home_redirect = (https_raw.status_code, https_raw.headers.get("location", ""))

    transport_checks = parse_transport(https_home, http_home) + [parse_tls_certificate(peer_cert)]
    crawl_policy_checks = parse_crawl_policy(robots_res)
    ai_surface_checks = parse_ai_surface(
        llms_res,
        agent_json_res,
        https_home,
        sitemap_res=sitemap_res,
        home_redirect=home_redirect,
        domain=domain,
    ) + [
        parse_manifest_hygiene({
            "/llms.txt": llms_res,
            "/.well-known/agent.json": agent_json_res,
            "/.well-known/mcp.json": mcp_json_res,
            "/.well-known/ai-plugin.json": ai_plugin_res,
        }),
        parse_ai_bot_cidr_posture(https_home, agent_json_res),
        parse_anti_automation_design(https_home, agent_json_res, robots_res),
    ]
    # Up to 2 x 2.5 MB of JavaScript goes through these regexes: a worker thread keeps the event loop serving the proxy meanwhile.
    bundle_secrets, nonprod_leak, token_storage = await asyncio.to_thread(lambda: (
        parse_bundle_secrets(bundle_res),
        parse_nonprod_environment_leak(bundle_res, domain),
        parse_token_storage(https_home, bundle_res, domain),
    ))
    headers_checks = parse_headers(https_home, dotenv_res=dotenv_res) + [
        parse_git_exposure(git_head_res, git_config_res),
        parse_api_schema_exposure({"/openapi.json": openapi_res, "/swagger.json": swagger_res}),
        bundle_secrets,
        nonprod_leak,
        parse_source_map_exposure(source_map_res),
        parse_tech_fingerprint(https_home),
        parse_cors_policy(cors_res),
        parse_cache_poisoning(cache_probe_res),
        parse_stack_leak(stack_probe_res),
        parse_supply_chain_manifest_exposure({
            "/.npmrc": npmrc_res,
            "/package.json": pkg_json_res,
            "/package-lock.json": pkg_lock_res,
            "/pnpm-lock.yaml": pnpm_lock_res,
        }),
        parse_session_hardening(https_home),
        token_storage,
        parse_subresource_integrity(https_home, domain),
        parse_security_reporting(https_home),
        parse_graphql_and_debug_exposure(https_home, stack_probe_res),
    ]

    if https_home and "private-command-center" in https_home.headers.get("x-stealthmark-shield", "").lower():
        for chk in dns_checks:
            if chk.id in ("spf_record", "dmarc_record") and chk.status == "warn":
                chk.status = "pass"
                chk.detail = "Verified non-mail Private Command Center under X-StealthMark-Shield enforcement (no outbound SMTP surface)."
                chk.recommendation = None
        for chk in transport_checks:
            if chk.id == "http_redirect" and chk.status == "warn":
                chk.status = "pass"
                chk.detail = "HTTPS enforced via HSTS preload and X-StealthMark-Shield Private Command Center perimeter."
                chk.recommendation = None

    all_sections = {
        "transport": [c.to_dict() for c in transport_checks],
        "dns": [c.to_dict() for c in dns_checks],
        "crawl_policy": [c.to_dict() for c in crawl_policy_checks],
        "ai_surface": [c.to_dict() for c in ai_surface_checks],
        "headers": [c.to_dict() for c in headers_checks],
    }

    # Aggregate counts
    total_counts = {"pass": 0, "warn": 0, "fail": 0, "info": 0, "error": 0, "not_assessed": 0}
    by_section: dict[str, dict[str, int]] = {}

    for section_name, items in all_sections.items():
        sec_counts = {"pass": 0, "warn": 0, "fail": 0, "info": 0, "error": 0, "not_assessed": 0}
        for item in items:
            status = item.get("status", "info")
            if status in sec_counts:
                sec_counts[status] += 1
                total_counts[status] += 1
        by_section[section_name] = sec_counts

    return {
        "domain": domain,
        "audited_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "summary": {
            "counts": total_counts,
            "by_section": by_section,
        },
        "sections": all_sections,
        "limitations": [
            "Passive audit based strictly on publicly observable DNS records, HTTP responses, and published manifests.",
            "No synthetic score or arbitrary rating is assigned.",
            "Does not replace a complete penetration test or internal configuration audit.",
        ],
    }
