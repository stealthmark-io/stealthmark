import time

import httpx
import pytest

from gateway import metering
from gateway.metering import Quota, QuotaCache, SiteResolver, UsageQueue, compute_quota
from tests.conftest import SUPABASE_TEST_KEY, SUPABASE_TEST_URL, make_request

ORG_ID = "11111111-1111-1111-1111-111111111111"
SITE_ID = "22222222-2222-2222-2222-222222222222"


def org_row(mode: str, cap: int = 100, balance: int = 0) -> dict:
    return {"billing_mode": mode, "monthly_event_cap": cap, "credit_balance_events": balance}


@pytest.mark.parametrize(
    ("mode", "cap", "balance", "used", "expected"),
    [
        ("free", 100, 0, 40, Quota("free", 100, 40, 60)),
        ("free", 100, 0, 250, Quota("free", 100, 250, 0)),
        ("credits", 100, 7, 999, Quota("credits", 7, 999, 7)),
        ("credits", 100, -3, 0, Quota("credits", 0, 0, 0)),
        ("enterprise", 100, 0, 5000, Quota("enterprise", None, 5000, None)),
        ("unexpected", 50, 0, 10, Quota("free", 50, 10, 40)),
    ],
)
def test_compute_quota_per_billing_mode(mode, cap, balance, used, expected):
    assert compute_quota(mode, cap, balance, used) == expected


def test_over_cap_only_when_remaining_is_zero():
    assert Quota("free", 10, 10, 0).over_cap
    assert not Quota("free", 10, 9, 1).over_cap
    assert not Quota("enterprise", None, 10**6, None).over_cap


@pytest.mark.parametrize(
    ("headers", "expected"),
    [
        ({"x-stealthmark-agent": "agent_autodev_001"}, "agent_autodev_001"),
        ({"accept": "application/agent+json", "user-agent": "Mozilla/5.0"}, "Mozilla/5.0"),
        ({"user-agent": "curl/8.4.0"}, None),
        ({"user-agent": "GPTBot/1.1"}, "GPTBot/1.1"),
        ({"user-agent": "Mozilla/5.0 (Macintosh) Safari/605.1.15"}, None),
        ({}, None),
    ],
)
def test_agent_identifier_detects_agents_and_ignores_humans(headers, expected):
    assert metering.agent_identifier(make_request(headers=headers)) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Customer.COM:8443", "customer.com"),
        ("https://www.customer.com/path?q=1", "www.customer.com"),
        ("customer.com.", "customer.com"),
        ("bad host,evil)", None),
        ("a.b)or(1=1", None),
        ("", None),
        (None, None),
    ],
)
def test_normalize_host(raw, expected):
    assert metering.normalize_host(raw) == expected


def test_event_type_for_manifest_paths():
    assert metering.event_type_for_path(".well-known/agent.json") == "agent_manifest"
    assert metering.event_type_for_path("/agent-manifest.json") == "agent_manifest"
    assert metering.event_type_for_path("products/1") == "agent_request"


async def test_quota_cache_free_sums_usage_across_pages(postgrest):
    postgrest.tables["organizations"] = [org_row("free", cap=5000)]
    postgrest.tables["usage_records"] = [{"units": 1}] * 1500
    quota = await QuotaCache().get(ORG_ID)
    assert quota == Quota("free", 5000, 1500, 3500)
    usage_calls = postgrest.calls_for("usage_records")
    assert [c["offset"] for c in usage_calls] == ["0", "1000"]
    assert usage_calls[0]["org_id"] == f"eq.{ORG_ID}"
    assert usage_calls[0]["period_month"] == f"eq.{metering.current_period_month()}"
    assert postgrest.calls_for("organizations")[0]["select"] == "billing_mode,monthly_event_cap,credit_balance_events"


async def test_quota_cache_free_stops_paging_once_cap_is_reached(postgrest):
    postgrest.tables["organizations"] = [org_row("free", cap=1000)]
    postgrest.tables["usage_records"] = [{"units": 1}] * 5000
    quota = await QuotaCache().get(ORG_ID)
    assert quota.remaining == 0
    assert len(postgrest.calls_for("usage_records")) == 1


async def test_quota_cache_credits_uses_balance_without_reading_usage(postgrest):
    postgrest.tables["organizations"] = [org_row("credits", cap=100, balance=42)]
    quota = await QuotaCache().get(ORG_ID)
    assert quota == Quota("credits", 42, 0, 42)
    assert postgrest.calls_for("usage_records") == []


async def test_quota_cache_enterprise_has_no_cap(postgrest):
    postgrest.tables["organizations"] = [org_row("enterprise", cap=100)]
    quota = await QuotaCache().get(ORG_ID)
    assert quota == Quota("enterprise", None, 0, None)
    assert not quota.over_cap


async def test_quota_cache_reuses_snapshot_and_tracks_queued_events(postgrest):
    postgrest.tables["organizations"] = [org_row("free", cap=10)]
    postgrest.tables["usage_records"] = [{"units": 8}]
    cache = QuotaCache()
    await cache.get(ORG_ID)
    cache.note_events(ORG_ID, 1)
    quota = await cache.get(ORG_ID)
    assert quota.used == 9 and quota.remaining == 1
    assert len(postgrest.calls_for("organizations")) == 1
    cache.note_events(ORG_ID, 5)
    assert (await cache.get(ORG_ID)).remaining == 0


async def test_enforce_quota_returns_429_when_free_org_is_over_cap(postgrest):
    postgrest.tables["organizations"] = [org_row("free", cap=100)]
    postgrest.tables["usage_records"] = [{"units": 100}]
    response = await metering.enforce_quota(ORG_ID)
    assert response is not None
    assert response.status_code == 429
    assert response.body == b'{"error":"quota_exceeded","retry_after_seconds":300}'
    assert response.headers["retry-after"] == "300"


async def test_enforce_quota_returns_429_when_credits_are_exhausted(postgrest):
    postgrest.tables["organizations"] = [org_row("credits", balance=0)]
    response = await metering.enforce_quota(ORG_ID)
    assert response is not None and response.status_code == 429


async def test_enforce_quota_allows_enterprise_org_regardless_of_cap(postgrest):
    postgrest.tables["organizations"] = [org_row("enterprise", cap=1)]
    assert await metering.enforce_quota(ORG_ID) is None


async def test_enforce_quota_allows_free_org_under_cap(postgrest):
    postgrest.tables["organizations"] = [org_row("free", cap=100)]
    postgrest.tables["usage_records"] = [{"units": 99}]
    assert await metering.enforce_quota(ORG_ID) is None


async def test_enforce_quota_fails_open_when_lookup_errors(postgrest):
    postgrest.status_by_table["organizations"] = 500
    assert await metering.enforce_quota(ORG_ID) is None


async def test_site_resolver_caches_hits_and_misses(postgrest):
    postgrest.tables["registered_sites"] = [{"id": SITE_ID, "org_id": ORG_ID, "domain": "customer.com"}]
    resolver = SiteResolver()
    site = await resolver.resolve("Customer.com:443")
    assert site is not None and (site.id, site.org_id) == (SITE_ID, ORG_ID)
    assert await resolver.resolve("customer.com") == site
    assert len(postgrest.calls_for("registered_sites")) == 1
    assert postgrest.calls_for("registered_sites")[0]["domain"] == "in.(customer.com,www.customer.com)"
    postgrest.tables["registered_sites"] = []
    assert await resolver.resolve("unknown.example") is None
    assert await resolver.resolve("unknown.example") is None
    assert len(postgrest.calls_for("registered_sites")) == 2


async def test_site_resolver_falls_back_to_second_host_and_skips_invalid_hosts(postgrest):
    postgrest.tables["registered_sites"] = [{"id": SITE_ID, "org_id": ORG_ID, "domain": "origin.com"}]
    resolver = SiteResolver()
    assert await resolver.resolve("bad host)", "origin.com") is not None
    assert [c["domain"] for c in postgrest.calls_for("registered_sites")] == ["in.(origin.com,www.origin.com)"]


async def test_site_resolver_ignores_sites_without_org(postgrest):
    postgrest.tables["registered_sites"] = [{"id": SITE_ID, "org_id": None, "domain": "orphan.com"}]
    assert await SiteResolver().resolve("orphan.com") is None


async def test_site_resolver_is_disabled_without_supabase_credentials():
    assert await SiteResolver().resolve("customer.com") is None


class RecordedPosts:
    def __init__(self, status_code: int = 201):
        self.status_code = status_code
        self.calls: list[tuple[str, dict, list[dict]]] = []

    async def post(self, url, **kwargs):
        self.calls.append((url, kwargs["headers"], kwargs["json"]))
        return httpx.Response(self.status_code)


def queued_row(index: int = 0) -> dict:
    return {"org_id": ORG_ID, "site_id": SITE_ID, "event_type": "agent_request", "units": 1, "n": index}


async def test_usage_queue_flushes_in_batches_with_postgrest_payload(supabase_enabled, monkeypatch):
    posts = RecordedPosts()
    monkeypatch.setattr(httpx.AsyncClient, "post", posts.post)
    queue = UsageQueue(max_batch=500)
    for index in range(1200):
        assert queue.enqueue(queued_row(index))
    assert [await queue.flush_once() for _ in range(4)] == [500, 500, 200, 0]
    assert [len(rows) for _, _, rows in posts.calls] == [500, 500, 200]
    url, headers, rows = posts.calls[0]
    assert url == f"{SUPABASE_TEST_URL}/rest/v1/usage_records"
    assert headers["apikey"] == SUPABASE_TEST_KEY
    assert headers["Authorization"] == f"Bearer {SUPABASE_TEST_KEY}"
    assert headers["Prefer"] == "return=minimal"
    assert rows[0]["n"] == 0 and rows[-1]["n"] == 499
    assert queue.flushed == 1200 and queue.pending() == 0


async def test_usage_queue_retries_failed_batch_then_drops_after_max_attempts(supabase_enabled, monkeypatch):
    posts = RecordedPosts(status_code=500)
    monkeypatch.setattr(httpx.AsyncClient, "post", posts.post)
    queue = UsageQueue(max_attempts=3)
    queue.enqueue(queued_row())
    assert await queue.flush_once() == 0 and queue.pending() == 1
    assert await queue.flush_once() == 0 and queue.pending() == 1
    assert await queue.flush_once() == 0 and queue.pending() == 0
    assert len(posts.calls) == 3
    assert queue.dropped == 1 and queue.flushed == 0


async def test_usage_queue_recovers_after_transient_failure(supabase_enabled, monkeypatch):
    posts = RecordedPosts(status_code=503)
    monkeypatch.setattr(httpx.AsyncClient, "post", posts.post)
    queue = UsageQueue()
    queue.enqueue(queued_row())
    assert await queue.flush_once() == 0
    posts.status_code = 201
    assert await queue.flush_once() == 1
    assert queue.dropped == 0 and queue.flushed == 1


def test_usage_queue_drops_events_when_full():
    queue = UsageQueue(max_size=2)
    assert [queue.enqueue(queued_row(i)) for i in range(3)] == [True, True, False]
    assert queue.dropped == 1


async def test_usage_queue_stop_drains_pending_events(supabase_enabled, monkeypatch):
    posts = RecordedPosts()
    monkeypatch.setattr(httpx.AsyncClient, "post", posts.post)
    queue = UsageQueue(flush_interval=3600)
    queue.start()
    for index in range(3):
        queue.enqueue(queued_row(index))
    await queue.stop()
    assert queue.flushed == 3 and queue.pending() == 0


def test_record_event_builds_gateway_ledger_row():
    site = metering.Site(id=SITE_ID, org_id=ORG_ID, domain="customer.com")
    request = make_request("/products/1", headers={"host": "customer.com"})
    assert metering.record_event(site, request, "agent_x", "agent_request", 200, 12.7)
    row = metering.usage_queue.queue.get_nowait()
    assert row["org_id"] == ORG_ID and row["site_id"] == SITE_ID
    assert row["event_type"] == "agent_request" and row["units"] == 1
    assert row["source"] == "gateway" and row["agent_identifier"] == "agent_x"
    assert row["latency_ms"] == 12 and row["success"] is True
    assert row["metadata"] == {"host": "customer.com", "path": "/products/1", "method": "GET", "status": 200}
    assert "period_month" not in row


def test_record_event_for_agent_blocked_has_zero_units_and_leaves_local_quota_untouched():
    site = metering.Site(id=SITE_ID, org_id=ORG_ID, domain="customer.com")
    metering.quotas._entries[ORG_ID] = (time.monotonic() + 60, metering.Quota("free", 10, 4, 6))
    request = make_request("/x", headers={"host": "customer.com"})
    assert metering.record_event(site, request, "agent_x", metering.EVENT_BLOCKED, 422, 1.0)
    assert metering.usage_queue.queue.get_nowait()["units"] == 0
    quota = metering.quotas._entries[ORG_ID][1]
    assert quota.used == 4 and quota.remaining == 6
    assert metering.record_event(site, request, "agent_x", metering.EVENT_REQUEST, 200, 1.0)
    assert quota.used == 5 and quota.remaining == 5


def test_units_for_only_blocked_is_free():
    assert [metering.units_for(t) for t in (metering.EVENT_BLOCKED, metering.EVENT_REQUEST, metering.EVENT_MANIFEST)] == [0, 1, 1]


@pytest.mark.parametrize("path,query,headers,expected", [
    ("/x", b"", {"x-stealthmark-target": "https://Customer.com/base"}, "customer.com"),
    ("/x", b"target=https://other.io", {}, "other.io"),
    ("/proxy/https://third.dev/page", b"", {}, "third.dev"),
    ("/x", b"", {}, None),
])
def test_target_host_reads_header_query_and_proxy_prefix(path, query, headers, expected):
    request = make_request(path, headers=headers)
    request.scope["query_string"] = query
    assert metering.target_host(request) == expected


@pytest.mark.asyncio
async def test_record_blocked_is_idempotent_and_skips_humans(postgrest):
    postgrest.tables["registered_sites"] = [{"id": SITE_ID, "org_id": ORG_ID, "domain": "customer.com"}]
    agent = make_request("/x", headers={"host": "customer.com", "x-stealthmark-agent": "agent_x"})
    assert await metering.record_blocked(agent, 403) is True
    assert await metering.record_blocked(agent, 403) is False
    human = make_request("/x", headers={"host": "customer.com", "user-agent": "Mozilla/5.0"})
    assert await metering.record_blocked(human, 403) is False
    assert metering.usage_queue.queue.qsize() == 1


@pytest.mark.asyncio
async def test_record_blocked_does_not_check_quota_and_never_raises(postgrest, monkeypatch):
    postgrest.tables["registered_sites"] = [{"id": SITE_ID, "org_id": ORG_ID, "domain": "customer.com"}]
    postgrest.tables["organizations"] = [{"billing_mode": "free", "monthly_event_cap": 1, "credit_balance_events": 0}]
    postgrest.tables["usage_records"] = [{"units": 50}]
    agent = make_request("/x", headers={"host": "customer.com", "x-stealthmark-agent": "agent_x"})
    assert await metering.record_blocked(agent, 413) is True
    assert postgrest.calls_for("organizations") == []

    async def boom(*hosts):
        raise RuntimeError("lookup exploded")

    monkeypatch.setattr(metering.sites, "resolve", boom)
    other = make_request("/y", headers={"host": "customer.com", "x-stealthmark-agent": "agent_x"})
    assert await metering.record_blocked(other, 413) is False
