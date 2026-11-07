"""Read-only exposure probes: /.git/HEAD and public OpenAPI/Swagger schemas (P1-2), secrets in JS bundles (P1-3).

A finding needs the file's own format in the body: a soft-200 HTML catch-all is not an exposure,
and a probe that did not answer is not_assessed, never a pass.
"""
import re
from typing import Optional

from gateway.auditor.ai_surface import CheckItem
from gateway.auditor.secrets import GOOGLE_BROWSER_KEY_RE, describe, find_secrets
from gateway.routes.scanner import Fetched

# A HEAD file holds a symbolic ref or a detached commit id (SHA-1, or SHA-256 in sha256 repositories).
_GIT_HEAD_RE = re.compile(r"\A(?:ref: refs/\S+|[0-9a-f]{40}|[0-9a-f]{64})\s*\Z")
# The @stealthmark/next /.git/config fixture: its disclosure comment plus an origin remote on the signed Canary URL.
_CANARY_GIT_CONFIG_RE = re.compile(
    r"(?m)^# Este dominio usa @stealthmark/next .*\n(?:.*\n)*?\turl = https://stealthmark\.io/api/telemetry/canary/"
)
_SCHEMA_VERSION_RE = re.compile(r'"(?:openapi|swagger)"\s*:\s*"\d')
_SCHEMA_PATHS_RE = re.compile(r'"paths"\s*:\s*\{')
_SOURCE_MAP_RE = re.compile(r'\A\s*\{.*"version"\s*:\s*3\b.*"sources"\s*:\s*\[', re.DOTALL)


def parse_git_exposure(res: Optional[Fetched], config_res: Optional[Fetched] = None) -> CheckItem:
    if res is None or res.status_code >= 500:
        return CheckItem(
            id="git_exposure",
            title="Git Metadata Exposure (/.git/HEAD)",
            status="not_assessed",
            detail="/.git/HEAD did not answer (timeout, network error or HTTP 5xx), so git metadata exposure was not assessed.",
        )
    body = res.text[:512]
    if res.status_code == 200 and "<html" not in body.lower() and _GIT_HEAD_RE.match(body):
        if config_res is not None and config_res.status_code == 200 and _CANARY_GIT_CONFIG_RE.search(config_res.text[:2048]):
            return CheckItem(
                id="git_exposure",
                title="Git Metadata Exposure (/.git/HEAD)",
                status="info",
                detail="/.git/HEAD and /.git/config serve a StealthMark Canary fixture (@stealthmark/next dotfiles: 'synthetic_fixture'): a plain ref and a synthetic config whose origin remote is a signed Canary URL, not the site's repository.",
            )
        return CheckItem(
            id="git_exposure",
            title="Git Metadata Exposure (/.git/HEAD)",
            status="fail",
            detail="Critical exposure: /.git/HEAD returned HTTP 200 with git ref content. A 403 on the /.git/ directory listing does not protect it: off-the-shelf tools request each git file by its known path (HEAD, refs, packs, objects) and can usually rebuild the full source code and its commit history, including old commits and any secret ever committed.",
            recommendation="Return 403/404 for every path under /.git/, not only the directory listing, at your web server, CDN or reverse proxy, or remove the .git directory from the deployed files; then rotate any secret that was ever committed to that repository.",
        )
    if res.status_code == 200:
        detail = "Not exposed: /.git/HEAD answered HTTP 200 without git ref content (likely a catch-all page)."
    else:
        detail = f"Not exposed: /.git/HEAD answered HTTP {res.status_code}."
    return CheckItem(id="git_exposure", title="Git Metadata Exposure (/.git/HEAD)", status="pass", detail=detail)


def _is_api_schema(res: Fetched) -> bool:
    if res.status_code != 200 or "json" not in res.headers.get("content-type", "").lower():
        return False
    body = res.text
    # The 8 KB cap can cut a large schema before "paths"; the version field alone then identifies it.
    return bool(_SCHEMA_VERSION_RE.search(body)) and (res.truncated or bool(_SCHEMA_PATHS_RE.search(body)))


def parse_api_schema_exposure(probes: dict[str, Optional[Fetched]]) -> CheckItem:
    title = "Public API Schema (OpenAPI/Swagger)"
    exposed = [path for path, res in probes.items() if res is not None and _is_api_schema(res)]
    if exposed:
        return CheckItem(
            id="api_schema_exposure",
            title=title,
            status="warn",
            detail=f"{', '.join(exposed)} serves an OpenAPI/Swagger schema that lists your API endpoints to anyone, including AI agents.",
            recommendation="If the API is not meant to be public, serve the schema only behind authentication or remove it from production builds.",
        )
    silent = [path for path, res in probes.items() if res is None or res.status_code >= 500]
    if silent:
        return CheckItem(
            id="api_schema_exposure",
            title=title,
            status="not_assessed",
            detail=f"{', '.join(silent)} did not answer (timeout, network error or HTTP 5xx), so public API schema exposure was not assessed.",
        )
    answers = ", ".join(f"{path} HTTP {res.status_code}" for path, res in probes.items() if res is not None)
    return CheckItem(
        id="api_schema_exposure",
        title=title,
        status="pass",
        detail=f"No OpenAPI/Swagger schema served ({answers}).",
    )


def parse_bundle_secrets(bundles: dict[str, Optional[Fetched]]) -> CheckItem:
    title = "Secrets in JavaScript Bundles"
    if not bundles:
        return CheckItem(
            id="js_bundle_secrets",
            title=title,
            status="not_assessed",
            detail="The home page references no same-origin JavaScript bundle (/_next/static/chunks/*.js or /assets/*.js), so bundles were not scanned.",
        )
    read = {path: res for path, res in bundles.items() if res is not None and res.status_code == 200}
    if not read:
        return CheckItem(
            id="js_bundle_secrets",
            title=title,
            status="not_assessed",
            detail=f"No bundle could be downloaded ({', '.join(bundles)}), so bundles were not scanned.",
        )

    leaked: list[str] = []
    key_ids: list[str] = []
    google_key = False
    for path, res in read.items():
        hits = find_secrets(res.text)
        if failing := [h for h in hits if h.severity == "fail"]:
            leaked.append(describe(failing, path))
        if warning := [h for h in hits if h.severity == "warn"]:
            key_ids.append(describe(warning, path))
        google_key = google_key or GOOGLE_BROWSER_KEY_RE.search(res.text) is not None

    scanned = ", ".join(f"{path} (first {len(res.body) // 1024} KB)" if res.truncated else path for path, res in read.items())
    if leaked:
        return CheckItem(
            id="js_bundle_secrets",
            title=title,
            status="fail",
            detail=f"Secret pattern found in public JavaScript: {'; '.join(leaked)}. Values are redacted and were not tested against the provider.",
            recommendation="Revoke and rotate each key in the provider's dashboard now, then move the calls that need it to server-side routes and keep the key out of NEXT_PUBLIC_/VITE_ variables.",
        )
    if key_ids:
        return CheckItem(
            id="js_bundle_secrets",
            title=title,
            status="warn",
            detail=f"AWS access key ID in public JavaScript without its secret key nearby: {'; '.join(key_ids)}.",
            recommendation="Check in AWS IAM which user or role owns this key ID; remove it from client code and deactivate it if its secret was ever shipped.",
        )
    if google_key:
        return CheckItem(
            id="js_bundle_secrets",
            title=title,
            status="info",
            detail=f"Scanned {scanned}: only a Google API browser key (AIza…), which is meant to ship to browsers.",
            recommendation="Confirm the key is restricted by HTTP referrer and to the APIs it needs in Google Cloud Console.",
        )
    return CheckItem(
        id="js_bundle_secrets",
        title=title,
        status="pass",
        detail=f"Scanned {scanned}: no OpenAI, Anthropic, Stripe, AWS, Supabase service_role, GitHub, Slack or Resend secret patterns.",
    )


# The host of an http(s) or ws(s) URL, also with JSON-escaped slashes (https:\/\/). Only the host is captured, never a
# path. The class is flat and bounded to a DNS name's length, so a hostile run of labels stays linear, and a host followed
# by "@" is userinfo (https://staging.example.com@evil.com), not the host.
_URL_HOST_RE = re.compile(r"(?:https?|wss?):(?:\\?/){2}([a-z0-9.-]{1,253})(?![a-z0-9.@-])", re.IGNORECASE)
# These words name a non-production host wherever they appear left of its registrable domain, as a label or part of a
# hyphenated one (api-staging.example.com). dev, test and local count only under the scanned site's own domain: under
# someone else's they also name public production hosts (feeds.dev.azure.com, test.pypi.org, www.local.gov.uk).
_NONPROD_WORDS = {"homologation", "homologacion", "homologacao", "staging", "stage", "internal"}
_OWN_NONPROD_WORDS = {"dev", "test", "local"}
_NONPROD_WORD_RE = re.compile("|".join(sorted(_NONPROD_WORDS)))
_ANY_NONPROD_WORD_RE = re.compile("|".join(sorted(_NONPROD_WORDS | _OWN_NONPROD_WORDS)))
# Second-level labels under a two-letter country code, where the registrable domain keeps three labels (example.com.ar).
_COUNTRY_SECOND_LEVEL = {"com", "net", "org", "gov", "gob", "edu", "co", "ac", "mil"}
_VITE_URL_VAR_RE = re.compile(r"\bVITE_[A-Z0-9_]*URL\b")
MAX_LISTED_NAMES = 5
MAX_NAME_CHARS = 80


def site_domain(domain: str) -> str:
    """The registrable domain, without a public suffix list: example.com, or example.com.ar under a country code."""
    labels = domain.lower().removeprefix("www.").split(".")
    keep = 3 if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in _COUNTRY_SECOND_LEVEL else 2
    return ".".join(labels[-keep:])


def _words(labels: list[str]) -> set[str]:
    return {word for label in labels for word in label.split("-")}


def _nonprod_kind(host: str, site: str) -> Optional[str]:
    """"warn" for a non-production host; "maybe" for dev, test or local right under the site, which can be a public portal."""
    if _NONPROD_WORD_RE.search(host) and _words(host[: -len(site_domain(host))].split(".")) & _NONPROD_WORDS:
        return "warn"
    if not host.endswith(f".{site}"):
        return None
    inner = host[: -len(site) - 1].split(".")
    if not _words(inner) & _OWN_NONPROD_WORDS:
        return None
    return "maybe" if len(inner) == 1 and inner[0] in _OWN_NONPROD_WORDS else "warn"


def _listed(names: set[str]) -> str:
    """At most MAX_LISTED_NAMES names, each cut to MAX_NAME_CHARS, so a hostile bundle cannot inflate the report."""
    shown = [name if len(name) <= MAX_NAME_CHARS else f"{name[:MAX_NAME_CHARS]}…" for name in sorted(names)[:MAX_LISTED_NAMES]]
    more = f" (+{len(names) - MAX_LISTED_NAMES} more)" if len(names) > MAX_LISTED_NAMES else ""
    return ", ".join(shown) + more


def parse_nonprod_environment_leak(bundles: dict[str, Optional[Fetched]], domain: str) -> CheckItem:
    title = "Non-Production Environment URLs in JavaScript Bundles"
    read = {path: res for path, res in bundles.items() if res is not None and res.status_code == 200}
    unread = [path for path in bundles if path not in read]
    if not read:
        why = f"No bundle could be downloaded ({', '.join(unread)})" if unread else (
            "No same-origin JavaScript bundle was read: the home page could not be read or references none "
            "(/_next/static/chunks/*.js or /assets/*.js)"
        )
        return CheckItem(
            id="nonprod_environment_leak_in_bundle",
            title=title,
            status="not_assessed",
            detail=f"{why}, so bundles were not scanned for non-production URLs.",
        )

    own_hosts = {domain, f"www.{domain}", domain.removeprefix("www.")}
    site = site_domain(domain)
    candidates: set[str] = set()
    variables: set[str] = set()
    for res in read.values():
        text = res.text
        candidates.update(host.strip(".").lower() for host in _URL_HOST_RE.findall(text))
        variables.update(_VITE_URL_VAR_RE.findall(text))
    hosts: set[str] = set()
    portals: set[str] = set()
    for host in candidates - own_hosts:
        if _ANY_NONPROD_WORD_RE.search(host) and (kind := _nonprod_kind(host, site)):
            (hosts if kind == "warn" else portals).add(host)

    scanned = ", ".join(f"{path} (first {len(res.body) // 1024} KB)" if res.truncated else path for path, res in read.items())
    maybe = f" {_listed(portals)} can be a public developer portal or a development environment of {site}: confirm which." if portals else ""
    named = f" URL variable name(s) in the bundle: {_listed(variables)}." if variables else ""
    if hosts:
        return CheckItem(
            id="nonprod_environment_leak_in_bundle",
            title=title,
            status="warn",
            detail=(
                f"Medium severity: the production JavaScript ({scanned}) points to non-production host(s) "
                f"{_listed(hosts)}. Only host names are shown.{maybe}{named} "
                "This maps internal topology for an attacker and can send production users, tokens or data to a homologation or staging backend."
            ),
            recommendation=(
                "Build production bundles from production-only environment files (for example .env.production), fail the release when a "
                "non-production host appears in the output, and make non-production APIs reject production tokens. A vendor's public "
                "sandbox host can match too: confirm each one."
            ),
        )
    if unread:
        return CheckItem(
            id="nonprod_environment_leak_in_bundle",
            title=title,
            status="not_assessed",
            detail=(
                f"{', '.join(unread)} could not be read (timeout, network error or a non-200 answer), so not every bundle was scanned. "
                f"Scanned {scanned}: no non-production host.{maybe}{named}"
            ),
        )
    no_host = (
        "no http(s) or ws(s) URL to a host labeled homologation, staging, stage or internal, or to a dev, test or local host "
        f"nested under {site}, also as part of a hyphenated label"
    )
    if portals or variables:
        inlined = f" If the build inlined the values of {_listed(variables)}, they ship to every browser." if variables else ""
        return CheckItem(
            id="nonprod_environment_leak_in_bundle",
            title=title,
            status="info",
            detail=f"Scanned {scanned}: {no_host}.{maybe}{inlined}",
            recommendation="Confirm that each listed host and every inlined VITE_ value points to production, with no internal endpoint among them.",
        )
    return CheckItem(
        id="nonprod_environment_leak_in_bundle",
        title=title,
        status="pass",
        detail=f"Scanned {scanned}: {no_host}, and none directly under it.",
    )


def parse_source_map_exposure(maps: dict[str, Optional[Fetched]]) -> CheckItem:
    title = "Public JavaScript Source Maps"
    if not maps:
        return CheckItem(
            id="source_map_exposure",
            title=title,
            status="not_assessed",
            detail="The home page references no same-origin JavaScript bundle, so source maps were not checked.",
        )
    public = [path for path, res in maps.items() if res is not None and res.status_code == 200 and _SOURCE_MAP_RE.match(res.text)]
    if public:
        return CheckItem(
            id="source_map_exposure",
            title=title,
            status="info",
            detail=f"{', '.join(public)} is public: anyone can read the original front-end source, including comments and inlined configuration.",
            recommendation="Unless you mean to publish your source, turn off production browser source maps (productionBrowserSourceMaps in Next.js, build.sourcemap in Vite).",
        )
    silent = [path for path, res in maps.items() if res is None or res.status_code >= 500]
    if silent:
        return CheckItem(
            id="source_map_exposure",
            title=title,
            status="not_assessed",
            detail=f"{', '.join(silent)} did not answer (timeout, network error or HTTP 5xx), so source map exposure was not assessed.",
        )
    answers = ", ".join(f"{path} HTTP {res.status_code}" for path, res in maps.items() if res is not None)
    return CheckItem(id="source_map_exposure", title=title, status="pass", detail=f"No public source map ({answers}).")


# Server-side stack-trace signatures. node_modules only counts inside a real frame ("at … (/…/node_modules/…"),
# never a bare path, so an ordinary HTML page that links /node_modules/ in dev is not flagged.
_STACK_TRACE_RES = (
    ("Python traceback", re.compile(r"Traceback \(most recent call last\):")),
    ("Java/JDBC exception", re.compile(r"\bjava\.sql\.SQLException\b|\bjavax?\.[\w.]+Exception\b")),
    ("Prisma client error", re.compile(r"\bPrismaClient(?:KnownRequest|UnknownRequest|Validation|Initialization|Rust)Error\b")),
    ("Node.js stack frame", re.compile(r"\n\s*at (?:[\w.$<>\[\] ]+ \()?(?:/[^\s:)]*node_modules/|/var/task/|/opt/app/)")),
    ("serverless filesystem path", re.compile(r"(?<![\w./])(?:/var/task/|/opt/app/)[\w./-]+")),
)


def parse_stack_leak(res: Optional[Fetched]) -> CheckItem:
    title = "Exceptional-Condition Stack Traces"
    if res is None:
        return CheckItem(
            id="exceptional_conditions_stack_leak",
            title=title,
            status="not_assessed",
            detail="The error-probe request to a random path did not answer (timeout or network error), so error-handling disclosure was not assessed.",
        )
    body = res.text[:16384]
    leaked = [label for label, pattern in _STACK_TRACE_RES if pattern.search(body)]
    if res.status_code >= 400 and leaked:
        return CheckItem(
            id="exceptional_conditions_stack_leak",
            title=title,
            status="fail",
            detail=f"A request to a random non-existent path returned HTTP {res.status_code} with a server-side stack trace in the body ({', '.join(leaked)}), revealing internal frameworks, file paths and query structure. The server fails open instead of returning a generic error.",
            recommendation="Return a generic error page for unhandled 4xx/5xx responses and log the trace server-side only (set NODE_ENV=production, disable debug error pages, and strip framework stack traces at the edge).",
        )
    return CheckItem(
        id="exceptional_conditions_stack_leak",
        title=title,
        status="pass",
        detail=f"A request to a random non-existent path returned HTTP {res.status_code} with no server-side stack trace in the body.",
    )


# Each manifest must match its own format and must not be an HTML soft-404 catch-all page.
_PKG_JSON_RE = re.compile(r'"(?:name|version|dependencies|devDependencies)"\s*:')
_NPM_LOCK_RE = re.compile(r'"lockfileVersion"\s*:\s*\d')
_PNPM_LOCK_RE = re.compile(r"(?im)^lockfileVersion:\s*['\"]?\d")
_NPMRC_REGISTRY_RE = re.compile(r"(?im)^\s*(?:@[\w.-]+:)?registry\s*=\s*\S")
_NPMRC_TOKEN_RE = re.compile(r"(?im)^\s*(?://[^\s=]+/:_(?:auth|authToken|password)|_auth(?:Token)?|_password)\s*=\s*\S")


def _manifest_kind(path: str, res: Fetched) -> Optional[str]:
    """What this response actually is ("exposed", "token", or None if it is not a real manifest)."""
    if res.status_code != 200:
        return None
    body = res.text
    head = body[:512].lstrip().lower()
    if head.startswith("<!doctype") or head.startswith("<html") or "<html" in head:
        return None
    if path == "/.npmrc":
        if _NPMRC_TOKEN_RE.search(body):
            return "token"
        return "exposed" if _NPMRC_REGISTRY_RE.search(body) else None
    if path == "/pnpm-lock.yaml":
        return "exposed" if _PNPM_LOCK_RE.search(body) else None
    if path == "/package-lock.json":
        return "exposed" if (body.lstrip().startswith("{") and _NPM_LOCK_RE.search(body)) else None
    # /package.json
    return "exposed" if (body.lstrip().startswith("{") and _PKG_JSON_RE.search(body)) else None


def parse_supply_chain_manifest_exposure(probes: dict[str, Optional[Fetched]]) -> CheckItem:
    title = "Supply-Chain Manifest Exposure"
    kinds = {path: _manifest_kind(path, res) for path, res in probes.items() if res is not None}
    token_paths = [path for path, kind in kinds.items() if kind == "token"]
    exposed_paths = [path for path, kind in kinds.items() if kind == "exposed"]
    if token_paths:
        return CheckItem(
            id="supply_chain_manifest_exposure",
            title=title,
            status="fail",
            detail=f"{', '.join(token_paths)} is public and contains a registry authentication token, which lets anyone publish or pull private packages as you. The token value is redacted and was not used.",
            recommendation="Remove .npmrc from the deployed files and block /.npmrc at the edge, then rotate the leaked registry token immediately.",
        )
    if exposed_paths:
        return CheckItem(
            id="supply_chain_manifest_exposure",
            title=title,
            status="warn",
            detail=f"{', '.join(exposed_paths)} is served publicly, exposing your exact dependency list (SBOM) so an attacker can match it against known-vulnerable versions.",
            recommendation="Block /.npmrc, /package.json, /package-lock.json and /pnpm-lock.yaml at your web server, CDN or reverse proxy, or keep them out of the deployed build output.",
        )
    silent = [path for path, res in probes.items() if res is None or res.status_code >= 500]
    if silent:
        return CheckItem(
            id="supply_chain_manifest_exposure",
            title=title,
            status="not_assessed",
            detail=f"{', '.join(silent)} did not answer (timeout, network error or HTTP 5xx), so supply-chain manifest exposure was not assessed.",
        )
    answers = ", ".join(f"{path} HTTP {res.status_code}" for path, res in probes.items() if res is not None)
    return CheckItem(
        id="supply_chain_manifest_exposure",
        title=title,
        status="pass",
        detail=f"No package manifest or lockfile is served publicly ({answers}).",
    )
