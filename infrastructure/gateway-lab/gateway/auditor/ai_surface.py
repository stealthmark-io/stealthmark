import json
import re
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Optional

from gateway.auditor.secrets import GOOGLE_BROWSER_KEY_RE, describe, find_secrets
from gateway.routes.scanner import Fetched
from gateway.shields.errors import ShieldBlock
from gateway.shields.semantic import scan_semantic_payload

_INVISIBLE_UNICODE_RE = re.compile(r"[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\U000e0000-\U000e007f]")
_UNPROXIED_ORIGIN_RE = re.compile(
    r"https?://[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.(?:a\.run\.app|execute-api\.[a-z0-9-]+\.amazonaws\.com|up\.railway\.app|onrender\.com)\b",
    re.IGNORECASE,
)


@dataclass
class CheckItem:
    id: str
    title: str
    status: str  # "pass" | "warn" | "fail" | "info" | "error"
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


MAX_SITEMAP_XML_BYTES = 2 * 1024 * 1024
MAX_SITEMAP_LOCS = 10_000


def extract_sitemap_urls(xml_bytes: bytes) -> tuple[Optional[list[str]], Optional[str]]:
    """
    Parses sitemap XML and returns (list_of_urls, error_message).
    Handles standard sitemap namespaces and sitemapindex files.
    Refuses DTD / ENTITY declarations to prevent XML Billion Laughs / XXE DoS.
    """
    if len(xml_bytes) > MAX_SITEMAP_XML_BYTES:
        return None, "Sitemap XML exceeds maximum allowed size (2 MB)"
    if b"<!ENTITY" in xml_bytes[:65536].upper():
        return None, "XML ENTITY declarations are not permitted in sitemaps"
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        return None, str(exc)

    locs: list[str] = []
    for elem in root.iter():
        if elem.tag.endswith("loc") and elem.text:
            text = elem.text.strip()
            if text:
                locs.append(text)
                if len(locs) >= MAX_SITEMAP_LOCS:
                    break

    return locs, None


def parse_sitemap_xml(
    sitemap_res: Optional[Fetched],
    home_redirect: Optional[tuple[int, str]] = None,
    domain: str = "",
) -> list[CheckItem]:
    """
    Inspects /sitemap.xml:
    1. HTTP 200 response
    2. Valid XML conforming to sitemaps.org
    3. Number of <loc> elements declared
    4. Language redirect trap: when apex / returns 301/302/307/308 (e.g. to /es or /en)
       but sitemap only declares the apex URL without listing canonical destination paths.
    """
    checks: list[CheckItem] = []

    if not sitemap_res or sitemap_res.status_code != 200:
        status_code = sitemap_res.status_code if sitemap_res else "connection error"
        checks.append(CheckItem(
            id="sitemap_xml",
            title="Sitemap XML (/sitemap.xml)",
            status="warn",
            detail=f"/sitemap.xml returned HTTP {status_code}. Search engines and AI crawlers rely on /sitemap.xml to discover content.",
            recommendation="Publish a valid /sitemap.xml file declaring all canonical content URLs with current <lastmod> dates.",
        ))
        return checks

    locs, parse_err = extract_sitemap_urls(sitemap_res.body)
    if parse_err is not None:
        checks.append(CheckItem(
            id="sitemap_xml",
            title="Sitemap XML (/sitemap.xml)",
            status="fail",
            detail=f"/sitemap.xml answered HTTP 200 but contains invalid XML: {parse_err}.",
            recommendation="Ensure /sitemap.xml is valid XML adhering to the sitemaps.org specification.",
        ))
        return checks

    loc_count = len(locs or [])
    if loc_count == 0:
        checks.append(CheckItem(
            id="sitemap_xml",
            title="Sitemap XML (/sitemap.xml)",
            status="warn",
            detail="/sitemap.xml answered HTTP 200 with valid XML, but declared 0 <loc> URLs.",
            recommendation="Populate /sitemap.xml with canonical page URLs.",
        ))
        return checks

    # Check for apex home language redirect trap (e.g. democv.example.com case)
    redirect_mismatch = False
    redirect_status = 0
    redirect_target = ""

    if home_redirect and locs:
        redirect_status, redirect_target = home_redirect
        target_norm = redirect_target.strip()
        # Parse target path
        if target_norm.startswith(("http://", "https://")):
            parsed_target = urllib.parse.urlsplit(target_norm)
            target_path = parsed_target.path.rstrip("/")
        else:
            target_path = target_norm.split("?")[0].rstrip("/")

        # If apex redirects to a localized or deeper subpath (e.g. /es, /en, /app)
        if target_path and target_path != "":
            # Normalize sitemap loc paths
            sitemap_paths: set[str] = set()
            for u in locs:
                try:
                    p = urllib.parse.urlsplit(u).path.rstrip("/")
                    sitemap_paths.add(p)
                except Exception:
                    pass

            # Trap: target path not in sitemap
            if target_path not in sitemap_paths:
                redirect_mismatch = True

    if redirect_mismatch:
        checks.append(CheckItem(
            id="sitemap_xml",
            title="Sitemap Canonical URLs & Language Redirect",
            status="warn",
            detail=(
                f"/sitemap.xml declares {loc_count} URL(s), but apex home redirects "
                f"(HTTP {redirect_status} -> {redirect_target}) and the destination path "
                f"is missing from the sitemap. AI crawlers (ClaudeBot, OAI-SearchBot) hitting the root "
                f"receive a redirect and may abandon crawling without indexing deep content."
            ),
            recommendation=(
                "Add the canonical locale URL the apex redirects to directly to /sitemap.xml "
                "with current <lastmod> timestamps."
            ),
        ))
    else:
        checks.append(CheckItem(
            id="sitemap_xml",
            title="Sitemap XML (/sitemap.xml)",
            status="pass",
            detail=f"/sitemap.xml is valid XML declaring {loc_count} canonical URL(s).",
        ))

    return checks


def parse_ai_surface(
    llms_res: Optional[Fetched],
    agent_json_res: Optional[Fetched],
    home_res: Optional[Fetched],
    sitemap_res: Optional[Fetched] = None,
    home_redirect: Optional[tuple[int, str]] = None,
    domain: str = "",
) -> list[CheckItem]:
    checks: list[CheckItem] = []

    # 1. /llms.txt
    if llms_res and llms_res.status_code == 200 and len(llms_res.body) > 0:
        checks.append(CheckItem(
            id="llms_txt",
            title="/llms.txt Context Index",
            status="pass",
            detail=f"/llms.txt is published ({len(llms_res.body)} bytes). LLMs can use this curated markdown index.",
        ))
    else:
        checks.append(CheckItem(
            id="llms_txt",
            title="/llms.txt Context Index",
            status="info",
            detail="/llms.txt not detected. llms.txt provides a standardized markdown context document for LLMs.",
            recommendation="Publish /llms.txt with your key documentation to improve accuracy in AI answers.",
        ))

    # 2. /.well-known/agent.json
    manifest_ok = False
    if agent_json_res and agent_json_res.status_code == 200:
        try:
            parsed = json.loads(agent_json_res.text)
            if isinstance(parsed, dict) and (parsed.get("capabilities") or parsed.get("name") or parsed.get("version")):
                manifest_ok = True
        except Exception:
            manifest_ok = False

    if manifest_ok:
        checks.append(CheckItem(
            id="agent_json",
            title="Agent Manifest (/.well-known/agent.json)",
            status="pass",
            detail="Valid machine-readable agent manifest published at /.well-known/agent.json.",
        ))
    else:
        checks.append(CheckItem(
            id="agent_json",
            title="Agent Manifest (/.well-known/agent.json)",
            status="warn",
            detail="No machine-readable agent manifest found at /.well-known/agent.json.",
            recommendation="Deploy @stealthmark/next to automatically expose a machine-readable capability manifest.",
        ))

    # 3. JSON-LD structured data on home page
    has_json_ld = False
    if home_res and home_res.status_code == 200:
        text = home_res.text
        if re.search(r'<script[^>]+type=["\']application/ld\+json["\']', text, re.IGNORECASE):
            has_json_ld = True

    if has_json_ld:
        checks.append(CheckItem(
            id="structured_data",
            title="Structured Data (Schema.org JSON-LD)",
            status="pass",
            detail="Schema.org JSON-LD structured data detected on the home page.",
        ))
    else:
        checks.append(CheckItem(
            id="structured_data",
            title="Structured Data (Schema.org JSON-LD)",
            status="info",
            detail="No JSON-LD structured data found in the home page markup.",
            recommendation="Add Schema.org JSON-LD (e.g. Organization, WebSite) so agents accurately understand your organization.",
        ))

    # 4. /sitemap.xml inspection (including language redirect check)
    sitemap_checks = parse_sitemap_xml(sitemap_res, home_redirect=home_redirect, domain=domain)
    checks.extend(sitemap_checks)

    # 5. AI Surface Integrity (Prompt Injection, NFKC Full-Width & Invisible Unicode Smuggling)
    surfaces_to_scan: list[tuple[str, str]] = []
    if llms_res and llms_res.status_code == 200 and llms_res.text:
        surfaces_to_scan.append(("/llms.txt", llms_res.text[:65536]))
    if agent_json_res and agent_json_res.status_code == 200 and agent_json_res.text:
        surfaces_to_scan.append(("/.well-known/agent.json", agent_json_res.text[:65536]))

    if not surfaces_to_scan:
        checks.append(CheckItem(
            id="ai_surface_integrity",
            title="AI Surface Integrity (Prompt-Injection & Unicode Scan)",
            status="info",
            detail="No published /llms.txt or /.well-known/agent.json surface available to inspect for prompt-injection or Unicode smuggling.",
            recommendation="Publish /llms.txt and /.well-known/agent.json so autonomous agents consume verified, injection-free context.",
        ))
    else:
        integrity_failures: list[str] = []
        for surface_name, content in surfaces_to_scan:
            try:
                scan_semantic_payload(content, surface_name)
            except ShieldBlock as exc:
                reason = exc.detail.get("reason") if isinstance(exc.detail, dict) else str(exc.detail)
                integrity_failures.append(f"{surface_name} triggered semantic shield ({reason})")
            if _INVISIBLE_UNICODE_RE.search(content):
                integrity_failures.append(f"{surface_name} contains hidden zero-width/bidi/tag Unicode characters")

        if integrity_failures:
            checks.append(CheckItem(
                id="ai_surface_integrity",
                title="AI Surface Integrity (Prompt-Injection & Unicode Scan)",
                status="fail",
                detail="Potential indirect prompt-injection or Unicode smuggling detected: " + "; ".join(integrity_failures) + ".",
                recommendation="Sanitize /llms.txt and /.well-known/agent.json with NFKC normalization, strip invisible zero-width/tag codepoints, and remove untrusted instruction overrides or markdown image exfiltration links.",
            ))
        else:
            scanned_names = ", ".join(name for name, _ in surfaces_to_scan)
            checks.append(CheckItem(
                id="ai_surface_integrity",
                title="AI Surface Integrity (Prompt-Injection & Unicode Scan)",
                status="pass",
                detail=f"Scanned {scanned_names} against NFKC full-width, invisible Unicode, and O(N) semantic prompt-injection signatures: 0 threats detected.",
            ))

    # 6. Agentic SEO & AI Search Citation Metadata (OAI-SearchBot, ClaudeBot, PerplexityBot)
    if home_res and home_res.status_code == 200 and home_res.text:
        head_slice = home_res.text[:65536]
        has_title = bool(re.search(r"<title\b[^>]{0,256}>\s*\S+", head_slice, re.IGNORECASE))
        has_desc = False
        has_og = False
        for meta_match in re.finditer(r"<meta\b[^>]{1,1024}>", head_slice, re.IGNORECASE):
            tag = meta_match.group(0)
            if (
                re.search(r'\bname\s*=\s*["\']description["\']', tag, re.IGNORECASE)
                and re.search(r'\bcontent\s*=\s*["\'][^"\']+["\']', tag, re.IGNORECASE)
            ):
                has_desc = True
            if re.search(r'\bproperty\s*=\s*["\']og:title["\']', tag, re.IGNORECASE):
                has_og = True
        has_canonical = bool(
            re.search(r'<link\b[^>]{1,1024}\brel\s*=\s*["\']canonical["\']', head_slice, re.IGNORECASE)
        )

        present_signals = [
            name
            for name, ok in [
                ("<title>", has_title),
                ("meta description", has_desc),
                ("OpenGraph og:title", has_og),
                ("rel=canonical", has_canonical),
            ]
            if ok
        ]
        if has_title and (has_desc or has_og):
            checks.append(CheckItem(
                id="ai_citation_metadata",
                title="Agentic SEO & AI Citation Metadata",
                status="pass",
                detail=f"Citation metadata detected for AI search engines ({', '.join(present_signals)}).",
            ))
        else:
            checks.append(CheckItem(
                id="ai_citation_metadata",
                title="Agentic SEO & AI Citation Metadata",
                status="info",
                detail=f"Partial or missing AI citation tags ({', '.join(present_signals) if present_signals else 'none detected'}).",
                recommendation="Add <title>, <meta name=\"description\">, <link rel=\"canonical\">, and OpenGraph tags so ChatGPT Search (OAI-SearchBot), Claude, and Perplexity cite your brand accurately.",
            ))

        # 7. Client-Side Secret & Unproxied Origin Exposure Check (#19)
        body_slice = home_res.text[:131072]
        secret_hits = find_secrets(body_slice)
        leaked = [h for h in secret_hits if h.severity == "fail"]
        key_ids = [h for h in secret_hits if h.severity == "warn"]
        origin_matches = list(dict.fromkeys(_UNPROXIED_ORIGIN_RE.findall(body_slice)))

        if leaked:
            checks.append(CheckItem(
                id="client_bundle_exposure",
                title="Client-Side Secret & Origin Exposure",
                status="fail",
                detail=f"Detected {len(leaked)} secret pattern(s) in public HTML markup: {describe(leaked)}. Values are redacted and were not tested against the provider.",
                recommendation="Immediately rotate exposed API keys and move secret-bearing calls behind server-side API routes.",
            ))
        elif origin_matches:
            sample_origins = ", ".join(origin_matches[:2])
            checks.append(CheckItem(
                id="client_bundle_exposure",
                title="Client-Side Secret & Origin Exposure",
                status="warn",
                detail=f"Direct unproxied cloud origin URL(s) exposed in client markup ({sample_origins}). Clients can call that origin directly, skipping any CDN, edge rules or rate limits in front of it.",
                recommendation="Proxy backend calls through Next.js/Cloudflare server routes so raw Cloud Run, Lambda, or Railway URLs are never exposed in client bundles.",
            ))
        elif key_ids:
            checks.append(CheckItem(
                id="client_bundle_exposure",
                title="Client-Side Secret & Origin Exposure",
                status="warn",
                detail=f"AWS access key ID in public HTML markup without its secret key nearby: {describe(key_ids)}.",
                recommendation="Check in AWS IAM which user or role owns this key ID; remove it from client code and deactivate it if its secret was ever shipped.",
            ))
        elif GOOGLE_BROWSER_KEY_RE.search(body_slice):
            checks.append(CheckItem(
                id="client_bundle_exposure",
                title="Client-Side Secret & Origin Exposure",
                status="info",
                detail="A Google API browser key (AIza…) appears in public markup. These keys are meant to ship to browsers; no secret token or unproxied origin URL was found.",
                recommendation="Confirm the key is restricted by HTTP referrer and to the APIs it needs in Google Cloud Console.",
            ))
        else:
            checks.append(CheckItem(
                id="client_bundle_exposure",
                title="Client-Side Secret & Origin Exposure",
                status="pass",
                detail="0 leaked API tokens or unproxied cloud origin URLs (*.a.run.app, *.execute-api.amazonaws.com) detected in initial markup.",
            ))

    # 8. A2A Payment & Settlement Discovery Surface (#20)
    has_a2a_billing = False
    if agent_json_res and agent_json_res.status_code == 200 and agent_json_res.text:
        try:
            aj = json.loads(agent_json_res.text[:65536])
            if isinstance(aj, dict) and (
                any(k in aj for k in ("billing", "payment", "pricing", "x402", "wallets", "settlement"))
                or any(isinstance(c, dict) and "pricing" in c for c in (aj.get("capabilities") or []))
            ):
                has_a2a_billing = True
        except Exception:
            has_a2a_billing = False

    if has_a2a_billing:
        checks.append(CheckItem(
            id="a2a_settlement_surface",
            title="A2A Settlement & Monetization Rail",
            status="pass",
            detail="Machine-readable A2A billing/settlement descriptors published in /.well-known/agent.json.",
        ))
    else:
        checks.append(CheckItem(
            id="a2a_settlement_surface",
            title="A2A Settlement & Monetization Rail",
            status="info",
            detail="No machine-readable A2A billing or settlement descriptor (pricing/x402/wallets) found in /.well-known/agent.json.",
            recommendation="Declare a billing or pricing block in /.well-known/agent.json so autonomous agents can discover and settle paid API calls programmatically.",
        ))

    return checks
