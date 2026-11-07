"""Proxy target allowlist and SSRF guard.

The universal reverse proxy only forwards to hosts the operator configured (DEMOCV/DEMODENTAL/SMILE upstreams and
any UPSTREAM_* environment variable) or to active registered_sites domains. The origin URL is always rebuilt from the
validated hostname, never taken from the caller, and the connection is pinned to a public address resolved here.
"""
import asyncio
import ipaddress
import logging
import os
import socket
import urllib.parse
from dataclasses import dataclass
from typing import Optional

from fastapi import Request

from gateway import config, metering

logger = logging.getLogger("stealthmark.gateway")

UPSTREAM_ENV_PREFIX = "UPSTREAM_"
BLOCKED_HOSTNAMES = frozenset({"localhost", "metadata", "metadata.google.internal"})
BLOCKED_HOST_SUFFIXES = (".internal", ".local", ".localhost", ".localdomain")
BLOCKED_NETWORKS = tuple(ipaddress.ip_network(cidr) for cidr in (
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
    "192.0.0.0/24", "192.168.0.0/16", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4",
    "::/128", "::1/128", "64:ff9b::/96", "2002::/16", "fc00::/7", "fe80::/10", "ff00::/8",
    # IPv4-compatible IPv6 (RFC 4291): ::127.0.0.1 has no ipv4_mapped value and Python reports it as global.
    "::/96",
    # Teredo tunnels to an arbitrary IPv4 address; 2001:db8::/32 is documentation only.
    "2001::/32", "2001:db8::/32",
))
DEFAULT_PORTS = {"http": 80, "https": 443}


@dataclass(frozen=True)
class Origin:
    base_url: str
    host: str
    site: Optional[metering.Site]


@dataclass(frozen=True)
class ResolvedTarget:
    origin: Origin
    sub_path: str


@dataclass(frozen=True)
class Pinned:
    origin: str
    host_header: str
    sni_hostname: Optional[str]


def configured_upstreams() -> dict[str, str]:
    """Hostname -> base URL for every operator-configured upstream."""
    candidates = [config.DEMOCV_UPSTREAM, config.DEMODENTAL_UPSTREAM, config.SMILE_API_UPSTREAM]
    candidates += [value for key, value in os.environ.items() if key.startswith(UPSTREAM_ENV_PREFIX)]
    upstreams: dict[str, str] = {}
    for raw in candidates:
        try:
            parts = urllib.parse.urlsplit(raw.strip())
            port = parts.port
        except ValueError:
            continue
        host = metering.normalize_host(parts.hostname)
        if parts.scheme in DEFAULT_PORTS and host:
            upstreams.setdefault(host, f"{parts.scheme}://{host}" + (f":{port}" if port else ""))
    return upstreams


async def lookup_origin(raw_host: Optional[str]) -> Optional[Origin]:
    """Allowed origin for a hostname or URL, or None when it is neither a configured upstream nor an active registered site."""
    host = metering.normalize_host(raw_host)
    if not host:
        return None
    base_url = configured_upstreams().get(host)
    site = await metering.sites.resolve(host)
    if base_url is None and site is None:
        return None
    return Origin(base_url or f"https://{host}", host, site)


async def resolve_request_target(request: Request, path: str) -> Optional[ResolvedTarget]:
    """Map a proxied request to an allowed origin and upstream path; any other target resolves to None (404)."""
    raw_host, sub_path = _requested_host_and_path(request, path)
    origin = await lookup_origin(raw_host)
    return ResolvedTarget(origin, sub_path) if origin else None


def _requested_host_and_path(request: Request, path: str) -> tuple[Optional[str], str]:
    declared = request.headers.get("x-stealthmark-target") or request.query_params.get("target")
    if declared:
        return declared, path
    for prefix, upstream in (("demodental/", config.DEMODENTAL_UPSTREAM), ("democv/", config.DEMOCV_UPSTREAM)):
        if path.startswith(prefix):
            return upstream, path[len(prefix):]
    if path.startswith(("proxy/http://", "proxy/https://")):
        parts = urllib.parse.urlsplit(path[len("proxy/"):])
        return parts.netloc, parts.path.lstrip("/")
    return request.headers.get("host"), path


def address_allowed(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not any(ip in network for network in BLOCKED_NETWORKS if network.version == ip.version)


def host_blocked(host: str) -> bool:
    # urlsplit keeps the FQDN trailing dot ("metadata.google.internal."), so normalize before comparing.
    host = host.strip().rstrip(".").lower()
    return host in BLOCKED_HOSTNAMES or host.endswith(BLOCKED_HOST_SUFFIXES)


async def resolve_addresses(host: str, port: int) -> list[str]:
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (OSError, UnicodeError):
        return []
    return sorted({str(info[4][0]) for info in infos}, key=lambda address: ":" in address)


async def public_addresses(host: str, port: int) -> list[str]:
    """Resolved addresses of a host, or [] when it is blocked, unresolvable or resolves to any non-public address."""
    if host_blocked(host):
        return []
    addresses = await resolve_addresses(host, port)
    if not addresses or not all(address_allowed(address) for address in addresses):
        return []
    return addresses


async def pin_origin(base_url: str) -> Optional[Pinned]:
    """Resolve the origin once and return a URL that connects to the validated address (defeats DNS rebinding)."""
    parts = urllib.parse.urlsplit(base_url)
    host = parts.hostname
    if not host or parts.scheme not in DEFAULT_PORTS:
        return None
    port = parts.port or DEFAULT_PORTS[parts.scheme]
    addresses = await public_addresses(host, port)
    if not addresses:
        logger.warning("proxy origin refused: %r", host)
        return None
    literal = f"[{addresses[0]}]" if ":" in addresses[0] else addresses[0]
    host_header = host if port == DEFAULT_PORTS[parts.scheme] else f"{host}:{port}"
    return Pinned(f"{parts.scheme}://{literal}:{port}", host_header, host if parts.scheme == "https" else None)


async def redirect_target(current: Origin, target: str, location: Optional[str]) -> Optional[tuple[Origin, str]]:
    """Origin and path for an upstream redirect, or None when the Location leaves the allowlist."""
    if not location:
        return None
    parts = urllib.parse.urlsplit(urllib.parse.urljoin(f"{current.base_url}{target}", location))
    if parts.scheme not in DEFAULT_PORTS:
        return None
    origin = await lookup_origin(parts.hostname)
    if origin is None:
        return None
    return origin, (parts.path or "/") + (f"?{parts.query}" if parts.query else "")


async def is_public_url(raw_url: str) -> bool:
    """True when the URL's host resolves only to public addresses (used by the scanner, which may fetch any public site)."""
    try:
        parts = urllib.parse.urlsplit(raw_url)
        port = parts.port or DEFAULT_PORTS.get(parts.scheme, 0)
    except ValueError:
        return False
    host = (parts.hostname or "").rstrip(".")
    return parts.scheme in DEFAULT_PORTS and bool(host) and bool(await public_addresses(host, port))
