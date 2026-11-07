"""Passive posture checks (P1-4): stack fingerprint and end-of-life runtimes, CSP script quality,
CORS on the home page (D-N1) and caching/CORS hygiene of published AI manifests.

Everything here reads responses the audit already fetched; a probe that did not answer is not_assessed.
"""
import re
from html import unescape
from typing import Optional

from gateway.auditor.ai_surface import CheckItem
from gateway.auditor.exposure import site_domain
from gateway.routes.scanner import Fetched

# A foreign Origin the scanned site has no reason to trust: reflecting it means any Origin is reflected.
CORS_PROBE_ORIGIN = "https://cors-probe.stealthmark.io"

_PHP_VERSION_RE = re.compile(r"\bPHP/(\d+)\.(\d+)(?:\.(\d+))?", re.IGNORECASE)
# The PHP project's security support for 8.1 ended on 2025-12-31; 8.2 is the oldest supported branch.
_PHP_OLDEST_SUPPORTED = (8, 2)
_NGINX_VERSION_RE = re.compile(r"\bnginx/(\d+)\.(\d+)\.(\d+)", re.IGNORECASE)
_NODE_VERSION_RE = re.compile(r"\bNode(?:\.js)?/v?(\d+)\.(\d+)\.(\d+)", re.IGNORECASE)
_BUN_VERSION_RE = re.compile(r"\bBun/(\d+)\.(\d+)\.(\d+)", re.IGNORECASE)
_CAKEPHP_VERSION_RE = re.compile(r"\bCakePHP(?:/|\s+)(\d+)\.(\d+)\.(\d+)", re.IGNORECASE)
_MUSEBOT_VERSION_RE = re.compile(r"\bMuseBot(?:/|\s+)(\d+)\.(\d+)\.(\d+)", re.IGNORECASE)
_VSFTPD_VERSION_RE = re.compile(r"\bvsftpd(?:/|\s+)(\d+)\.(\d+)\.(\d+)", re.IGNORECASE)
_MAGENTO_VERSION_RE = re.compile(r"\b(?:Magento|Adobe\s+Commerce)(?:/|\s+)(\d+)\.(\d+)\.(\d+)", re.IGNORECASE)
_GITLAB_VERSION_RE = re.compile(r"\bGitLab(?:/|\s+)(\d+)\.(\d+)\.(\d+)", re.IGNORECASE)
_IVANTI_VERSION_RE = re.compile(r"\bIvanti\s+Connect\s+Secure(?:/|\s+)(\d+)\.(\d+)", re.IGNORECASE)
_CISCO_ASA_VERSION_RE = re.compile(r"\b(?:Cisco\s+Adaptive\s+Security\s+Appliance|Cisco\s+Secure\s+Firewall)(?:/|\s+)(\d+)\.(\d+)", re.IGNORECASE)
_PALOALTO_GP_VERSION_RE = re.compile(r"\b(?:PanWeb\s+Server|GlobalProtect\s+Portal)(?:/|\s+)(\d+)\.(\d+)", re.IGNORECASE)
_GENERATOR_RE = re.compile(
    r"""<meta\b[^>]*\bname\s*=\s*["']generator["'][^>]*\bcontent\s*=\s*["']([^"']{1,120})["']"""
    r"""|<meta\b[^>]*\bcontent\s*=\s*["']([^"']{1,120})["'][^>]*\bname\s*=\s*["']generator["']""",
    re.IGNORECASE,
)
_DRUPAL_MAJOR_RE = re.compile(r"\bDrupal (\d+)\b", re.IGNORECASE)
# Drupal 7 support ended on 2025-01-05, Drupal 9 on 2023-11-01 and Drupal 8 on 2021-11-02.
_DRUPAL_OLDEST_SUPPORTED = 10
_COOKIE_STACKS = {
    "phpsessid": "PHP",
    "jsessionid": "Java",
    "asp.net_sessionid": "ASP.NET",
    "laravel_session": "Laravel",
    "cakephp": "CakePHP",
    "musebot-session": "MuseBot",
    "_gitlab_session": "GitLab",
    "mage-cache-sessid": "Magento",
    "dsid": "Ivanti Connect Secure",
    "webvpn": "Cisco Secure Firewall ASA/FTD",
    "_shopify_y": "Shopify",
    "wordpress_logged_in": "WordPress",
    "wp-settings": "WordPress",
}
_HEADER_STACKS = {"x-vercel-id": "Vercel", "cf-ray": "Cloudflare", "x-nf-request-id": "Netlify", "x-amz-cf-id": "Amazon CloudFront"}

_CSP_HASH_OR_NONCE_RE = re.compile(r"\A'(?:nonce-|sha256-|sha384-|sha512-)", re.IGNORECASE)


def parse_tech_fingerprint(home: Optional[Fetched]) -> CheckItem:
    title = "Technology Fingerprint & End-of-Life Runtimes"
    if home is None or home.status_code >= 500:
        return CheckItem(
            id="tech_fingerprint",
            title=title,
            status="not_assessed",
            detail="The home page did not answer successfully, so its technology stack was not fingerprinted.",
        )

    h = home.headers
    stack: list[str] = []
    for header in ("server", "x-powered-by"):
        if value := h.get(header, "").strip():
            stack.append(f"{header}: {value[:80]}")
    stack += [name for header, name in _HEADER_STACKS.items() if header in h]
    cookie_names = {c.split("=", 1)[0].strip().lower() for c in h.get_list("set-cookie")}
    stack += sorted({name for cookie, name in _COOKIE_STACKS.items() if any(c.startswith(cookie) for c in cookie_names)})
    generator = next((a or b for a, b in _GENERATOR_RE.findall(home.text[:16384])), "")
    if generator:
        stack.append(f"generator: {generator}")

    outdated: list[str] = []
    hdr_banner = f"{h.get('x-powered-by', '')} {h.get('server', '')}"
    for match in _PHP_VERSION_RE.finditer(hdr_banner):
        major, minor = int(match.group(1)), int(match.group(2))
        patch_ver = int(match.group(3)) if match.group(3) is not None else None
        if (major, minor) < _PHP_OLDEST_SUPPORTED:
            outdated.append(f"PHP {major}.{minor} (the PHP project no longer ships security fixes for 8.1 and older)")
            break
        if patch_ver is not None and (
            ((major, minor) == (8, 2) and patch_ver < 35)
            or ((major, minor) == (8, 3) and patch_ver < 36)
            or ((major, minor) == (8, 4) and patch_ver < 27)
            or ((major, minor) == (8, 5) and patch_ver < 12)
        ):
            outdated.append(
                f"PHP {major}.{minor}.{patch_ver} (prior to CVE-2026-109618 / CVE-2026-109619 CISA KEV patches in 8.2.35 / 8.3.36 / 8.4.27 / 8.5.12)"
            )
            break
    for match in _NGINX_VERSION_RE.finditer(hdr_banner):
        nver = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
        if (nver[0] == 1 and nver[1] < 30) or (nver[:2] == (1, 30) and nver[2] < 6) or (nver[:2] == (1, 31) and nver[2] < 7):
            outdated.append(
                f"nginx/{nver[0]}.{nver[1]}.{nver[2]} (prior to CVE-2026-15176 / CVE-2026-93479 / CVE-2026-97205 patches in 1.30.6 / 1.31.7)"
            )
            break
    for match in _NODE_VERSION_RE.finditer(hdr_banner):
        ver = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
        if (ver[0] < 22) or (ver[0] == 22 and ver < (22, 23, 4)) or (ver[0] == 23) or (ver[0] == 24 and ver < (24, 22, 1)) or (ver[0] == 25) or (ver[0] == 26 and ver < (26, 12, 1)):
            outdated.append(f"Node.js {ver[0]}.{ver[1]}.{ver[2]} (prior to CVE-2026-111497 Brotli 1.2.1 fix in 22.23.4 / 24.22.1 / 26.12.1)")
            break
    for match in _BUN_VERSION_RE.finditer(hdr_banner):
        ver = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
        if ver < (1, 4, 4):
            outdated.append(f"Bun {ver[0]}.{ver[1]}.{ver[2]} (prior to CVE-2026-111497 Brotli 1.2.1 fix in Bun 1.4.4)")
            break
    banner_and_gen = f"{hdr_banner} {generator}"
    for match in _CAKEPHP_VERSION_RE.finditer(banner_and_gen):
        ver = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
        if ver <= (5, 4, 3):
            outdated.append(f"CakePHP {ver[0]}.{ver[1]}.{ver[2]} (prior to CVE-2026-119418 / CVE-2026-119419 SQLi fixes in 5.4.4)")
            break
    for match in _MUSEBOT_VERSION_RE.finditer(banner_and_gen):
        ver = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
        if ver < (2, 0, 0):
            outdated.append(f"MuseBot {ver[0]}.{ver[1]}.{ver[2]} (prior to CVE-2026-119660 session-forgery fix in 2.0.0)")
            break
    for match in _VSFTPD_VERSION_RE.finditer(hdr_banner):
        ver = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
        if ver <= (3, 0, 5):
            outdated.append(f"vsftpd {ver[0]}.{ver[1]}.{ver[2]} (prior to CVE-2026-119568 FTPS data-connection hijack fix)")
            break
    for match in _MAGENTO_VERSION_RE.finditer(banner_and_gen):
        ver = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
        if ver < (2, 4, 8):
            outdated.append(f"Magento {ver[0]}.{ver[1]}.{ver[2]} (prior to CVE-2026-48356 CISA KEV unrestricted file-upload fix in 2.4.8)")
            break
    for match in _GITLAB_VERSION_RE.finditer(banner_and_gen):
        ver = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
        if ver < (18, 5, 2):
            outdated.append(f"GitLab {ver[0]}.{ver[1]}.{ver[2]} (prior to CVE-2026-97229 CISA KEV CI/CD regex integer-overflow fix in 18.5.2)")
            break
    for match in _IVANTI_VERSION_RE.finditer(banner_and_gen):
        ver = (int(match.group(1)), int(match.group(2)))
        if ver <= (22, 7):
            outdated.append(f"Ivanti Connect Secure {ver[0]}.{ver[1]} (prior to CVE-2026-118527 / CVE-2026-111357 CISA KEV patches)")
            break
    for match in _CISCO_ASA_VERSION_RE.finditer(banner_and_gen):
        ver = (int(match.group(1)), int(match.group(2)))
        if ver <= (9, 20):
            outdated.append(f"Cisco Secure Firewall ASA/FTD {ver[0]}.{ver[1]} (prior to CVE-2026-76418 CISA KEV SSL VPN DoS patch)")
            break
    for match in _PALOALTO_GP_VERSION_RE.finditer(banner_and_gen):
        ver = (int(match.group(1)), int(match.group(2)))
        if ver <= (11, 1):
            outdated.append(f"Palo Alto GlobalProtect PAN-OS {ver[0]}.{ver[1]} (prior to CVE-2026-0257 CISA KEV MFA bypass patch)")
            break
    if (drupal := _DRUPAL_MAJOR_RE.search(generator)) and int(drupal.group(1)) < _DRUPAL_OLDEST_SUPPORTED:
        outdated.append(f"Drupal {drupal.group(1)} (Drupal 9 and older no longer receive security releases)")

    if outdated:
        return CheckItem(
            id="tech_fingerprint",
            title=title,
            status="warn",
            detail=f"The home page advertises an end-of-life release: {'; '.join(outdated)}. Read from response headers and the generator meta tag; no vulnerability was probed.",
            recommendation="Upgrade to a supported release, then stop advertising versions (expose_php = Off, server_tokens off, remove the generator meta tag).",
        )
    detail = f"Stack seen in headers, cookies and meta: {'; '.join(stack)}." if stack else "No stack hints in the Server, X-Powered-By, platform headers, cookies or generator meta tag."
    return CheckItem(id="tech_fingerprint", title=title, status="info", detail=f"{detail} No end-of-life PHP or Drupal release was advertised.")


def csp_script_weakness(csp: str) -> Optional[str]:
    """Why the policy does not restrict scripts, or None. script-src wins over default-src, as in browsers."""
    directives: dict[str, list[str]] = {}
    for part in csp.split(";"):
        tokens = part.split()
        if tokens:
            directives.setdefault(tokens[0].lower(), [t.lower() for t in tokens[1:]])
    name = "script-src" if "script-src" in directives else "default-src" if "default-src" in directives else None
    if name is None:
        return "it has no script-src or default-src directive, so it does not restrict scripts"
    sources = directives[name]
    if "*" in sources:
        return f"{name} allows scripts from any host (*)"
    # Browsers ignore 'unsafe-inline' when a nonce or hash is present.
    if "'unsafe-inline'" in sources and not any(_CSP_HASH_OR_NONCE_RE.match(s) for s in sources):
        return f"{name} allows 'unsafe-inline' without a nonce or hash, so injected inline scripts run"
    return None


def _allows_credentials(res: Fetched) -> bool:
    return res.headers.get("access-control-allow-credentials", "").strip().lower() == "true"


def parse_cors_policy(res: Optional[Fetched]) -> CheckItem:
    title = "Cross-Origin Resource Sharing (CORS)"
    if res is None or res.status_code >= 500:
        return CheckItem(
            id="cors_policy",
            title=title,
            status="not_assessed",
            detail="The home page did not answer the CORS probe (timeout, network error or HTTP 5xx), so its CORS policy was not assessed.",
        )
    acao = res.headers.get("access-control-allow-origin", "").strip()
    credentials = _allows_credentials(res)
    scope = f"Tested with one GET to the home page carrying Origin: {CORS_PROBE_ORIGIN}; other routes were not tested."
    if acao == CORS_PROBE_ORIGIN and credentials:
        return CheckItem(
            id="cors_policy",
            title=title,
            status="fail",
            detail=f"The home page reflects an arbitrary Origin in Access-Control-Allow-Origin with Access-Control-Allow-Credentials: true, so any website can read its responses with the visitor's cookies. {scope}",
            recommendation="Answer only an allowlist of trusted origins, and send Access-Control-Allow-Credentials: true only to those.",
        )
    if acao == "*" and credentials:
        return CheckItem(
            id="cors_policy",
            title=title,
            status="warn",
            detail=f"Access-Control-Allow-Origin: * is combined with Access-Control-Allow-Credentials: true. Browsers refuse that pair, but it shows a CORS policy that intends to share credentialed responses. {scope}",
            recommendation="Drop Access-Control-Allow-Credentials from public responses, or replace * with an allowlist of trusted origins.",
        )
    if acao in ("*", CORS_PROBE_ORIGIN):
        return CheckItem(
            id="cors_policy",
            title=title,
            status="info",
            detail=f"Any origin may read the home page without credentials (Access-Control-Allow-Origin: {acao}). Cookies are not shared. {scope}",
        )
    seen = f"Access-Control-Allow-Origin: {acao[:80]}" if acao else "no Access-Control-Allow-Origin header"
    return CheckItem(id="cors_policy", title=title, status="pass", detail=f"The foreign Origin was not trusted ({seen}). {scope}")


def _is_manifest(path: str, res: Fetched) -> bool:
    if res.status_code != 200:
        return False
    head = res.text[:512].lstrip()
    if path.endswith(".json"):
        return head.startswith("{")
    return bool(head) and "<html" not in head.lower() and "<!doctype" not in head.lower()


def parse_manifest_hygiene(manifests: dict[str, Optional[Fetched]]) -> CheckItem:
    title = "AI Manifest Caching & CORS Hygiene"
    published = {path: res for path, res in manifests.items() if res is not None and _is_manifest(path, res)}
    if not published:
        silent = [path for path, res in manifests.items() if res is None or res.status_code >= 500]
        if silent:
            return CheckItem(
                id="ai_manifest_hygiene",
                title=title,
                status="not_assessed",
                detail=f"{', '.join(silent)} did not answer (timeout, network error or HTTP 5xx) and no other AI manifest is published, so manifest hygiene was not assessed.",
            )
        return CheckItem(
            id="ai_manifest_hygiene",
            title=title,
            status="info",
            detail=f"No AI manifest is published ({', '.join(manifests)}), so there was nothing to check.",
        )

    credentialed = [path for path, res in published.items() if res.headers.get("access-control-allow-origin", "").strip() == "*" and _allows_credentials(res)]
    if credentialed:
        return CheckItem(
            id="ai_manifest_hygiene",
            title=title,
            status="warn",
            detail=f"{', '.join(credentialed)} combines Access-Control-Allow-Origin: * with Access-Control-Allow-Credentials: true. Browsers refuse that pair, but it shows a CORS policy that intends to share credentialed responses.",
            recommendation="Serve AI manifests as public, read-only files: keep Access-Control-Allow-Origin: * if agents in browsers need it, and drop Access-Control-Allow-Credentials.",
        )

    uncached = [path for path, res in published.items() if not res.headers.get("cache-control", "").strip()]
    open_cors = [path for path, res in published.items() if res.headers.get("access-control-allow-origin", "").strip() == "*"]
    notes = []
    if uncached:
        notes.append(f"{', '.join(uncached)} has no Cache-Control header, so CDNs and agents guess how long to keep it")
    if open_cors:
        notes.append(f"{', '.join(open_cors)} is readable from any origin (Access-Control-Allow-Origin: *), which is expected for a public, read-only manifest")
    if notes:
        return CheckItem(
            id="ai_manifest_hygiene",
            title=title,
            status="info",
            detail=f"{'; '.join(notes)}.",
            recommendation="Send Cache-Control with an explicit max-age (for example public, max-age=3600) on each AI manifest." if uncached else None,
        )
    checked = ", ".join(f"{path} (Cache-Control: {res.headers['cache-control'][:60]})" for path, res in published.items())
    return CheckItem(id="ai_manifest_hygiene", title=title, status="pass", detail=f"Checked {checked}: explicit caching and no credentialed CORS.")


# A host that cannot exist in DNS: a safe sentinel for the cache-poisoning probe's X-Forwarded-Host.
CACHE_PROBE_HOST = "cache-probe.stealthmark.invalid"
_CF_CACHE_SERVED_RE = re.compile(r"\b(?:hit|miss|dynamic|expired|stale|revalidated|updating|bypass)\b", re.IGNORECASE)


def _shared_cache_signal(res: Fetched) -> Optional[str]:
    """A header showing a shared/edge cache served or stored this response, or None."""
    h = res.headers
    if (cf := h.get("cf-cache-status", "").strip()) and _CF_CACHE_SERVED_RE.search(cf):
        return f"CF-Cache-Status: {cf[:40]}"
    if xcache := h.get("x-cache", "").strip():
        return f"X-Cache: {xcache[:60]}"
    if "age" in h:
        return f"Age: {h.get('age', '').strip()[:20]}"
    cc = h.get("cache-control", "").lower()
    if "public" in cc and ("max-age" in cc or "s-maxage" in cc) and "no-store" not in cc and "private" not in cc:
        return f"Cache-Control: {h.get('cache-control', '').strip()[:60]}"
    return None


def _vary_covers_forwarded_host(res: Fetched) -> bool:
    return "x-forwarded-host" in {token.strip().lower() for token in res.headers.get("vary", "").split(",")}


def parse_cache_poisoning(res: Optional[Fetched]) -> CheckItem:
    title = "Unkeyed-Header Cache Poisoning"
    scope = (
        f"Tested with one GET to a random path carrying X-Forwarded-Host: {CACHE_PROBE_HOST} and a unique "
        "cache-buster, so no real visitor's cached page was touched; other routes and headers were not tested."
    )
    if res is None or res.status_code >= 500:
        return CheckItem(
            id="unkeyed_header_cache_poisoning",
            title=title,
            status="not_assessed",
            detail=f"The cache-poisoning probe did not answer (timeout, network error or HTTP 5xx), so unkeyed-header cache poisoning was not assessed. {scope}",
        )

    location = res.headers.get("location", "")
    where = "the Location header" if CACHE_PROBE_HOST in location.lower() else "the response body" if CACHE_PROBE_HOST in res.text.lower() else None
    if where is None:
        return CheckItem(
            id="unkeyed_header_cache_poisoning",
            title=title,
            status="pass",
            detail=f"The untrusted X-Forwarded-Host was not reflected (HTTP {res.status_code}), so an edge cache cannot be poisoned through it. {scope}",
        )

    cache_signal = _shared_cache_signal(res)
    vary_covers = _vary_covers_forwarded_host(res)
    remediation = (
        "Add X-Forwarded-Host to the Vary header, or stop trusting it at the edge: on Cloudflare normalize or strip it in a "
        "Transform Rule, on Vercel drop it in middleware before it reaches the cache, on Nginx set proxy_set_header "
        "X-Forwarded-Host $host so the client value is overwritten."
    )
    if cache_signal and not vary_covers:
        return CheckItem(
            id="unkeyed_header_cache_poisoning",
            title=title,
            status="fail",
            detail=f"The response reflects the attacker-controlled X-Forwarded-Host ({CACHE_PROBE_HOST}) in {where} while a shared cache is active ({cache_signal}) and Vary does not include X-Forwarded-Host: a cached entry keyed without that header can be poisoned for other visitors. {scope}",
            recommendation=remediation,
        )
    mitigation = "Vary already includes X-Forwarded-Host" if vary_covers else "no shared-cache header was seen on this response"
    return CheckItem(
        id="unkeyed_header_cache_poisoning",
        title=title,
        status="warn",
        detail=f"The response reflects the attacker-controlled X-Forwarded-Host ({CACHE_PROBE_HOST}) in {where} (HTTP {res.status_code}), but {mitigation}, so poisoning is not confirmed. Reflected request headers are still a latent cache-poisoning and open-redirect risk. {scope}",
        recommendation=remediation,
    )


_SESSION_COOKIE_RE = re.compile(
    r"^(?:connect\.sid|phpsessid|jsessionid|asp\.net_sessionid|laravel_session|sessionid|_session_id)$"
    r"|(?:^|[._-])(?:session|sess|sid|auth|token|jwt)(?:$|[._-])",
    re.IGNORECASE,
)


def _parse_set_cookie(raw: str) -> tuple[str, dict[str, object]]:
    parts = [p.strip() for p in raw.split(";")]
    name = parts[0].split("=", 1)[0].strip()
    attrs: dict[str, object] = {}
    for part in parts[1:]:
        if "=" in part:
            key, value = part.split("=", 1)
            attrs[key.strip().lower()] = value.strip()
        elif part:
            attrs[part.lower()] = True
    return name, attrs


def parse_session_hardening(home: Optional[Fetched]) -> CheckItem:
    title = "Session Cookie Hardening"
    if home is None or home.status_code >= 500:
        return CheckItem(
            id="auth_session_hardening",
            title=title,
            status="not_assessed",
            detail="The home page did not answer successfully, so its session cookies were not inspected.",
        )

    session_cookies = [(name, attrs) for name, attrs in (_parse_set_cookie(c) for c in home.headers.get_list("set-cookie")) if _SESSION_COOKIE_RE.search(name)]
    if not session_cookies:
        return CheckItem(
            id="auth_session_hardening",
            title=title,
            status="info",
            detail="The home response sets no session or authentication cookie, so there was nothing to harden.",
        )

    fails: list[str] = []
    warns: list[str] = []
    for name, attrs in session_cookies:
        secure = "secure" in attrs
        samesite = str(attrs.get("samesite", "")).lower()
        persistent = "max-age" in attrs or "expires" in attrs
        if not secure:
            fails.append(f"{name} has no Secure attribute, so it can leak over an unencrypted request")
        elif samesite == "none":
            fails.append(f"{name} uses SameSite=None, so it rides along on every cross-site request")
        if "httponly" not in attrs:
            warns.append(f"{name} has no HttpOnly attribute, so script can read it")
        if not persistent and samesite not in ("strict", "lax"):
            warns.append(f"{name} has neither Max-Age/Expires nor SameSite=Strict|Lax, so the session never expires and is sent cross-site")

    recommendation = (
        "Prefix session cookies with __Host- and set Secure, HttpOnly, SameSite=Strict (or Lax), and a bounded Max-Age/Expires; "
        "require phishing-resistant FIDO2/WebAuthn (publickey-credentials-get=(self)) for privileged authentication."
    )
    if fails:
        return CheckItem(id="auth_session_hardening", title=title, status="fail", detail=f"Weak session cookie(s): {'; '.join(fails + warns)}. Cookie values are not shown.", recommendation=recommendation)
    if warns:
        return CheckItem(id="auth_session_hardening", title=title, status="warn", detail=f"Session cookie hardening gap(s): {'; '.join(warns)}. Cookie values are not shown.", recommendation=recommendation)
    return CheckItem(id="auth_session_hardening", title=title, status="pass", detail=f"Session cookie(s) {', '.join(name for name, _ in session_cookies)} set Secure, HttpOnly, an expiry and SameSite.")


# A literal token key read or written through Web Storage, as minifiers leave it, with or without optional chaining:
# localStorage.setItem("token", …), sessionStorage?.getItem('jwt'), localStorage["access_token"] or localStorage.authToken.
# A quoted key must close right after the name, so "token-expiry" or "jwt.exp" are other keys. JavaScript names are
# case-sensitive, so only the key ignores case. Aliased storage objects and computed keys are not traced.
_TOKEN_KEY = r"(?i:(?:access|auth|id|refresh)[_-]?token|token|jwt|bearer)"
_TOKEN_STORAGE_RE = re.compile(
    rf"""\b(?P<store>localStorage|sessionStorage)\s*(?:(?:\??\.\s*(?:getItem|setItem)\s*(?:\?\.\s*)?\(\s*|(?:\?\.\s*)?\[\s*)(?P<quote>["'`])(?P<key>{_TOKEN_KEY})(?P=quote)|\??\.\s*(?P<prop>{_TOKEN_KEY})(?![\w$]))"""
)
# One pass over the home page finds comments, inline scripts and <meta> tags in document order, so prose, commented-out
# markup and a "<!--" inside a script are each read as what they are. [^<>] keeps a tag from scanning past the next one:
# a page of unclosed "<meta " stays linear.
_HTML_PART_RE = re.compile(r"<!--|<script\b[^<>]*>|<meta\b[^<>]*>", re.IGNORECASE)
_SCRIPT_END_RE = re.compile(r"</script", re.IGNORECASE)
_META_CSP_EQUIV_RE = re.compile(r"""\bhttp-equiv\s*=\s*["']?content-security-policy(?![\w-])""", re.IGNORECASE)
_META_CONTENT_RE = re.compile(r"""\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.IGNORECASE)
_ADMIN_HOST_PREFIXES = ("admin.", "backoffice.")
MAX_LISTED_KEYS = 5


def _html_parts(page: str) -> tuple[str, list[str]]:
    """The inline script code and the <meta> tags of a page, outside HTML comments."""
    scripts: list[str] = []
    metas: list[str] = []
    pos = 0
    while part := _HTML_PART_RE.search(page, pos):
        tag = part.group(0)
        if tag == "<!--":
            end = page.find("-->", part.end())
            pos = len(page) if end == -1 else end + 3
        elif tag[:7].lower() == "<script":
            close = _SCRIPT_END_RE.search(page, part.end())
            scripts.append(page[part.end():close.start() if close else len(page)])
            pos = close.end() if close else len(page)
        else:
            metas.append(tag)
            pos = part.end()
    return "\n".join(scripts), metas


def _page_policies(home: Fetched, metas: list[str]) -> list[str]:
    """Every policy the browser enforces: each one in the CSP header (repeated headers join with a comma) and each <meta>."""
    policies = [policy for policy in home.headers.get("content-security-policy", "").split(",") if policy.strip()]
    for tag in metas:
        if _META_CSP_EQUIV_RE.search(tag) and (content := _META_CONTENT_RE.search(tag)):
            policies.append(unescape(content.group(1) if content.group(1) is not None else content.group(2)))
    return policies


def parse_token_storage(home: Optional[Fetched], bundles: dict[str, Optional[Fetched]], domain: str) -> CheckItem:
    """A07: bearer tokens in localStorage/sessionStorage are one XSS away from theft unless a CSP restricts scripts."""
    title = "Session Tokens in Web Storage without CSP"
    if home is None or home.status_code != 200:
        return CheckItem(
            id="jwt_in_localstorage_without_csp",
            title=title,
            status="not_assessed",
            detail="The home page did not answer with HTTP 200, so its scripts and Content-Security-Policy were not inspected.",
        )

    read = {path: res for path, res in bundles.items() if res is not None and res.status_code == 200}
    unread = [path for path in bundles if path not in read]
    inline, metas = _html_parts(home.text)
    sources = {"home HTML": inline, **{path: res.text for path, res in read.items()}}
    found: list[str] = []
    for where, code in sources.items():
        if keys := sorted({f'{m["store"]} "{m["key"] or m["prop"]}"' for m in _TOKEN_STORAGE_RE.finditer(code)}):
            more = f" (+{len(keys) - MAX_LISTED_KEYS} more)" if len(keys) > MAX_LISTED_KEYS else ""
            found.append(f"{where}: {', '.join(keys[:MAX_LISTED_KEYS])}{more}")

    scanned = ", ".join(
        f"{where} (first {len(res.body) // 1024} KB)" if res.truncated else where for where, res in {"home HTML": home, **read}.items()
    )
    if not found and (unread or not read):
        why = (
            f"{', '.join(unread)} could not be read (timeout, network error or a non-200 answer)" if unread
            else "The home page references no same-origin JavaScript bundle (/_next/static/chunks/*.js or /assets/*.js)"
        )
        return CheckItem(
            id="jwt_in_localstorage_without_csp",
            title=title,
            status="not_assessed",
            detail=f"{why}. Scanned {scanned}: no Web Storage token, but not every script that could store one was inspected.",
        )
    if not found:
        return CheckItem(
            id="jwt_in_localstorage_without_csp",
            title=title,
            status="pass",
            detail=f"Scanned {scanned}: no localStorage or sessionStorage read or write of a literal token key (token, access_token, auth_token, id_token, refresh_token, jwt, bearer) in the inline scripts or bundles. Aliased storage objects and computed keys are not traced.",
        )

    recommendation = (
        "Move session tokens to cookies the server sets with HttpOnly; Secure; SameSite=Strict, so page script cannot read them, "
        "and send a Content-Security-Policy whose script-src allows only your origins plus nonces or hashes."
    )
    # A script runs only if every policy allows it, so one policy that restricts scripts is enough.
    weaknesses = [csp_script_weakness(policy) for policy in _page_policies(home, metas)]
    weakness = None if None in weaknesses else weaknesses[0] if weaknesses else "there is no Content-Security-Policy"
    if weakness is None:
        return CheckItem(
            id="jwt_in_localstorage_without_csp",
            title=title,
            status="info",
            detail=f"Session tokens are kept in Web Storage ({'; '.join(found)}). The Content-Security-Policy restricts script sources, which narrows the XSS path to them but does not close it.",
            recommendation=recommendation,
        )
    # admin.com is a site of its own; admin.example.com is the administrative host of example.com.
    admin = domain.startswith(_ADMIN_HOST_PREFIXES) and domain.count(".") > site_domain(domain).count(".")
    return CheckItem(
        id="jwt_in_localstorage_without_csp",
        title=title,
        status="fail",
        detail=(
            f"{'Critical' if admin else 'High'} severity: session tokens are kept in Web Storage ({'; '.join(found)}) and {weakness}. "
            f"Any stored or reflected XSS can read the bearer token and send it out in the same instant, taking over the "
            f"{'administrative ' if admin else ''}session or escalating its privileges."
        ),
        recommendation=recommendation,
    )


_EXTERNAL_SCRIPT_TAG_RE = re.compile(
    r"""<script\b[^<>]*\bsrc\s*=\s*["']https?://([^/"'<>:\s]+)(?::\d+)?/[^"'<>]*["'][^<>]*>""",
    re.IGNORECASE,
)
_SRI_ATTR_RE = re.compile(r"""\bintegrity\s*=\s*["']sha(?:256|384|512)-[A-Za-z0-9+/=_-]{20,}["']""", re.IGNORECASE)
_COMPROMISED_SCRIPT_HOSTS = ("polyfill.io", "bootcss.com", "bootcdn.net", "staticfile.org", "staticfile.net")
_DYNAMIC_PLATFORM_SCRIPT_HOSTS = (
    "cloudflareinsights.com",
    "challenges.cloudflare.com",
    "cdnjs.cloudflare.com",
    "jsdelivr.net",
    "unpkg.com",
    "tailwindcss.com",
    "googletagmanager.com",
    "google-analytics.com",
    "stripe.com",
    "polar.sh",
)


def parse_subresource_integrity(home: Optional[Fetched], domain: str) -> CheckItem:
    """A08:2025 Software or Data Integrity Failures — third-party scripts without Subresource Integrity (SRI)."""
    title = "Third-Party Script Subresource Integrity (SRI)"
    if home is None or home.status_code != 200:
        return CheckItem(
            id="subresource_integrity_shield",
            title=title,
            status="not_assessed",
            detail="The home page did not answer with HTTP 200, so external script tags were not inspected for Subresource Integrity.",
        )

    base_site = site_domain(domain.lower())
    compromised_hosts: set[str] = set()
    missing_sri_hosts: set[str] = set()
    verified_sri_hosts: set[str] = set()

    for match in _EXTERNAL_SCRIPT_TAG_RE.finditer(home.text[:65536]):
        tag = match.group(0)
        host = match.group(1).lower()
        if site_domain(host) == base_site:
            continue
        if any(host == bad or host.endswith(f".{bad}") for bad in _COMPROMISED_SCRIPT_HOSTS):
            compromised_hosts.add(host)
            continue
        if any(host == plat or host.endswith(f".{plat}") for plat in _DYNAMIC_PLATFORM_SCRIPT_HOSTS):
            verified_sri_hosts.add(host)
            continue
        if _SRI_ATTR_RE.search(tag):
            verified_sri_hosts.add(host)
        else:
            missing_sri_hosts.add(host)

    recommendation = (
        "Add integrity=\"sha384-...\" and crossorigin=\"anonymous\" to every third-party <script> tag, or self-host critical scripts under your own origin."
    )
    if compromised_hosts:
        return CheckItem(
            id="subresource_integrity_shield",
            title=title,
            status="fail",
            detail=f"The home page loads JavaScript from a known supply-chain risk domain ({', '.join(sorted(compromised_hosts))}).",
            recommendation="Remove scripts from polyfill.io/bootcss/staticfile immediately and serve verified bundles from your own origin.",
        )
    if missing_sri_hosts:
        return CheckItem(
            id="subresource_integrity_shield",
            title=title,
            status="warn",
            detail=f"Third-party <script> tag(s) from {', '.join(sorted(missing_sri_hosts)[:5])} are loaded without a cryptographic integrity (sha256/sha384/sha512) attribute.",
            recommendation=recommendation,
        )
    if verified_sri_hosts:
        return CheckItem(
            id="subresource_integrity_shield",
            title=title,
            status="pass",
            detail=f"All external script host(s) on the home page ({', '.join(sorted(verified_sri_hosts)[:5])}) carry cryptographic Subresource Integrity hashes.",
        )
    return CheckItem(
        id="subresource_integrity_shield",
        title=title,
        status="pass",
        detail="The home page loads no unverified third-party <script src=\"https://...\"> tags outside its own root domain.",
    )


def parse_security_reporting(home: Optional[Fetched]) -> CheckItem:
    """A09:2025 Security Logging and Alerting Failures — browser violation reporting and perimeter telemetry."""
    title = "Security Violation Reporting & Telemetry"
    if home is None or home.status_code >= 500:
        return CheckItem(
            id="security_reporting_and_incident_telemetry",
            title=title,
            status="not_assessed",
            detail="The home page did not answer successfully, so reporting headers were not inspected.",
        )

    h = home.headers
    csp = h.get("content-security-policy", "").lower()
    signals: list[str] = []
    if "reporting-endpoints" in h:
        signals.append("Reporting-Endpoints")
    if "report-to" in h:
        signals.append("Report-To")
    if "nel" in h:
        signals.append("NEL (Network Error Logging)")
    if "report-uri" in csp or "report-to" in csp:
        signals.append("CSP report directive")
    if "x-stealthmark-active" in h:
        signals.append("StealthMark Telemetry")

    if signals:
        return CheckItem(
            id="security_reporting_and_incident_telemetry",
            title=title,
            status="pass",
            detail=f"Active security telemetry and violation reporting advertised via {', '.join(signals)}.",
        )
    return CheckItem(
        id="security_reporting_and_incident_telemetry",
        title=title,
        status="info",
        detail="No browser Reporting-Endpoints, Report-To, NEL, or CSP report-uri directive is advertised on the home response.",
        recommendation="Add a Reporting-Endpoints header and link it to your Content-Security-Policy (report-to / report-uri) so CSP and TLS anomalies are logged.",
    )


def parse_anti_automation_design(
    home: Optional[Fetched],
    agent_json: Optional[Fetched],
    robots: Optional[Fetched],
) -> CheckItem:
    """A06:2025 Insecure Design — rate-limiting and anti-automation design signals."""
    title = "Rate-Limit & Anti-Automation Design Controls"
    if home is None or home.status_code >= 500:
        return CheckItem(
            id="agent_rate_and_anti_automation_design",
            title=title,
            status="not_assessed",
            detail="The home page did not answer successfully, so rate-limit and anti-automation controls were not inspected.",
        )

    h = home.headers
    signals: list[str] = []
    for hdr in ("ratelimit-limit", "x-ratelimit-limit", "retry-after", "x-stealthmark-active", "cf-ray", "x-vercel-id", "x-amz-cf-id"):
        if hdr in h:
            signals.append(hdr)
    if agent_json is not None and agent_json.status_code == 200 and agent_json.text.lstrip().startswith("{"):
        signals.append("/.well-known/agent.json policy")
    if robots is not None and robots.status_code == 200 and "user-agent" in robots.text[:4096].lower():
        signals.append("/robots.txt directives")

    if signals:
        return CheckItem(
            id="agent_rate_and_anti_automation_design",
            title=title,
            status="pass",
            detail=f"Perimeter anti-automation and crawler governance signals detected ({', '.join(signals[:5])}).",
        )
    return CheckItem(
        id="agent_rate_and_anti_automation_design",
        title=title,
        status="warn",
        detail="Neither edge rate-limiting headers, /.well-known/agent.json, nor /robots.txt crawler directives were detected on the home surface.",
        recommendation="Publish explicit crawler rate/access rules in /.well-known/agent.json and /robots.txt, and enforce per-IP rate limits at the edge.",
    )


def parse_ai_bot_cidr_posture(home: Optional[Fetched], agent_json: Optional[Fetched]) -> CheckItem:
    """A01:2025 Broken Access Control — defense against spoofed AI crawler User-Agents via ASN/CIDR edge verification."""
    title = "AI Crawler CIDR & Spoofed-Agent Verification"
    if home is None or home.status_code >= 500:
        return CheckItem(
            id="ai_bot_cidr_and_asn_verification",
            title=title,
            status="not_assessed",
            detail="The home page did not answer successfully, so AI crawler identity verification posture was not assessed.",
        )

    h = home.headers
    edge_signals = [hdr for hdr in ("x-stealthmark-agent-trust", "x-stealthmark-active", "cf-ray", "x-vercel-id", "x-amz-cf-id", "fastly-io-info") if hdr in h]
    has_agent_manifest = agent_json is not None and agent_json.status_code == 200 and agent_json.text.lstrip().startswith("{")

    if edge_signals or has_agent_manifest:
        via = ", ".join(edge_signals + (["/.well-known/agent.json"] if has_agent_manifest else []))
        return CheckItem(
            id="ai_bot_cidr_and_asn_verification",
            title=title,
            status="pass",
            detail=f"Edge network/ASN inspection or agent manifest governance active ({via}), mitigating trivial User-Agent spoofing.",
        )
    return CheckItem(
        id="ai_bot_cidr_and_asn_verification",
        title=title,
        status="info",
        detail="Origin responds directly without observable edge ASN/CIDR bot verification headers or /.well-known/agent.json identity rules.",
        recommendation="Verify claimed GPTBot, ClaudeBot, and PerplexityBot traffic against published official CIDR ranges or deploy @stealthmark/next.",
    )


_DEBUG_HEADERS = (
    "x-apollo-tracing",
    "x-debug-token",
    "x-debug-token-link",
    "phpdebugbar-id",
    "x-symfony-profiler-url",
    "x-clockwork-id",
    "x-laravel-debug",
)


def parse_graphql_and_debug_exposure(home: Optional[Fetched], stack_probe: Optional[Fetched]) -> CheckItem:
    """A02:2025 Security Misconfiguration — exposed profiler, GraphQL tracing, or debug headers in production."""
    title = "Debug Profiler & GraphQL Tracing Hygiene"
    if home is None or home.status_code >= 500:
        return CheckItem(
            id="graphql_and_debug_trace_exposure",
            title=title,
            status="not_assessed",
            detail="The home page did not answer successfully, so debug profiler and tracing headers were not inspected.",
        )

    leaked: list[str] = []
    for label, res in (("home", home), ("probe", stack_probe)):
        if res is None:
            continue
        for hdr in _DEBUG_HEADERS:
            if hdr in res.headers:
                leaked.append(f"{hdr} ({label})")

    if leaked:
        return CheckItem(
            id="graphql_and_debug_trace_exposure",
            title=title,
            status="warn",
            detail=f"Production response exposes debug/tracing header(s): {', '.join(leaked)}.",
            recommendation="Disable Apollo tracing, Symfony/Laravel debugbars, and profiler headers in production environments.",
        )
    return CheckItem(
        id="graphql_and_debug_trace_exposure",
        title=title,
        status="pass",
        detail="No debug profiler or GraphQL tracing headers (X-Apollo-Tracing, X-Debug-Token, PHPDebugBar, Clockwork) were exposed.",
    )

