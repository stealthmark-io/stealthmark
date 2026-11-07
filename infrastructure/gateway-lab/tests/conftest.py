import copy
import inspect
import ipaddress
import os
import time
import urllib.error
import urllib.request

for name in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY", "INTERNAL_AUTH_SECRET", "PASSPORT_HMAC_SECRET"):
    os.environ.pop(name, None)

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from gateway import config, metering, state, targets
from gateway.abuse_guard import EventGate
from gateway.shields import passport
from gateway import postgrest as postgrest_client
from gateway.app import app, create_app
from gateway.routes import scanner

SUPABASE_TEST_URL = "https://example-project.supabase.co"
SUPABASE_TEST_KEY = "test-service-role-key"
INTERNAL_TEST_SECRET = "internal-test-secret"
PASSPORT_TEST_SECRET = "passport-test-secret"
PUBLIC_TEST_ADDRESS = "93.184.216.34"
FROZEN_CLOCK = 1_700_000_040.0
INTERNAL_HEADERS = {"x-internal-secret": INTERNAL_TEST_SECRET}


def fake_dns(overrides: dict[str, list[str]]):
    """Deterministic resolver: every host is public unless overridden, so tests never touch the network."""

    async def resolve(host: str, port: int) -> list[str]:
        if host in overrides:
            return overrides[host]
        try:
            ipaddress.ip_address(host)
        except ValueError:
            return [PUBLIC_TEST_ADDRESS]
        return [host]

    return resolve


def internetdb_unreachable(*args, **kwargs):
    """The audit's InternetDB lookup uses urllib; tests never reach the real service."""
    raise urllib.error.URLError("network disabled in tests")


@pytest.fixture(autouse=True)
def isolated_gateway_state(tmp_path, monkeypatch):
    """Keep telemetry, DEFCON posture and metering singletons from leaking between tests or touching /tmp."""
    monkeypatch.setattr(state, "TELEMETRY_CACHE_FILE", str(tmp_path / "telemetry.json"))
    monkeypatch.setattr(state, "CURRENT_DEFCON_LEVEL", 5)
    monkeypatch.setattr(postgrest_client, "SUPABASE_URL", "")
    monkeypatch.setattr(postgrest_client, "SUPABASE_SERVICE_ROLE_KEY", "")
    monkeypatch.setattr(metering, "sites", metering.SiteResolver())
    monkeypatch.setattr(metering, "quotas", metering.QuotaCache())
    monkeypatch.setattr(metering, "usage_queue", metering.UsageQueue())
    monkeypatch.setattr(metering, "event_gate", EventGate(clock=lambda: FROZEN_CLOCK))
    from gateway.routes import audit_v2, scanner
    monkeypatch.setattr(scanner, "_clock", lambda: FROZEN_CLOCK)
    scanner._scan_counts.clear()
    monkeypatch.setattr(audit_v2, "_clock", lambda: FROZEN_CLOCK)
    monkeypatch.setattr(audit_v2, "_tls_cert_fetcher", lambda domain: None)
    audit_v2._audit_counts.clear()
    monkeypatch.setattr(passport, "PASSPORT_HMAC_SECRET", "")
    monkeypatch.setattr(config, "INTERNAL_AUTH_SECRET", "")
    monkeypatch.setattr(targets, "resolve_addresses", fake_dns({}))
    monkeypatch.setattr(urllib.request, "urlopen", internetdb_unreachable)
    telemetry_snapshot = copy.deepcopy(state.TELEMETRY)
    state.REQUEST_LOG.clear()
    state.RECENT_AUDIT_LOGS.clear()
    yield
    state.TELEMETRY.clear()
    state.TELEMETRY.update(telemetry_snapshot)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def web_response(status: int = 200, headers: dict[str, str] | None = None, content: bytes = b"") -> httpx.Response:
    """A streaming response, like the ones AsyncClient.stream hands to the scanner."""
    return httpx.Response(status, headers=headers or {}, stream=httpx.ByteStream(content))


def fake_web(monkeypatch, handler) -> list[httpx.Request]:
    """Answer every outbound AsyncClient request with handler(request) and return the list of requests actually sent."""
    sent: list[httpx.Request] = []

    async def send(self, request, **kwargs):
        sent.append(request)
        result = handler(request)
        return await result if inspect.isawaitable(result) else result

    monkeypatch.setattr(httpx.AsyncClient, "send", send)
    return sent


@pytest.fixture
def lab_client() -> TestClient:
    """The gateway with the demo routers enabled; they exercise the passport, rate-limit and semantic shields."""
    return TestClient(create_app(lab_routes=True))


@pytest.fixture
def supabase_enabled(monkeypatch):
    monkeypatch.setattr(postgrest_client, "SUPABASE_URL", SUPABASE_TEST_URL)
    monkeypatch.setattr(postgrest_client, "SUPABASE_SERVICE_ROLE_KEY", SUPABASE_TEST_KEY)


class FakePostgrest:
    """Records PostgREST GET calls made through httpx.AsyncClient.get and answers from per-table fixtures."""

    def __init__(self):
        self.tables: dict[str, list[dict]] = {}
        self.status_by_table: dict[str, int] = {}
        self.calls: list[tuple[str, dict]] = []

    async def get(self, url, **kwargs):
        table = url.rsplit("/", 1)[-1]
        params = dict(kwargs.get("params") or {})
        self.calls.append((table, params))
        status_code = self.status_by_table.get(table, 200)
        if status_code != 200:
            return httpx.Response(status_code, json={"message": "error"})
        rows = self.tables.get(table, [])
        domain_filter = params.get("domain", "")
        if table == "registered_sites" and domain_filter.startswith("in.("):
            wanted = domain_filter[len("in.("):-1].split(",")
            rows = [row for row in rows if row.get("domain") in wanted]
        if "offset" in params:
            start = int(params["offset"])
            rows = rows[start:start + int(params["limit"])]
        return httpx.Response(200, json=rows)

    def calls_for(self, table: str) -> list[dict]:
        return [params for name, params in self.calls if name == table]


@pytest.fixture
def postgrest(monkeypatch, supabase_enabled) -> FakePostgrest:
    fake = FakePostgrest()
    monkeypatch.setattr(httpx.AsyncClient, "get", fake.get)
    return fake


def make_request(path: str = "/page", method: str = "GET", headers: dict[str, str] | None = None) -> Request:
    raw_headers = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    return Request({"type": "http", "method": method, "path": path, "query_string": b"", "headers": raw_headers})


@pytest.fixture
def dns(monkeypatch):
    """Override DNS answers per host for one test: dns({"evil.example": ["169.254.169.254"]})."""

    def install(overrides: dict[str, list[str]]) -> None:
        monkeypatch.setattr(targets, "resolve_addresses", fake_dns(overrides))

    return install


@pytest.fixture
def internal_secret(monkeypatch) -> dict[str, str]:
    monkeypatch.setattr(config, "INTERNAL_AUTH_SECRET", INTERNAL_TEST_SECRET)
    return INTERNAL_HEADERS


@pytest.fixture
def passport_secret(monkeypatch) -> None:
    monkeypatch.setattr(passport, "PASSPORT_HMAC_SECRET", PASSPORT_TEST_SECRET)


def signed_passport_headers(agent_id: str, timestamp: str | None = None) -> dict[str, str]:
    """Headers of a valid passport; requires the passport_secret fixture."""
    issued_at = timestamp or str(time.time())
    return {
        "x-stealthmark-agent": agent_id,
        "x-stealthmark-signature": passport.sign_passport(agent_id, issued_at) or "",
        "x-stealthmark-timestamp": issued_at,
    }
