"""Agent-event metering and quota enforcement for the hosted gateway.

One agent event is one agent-identified HTTP request that maps to a registered
site. Events are queued in memory and flushed in batches to the Supabase
usage_records ledger through PostgREST (service role). Quota checks are cached
and fail open: a metering outage must never block customer traffic.
"""
import datetime
import re
import time
from dataclasses import dataclass
from typing import Optional

import httpx
from fastapi import Request
from fastapi.responses import JSONResponse

from gateway import postgrest
from gateway.abuse_guard import EventGate
from gateway.clientip import client_ip
from gateway.config import AGENT_UA_TOKENS, logger
from gateway.usage_queue import UsageQueue

SITE_CACHE_TTL_SECONDS = 60.0
SITE_ERROR_TTL_SECONDS = 5.0
SITE_CACHE_MAX_ENTRIES = 5000
QUOTA_CACHE_TTL_SECONDS = 30.0
QUOTA_ERROR_TTL_SECONDS = 5.0
QUOTA_RETRY_AFTER_SECONDS = 300
USAGE_PAGE_SIZE = 1000
USAGE_MAX_PAGES = 100

EVENT_REQUEST = "agent_request"
EVENT_BLOCKED = "agent_blocked"
EVENT_MANIFEST = "agent_manifest"
SOURCE_GATEWAY = "gateway"
BLOCK_METERED_STATE_KEY = "block_metered"

MANIFEST_PATHS = frozenset({
    ".well-known/agent.json",
    ".well-known/ai-plugin.json",
    "agent-manifest.json",
})

HOST_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$")


def metering_enabled() -> bool:
    return postgrest.is_configured()


def normalize_host(value: Optional[str]) -> Optional[str]:
    """Reduce a Host header or URL to a lowercase hostname, or None when it is not a plain DNS name."""
    if not value:
        return None
    host = value.strip().lower()
    if "://" in host:
        host = host.split("://", 1)[1]
    host = host.split("/", 1)[0].split("@")[-1].split(":", 1)[0].rstrip(".")
    return host if HOST_PATTERN.match(host) else None


def current_period_month() -> str:
    today = datetime.datetime.now(datetime.timezone.utc).date()
    return today.replace(day=1).isoformat()


def agent_identifier(request: Request) -> Optional[str]:
    """Return a stable identifier when the request comes from an AI agent, otherwise None (human traffic is never metered)."""
    declared = request.headers.get("x-stealthmark-agent")
    user_agent = request.headers.get("user-agent", "")
    accept = request.headers.get("accept", "")
    is_agent = bool(declared) or "application/agent+json" in accept or any(
        token in user_agent.lower() for token in AGENT_UA_TOKENS
    )
    if not is_agent:
        return None
    return (declared or user_agent or "unknown-agent")[:128]


def target_host(request: Request) -> Optional[str]:
    """Hostname the request asks the gateway to proxy to (header, query parameter or /proxy/<url> prefix), if any."""
    declared = request.headers.get("x-stealthmark-target") or request.query_params.get("target")
    if declared:
        return normalize_host(declared)
    path = request.url.path.lstrip("/")
    if path.startswith("proxy/http://") or path.startswith("proxy/https://"):
        return normalize_host(path[len("proxy/"):])
    return None


def event_type_for_path(path: str) -> str:
    return EVENT_MANIFEST if path.strip("/") in MANIFEST_PATHS else EVENT_REQUEST


@dataclass(frozen=True)
class Site:
    id: str
    org_id: str
    domain: str


@dataclass
class Quota:
    billing_mode: str
    cap: Optional[int]
    used: int
    remaining: Optional[int]

    @property
    def over_cap(self) -> bool:
        return self.remaining is not None and self.remaining <= 0


def compute_quota(billing_mode: str, monthly_event_cap: int, credit_balance_events: int, used: int) -> Quota:
    """Effective cap per mode: free compares the period usage with monthly_event_cap, credits uses the remaining balance, enterprise has no cap."""
    if billing_mode == "enterprise":
        return Quota("enterprise", None, used, None)
    if billing_mode == "credits":
        balance = max(0, credit_balance_events)
        return Quota("credits", balance, used, balance)
    return Quota("free", monthly_event_cap, used, max(0, monthly_event_cap - used))


class SiteResolver:
    """Cached lookup of active, DNS-verified registered_sites by hostname (positive and negative results; a lookup error keeps serving the last known site)."""

    def __init__(self, ttl: float = SITE_CACHE_TTL_SECONDS, max_entries: int = SITE_CACHE_MAX_ENTRIES):
        self.ttl = ttl
        self.max_entries = max_entries
        self._cache: dict[str, tuple[float, Optional[Site]]] = {}

    async def resolve(self, *hosts: Optional[str]) -> Optional[Site]:
        if not metering_enabled():
            return None
        for raw in hosts:
            host = normalize_host(raw)
            if host:
                site = await self._lookup(host)
                if site:
                    return site
        return None

    async def _lookup(self, host: str) -> Optional[Site]:
        now = time.monotonic()
        hit = self._cache.get(host)
        if hit and hit[0] > now:
            return hit[1]
        try:
            site = await self._fetch(host)
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("registered_sites lookup failed for %s: %s", host, exc)
            stale = hit[1] if hit else None
            self._store(host, stale, now + SITE_ERROR_TTL_SECONDS)
            return stale
        self._store(host, site, now + self.ttl)
        return site

    async def _fetch(self, host: str) -> Optional[Site]:
        twin = host[4:] if host.startswith("www.") else f"www.{host}"
        rows = await postgrest.rest_get("registered_sites", {
            "domain": f"in.({host},{twin})",
            "status": "eq.active",
            "dns_verified": "eq.true",
            "select": "id,org_id,domain",
            "limit": "1",
        })
        for row in rows:
            if row.get("id") and row.get("org_id"):
                return Site(id=str(row["id"]), org_id=str(row["org_id"]), domain=str(row.get("domain") or host))
        return None

    def _store(self, host: str, site: Optional[Site], expires_at: float) -> None:
        if len(self._cache) >= self.max_entries:
            now = time.monotonic()
            self._cache = {k: v for k, v in self._cache.items() if v[0] > now}
            if len(self._cache) >= self.max_entries:
                self._cache.clear()
        self._cache[host] = (expires_at, site)


class QuotaCache:
    """Per-organization quota snapshot cached for 30 s, adjusted locally as events are queued."""

    def __init__(self, ttl: float = QUOTA_CACHE_TTL_SECONDS):
        self.ttl = ttl
        self._entries: dict[str, tuple[float, Optional[Quota]]] = {}

    async def get(self, org_id: str) -> Optional[Quota]:
        now = time.monotonic()
        hit = self._entries.get(org_id)
        if hit and hit[0] > now:
            return hit[1]
        try:
            quota = await self._fetch(org_id)
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("quota lookup failed for org %s: %s", org_id, exc)
            self._entries[org_id] = (now + QUOTA_ERROR_TTL_SECONDS, None)
            return None
        self._entries[org_id] = (now + self.ttl, quota)
        return quota

    def note_events(self, org_id: str, units: int) -> None:
        hit = self._entries.get(org_id)
        if not hit or hit[1] is None:
            return
        quota = hit[1]
        quota.used += units
        if quota.remaining is not None:
            quota.remaining = max(0, quota.remaining - units)

    async def _fetch(self, org_id: str) -> Optional[Quota]:
        rows = await postgrest.rest_get("organizations", {
            "id": f"eq.{org_id}",
            "select": "billing_mode,monthly_event_cap,credit_balance_events",
        })
        if not rows:
            return None
        org = rows[0]
        mode = str(org.get("billing_mode") or "free")
        cap = int(org.get("monthly_event_cap") if org.get("monthly_event_cap") is not None else 250)
        balance = int(org.get("credit_balance_events") or 0)
        used = await self._sum_units(org_id, cap) if mode not in ("enterprise", "credits") else 0
        return compute_quota(mode, cap, balance, used)

    async def _sum_units(self, org_id: str, stop_at: int) -> int:
        total = 0
        period = current_period_month()
        for page in range(USAGE_MAX_PAGES):
            rows = await postgrest.rest_get("usage_records", {
                "org_id": f"eq.{org_id}",
                "period_month": f"eq.{period}",
                "select": "units",
                "limit": str(USAGE_PAGE_SIZE),
                "offset": str(page * USAGE_PAGE_SIZE),
            })
            total += sum(int(row.get("units") or 0) for row in rows)
            if total >= stop_at or len(rows) < USAGE_PAGE_SIZE:
                break
        return total


sites = SiteResolver()
quotas = QuotaCache()
usage_queue = UsageQueue()
event_gate = EventGate()


async def start_metering() -> None:
    if metering_enabled():
        usage_queue.start()


async def stop_metering() -> None:
    await usage_queue.stop()


async def enforce_quota(org_id: str) -> Optional[JSONResponse]:
    """Return a 429 response when the organization is at or over its effective cap, otherwise None (fail open on lookup errors)."""
    quota = await quotas.get(org_id)
    if quota is None or not quota.over_cap:
        return None
    return JSONResponse(
        status_code=429,
        headers={"Retry-After": str(QUOTA_RETRY_AFTER_SECONDS)},
        content={"error": "quota_exceeded", "retry_after_seconds": QUOTA_RETRY_AFTER_SECONDS},
    )


def units_for(event_type: str) -> int:
    """agent_blocked is recorded for visibility but costs nothing; every other event costs one unit."""
    return 0 if event_type == EVENT_BLOCKED else 1


def record_event(
    site: Site,
    request: Request,
    agent: str,
    event_type: str,
    status_code: int,
    latency_ms: float,
) -> bool:
    units = units_for(event_type)
    if units > 0:
        within_limit = event_gate.allow_billable(site.org_id, client_ip(request))
    else:
        within_limit = event_gate.allow_blocked(site.org_id)
    if not within_limit:
        return False
    row = {
        "org_id": site.org_id,
        "site_id": site.id,
        "event_type": event_type,
        "units": units,
        "source": SOURCE_GATEWAY,
        "agent_identifier": agent,
        "request_count": 1,
        "latency_ms": int(latency_ms),
        "success": status_code < 400,
        "metadata": {"host": site.domain, "path": request.url.path, "method": request.method, "status": status_code},
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    accepted = usage_queue.enqueue(row)
    if accepted and units > 0:
        quotas.note_events(site.org_id, units)
    return accepted


async def record_blocked(
    request: Request,
    status_code: int,
    latency_ms: float = 0.0,
    site: Optional[Site] = None,
) -> bool:
    """Record a shield rejection of agent traffic for a registered site as a free agent_blocked event.

    Never checks quota, so attacks stay visible after the cap. Idempotent per request, skipped for humans,
    unknown hosts and when metering is disabled, and it never raises: metering must not break the shield response.
    """
    if getattr(request.state, BLOCK_METERED_STATE_KEY, False):
        return False
    try:
        agent = agent_identifier(request)
        if not agent:
            return False
        resolved = site or await sites.resolve(request.headers.get("host"), target_host(request))
        if resolved is None:
            return False
        setattr(request.state, BLOCK_METERED_STATE_KEY, True)
        return record_event(resolved, request, agent, EVENT_BLOCKED, status_code, latency_ms)
    except Exception:
        logger.exception("failed to record agent_blocked event")
        return False


async def meter_manifest(request: Request) -> None:
    """Count a manifest fetch served locally for a registered site; skipped for humans, unknown hosts and orgs over cap."""
    agent = agent_identifier(request)
    if not agent:
        return
    site = await sites.resolve(request.headers.get("host"))
    if site is None or await enforce_quota(site.org_id) is not None:
        return
    record_event(site, request, agent, EVENT_MANIFEST, 200, 0.0)
