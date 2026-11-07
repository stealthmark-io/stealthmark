"""The unauthenticated scanner can only reach public addresses it validated itself, within strict size, time and rate limits."""
import asyncio

import httpx
import pytest

from gateway.routes import scanner
from tests.conftest import PUBLIC_TEST_ADDRESS, fake_dns, fake_web, web_response

SCAN_URL = "/api/v1/scanner/audit-url"
HTML = {"content-type": "text/html"}


def scan(client, target="https://example.com/"):
    return client.post(SCAN_URL, json={"target_url": target})


def page(status: int = 200, headers: dict[str, str] | None = None, content: bytes = b""):
    """A page that builds a fresh streaming response on every request, since a stream can be read only once."""
    return lambda: web_response(status, headers, content)


def site(pages: dict[str, object] | None = None, default_status: int = 404):
    """Handler serving `pages` by path; anything else answers default_status."""

    def handler(request: httpx.Request) -> httpx.Response:
        build = (pages or {}).get(request.url.path)
        return build() if build is not None else web_response(default_status, content=b"nope")

    return handler


def test_every_outbound_request_connects_to_the_validated_address_and_keeps_the_real_name(client, monkeypatch):
    sent = fake_web(monkeypatch, site({"/": page(200, HTML, b"<html>ok</html>")}))
    assert scan(client, "https://example.com/").status_code == 200
    assert [request.url.path for request in sent] == ["/", "/.well-known/agent.json", "/docs"]
    for request in sent:
        assert request.url.scheme == "https"
        assert request.url.host == PUBLIC_TEST_ADDRESS
        assert request.headers["host"] == "example.com"
        assert request.extensions["sni_hostname"] == "example.com"


def test_plain_http_targets_are_pinned_without_sni(client, monkeypatch):
    sent = fake_web(monkeypatch, site({"/": page(200, HTML, b"ok")}))
    assert scan(client, "http://example.com/").status_code == 200
    assert all(request.url.scheme == "http" and request.url.host == PUBLIC_TEST_ADDRESS for request in sent)
    assert all("sni_hostname" not in request.extensions for request in sent)


def test_a_hostname_that_turns_private_after_the_first_check_is_never_contacted(client, monkeypatch, dns):
    answers = iter([[PUBLIC_TEST_ADDRESS]])

    async def rebinding_resolver(host: str, port: int) -> list[str]:
        return next(answers, ["169.254.169.254"])

    monkeypatch.setattr(scanner.targets, "resolve_addresses", rebinding_resolver)
    sent = fake_web(monkeypatch, site({"/": page(200, HTML, b"ok")}))
    res = scan(client)
    assert res.status_code == 400
    assert res.json()["error"] == "Target Not Allowed"
    assert sent == []


def test_the_scanner_never_contacts_an_address_it_did_not_validate_for_that_hop(client, monkeypatch):
    validated: list[str] = []

    async def resolver(host: str, port: int) -> list[str]:
        validated.append(PUBLIC_TEST_ADDRESS)
        return [PUBLIC_TEST_ADDRESS]

    monkeypatch.setattr(scanner.targets, "resolve_addresses", resolver)
    sent = fake_web(monkeypatch, site({"/": page(200, HTML, b"ok")}))
    assert scan(client).status_code == 200
    assert {request.url.host for request in sent} == set(validated)


def test_redirect_to_a_private_address_is_refused_and_never_contacted(client, monkeypatch, dns):
    dns({"internal.example": ["10.0.0.5"]})
    sent = fake_web(monkeypatch, site({"/": page(302, {"location": "https://internal.example/secret"})}))
    res = scan(client)
    assert res.status_code == 400
    assert res.json()["error"] == "Target Not Allowed"
    assert all(request.url.host != "10.0.0.5" for request in sent)
    assert all(request.headers["host"] != "internal.example" for request in sent)


def test_redirect_to_a_cloud_metadata_address_is_refused_and_never_contacted(client, monkeypatch):
    sent = fake_web(monkeypatch, site({"/": page(301, {"location": "http://169.254.169.254/computeMetadata/v1/"})}))
    assert scan(client).status_code == 400
    assert all(request.url.host != "169.254.169.254" for request in sent)


def test_redirect_to_another_public_host_is_followed_and_pinned_again(client, monkeypatch, dns):
    dns({"www.example.com": ["151.101.1.1"], "example.com": [PUBLIC_TEST_ADDRESS]})

    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers["host"] == "example.com" and request.url.path == "/":
            return web_response(301, {"location": "https://www.example.com/home"})
        if request.url.path == "/home":
            return web_response(200, HTML, b"<html>home</html>")
        return web_response(404, content=b"nope")

    sent = fake_web(monkeypatch, handler)
    body = scan(client).json()
    assert body["metrics"]["http_status"] == 200
    hop = [request for request in sent if request.url.path == "/home"][0]
    assert hop.url.host == "151.101.1.1"
    assert hop.headers["host"] == "www.example.com"
    assert hop.extensions["sni_hostname"] == "www.example.com"


def test_redirect_chain_is_capped(client, monkeypatch):
    sent = fake_web(monkeypatch, site({"/": page(302, {"location": "/next"}), "/next": page(302, {"location": "/next"})}))
    body = scan(client).json()
    assert body["metrics"]["http_status"] == 302
    assert len([request for request in sent if request.url.path in ("/", "/next")]) == scanner.MAX_SCAN_REDIRECT_HOPS + 1


def test_redirect_to_a_non_default_port_is_not_followed(client, monkeypatch):
    sent = fake_web(monkeypatch, site({"/": page(302, {"location": "https://example.com:6379/"})}))
    assert scan(client).json()["metrics"]["http_status"] == 302
    assert all(request.url.port != 6379 for request in sent)


@pytest.mark.parametrize("target", ["https://example.com:6379/", "http://example.com:22", "example.com:8443", "https://example.com:notaport/"])
def test_the_scanner_only_reaches_default_web_ports(client, monkeypatch, target):
    sent = fake_web(monkeypatch, site())
    res = scan(client, target)
    assert res.status_code == 400
    assert res.json()["error"] == "Target Not Allowed"
    assert sent == []


def test_well_known_and_docs_are_probed_at_the_origin_root_not_appended_to_the_query(client, monkeypatch):
    sent = fake_web(monkeypatch, site({"/": page(200, HTML, b"ok")}))
    assert scan(client, "https://user:secret@example.com/app/page?stealthmark.io#frag").status_code == 200
    assert [request.url.raw_path for request in sent] == [b"/app/page?stealthmark.io", b"/.well-known/agent.json", b"/docs"]
    assert all(request.url.userinfo == b"" and "secret" not in str(request.url) for request in sent)


def test_requests_identify_the_scanner_and_ask_for_an_uncompressed_body(client, monkeypatch):
    sent = fake_web(monkeypatch, site({"/": page(200, HTML, b"ok")}))
    scan(client)
    assert sent
    for request in sent:
        assert request.headers["user-agent"].startswith("StealthMarkScanner/")
        assert request.headers["accept-encoding"] == "identity"
        assert "cookie" not in request.headers and "authorization" not in request.headers


def test_an_oversized_body_is_cut_off_and_reported_as_truncated(client, monkeypatch):
    monkeypatch.setattr(scanner, "MAX_SCAN_BODY_BYTES", 50_000)
    fake_web(monkeypatch, site({"/": page(200, HTML, b"x" * 400_000)}))
    metrics = scan(client).json()["metrics"]
    assert metrics["payload_kb"] == round(50_000 / 1024, 1)
    assert metrics["payload_truncated"] is True


def test_a_body_within_the_cap_is_not_flagged(client, monkeypatch):
    fake_web(monkeypatch, site({"/": page(200, HTML, b"x" * 1_000)}))
    metrics = scan(client).json()["metrics"]
    assert metrics["payload_truncated"] is False
    assert metrics["estimated_tokens_per_visit"] == 250


def test_a_hostile_deeply_nested_manifest_is_reported_as_missing_instead_of_crashing(client, monkeypatch):
    nested = b"[" * 200_000
    fake_web(monkeypatch, site({"/": page(200, HTML, b"ok"), "/.well-known/agent.json": page(200, {"content-type": "application/json"}, nested)}))
    res = scan(client)
    assert res.status_code == 200
    assert "MANIFEST" in {finding["tag"] for finding in res.json()["findings"]}


def test_a_manifest_that_is_not_an_object_does_not_count(client, monkeypatch):
    fake_web(monkeypatch, site({"/": page(200, HTML, b"ok"), "/.well-known/agent.json": page(200, {"content-type": "application/json"}, b"[1, 2]")}))
    assert "MANIFEST" in {finding["tag"] for finding in scan(client).json()["findings"]}


def test_a_connection_failure_is_reported_without_internal_details(client, monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connect to 10.1.2.3:5432 refused")

    fake_web(monkeypatch, handler)
    res = scan(client)
    assert res.status_code == 400
    assert res.json() == {"error": "Connection Failed", "detail": "Could not connect to target URL."}


def test_a_target_that_never_finishes_hits_the_scan_deadline_and_frees_its_slot(client, monkeypatch):
    monkeypatch.setattr(scanner, "SCAN_DEADLINE_SECONDS", 0.05)

    async def stalls(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(5)
        return web_response(200, HTML, b"late")

    fake_web(monkeypatch, stalls)
    res = scan(client)
    assert res.status_code == 504
    assert res.json()["error"] == "Scan Timed Out"
    assert not scanner._scan_slots.locked()

    fake_web(monkeypatch, site({"/": page(200, HTML, b"ok")}))
    assert scan(client).status_code == 200


def test_the_rate_limit_answers_before_any_dns_lookup(client, monkeypatch):
    fake_web(monkeypatch, site({"/": page(200, HTML, b"ok")}))
    for _ in range(scanner.SCANS_PER_IP_PER_MINUTE):
        assert scan(client).status_code == 200

    lookups: list[str] = []
    resolver = fake_dns({})

    async def counting_resolver(host: str, port: int) -> list[str]:
        lookups.append(host)
        return await resolver(host, port)

    monkeypatch.setattr(scanner.targets, "resolve_addresses", counting_resolver)
    res = scan(client, "https://another.example/")
    assert res.status_code == 429
    assert res.headers["retry-after"] == "60"
    assert lookups == []


def test_invalid_targets_also_spend_the_rate_budget(client, monkeypatch):
    fake_web(monkeypatch, site())
    for _ in range(scanner.SCANS_PER_IP_PER_MINUTE):
        assert scan(client, "http://localhost").status_code == 400
    assert scan(client, "http://localhost").status_code == 429


def test_busy_scanner_answers_503_instead_of_queueing(client, monkeypatch):
    monkeypatch.setattr(scanner, "_scan_slots", asyncio.Semaphore(0))
    fake_web(monkeypatch, site({"/": page(200, HTML, b"ok")}))
    res = scan(client)
    assert res.status_code == 503
    assert res.headers["retry-after"] == "5"


def test_the_gateway_manifest_states_the_scanner_limits_instead_of_calling_it_unrestricted(client):
    description = client.get("/.well-known/agent.json").json()["capabilities"]["audit_website_security"]["description"]
    assert f"up to {scanner.SCANS_PER_IP_PER_MINUTE} scans per minute" in description
    assert "ports 80 and 443" in description
    assert "unrestricted" not in description.lower()
