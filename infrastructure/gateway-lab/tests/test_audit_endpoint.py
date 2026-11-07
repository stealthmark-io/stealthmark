"""Hermetic tests for GET /api/v2/audit (Passive Web & AI-Surface Readiness Auditor)."""
import asyncio
from unittest.mock import MagicMock
import pytest
from fastapi.testclient import TestClient

from gateway.routes import audit_v2, scanner
from tests.conftest import web_response, fake_web


class MockDNSData:
    def __init__(self, text: str):
        self._text = text
        self.strings = [text.encode("utf-8")]

    def __str__(self):
        return self._text


class FakeDNSResolver:
    def __init__(self, records: dict[tuple[str, str], list[str]] = None):
        self.records = records or {}
        self.timeout = 3.0
        self.lifetime = 3.0

    def resolve(self, qname: str, rdtype: str):
        key = (str(qname).rstrip("."), str(rdtype).upper())
        if key in self.records:
            return [MockDNSData(val) for val in self.records[key]]
        raise Exception("NoAnswer")


@pytest.fixture
def mock_dns(monkeypatch):
    default_records = {
        ("example.com", "A"): ["93.184.216.34"],
        ("example.com", "AAAA"): ["2606:2800:220:1:248:1893:25c8:1946"],
        ("example.com", "CAA"): ['0 issue "letsencrypt.org"'],
        ("example.com", "TXT"): ["v=spf1 include:_spf.google.com ~all"],
        ("_dmarc.example.com", "TXT"): ["v=DMARC1; p=reject; rua=mailto:dmarc@example.com"],
    }
    resolver = FakeDNSResolver(default_records)
    monkeypatch.setattr(audit_v2, "_dns_resolver_factory", lambda: resolver)
    return resolver


def test_missing_domain_returns_400(client: TestClient):
    response = client.get("/api/v2/audit")
    assert response.status_code == 400
    assert response.json()["error"] == "Missing Domain"


@pytest.mark.parametrize("invalid", [
    "",
    "   ",
    "127.0.0.1",
    "169.254.169.254",
    "::1",
    "invalid_domain",
    "bad domain .com",
])
def test_invalid_domain_or_ip_literal_returns_400(client: TestClient, invalid: str):
    response = client.get(f"/api/v2/audit?domain={invalid}")
    assert response.status_code == 400
    assert response.json()["error"] in ("Missing Domain", "Invalid Domain")


@pytest.mark.parametrize("blocked", [
    "metadata.google.internal",
    "metadata.google.internal.",
    "localhost",
    "localhost.",
    "service.internal",
    "printer.local",
])
def test_blocked_hosts_return_400(client: TestClient, blocked: str):
    response = client.get(f"/api/v2/audit?domain={blocked}")
    assert response.status_code == 400
    assert response.json()["error"] in ("Target Not Allowed", "Invalid Domain")


def test_non_public_domain_returns_400(client: TestClient, dns):
    dns({"private.example.com": ["10.0.0.1"]})
    response = client.get("/api/v2/audit?domain=private.example.com")
    assert response.status_code == 400
    assert response.json()["error"] == "Target Domain Not Allowed"


def test_rate_limit_returns_429(client: TestClient, monkeypatch):
    monkeypatch.setattr(audit_v2, "AUDITS_PER_IP_PER_MINUTE", 2)
    audit_v2._audit_counts.clear()

    # Call 1 & 2 succeed or return 400 (if non-public), but consume quota
    client.get("/api/v2/audit?domain=bad1")
    client.get("/api/v2/audit?domain=bad2")

    res = client.get("/api/v2/audit?domain=bad3")
    assert res.status_code == 429
    assert res.headers.get("retry-after") == "60"
    assert res.json()["error"] == "Too Many Requests"


def test_audit_successful_clean_site(client: TestClient, monkeypatch, mock_dns):
    """Verifies complete pass on a properly configured site, with state counts and NO score."""
    def handler(request):
        url = str(request.url)
        headers = {
            "content-security-policy": "default-src 'self'",
            "x-content-type-options": "nosniff",
            "referrer-policy": "strict-origin-when-cross-origin",
            "x-frame-options": "DENY",
            "strict-transport-security": "max-age=31536000; includeSubDomains",
        }
        if "robots.txt" in url:
            body = (
                "User-agent: *\nDisallow: /admin\n"
                "User-agent: GPTBot\nAllow: /\n"
                "User-agent: ClaudeBot\nAllow: /\n"
                "Sitemap: https://example.com/sitemap.xml\n"
            ).encode("utf-8")
            return web_response(200, {"content-type": "text/plain"}, body)
        elif "llms.txt" in url:
            body = b"# Example Site\nThis is the llms.txt context document."
            return web_response(200, {"content-type": "text/markdown"}, body)
        elif ".well-known/agent.json" in url:
            body = b'{"name": "Example", "version": "1.0", "capabilities": [{"id": "search"}]}'
            return web_response(200, {"content-type": "application/json"}, body)
        elif url.startswith("http://"):
            return web_response(301, {"location": "https://example.com/"}, b"")
        else:
            # HTTPS home
            body = b'<!DOCTYPE html><html><head><script type="application/ld+json">{"@context":"https://schema.org"}</script></head><body>Hello</body></html>'
            return web_response(200, headers, body)

    fake_web(monkeypatch, handler)

    res = client.get("/api/v2/audit?domain=https://example.com/test")
    assert res.status_code == 200
    data = res.json()

    assert data["domain"] == "example.com"
    assert "audited_at" in data

    # Decision (a): Counts only, NO score
    assert "score" not in data
    assert "agentic_score" not in data
    summary = data["summary"]
    counts = summary["counts"]
    assert counts["pass"] >= 10
    assert counts["fail"] == 0
    assert "warn" in counts
    assert "info" in counts
    assert "error" in counts

    # By section breakdown
    by_section = summary["by_section"]
    for expected_sec in ["transport", "dns", "crawl_policy", "ai_surface", "headers"]:
        assert expected_sec in by_section
        assert "pass" in by_section[expected_sec]

    # Section findings
    sections = data["sections"]
    for expected_sec in ["transport", "dns", "crawl_policy", "ai_surface", "headers"]:
        assert expected_sec in sections
        assert len(sections[expected_sec]) > 0

    # Limitations banner
    assert len(data["limitations"]) >= 2
    assert any("score" in lim.lower() for lim in data["limitations"])


def test_audit_missing_features_yields_warnings(client: TestClient, monkeypatch, internal_secret):
    """Verifies warnings when robots.txt, agent.json, and security headers are absent."""
    # Empty DNS records
    resolver = FakeDNSResolver({("example.com", "A"): ["93.184.216.34"]})
    monkeypatch.setattr(audit_v2, "_dns_resolver_factory", lambda: resolver)

    def handler(request):
        url = str(request.url)
        if url.startswith("http://"):
            return web_response(200, {}, b"Plain HTTP without redirect")
        if any(path in url for path in ["robots.txt", "llms.txt", ".well-known/agent.json"]):
            return web_response(404, {}, b"Not Found")
        # Bare HTTPS home without security headers or json-ld
        return web_response(200, {}, b"<html><body>Hello</body></html>")

    fake_web(monkeypatch, handler)

    res = client.get("/api/v2/audit?domain=example.com", headers=internal_secret)
    assert res.status_code == 200
    data = res.json()

    counts = data["summary"]["counts"]
    assert counts["warn"] >= 3  # robots missing, agent.json missing, csp missing, hsts missing...
    assert counts["pass"] >= 1

    # Check specific items
    ai_surface = {item["id"]: item for item in data["sections"]["ai_surface"]}
    assert ai_surface["agent_json"]["status"] == "warn"
    assert ai_surface["llms_txt"]["status"] == "info"

    headers_sec = {item["id"]: item for item in data["sections"]["headers"]}
    assert headers_sec["content_security_policy"]["status"] == "warn"
    assert headers_sec["content_type_options"]["status"] == "warn"


def test_audit_without_the_internal_secret_locks_every_issue(client: TestClient, monkeypatch, internal_secret):
    """Direct callers of the gateway see statuses and counts; the content of each issue is sold at stealthmark.io/scan."""
    monkeypatch.setattr(audit_v2, "_dns_resolver_factory", lambda: FakeDNSResolver({("example.com", "A"): ["93.184.216.34"]}))

    def handler(request):
        if any(path in str(request.url) for path in ["robots.txt", "llms.txt", ".well-known/agent.json"]):
            return web_response(404, {}, b"Not Found")
        return web_response(200, {}, b"<html><body>Hello</body></html>")

    fake_web(monkeypatch, handler)
    full = client.get("/api/v2/audit?domain=example.com", headers=internal_secret).json()
    unlock = "Unlock this finding at https://stealthmark.io/scan?domain=example.com"

    for headers in [{}, {"x-internal-secret": "wrong-secret"}, {"x-internal-secret": "é".encode()}]:
        public = client.get("/api/v2/audit?domain=example.com", headers=headers).json()
        assert public["summary"] == full["summary"]
        assert public["limitations"] == full["limitations"]
        issues = 0
        for section, items in full["sections"].items():
            assert len(public["sections"][section]) == len(items)
            for idx, (item, shown) in enumerate(zip(items, public["sections"][section])):
                if item["status"] in ("warn", "fail", "error"):
                    issues += 1
                    assert shown == {
                        "id": f"locked_{section}_{idx}",
                        "status": item["status"],
                        "locked": True,
                        "title": "Locked finding",
                        "detail": unlock,
                    }
                else:
                    assert shown == item
        assert issues >= 3


def test_audit_dns_failure_does_not_crash(client: TestClient, monkeypatch, internal_secret):
    """If DNS resolution throws, the endpoint returns 200 with fail/error checks rather than crashing."""
    class FailingResolver:
        def __init__(self):
            self.timeout = 1.0
            self.lifetime = 1.0

        def resolve(self, *args, **kwargs):
            raise Exception("Nameserver failed")

    monkeypatch.setattr(audit_v2, "_dns_resolver_factory", lambda: FailingResolver())

    def handler(request):
        return web_response(200, {}, b"<html></html>")

    fake_web(monkeypatch, handler)

    res = client.get("/api/v2/audit?domain=example.com", headers=internal_secret)
    assert res.status_code == 200
    data = res.json()
    dns_sec = {item["id"]: item for item in data["sections"]["dns"]}
    assert dns_sec["dns_records"]["status"] == "fail"


def test_audit_http_probes_run_concurrently(client: TestClient, monkeypatch, mock_dns):
    """The independent GETs overlap instead of running one after another."""
    in_flight = 0
    peak = 0

    async def handler(request):
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        await asyncio.sleep(0.05)
        in_flight -= 1
        return web_response(404, {}, b"Not Found")

    sent = fake_web(monkeypatch, handler)

    res = client.get("/api/v2/audit?domain=example.com")
    assert res.status_code == 200
    assert len(sent) >= 8
    assert peak >= 4


def test_read_capped_honours_a_per_probe_byte_cap():
    fetched = asyncio.run(scanner.read_capped(web_response(200, {}, b"A=1\n" * 10_000), max_bytes=audit_v2.DOTFILE_MAX_BYTES))
    assert len(fetched.body) == audit_v2.DOTFILE_MAX_BYTES
    assert fetched.truncated is True


def test_dotenv_probe_is_read_with_the_dotfile_cap(client: TestClient, monkeypatch, mock_dns):
    caps: dict[tuple[str, str | None], int | None] = {}
    real_fetch_pinned = audit_v2.fetch_pinned

    async def recording_fetch_pinned(client, url, headers, follow_redirects=True, max_bytes=None):
        caps[(url, headers.get("Origin"))] = max_bytes
        return await real_fetch_pinned(client, url, headers, follow_redirects=follow_redirects, max_bytes=max_bytes)

    monkeypatch.setattr(audit_v2, "fetch_pinned", recording_fetch_pinned)
    fake_web(monkeypatch, lambda request: web_response(404, {}, b""))

    assert client.get("/api/v2/audit?domain=example.com").status_code == 200
    assert caps[("https://example.com/.env", None)] == audit_v2.DOTFILE_MAX_BYTES
    assert caps[("https://example.com/", None)] is None
    # The D-N1 CORS probe only needs the response headers.
    assert caps[("https://example.com/", audit_v2.CORS_PROBE_ORIGIN)] == audit_v2.DOTFILE_MAX_BYTES
