"""P1-4: stack fingerprint and EOL, CSP script quality, CORS probe (D-N1) and AI manifest hygiene."""
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from gateway.auditor.posture import (
    CORS_PROBE_ORIGIN,
    csp_script_weakness,
    parse_cors_policy,
    parse_manifest_hygiene,
    parse_tech_fingerprint,
)
from gateway.routes import audit_v2
from gateway.routes.scanner import Fetched
from tests.conftest import fake_web, web_response
from tests.test_audit_endpoint import FakeDNSResolver


def fetched(status: int = 200, headers: list[tuple[str, str]] | dict[str, str] | None = None, body: bytes = b"") -> Fetched:
    return Fetched(status_code=status, headers=httpx.Headers(headers or {}), body=body, truncated=False)


@pytest.mark.parametrize(
    "headers,body,status",
    [
        ({"x-powered-by": "PHP/8.1.27"}, b"", "warn"),
        ({"server": "Apache/2.4.57 (Debian) PHP/7.4.33"}, b"", "warn"),
        ({"x-powered-by": "PHP/8.2.10"}, b"", "warn"),
        ({"x-powered-by": "PHP/8.2.35"}, b"", "info"),
        ({}, b'<meta name="Generator" content="Drupal 7 (https://www.drupal.org)">', "warn"),
        ({}, b'<meta content="Drupal 10 (https://www.drupal.org)" name="generator">', "info"),
        ({}, b'<meta name="generator" content="WordPress 6.6.2">', "info"),
        ({"x-powered-by": "CakePHP/5.4.3"}, b"", "warn"),
        ({"x-powered-by": "CakePHP/5.4.4"}, b"", "info"),
        ({"server": "MuseBot/1.9.2"}, b"", "warn"),
        ({"server": "MuseBot/2.0.0"}, b"", "info"),
        ({"server": "vsftpd/3.0.5"}, b"", "warn"),
        ({"x-powered-by": "Magento/2.4.7"}, b"", "warn"),
        ({"x-powered-by": "Magento/2.4.8"}, b"", "info"),
        ({"server": "GitLab/18.5.1"}, b"", "warn"),
        ({"server": "GitLab/18.5.2"}, b"", "info"),
        ({"server": "Ivanti Connect Secure/22.7"}, b"", "warn"),
        ({"server": "Cisco Secure Firewall/9.20"}, b"", "warn"),
        ({"server": "GlobalProtect Portal/11.1"}, b"", "warn"),
    ],
)
def test_end_of_life_runtime_warns_and_never_claims_an_exploit(headers, body, status):
    check = parse_tech_fingerprint(fetched(headers=headers, body=body))
    assert check.status == status
    assert "rce" not in check.detail.lower() and "remote code" not in check.detail.lower()


def test_fingerprint_lists_platform_headers_and_session_cookies():
    home = fetched(headers=[
        ("server", "Vercel"),
        ("x-vercel-id", "iad1::abc"),
        ("cf-ray", "8a1b2c3d4e5f-EZE"),
        ("set-cookie", "PHPSESSID=abc; path=/; HttpOnly"),
        ("set-cookie", "laravel_session=xyz; expires=Thu, 01 Jan 2026 00:00:00 GMT"),
        ("set-cookie", "webvpn=12345; Secure; HttpOnly"),
    ])
    detail = parse_tech_fingerprint(home).detail
    for name in ("server: Vercel", "Vercel", "Cloudflare", "PHP", "Laravel", "Cisco Secure Firewall ASA/FTD"):
        assert name in detail


@pytest.mark.parametrize("res", [None, fetched(503)])
def test_fingerprint_without_a_home_page_is_not_assessed(res):
    assert parse_tech_fingerprint(res).status == "not_assessed"


@pytest.mark.parametrize(
    "csp,weak",
    [
        ("default-src 'self'", False),
        ("script-src 'self' 'unsafe-inline'", True),
        ("script-src 'self' 'unsafe-inline' 'nonce-r4nd0m'", False),
        ("script-src 'self' 'unsafe-inline' 'sha256-abc='", False),
        ("default-src *", True),
        ("frame-ancestors 'none'", True),
        ("default-src 'unsafe-inline'; script-src 'self'", False),
    ],
)
def test_csp_script_quality(csp, weak):
    assert (csp_script_weakness(csp) is not None) is weak
    check = {c.id: c for c in audit_v2.parse_headers(fetched(headers={"content-security-policy": csp}))}["content_security_policy"]
    assert check.status == ("warn" if weak else "pass")


@pytest.mark.parametrize(
    "headers,status",
    [
        ({"access-control-allow-origin": CORS_PROBE_ORIGIN, "access-control-allow-credentials": "true"}, "fail"),
        ({"access-control-allow-origin": "*", "access-control-allow-credentials": "true"}, "warn"),
        ({"access-control-allow-origin": "*"}, "info"),
        ({"access-control-allow-origin": CORS_PROBE_ORIGIN}, "info"),
        ({"access-control-allow-origin": "https://app.example.com", "access-control-allow-credentials": "true"}, "pass"),
        ({}, "pass"),
    ],
)
def test_cors_fails_only_on_a_reflected_origin_with_credentials(headers, status):
    check = parse_cors_policy(fetched(headers=headers))
    assert check.status == status
    assert "home page" in check.detail


@pytest.mark.parametrize("res", [None, fetched(502)])
def test_cors_probe_that_did_not_answer_is_not_assessed(res):
    assert parse_cors_policy(res).status == "not_assessed"


MANIFEST_PATHS = ("/llms.txt", "/.well-known/agent.json", "/.well-known/mcp.json", "/.well-known/ai-plugin.json")


def manifests(**published: Fetched) -> dict[str, Fetched | None]:
    by_name = {"llms": "/llms.txt", "agent": "/.well-known/agent.json", "mcp": "/.well-known/mcp.json", "plugin": "/.well-known/ai-plugin.json"}
    probes: dict[str, Fetched | None] = {path: fetched(404) for path in MANIFEST_PATHS}
    probes.update({by_name[name]: res for name, res in published.items()})
    return probes


def test_no_published_manifest_is_info_and_a_silent_probe_is_not_assessed():
    assert parse_manifest_hygiene(manifests()).status == "info"
    assert parse_manifest_hygiene(manifests(mcp=None)).status == "not_assessed"


def test_soft_200_html_is_not_a_manifest():
    page = fetched(headers={"content-type": "text/html"}, body=b"<!DOCTYPE html><html><body>Not found</body></html>")
    assert parse_manifest_hygiene(manifests(llms=page, mcp=page)).status == "info"


def test_manifest_hygiene_statuses():
    cached = {"cache-control": "public, max-age=3600"}
    assert parse_manifest_hygiene(manifests(mcp=fetched(headers=cached, body=b'{"name":"x"}'))).status == "pass"
    open_cors = fetched(headers={**cached, "access-control-allow-origin": "*"}, body=b"# Site\n")
    assert parse_manifest_hygiene(manifests(llms=open_cors)).status == "info"
    uncached = parse_manifest_hygiene(manifests(agent=fetched(body=b'{"name":"x"}')))
    assert uncached.status == "info" and "Cache-Control" in uncached.detail
    credentialed = fetched(headers={**cached, "access-control-allow-origin": "*", "access-control-allow-credentials": "true"}, body=b'{"a":1}')
    assert parse_manifest_hygiene(manifests(plugin=credentialed)).status == "warn"


def test_audit_sends_one_cors_probe_and_reports_posture(client: TestClient, monkeypatch, internal_secret):
    monkeypatch.setattr(audit_v2, "_dns_resolver_factory", lambda: FakeDNSResolver({("example.com", "A"): ["93.184.216.34"]}))

    def handler(request):
        if request.url.path == "/":
            origin = request.headers.get("origin")
            cors = {"access-control-allow-origin": origin, "access-control-allow-credentials": "true"} if origin else {}
            return web_response(200, {"content-type": "text/html", "x-powered-by": "PHP/8.0.30", **cors}, b"<html></html>")
        if request.url.path == "/.well-known/mcp.json":
            return web_response(200, {"content-type": "application/json", "cache-control": "max-age=600"}, b'{"name":"shop"}')
        return web_response(404, {}, b"Not Found")

    sent = fake_web(monkeypatch, handler)
    res = client.get("/api/v2/audit?domain=example.com", headers=internal_secret)
    assert res.status_code == 200
    sections = res.json()["sections"]
    headers = {c["id"]: c for c in sections["headers"]}
    ai_surface = {c["id"]: c for c in sections["ai_surface"]}
    assert headers["cors_policy"]["status"] == "fail"
    assert headers["tech_fingerprint"]["status"] == "warn"
    assert ai_surface["ai_manifest_hygiene"]["status"] == "pass"
    assert [r.headers.get("origin") for r in sent if r.headers.get("origin")] == [CORS_PROBE_ORIGIN]


def _cert(organization: str, common_name: str, expires_in_days: float = 60) -> dict:
    not_after = time.strftime("%b %d %H:%M:%S %Y GMT", time.gmtime(audit_v2._clock() + expires_in_days * 86400))
    return {
        "issuer": ((("countryName", "US"),), (("organizationName", organization),), (("commonName", common_name),)),
        "notAfter": not_after,
    }


def test_tls_certificate_emudhra_emsign_and_trust_states():
    unread = audit_v2.parse_tls_certificate(None)
    assert unread.id == "tls_certificate_trust"
    assert unread.status == "not_assessed"

    for organization, common_name in (("eMudhra Technologies Limited", "emSign SSL CA - G1"), ("Acme Trust", "EMSIGN ECC SSL CA - C3")):
        emsign = audit_v2.parse_tls_certificate(_cert(organization, common_name))
        assert emsign.status == "fail"
        assert "eight eMudhra intermediate CAs were revoked" in emsign.detail
        assert "2026.10.2" in emsign.recommendation
        assert "Let's Encrypt" in emsign.recommendation

    expiring = audit_v2.parse_tls_certificate(_cert("Let's Encrypt", "R11", expires_in_days=5))
    assert expiring.status == "warn"
    assert "less than 14 days" in expiring.detail

    trusted = audit_v2.parse_tls_certificate(_cert("Let's Encrypt", "R11"))
    assert trusted.status == "pass"
    assert "Let's Encrypt / R11" in trusted.detail


def test_tls_chain_rejected_by_the_trust_store_is_a_fail_not_unassessed():
    rejected = audit_v2.parse_tls_certificate({"verify_error": "unable to get local issuer certificate"})
    assert rejected.status == "fail"
    assert "unable to get local issuer certificate" in rejected.detail


@pytest.mark.parametrize(
    "domain,addresses",
    [
        ("metadata.google.internal", ["93.184.216.34"]),
        ("example.com", ["10.0.0.5"]),
        ("example.com", ["93.184.216.34", "127.0.0.1"]),
        ("example.com", []),
    ],
)
def test_tls_fetcher_never_connects_to_a_blocked_or_private_address(monkeypatch, domain, addresses):
    connections = []
    monkeypatch.setattr(audit_v2.socket, "getaddrinfo", lambda host, port, type=0: [(2, 1, 6, "", (a, port)) for a in addresses])
    monkeypatch.setattr(audit_v2.socket, "create_connection", lambda *args, **kwargs: connections.append(args))
    assert audit_v2._fetch_peer_cert(domain) is None
    assert connections == []
