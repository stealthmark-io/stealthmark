import asyncio
import json
import time
import urllib.parse
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Callable, Mapping

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from gateway import targets, upstream
from gateway.clientip import client_ip

router = APIRouter()

SCANS_PER_IP_PER_MINUTE = 6
MAX_CONCURRENT_SCANS = 8
MAX_TRACKED_IPS = 10_000
SCAN_TIMEOUT_SECONDS = 8.0
SCAN_DEADLINE_SECONDS = 20.0
MAX_SCAN_BODY_BYTES = 2 * 1024 * 1024
MAX_SCAN_REDIRECT_HOPS = 3
SCANNABLE_PORTS = frozenset({None, 80, 443})

_clock: Callable[[], float] = time.time
_scan_slots = asyncio.Semaphore(MAX_CONCURRENT_SCANS)
_scan_counts: "OrderedDict[tuple[str, int], int]" = OrderedDict()


def allow_scan(ip: str, now: float | None = None) -> bool:
    """Per-address budget for the unauthenticated scanner: each call makes up to three outbound requests."""
    window = int((_clock() if now is None else now) // 60)
    key = (ip, window)
    count = _scan_counts.get(key, 0)
    if count >= SCANS_PER_IP_PER_MINUTE:
        return False
    _scan_counts[key] = count + 1
    _scan_counts.move_to_end(key)
    while len(_scan_counts) > MAX_TRACKED_IPS:
        _scan_counts.popitem(last=False)
    return True


class ScannerRequest(BaseModel):
    target_url: str


@dataclass
class Probe:
    """Everything the scanner measured about one target; the report is derived from these values and nothing else."""

    status_code: int
    headers: Mapping[str, str]
    body_bytes: int
    manifest_found: bool
    docs_exposed: bool


@dataclass
class Report:
    score: int
    tier: str
    badge_color: str
    agent_access: str
    findings: list[dict[str, str]] = field(default_factory=list)


def analyze(probe: Probe) -> Report:
    """Scores a probe from measured facts only. It never claims a protection the target did not demonstrate."""
    headers = {k.lower(): v for k, v in probe.headers.items()}
    blocked = probe.status_code in (403, 429, 503)
    findings: list[dict[str, str]] = []
    score = 100

    if blocked:
        score -= 35
        findings.append({
            "severity": "HIGH",
            "tag": "AGENT ACCESS",
            "title": f"The target answered HTTP {probe.status_code} to an automated request",
            "description": "The scanner identifies itself as an automated client. A blocking answer means AI assistants that identify themselves the same way may be refused as well.",
            "solution": "Decide which agents you want to admit and publish that policy in a machine-readable manifest.",
        })

    if not probe.manifest_found:
        score -= 20
        findings.append({
            "severity": "MEDIUM",
            "tag": "MANIFEST",
            "title": "No agent manifest found at /.well-known/agent.json",
            "description": "No machine-readable description of what agents may do on this site was served.",
            "solution": "Publish /.well-known/agent.json. The open-source StealthMark SDK generates one.",
        })

    has_hsts = "strict-transport-security" in headers
    has_csp = "content-security-policy" in headers
    if not has_hsts or not has_csp:
        score -= 10
        missing = " and ".join(name for name, present in (("Strict-Transport-Security", has_hsts), ("Content-Security-Policy", has_csp)) if not present)
        findings.append({
            "severity": "MEDIUM",
            "tag": "TRANSPORT HEADERS",
            "title": f"Missing response header: {missing}",
            "description": "These headers were absent from the response the scanner received.",
            "solution": "Add the missing headers at your origin or CDN.",
        })

    if probe.body_bytes > 35_000:
        score -= 15
        findings.append({
            "severity": "LOW",
            "tag": "PAGE WEIGHT",
            "title": f"Large HTML response ({probe.body_bytes // 1024} KB)",
            "description": f"Roughly {probe.body_bytes // 4:,} tokens if an agent reads the page as text (4 bytes per token is an approximation).",
            "solution": "Serve agents a compact manifest or structured data instead of the full page.",
        })

    if probe.docs_exposed:
        score -= 15
        findings.append({
            "severity": "HIGH",
            "tag": "API DOCS",
            "title": "Swagger or OpenAPI documentation is publicly reachable at /docs",
            "description": "The page answered 200 and mentions Swagger or OpenAPI.",
            "solution": "Restrict the documentation route if the API is not meant to be public.",
        })

    if headers.get("x-stealthmark-agent-policy") or headers.get("x-stealthmark-shield"):
        findings.append({
            "severity": "INFO",
            "tag": "SDK SIGNAL",
            "title": "A StealthMark response header is present",
            "description": "Any server can send this header, so it is reported as self-declared and has no effect on the score.",
            "solution": "Check your own console for the events the SDK reports.",
        })

    score = max(10, min(100, score))
    if score >= 80:
        tier, color = "HEALTHY", "emerald"
    elif score >= 50:
        tier, color = "MODERATE RISK", "amber"
    else:
        tier, color = "CRITICAL VULNERABILITY", "rose"
    return Report(score, tier, color, f"BLOCKED (HTTP {probe.status_code})" if blocked else "OPEN", findings)


def recommended_action(url: str, report: Report) -> str:
    if not report.findings or all(f["severity"] == "INFO" for f in report.findings):
        return f"No gaps found in the checks performed against {url}."
    return f"Review the {len([f for f in report.findings if f['severity'] != 'INFO'])} finding(s) listed for {url}."


class ScanRefused(Exception):
    """The target, or a redirect it issued, points at an address the scanner is not allowed to contact."""


@dataclass
class Fetched:
    status_code: int
    headers: httpx.Headers
    body: bytes
    truncated: bool

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")


def scannable_url(url: str) -> bool:
    """Only http(s) on the default ports: an open scanner must not double as a port scanner for third-party hosts."""
    try:
        parts = urllib.parse.urlsplit(url)
        return parts.scheme in ("http", "https") and bool(parts.hostname) and parts.port in SCANNABLE_PORTS
    except ValueError:
        return False


def origin_of(url: str) -> str:
    """scheme://host[:port] of a URL, without credentials, path or query."""
    parts = urllib.parse.urlsplit(url)
    host = parts.hostname or ""
    netloc = f"[{host}]" if ":" in host else host
    return f"{parts.scheme}://{netloc}" + (f":{parts.port}" if parts.port else "")


async def read_capped(response: httpx.Response, max_bytes: int | None = None) -> Fetched:
    """Read at most max_bytes (default MAX_SCAN_BODY_BYTES) of the raw, never decompressed body so a hostile target cannot exhaust memory."""
    limit = MAX_SCAN_BODY_BYTES if max_bytes is None else max_bytes
    chunks: list[bytes] = []
    size = 0
    truncated = False
    async for chunk in response.aiter_raw():
        room = limit - size
        if len(chunk) > room:
            chunks.append(chunk[:room])
            size += room
            truncated = True
            break
        chunks.append(chunk)
        size += len(chunk)
    return Fetched(response.status_code, response.headers, b"".join(chunks), truncated)


async def fetch_pinned(
    client: httpx.AsyncClient,
    url: str,
    headers: Mapping[str, str],
    follow_redirects: bool = True,
    max_bytes: int | None = None,
) -> Fetched:
    """
    GET a public URL and follow at most MAX_SCAN_REDIRECT_HOPS redirects. Every hop resolves its host once, checks that
    every address is public and connects to that validated address (Host and SNI keep the real name), so a hostname
    that changes its DNS answer between the check and the connection cannot steer the request into private space.
    """
    current = url
    hops = 0
    while True:
        pinned = await targets.pin_origin(origin_of(current))
        if pinned is None:
            raise ScanRefused(urllib.parse.urlsplit(current).hostname or "")
        parts = urllib.parse.urlsplit(current)
        target = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        async with client.stream(
            "GET",
            f"{pinned.origin}{target}",
            headers={**headers, "host": pinned.host_header},
            extensions={"sni_hostname": pinned.sni_hostname} if pinned.sni_hostname else {},
        ) as response:
            if follow_redirects and response.status_code in upstream.REDIRECT_STATUSES and hops < MAX_SCAN_REDIRECT_HOPS:
                location = response.headers.get("location")
                following = urllib.parse.urljoin(current, location) if location else None
                if following and scannable_url(following):
                    current = following
                    hops += 1
                    continue
            return await read_capped(response, max_bytes)


def target_not_allowed() -> JSONResponse:
    return JSONResponse(status_code=400, content={"error": "Target Not Allowed", "detail": "The scanner only audits public websites on the standard http and https ports."})


@router.post("/api/v1/scanner/audit-url")
async def audit_external_website(payload: ScannerRequest, request: Request):
    """
    Perimeter readiness check for a public website. Every field of the answer comes from what this call
    measured: the HTTP status, response headers, size, the agent manifest and the /docs route.
    """
    url = payload.target_url.strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        url = f"https://{url}"

    if not allow_scan(client_ip(request)):
        return JSONResponse(status_code=429, headers={"Retry-After": "60"}, content={"error": "Too Many Requests", "detail": "Scanner limit reached for this address. Try again in a minute."})

    if not scannable_url(url) or not await targets.is_public_url(url):
        return target_not_allowed()

    if _scan_slots.locked():
        return JSONResponse(status_code=503, headers={"Retry-After": "5"}, content={"error": "Scanner Busy", "detail": "Too many scans are running. Try again shortly."})

    async with _scan_slots:
        try:
            async with asyncio.timeout(SCAN_DEADLINE_SECONDS):
                return await _scan(url)
        except TimeoutError:
            return JSONResponse(status_code=504, content={"error": "Scan Timed Out", "detail": "The target did not answer within the scan deadline."})


async def _scan(url: str):
    started = time.perf_counter()
    agent_headers = {
        "User-Agent": "StealthMarkScanner/1.0 (+https://stealthmark.io/docs)",
        "Accept": "application/agent+json, application/json, text/html",
        "Accept-Encoding": "identity",
    }
    async with httpx.AsyncClient(follow_redirects=False, timeout=SCAN_TIMEOUT_SECONDS, trust_env=False) as client:
        try:
            response = await fetch_pinned(client, url, agent_headers)
        except ScanRefused:
            return target_not_allowed()
        except (httpx.HTTPError, httpx.InvalidURL):
            return JSONResponse(status_code=400, content={"error": "Connection Failed", "detail": "Could not connect to target URL."})

        scan_latency = round((time.perf_counter() - started) * 1000, 1)
        base = origin_of(url)

        manifest_found = False
        try:
            manifest = await fetch_pinned(client, f"{base}/.well-known/agent.json", agent_headers)
            if manifest.status_code == 200 and "json" in manifest.headers.get("content-type", "").lower():
                manifest_found = isinstance(json.loads(manifest.text), dict)
        except (httpx.HTTPError, httpx.InvalidURL, ScanRefused, ValueError, RecursionError):
            manifest_found = False

        docs_exposed = False
        try:
            docs = await fetch_pinned(client, f"{base}/docs", agent_headers)
            text = docs.text.lower()
            docs_exposed = docs.status_code == 200 and ("swagger" in text or "openapi" in text)
        except (httpx.HTTPError, httpx.InvalidURL, ScanRefused):
            docs_exposed = False

    probe = Probe(
        status_code=response.status_code,
        headers=dict(response.headers),
        body_bytes=len(response.body),
        manifest_found=manifest_found,
        docs_exposed=docs_exposed,
    )
    report = analyze(probe)
    return {
        "target": url,
        "scanned_at": time.time(),
        "scan_latency_ms": scan_latency,
        "agentic_score": report.score,
        "readiness_tier": report.tier,
        "badge_color": report.badge_color,
        "metrics": {
            "http_status": probe.status_code,
            "payload_kb": round(probe.body_bytes / 1024, 1),
            "payload_truncated": response.truncated,
            "estimated_tokens_per_visit": probe.body_bytes // 4,
            "agent_access": report.agent_access,
            "server": response.headers.get("server", "unknown"),
        },
        "findings": report.findings,
        "recommended_action": recommended_action(url, report),
    }
