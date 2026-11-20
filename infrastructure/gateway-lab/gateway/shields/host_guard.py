"""Host, Origin, and route-scoped CORS guards against browser DNS rebinding (CVE-2026-77359 / CVE-2026-76807).

Control-plane and management routes (/health, /api/v1/defcon*, /api/v1/domains*, /api/v1/telemetry*, /api/v1/ping)
reject missing/empty/duplicate Host headers (400), foreign Host headers (421), and foreign/null/malformed Origin
headers (403). All routes reject missing/duplicate Host headers, non-canonical IP Host headers (octal, hex, decimal
integer, abbreviated IPv4), and cross-origin requests targeting any loopback host (127.0.0.0/8, ::1, ::ffff:127/104,
localhost, *.localhost). Public discovery and /x402/* routes handle their own CORS headers directly.
"""
from __future__ import annotations

import ipaddress
import re
import urllib.parse

from fastapi import Request
from fastapi.responses import JSONResponse, Response

from gateway import config

MANAGEMENT_EXACT_PATHS = frozenset({"/health"})
MANAGEMENT_PATH_PREFIXES = (
    "/api/v1/defcon",
    "/api/v1/domains",
    "/api/v1/telemetry",
    "/api/v1/ping",
)
GATEWAY_API_PREFIXES = ("/api/", "/agent/")
PUBLIC_CORS_EXACT_PATHS = frozenset({"/llms.txt", "/openapi.json", "/mcp.json", "/favicon.ico"})
PUBLIC_CORS_PREFIXES = ("/x402/", "/.well-known/")

_DEFAULT_MANAGEMENT_HOSTS = frozenset({
    "localhost",
    "127.0.0.1",
    "::1",
    "gateway.stealthmark.io",
    "stealthmark-gateway",
})
# Populated only by pytest conftest so Starlette TestClient's default Host ("testserver") is never allowed in prod.
_TEST_MANAGEMENT_HOSTS: frozenset[str] = frozenset()

_DECIMAL_PART_RE = re.compile(r"^[0-9]+$")
_HEX_PART_RE = re.compile(r"^0x[0-9a-f]+$")
_CORS_ALLOW_METHODS = "GET, POST, OPTIONS, HEAD"
_CORS_ALLOW_HEADERS = "Content-Type, Authorization, x-stealthmark-agent, x-stealthmark-signature, x-stealthmark-timestamp"


def _normalize_host_entry(entry: str) -> str:
    h = entry.strip().lower()
    if h.startswith("[") and h.endswith("]"):
        h = h[1:-1]
    h = h.rstrip(".")
    if ":" in h:
        try:
            return str(ipaddress.IPv6Address(h))
        except ValueError:
            pass
    return h


def _parse_host(raw_host: str) -> tuple[str, bool]:
    raw = raw_host.strip().lower()
    if not raw or any(ch.isspace() or ord(ch) < 32 for ch in raw):
        return "", False
    if raw.startswith("["):
        end = raw.find("]")
        if end == -1:
            return "", False
        host = raw[1:end]
        rest = raw[end + 1 :]
        if rest:
            if not rest.startswith(":"):
                return "", False
            port = rest[1:]
            if not (port.isascii() and port.isdigit()) or not (1 <= int(port) <= 65535):
                return "", False
        try:
            ip = ipaddress.IPv6Address(host)
        except ValueError:
            return "", False
        return str(ip), True
    if ":" in raw:
        host, port = raw.split(":", 1)
        if not (port.isascii() and port.isdigit()) or not (1 <= int(port) <= 65535):
            return "", False
    else:
        host = raw
    if not host:
        return "", False
    return host, True


def _is_non_canonical_ip(host: str) -> bool:
    """Detects octal/hex octets in any position, integer decimal IPv4 (2130706433), and abbreviated IPv4 (127.1)."""
    clean = host.rstrip(".")
    if not clean or ":" in clean:
        return False
    parts = clean.split(".")
    if len(parts) > 4:
        return False
    if not all(_DECIMAL_PART_RE.match(p) or _HEX_PART_RE.match(p) for p in parts):
        return False
    # 1..3 purely numeric/hex parts (e.g. "2130706433", "0x7f000001", "127.1", "127.0.1") are always non-canonical.
    if len(parts) < 4:
        return True
    # 4-part dotted IPv4: reject any hex part or leading-zero octal part (e.g. "0177.0.0.1", "127.0.0.01").
    for part in parts:
        if part.startswith("0x") or (len(part) > 1 and part.startswith("0")):
            return True
    return False


def _is_loopback_host(host: str) -> bool:
    clean = host.rstrip(".")
    if not clean:
        return False
    if clean == "localhost" or clean.endswith(".localhost"):
        return True
    try:
        ip = ipaddress.ip_address(clean)
    except ValueError:
        return False
    if ip.is_loopback:
        return True
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return ip.ipv4_mapped.is_loopback
    return False


def _is_management_path(path: str) -> bool:
    return path in MANAGEMENT_EXACT_PATHS or path.startswith(MANAGEMENT_PATH_PREFIXES)


def _is_public_cors_path(path: str) -> bool:
    return path in PUBLIC_CORS_EXACT_PATHS or path.startswith(PUBLIC_CORS_PREFIXES)


def _is_gateway_api_path(path: str) -> bool:
    return path in MANAGEMENT_EXACT_PATHS or path.startswith(GATEWAY_API_PREFIXES)


def _allowed_cors_origins() -> set[str]:
    return {o.strip().lower().rstrip("/") for o in config.CORS_ALLOW_ORIGINS if o.strip()}


def _parse_origin(origin: str) -> tuple[str, bool]:
    """Strict RFC 6454 origin parser: http(s) scheme, no userinfo/path/query/fragment/control chars."""
    if not origin or any(ch.isspace() or ord(ch) < 32 for ch in origin):
        return "", False
    try:
        parsed = urllib.parse.urlsplit(origin)
    except ValueError:
        return "", False
    if parsed.scheme not in ("http", "https"):
        return "", False
    if parsed.username is not None or parsed.password is not None:
        return "", False
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        return "", False
    if not parsed.netloc or not parsed.hostname:
        return "", False
    host, valid = _parse_host(parsed.netloc)
    if not valid or _is_non_canonical_ip(host):
        return "", False
    return host, True


async def gateway_cors_middleware(request: Request, call_next):
    """Route-scoped CORS: keeps /x402/*, /.well-known/*, and proxied tenant routes untouched while
    enforcing an explicit Origin allowlist on gateway-owned API routes (never wildcard `*`)."""
    path = request.url.path
    if _is_public_cors_path(path) or not _is_gateway_api_path(path):
        return await call_next(request)

    origin = (request.headers.get("origin") or "").strip()
    origin_key = origin.lower().rstrip("/")
    allowed_origins = _allowed_cors_origins()
    is_preflight = request.method == "OPTIONS" and "access-control-request-method" in request.headers

    if is_preflight:
        if not origin or origin_key not in allowed_origins:
            return JSONResponse(status_code=403, content={"error": "forbidden_cors_origin"})
        return Response(
            status_code=204,
            headers={
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Methods": _CORS_ALLOW_METHODS,
                "Access-Control-Allow-Headers": _CORS_ALLOW_HEADERS,
                "Vary": "Origin",
            },
        )

    response = await call_next(request)
    if origin and origin_key in allowed_origins:
        response.headers.setdefault("Access-Control-Allow-Origin", origin)
        response.headers.setdefault("Vary", "Origin")
    return response


async def host_origin_rebinding_guard(request: Request, call_next):
    raw_hosts = request.headers.getlist("host")
    if len(raw_hosts) > 1:
        return JSONResponse(status_code=400, content={"error": "duplicate_host_header"})

    raw_host = raw_hosts[0].strip() if raw_hosts else ""
    if not raw_host:
        return JSONResponse(status_code=400, content={"error": "missing_host_header"})

    host, valid = _parse_host(raw_host)
    if not valid or _is_non_canonical_ip(host):
        return JSONResponse(status_code=400, content={"error": "invalid_host_header"})

    normalized_host = host.rstrip(".")
    configured_hosts = {_normalize_host_entry(h) for h in config.ALLOWED_HOSTS if h.strip()}
    if configured_hosts and normalized_host not in configured_hosts:
        return JSONResponse(status_code=421, content={"error": "misdirected_host"})

    raw_origins = request.headers.getlist("origin")
    if len(raw_origins) > 1:
        return JSONResponse(status_code=400, content={"error": "duplicate_origin_header"})
    origin = raw_origins[0].strip().lower().rstrip("/") if raw_origins else ""
    cors_origins = _allowed_cors_origins()

    if _is_management_path(request.url.path):
        allowed_mgmt = _DEFAULT_MANAGEMENT_HOSTS | _TEST_MANAGEMENT_HOSTS | configured_hosts
        if normalized_host not in allowed_mgmt:
            return JSONResponse(status_code=421, content={"error": "misdirected_host"})
        if origin:
            if origin == "null":
                return JSONResponse(status_code=403, content={"error": "forbidden_origin"})
            origin_host, origin_valid = _parse_origin(origin)
            if not origin_valid:
                return JSONResponse(status_code=403, content={"error": "forbidden_origin"})
            if origin not in cors_origins and origin_host.rstrip(".") not in allowed_mgmt:
                return JSONResponse(status_code=403, content={"error": "forbidden_origin"})

    if _is_loopback_host(normalized_host) and origin:
        if origin == "null":
            return JSONResponse(status_code=403, content={"error": "forbidden_origin"})
        origin_host, origin_valid = _parse_origin(origin)
        if not origin_valid:
            return JSONResponse(status_code=403, content={"error": "forbidden_origin"})
        if origin not in cors_origins and not _is_loopback_host(origin_host):
            return JSONResponse(status_code=403, content={"error": "forbidden_origin"})

    return await call_next(request)
