from unittest.mock import AsyncMock

import httpx
import pytest

from gateway import metering, state, targets

ORG_ID = "11111111-1111-1111-1111-111111111111"
SITE_ID = "22222222-2222-2222-2222-222222222222"
AGENT_HEADERS = {"host": "customer.com", "x-stealthmark-agent": "agent_x"}


def ok_response() -> httpx.Response:
    return httpx.Response(200, content=b"{}", headers={"content-type": "application/json"})


@pytest.fixture
def upstream(monkeypatch):
    mock = AsyncMock(return_value=ok_response())
    monkeypatch.setattr(state.http_client, "request", mock)
    return mock


@pytest.fixture
def sites(postgrest):
    postgrest.tables["registered_sites"] = [{"id": SITE_ID, "org_id": ORG_ID, "domain": "customer.com"}]
    postgrest.tables["organizations"] = [{"billing_mode": "free", "monthly_event_cap": 1000, "credit_balance_events": 0}]
    postgrest.tables["usage_records"] = []
    return postgrest


@pytest.mark.parametrize(
    "target",
    [
        "http://metadata.google.internal/computeMetadata/v1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://127.0.0.1:8080",
        "http://[::1]/",
        "http://10.0.0.5",
        "http://192.168.1.1",
        "http://localhost",
        "https://attacker.example",
    ],
)
def test_unlisted_and_internal_targets_are_rejected_before_any_upstream_call(client, upstream, sites, target):
    for res in (
        client.get("/", headers={"x-stealthmark-target": target}),
        client.get("/", params={"target": target}),
        client.get(f"/proxy/{target}/x"),
    ):
        assert res.status_code == 404
        assert res.json() == {"error": "not_found"}
    upstream.assert_not_awaited()


def test_unknown_host_has_no_default_upstream(client, upstream, sites):
    assert client.get("/anything").status_code == 404
    assert client.get("/anything", headers={"host": "www.democv.example.com.evil.example"}).status_code == 404
    upstream.assert_not_awaited()


@pytest.mark.parametrize(
    ("registered", "answers"),
    [
        ("rebind.example", ["169.254.169.254"]),
        ("rebind.example", ["93.184.216.34", "10.0.0.7"]),
        ("rebind.example", ["::1"]),
        ("rebind.example", ["::ffff:127.0.0.1"]),
        ("rebind.example", ["fd00::1"]),
        ("rebind.example", []),
        ("169.254.169.254", ["169.254.169.254"]),
        ("metadata.google.internal", ["93.184.216.34"]),
    ],
)
def test_registered_site_resolving_to_private_space_is_refused(client, upstream, sites, dns, registered, answers):
    sites.tables["registered_sites"] = [{"id": SITE_ID, "org_id": ORG_ID, "domain": registered}]
    dns({registered: answers})
    res = client.get("/x", headers={"x-stealthmark-target": f"https://{registered}"})
    assert res.status_code == 404
    upstream.assert_not_awaited()


@pytest.mark.parametrize(
    ("address", "allowed"),
    [
        ("93.184.216.34", True),
        ("2606:2800:220:1:248:1893:25c8:1946", True),
        ("127.0.0.1", False),
        ("10.1.2.3", False),
        ("172.16.0.1", False),
        ("172.31.255.255", False),
        ("192.168.0.1", False),
        ("169.254.169.254", False),
        ("100.64.0.1", False),
        ("0.0.0.0", False),
        ("224.0.0.1", False),
        ("::1", False),
        ("fc00::1", False),
        ("fe80::1", False),
        ("::ffff:10.0.0.1", False),
        ("64:ff9b::a00:1", False),
        ("not-an-ip", False),
    ],
)
def test_address_allowed_matches_public_ranges_only(address, allowed):
    assert targets.address_allowed(address) is allowed


def test_registered_site_is_proxied_over_a_pinned_public_address(client, upstream, sites):
    res = client.get("/catalog?page=2", headers=AGENT_HEADERS)
    assert res.status_code == 200
    kwargs = upstream.await_args.kwargs
    assert kwargs["url"] == "https://93.184.216.34:443/catalog?page=2"
    assert kwargs["headers"]["host"] == "customer.com"
    assert kwargs["extensions"] == {"sni_hostname": "customer.com"}
    assert kwargs["follow_redirects"] is False


def test_origin_cannot_set_cookies_on_the_shared_gateway_origin(client, upstream, sites):
    upstream.return_value = httpx.Response(
        200, content=b"{}", headers=[("content-type", "application/json"), ("set-cookie", "session=attacker; Path=/")]
    )
    res = client.get("/catalog", headers=AGENT_HEADERS)
    assert res.status_code == 200
    assert "set-cookie" not in res.headers


def test_inactive_sites_are_filtered_in_the_registry_query(client, upstream, sites):
    client.get("/catalog", headers=AGENT_HEADERS)
    assert sites.calls_for("registered_sites")[0]["status"] == "eq.active"


def test_unverified_sites_are_filtered_in_the_registry_query(client, upstream, sites):
    client.get("/catalog", headers=AGENT_HEADERS)
    assert sites.calls_for("registered_sites")[0]["dns_verified"] == "eq.true"


def test_operator_configured_upstream_is_allowed(client, upstream, monkeypatch):
    monkeypatch.setenv("UPSTREAM_PARTNER", "https://partner.example")
    res = client.get("/data", headers={"x-stealthmark-target": "https://partner.example"})
    assert res.status_code == 200
    assert upstream.await_args.kwargs["url"] == "https://93.184.216.34:443/data"
    assert upstream.await_args.kwargs["headers"]["host"] == "partner.example"


def test_product_prefixes_still_route_to_their_configured_upstreams(client, upstream):
    assert client.get("/democv/some/page").status_code == 200
    assert upstream.await_args.kwargs["headers"]["host"] == "www.democv.example.com"
    assert upstream.await_args.kwargs["url"] == "https://93.184.216.34:443/some/page"
    assert client.get("/demodental/pricing").status_code == 200
    assert upstream.await_args.kwargs["headers"]["host"] == "www.demodental.example.com"


def test_credentials_and_control_headers_are_not_forwarded(client, upstream, sites):
    client.get(
        "/catalog",
        headers={
            **AGENT_HEADERS,
            "authorization": "Bearer user-token",
            "cookie": "session=abc",
            "metadata-flavor": "Google",
            "x-internal-secret": "s3cr3t",
            "x-stealthmark-target": "https://customer.com",
            "x-stealthmark-signature": "sig",
            "x-forwarded-for": "6.6.6.6, 203.0.113.9",
            "accept": "text/html",
        },
    )
    forwarded = {name.lower(): value for name, value in upstream.await_args.kwargs["headers"].items()}
    for name in ("authorization", "cookie", "metadata-flavor", "x-internal-secret", "x-stealthmark-target", "x-stealthmark-signature", "x-stealthmark-agent"):
        assert name not in forwarded
    assert forwarded["accept"] == "text/html"
    assert forwarded["host"] == "customer.com"
    assert forwarded["x-forwarded-for"] == "203.0.113.9"
    assert forwarded["x-stealthmark-proxied"] == "true"


def test_upstream_errors_never_leak_internal_details(client, sites, monkeypatch):
    monkeypatch.setattr(state.http_client, "request", AsyncMock(side_effect=httpx.ConnectError("connect to 10.1.2.3:5432 refused")))
    res = client.get("/catalog", headers=AGENT_HEADERS)
    assert res.status_code == 502
    assert res.json() == {"error": "Bad Gateway", "shield": "StealthMark Reverse Proxy Guard"}
    assert "10.1.2.3" not in res.text


def test_already_proxied_requests_are_rejected_as_loops(client, upstream, sites):
    res = client.get("/catalog", headers={**AGENT_HEADERS, "x-stealthmark-proxied": "true"})
    assert res.status_code == 508
    upstream.assert_not_awaited()


def redirect(location: str, code: int = 302) -> httpx.Response:
    return httpx.Response(code, headers={"location": location})


def test_redirect_to_metadata_is_not_followed_and_is_returned_to_the_caller(client, sites, monkeypatch):
    mock = AsyncMock(return_value=redirect("http://169.254.169.254/computeMetadata/v1/"))
    monkeypatch.setattr(state.http_client, "request", mock)
    res = client.get("/go", headers=AGENT_HEADERS, follow_redirects=False)
    assert res.status_code == 302
    assert mock.await_count == 1


def test_redirect_to_another_allowed_host_is_followed_with_revalidation(client, sites, monkeypatch):
    sites.tables["registered_sites"] = [{"id": SITE_ID, "org_id": ORG_ID, "domain": "customer.com"}]
    mock = AsyncMock(side_effect=[redirect("https://www.customer.com/landing"), ok_response()])
    monkeypatch.setattr(state.http_client, "request", mock)
    res = client.get("/go", headers=AGENT_HEADERS)
    assert res.status_code == 200
    assert mock.await_count == 2
    assert mock.await_args.kwargs["url"] == "https://93.184.216.34:443/landing"
    assert mock.await_args.kwargs["headers"]["host"] == "www.customer.com"


def test_redirect_chain_is_capped_at_three_hops(client, sites, monkeypatch):
    mock = AsyncMock(side_effect=lambda **_: redirect("/again"))
    monkeypatch.setattr(state.http_client, "request", mock)
    res = client.get("/go", headers=AGENT_HEADERS, follow_redirects=False)
    assert res.status_code == 302
    assert mock.await_count == 4


def test_redirect_to_a_host_that_turns_private_is_not_followed(client, sites, dns, monkeypatch):
    sites.tables["registered_sites"] = [{"id": SITE_ID, "org_id": ORG_ID, "domain": "customer.com"}]
    dns({"www.customer.com": ["10.0.0.9"]})
    mock = AsyncMock(return_value=redirect("https://www.customer.com/x"))
    monkeypatch.setattr(state.http_client, "request", mock)
    assert client.get("/go", headers=AGENT_HEADERS, follow_redirects=False).status_code == 302
    assert mock.await_count == 1


def test_post_redirected_with_302_is_replayed_as_get_without_body(client, sites, monkeypatch):
    mock = AsyncMock(side_effect=[redirect("/done"), ok_response()])
    monkeypatch.setattr(state.http_client, "request", mock)
    assert client.post("/submit", content=b"payload", headers=AGENT_HEADERS).status_code == 200
    assert mock.await_args.kwargs["method"] == "GET"
    assert mock.await_args.kwargs["content"] == b""


@pytest.mark.parametrize("target", ["http://169.254.169.254/", "http://localhost:8080", "https://10.0.0.1/admin"])
def test_scanner_refuses_non_public_targets(client, target):
    res = client.post("/api/v1/scanner/audit-url", json={"target_url": target})
    assert res.status_code == 400
    assert res.json()["error"] == "Target Not Allowed"
