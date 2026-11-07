import datetime
import html
import itertools
import re
import unicodedata
from typing import Optional
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from gateway import targets
from gateway.auth import require_internal_secret
from gateway.auditor.ai_surface import (
    _INVISIBLE_UNICODE_RE,
    _UNPROXIED_ORIGIN_RE,
    extract_sitemap_urls,
)
from gateway.auditor.secrets import find_secrets
from gateway.clientip import client_ip
from gateway.routes.audit_v2 import AUDIT_TIMEOUT_SECONDS, AGENT_USER_AGENT, allow_audit, normalize_domain
from gateway.routes.scanner import ScanRefused, fetch_pinned
from gateway.shields.errors import ShieldBlock
from gateway.shields.semantic import scan_semantic_payload

router = APIRouter()

MAX_SCAN_TEXT_CHARS = 65_536

_WALLET_DRAIN_RE = re.compile(
    r"(?i)(?:transferWithAuthorization|pay_lightning_invoice|eth_sendTransaction|"
    r"eth_signTypedData|send\s+\d+(?:\.\d+)?\s*(?:usdc|usdt|eth|sol|btc|bnb)\s+to\s+0x[a-fA-F0-9]{40}|"
    r"export\s+(?:your\s+)?(?:seed\s+phrase|private\s+key|mnemonic))",
)


class ShieldScanRequest(BaseModel):
    text: str = Field(..., max_length=MAX_SCAN_TEXT_CHARS)
    context: Optional[str] = Field(default="untrusted_input", max_length=64)


class GenerateManifestsRequest(BaseModel):
    domain: str = Field(..., max_length=255)


@router.post("/api/v2/shield/scan")
async def shield_scan_endpoint(payload: ShieldScanRequest, request: Request):
    """
    A2A Microservice #2: Prompt-Injection & Unicode Firewall Scan.
    Inspects untrusted text (web pages, /llms.txt, emails, tool outputs, resumes) for:
    - Full-width NFKC homoglyph smuggling
    - Hidden zero-width / bidirectional / Unicode tag characters
    - Linear-time O(N) semantic prompt-injection & markdown image exfiltration patterns
    Returns deterministic findings plus a sanitized, NFKC-normalized copy of the text.
    """
    ip = client_ip(request)
    if not allow_audit(ip):
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": "60"},
            content={
                "error": "Too Many Requests",
                "detail": "Rate limit reached for this address. Provide an active sk_live_ API key or retry in 60s.",
            },
        )

    raw_text = payload.text or ""
    ctx_label = (payload.context or "untrusted_input").strip()[:64]

    invisible_matches = _INVISIBLE_UNICODE_RE.findall(raw_text)
    invisible_count = len(invisible_matches)

    stripped_invisible = _INVISIBLE_UNICODE_RE.sub("", raw_text)
    normalized_text = unicodedata.normalize("NFKC", stripped_invisible)
    nfkc_modified = normalized_text != stripped_invisible

    threats: list[dict[str, str]] = []
    if invisible_count > 0:
        threats.append({
            "type": "invisible_unicode_smuggling",
            "severity": "high",
            "detail": f"Detected {invisible_count} hidden zero-width, bidirectional, or Unicode tag character(s).",
        })

    try:
        scan_semantic_payload(normalized_text, ctx_label)
    except ShieldBlock as exc:
        reason = exc.detail.get("reason") if isinstance(exc.detail, dict) else str(exc.detail)
        threats.append({
            "type": "semantic_prompt_injection",
            "severity": "critical",
            "detail": reason,
        })

    wallet_drains = _WALLET_DRAIN_RE.findall(normalized_text)
    if wallet_drains:
        threats.append({
            "type": "wallet_drain_prompt_injection",
            "severity": "critical",
            "detail": f"Detected {len(wallet_drains)} indirect wallet-draining instruction(s) (e.g. transferWithAuthorization / pay_lightning_invoice / unauthorized transfer).",
        })

    secret_leaks = [h for h in find_secrets(normalized_text) if h.severity == "fail"]
    if secret_leaks:
        threats.append({
            "type": "secret_or_api_key_leak",
            "severity": "critical",
            "detail": f"Detected {len(secret_leaks)} exposed API/service credential token(s) in payload.",
        })

    origin_leaks = list(dict.fromkeys(_UNPROXIED_ORIGIN_RE.findall(normalized_text)))
    if origin_leaks:
        threats.append({
            "type": "unproxied_cloud_origin_leak",
            "severity": "medium",
            "detail": f"Detected {len(origin_leaks)} direct unproxied cloud origin URL(s) ({', '.join(origin_leaks[:2])}).",
        })

    safe = len(threats) == 0
    return {
        "safe": safe,
        "context": ctx_label,
        "scanned_bytes": len(raw_text.encode("utf-8")),
        "invisible_unicode_count": invisible_count,
        "nfkc_modified": nfkc_modified,
        "threats": threats,
        "sanitized_text": normalized_text if safe else None,
        "audited_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


# The title and description reach llms.txt and agent.json, so the characters a reader cannot see are dropped: zero-width
# and bidi controls, tags, and control characters. Whitespace controls are left to the \s+ collapse, which makes them a space.
_META_HIDDEN_RE = re.compile(
    r"[\x00-\x08\x0e-\x1b\x7f-\x84\x86-\x9f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\U000e0000-\U000e007f]"
)


def _extract_html_meta(html_text: str, domain: str) -> tuple[str, str]:
    head_slice = html_text[:65536]
    title_match = re.search(r"<title\b[^>]{0,256}>(.*?)</title>", head_slice, re.IGNORECASE | re.DOTALL)
    raw_title = (
        _META_HIDDEN_RE.sub("", unicodedata.normalize("NFKC", html.unescape(title_match.group(1)))).strip()
        if title_match
        else domain
    )
    clean_title = re.sub(r"\s+", " ", raw_title)[:100] or domain

    raw_desc = ""
    for meta_match in re.finditer(r"<meta\b[^>]{1,1024}>", head_slice, re.IGNORECASE):
        tag = meta_match.group(0)
        if re.search(r'\bname\s*=\s*["\']description["\']', tag, re.IGNORECASE):
            cm = re.search(r'\bcontent\s*=\s*["\']([^"\']{1,500})["\']', tag, re.IGNORECASE)
            if cm:
                raw_desc = _META_HIDDEN_RE.sub("", unicodedata.normalize("NFKC", html.unescape(cm.group(1)))).strip()
                break

    if not raw_desc:
        raw_desc = f"Official web surface and documentation for {domain}."
    clean_desc = re.sub(r"\s+", " ", raw_desc)[:240]
    return clean_title, clean_desc


# The title, description and sitemap URLs come from the scanned site, so llms.txt shows them as text: they must not
# add links, HTML, code spans or blocks of their own.
_MD_INLINE_RE = re.compile(r"([\\`*_\[\]<~])")


def _md_inline(text: str) -> str:
    return _MD_INLINE_RE.sub(r"\\\1", text)


def _md_title(title: str) -> str:
    # A trailing run of "#" after a space would be read as the closing sequence of the heading and dropped.
    return re.sub(r"(^|\s)(#+)(?=\s*$)", r"\1\\\2", _md_inline(title))


def _md_description(desc: str) -> str:
    # After "> ", a leading "#", ">", "+", "-" or "1." would open a heading, a nested quote or a list.
    escaped = re.sub(r"^([#>+-])", r"\\\1", _md_inline(desc))
    return re.sub(r"^(\d{1,9})([.)])(?=\s|$)", r"\1\\\2", escaped)


# A host made of letters, digits, dots and hyphens (Unicode letters included), or an IPv6 literal, plus an optional port.
_LLMS_TXT_HOST_RE = re.compile(r"(?:(?:[^\W_]|[-.])+|\[[0-9A-Fa-f:.]+\])(?::[0-9]{1,5})?")


def _llms_txt_url(loc: str) -> Optional[str]:
    # re.ASCII keeps IGNORECASE from matching "ſ" (U+017F) as "s", which would let "httpſ://" through as a scheme.
    match = re.fullmatch(r"(https?)://([^/?#]*)(.*)", loc, re.IGNORECASE | re.DOTALL | re.ASCII)
    if not match:
        return None
    scheme, host, rest = match.groups()
    # The host is kept as written, so Unicode and IPv6 hosts still resolve, once NFKC cannot turn it into Markdown.
    if not _LLMS_TXT_HOST_RE.fullmatch(host) or unicodedata.normalize("NFKC", host) != host:
        return None
    # Percent-encoding whitespace, brackets, parentheses and angle brackets keeps the URL inside its Markdown link.
    return f"{scheme}://{host}" + quote(rest, safe=":/?#@!$&'*+,;=%")


@router.post("/api/v2/generate/manifests", dependencies=[Depends(require_internal_secret)])
async def generate_manifests_endpoint(payload: GenerateManifestsRequest, request: Request):
    """
    A2A Microservice #4: Automated /llms.txt and /.well-known/agent.json Generator.
    Fetches the public homepage and /sitemap.xml of a domain using SSRF-pinned connections
    and synthesizes ready-to-publish /llms.txt and /.well-known/agent.json artifacts.
    """
    ip = client_ip(request)
    if not allow_audit(ip):
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": "60"},
            content={
                "error": "Too Many Requests",
                "detail": "Rate limit reached for this address. Try again in a minute.",
            },
        )

    clean_domain = normalize_domain(payload.domain)
    if not clean_domain:
        return JSONResponse(
            status_code=400,
            content={"error": "Invalid Domain", "detail": "Provide a valid public internet domain name."},
        )

    if targets.host_blocked(clean_domain):
        return JSONResponse(
            status_code=400,
            content={"error": "Target Not Allowed", "detail": "This host is on the restricted targets list."},
        )

    resolved_public = await targets.public_addresses(clean_domain, 443)
    if not resolved_public:
        return JSONResponse(
            status_code=400,
            content={"error": "Target Domain Not Allowed", "detail": "Domain does not resolve to public internet addresses."},
        )

    headers = {
        "User-Agent": AGENT_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "identity",
    }

    home_html = ""
    sitemap_urls: list[str] = []

    async with httpx.AsyncClient(follow_redirects=False, timeout=AUDIT_TIMEOUT_SECONDS, trust_env=False) as client:
        try:
            home_res = await fetch_pinned(client, f"https://{clean_domain}/", headers, follow_redirects=True)
            if home_res and home_res.status_code == 200:
                home_html = home_res.text
        except (httpx.HTTPError, ScanRefused, Exception):
            home_html = ""

        try:
            sm_res = await fetch_pinned(client, f"https://{clean_domain}/sitemap.xml", headers, follow_redirects=True)
            if sm_res and sm_res.status_code == 200:
                locs, err = extract_sitemap_urls(sm_res.body)
                if not err and locs:
                    sitemap_urls = list(itertools.islice(filter(None, map(_llms_txt_url, locs)), 25))
        except (httpx.HTTPError, ScanRefused, Exception):
            sitemap_urls = []

    site_title, site_desc = _extract_html_meta(home_html, clean_domain)
    if not sitemap_urls:
        sitemap_urls = [
            f"https://{clean_domain}/",
            f"https://{clean_domain}/docs",
            f"https://{clean_domain}/pricing",
        ]

    url_bullets = "\n".join(f"- [{_md_inline(u)}]({u})" for u in sitemap_urls[:15])
    # The attribution is the last line on its own, so the site owner can delete it; agent.json carries none.
    llms_txt = (
        f"# {_md_title(site_title)}\n\n"
        f"> {_md_description(site_desc)}\n\n"
        f"## Canonical URLs & Documentation\n\n"
        f"{url_bullets}\n\n"
        f"## AI Agent Governance\n\n"
        f"- Machine-readable manifest: `https://{clean_domain}/.well-known/agent.json`\n"
        f"- Sitemap index: `https://{clean_domain}/sitemap.xml`\n\n"
        f"> Generated with StealthMark — https://stealthmark.io\n"
    )

    agent_json = {
        "schema_version": "1.0",
        "name": site_title,
        "domain": clean_domain,
        "description": site_desc,
        "llms_txt": f"https://{clean_domain}/llms.txt",
        "sitemap": f"https://{clean_domain}/sitemap.xml",
        "policy": {
            "default": "observe",
            "allowed_crawlers": ["GPTBot", "OAI-SearchBot", "ClaudeBot", "PerplexityBot", "Google-Extended"],
        },
        "capabilities": [
            {
                "id": "public_content_index",
                "type": "read",
                "endpoint": f"https://{clean_domain}/llms.txt",
                "format": "text/markdown",
            }
        ],
    }

    return {
        "domain": clean_domain,
        "title": site_title,
        "description": site_desc,
        "discovered_urls_count": len(sitemap_urls),
        "artifacts": {
            "llms_txt": llms_txt,
            "agent_json": agent_json,
        },
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


@router.post("/api/v2/generate/edge-shield", dependencies=[Depends(require_internal_secret)])
async def generate_edge_shield_endpoint(request: Request, body: GenerateManifestsRequest):
    """
    A2A Microservice #3: Synthesizes a ready-to-deploy Cloudflare edge bundle
    (Cloudflare Worker + Cloudflare WAF Expression + Enforced DMARC)
    for any target domain.
    """
    ip = client_ip(request)
    if not allow_audit(ip):
        return JSONResponse(status_code=429, content={"error": "rate_limit_exceeded"})

    clean_domain = normalize_domain(body.domain)
    if not clean_domain or targets.host_blocked(clean_domain):
        return JSONResponse(status_code=400, content={"error": "invalid_domain"})

    cf_worker_js = f"""// StealthMark Edge Shield Worker for {clean_domain}
// Blocks known scanner user agents (tlm-scanner, sqlmap, nuclei), /.env, /.git and other sensitive paths, and PHP CGI argument-injection query strings before they reach the origin
const BLOCKED_UA_RE = /(?:tlm-scanner|sqlmap|nikto|nuclei|masscan|zgrab|dirbuster|gobuster|wpscan|acunetix|nessus)/i;
const BLOCKED_PATH_RE = /(?:^\\/\\.(?:env|git|aws|ssh|svn|DS_Store|htaccess|htpasswd)|^\\/(?:wp-config\\.php|xmlrpc\\.php|phpmyadmin|actuator|docker-compose|vendor\\/phpunit|cgi-bin\\/php)|\\.(?:env|bak|swp|old|save|sql|ini)$)/i;
const PHP_RCE_QUERY_RE = /(?:^|[?&])(?:-d|-n|-f|-c|%2d%64|%ad%64|allow_url_include|auto_prepend_file|auto_append_file|php:\\/\\/(?:input|filter)|data:\\/\\/text)/i;
const ALLOWED_PORTS = new Set(['', '80', '443']);

export default {{
  async fetch(request) {{
    const url = new URL(request.url);
    if (url.port && !ALLOWED_PORTS.has(url.port)) {{
      return new Response(JSON.stringify({{ error: 'forbidden_port', shield: 'stealthmark_edge' }}), {{
        status: 403,
        headers: {{ 'content-type': 'application/json', 'x-stealthmark-edge-shield': 'BLOCKED_PORT' }},
      }});
    }}
    const ua = request.headers.get('user-agent') || '';
    if (BLOCKED_UA_RE.test(ua) || BLOCKED_PATH_RE.test(url.pathname) || PHP_RCE_QUERY_RE.test(url.search)) {{
      return new Response(JSON.stringify({{ error: 'edge_shield_blocked', domain: '{clean_domain}' }}), {{
        status: 403,
        headers: {{ 'content-type': 'application/json', 'x-stealthmark-edge-shield': 'BLOCKED_SCANNER_OR_PHP_RCE', 'cache-control': 'public, max-age=3600' }},
      }});
    }}
    const response = await fetch(request);
    const outHeaders = new Headers(response.headers);
    outHeaders.delete('x-powered-by');
    outHeaders.set('x-stealthmark-edge-shield', 'ACTIVE');
    outHeaders.set('x-content-type-options', 'nosniff');
    outHeaders.set('x-frame-options', 'DENY');
    outHeaders.set('referrer-policy', 'strict-origin-when-cross-origin');
    outHeaders.set('strict-transport-security', 'max-age=63072000; includeSubDomains; preload');
    return new Response(response.body, {{ status: response.status, statusText: response.statusText, headers: outHeaders }});
  }}
}};"""

    cf_waf_rule = (
        '(http.user_agent contains "tlm-scanner") or (http.user_agent contains "sqlmap") or '
        '(http.user_agent contains "nuclei") or (http.user_agent contains "nikto") or '
        '(starts_with(http.request.uri.path, "/.env")) or (starts_with(http.request.uri.path, "/.git")) or '
        '(http.request.uri.path eq "/xmlrpc.php") or (http.request.uri.path contains "/vendor/phpunit") or '
        '(http.request.uri.query contains "allow_url_include") or (http.request.uri.query contains "auto_prepend_file") or '
        '(http.request.uri.query contains "%ADd") or (http.request.uri.query contains "php://input") or '
        '(not cf.edge.server_port in {80 443})'
    )

    dmarc_record = f'_dmarc.{clean_domain} TXT "v=DMARC1; p=quarantine; pct=100; rua=mailto:security@{clean_domain}"'

    return {
        "domain": clean_domain,
        "cloudflare_worker_js": cf_worker_js,
        "cloudflare_waf_expression": cf_waf_rule,
        "dmarc_dns_record": dmarc_record,
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
