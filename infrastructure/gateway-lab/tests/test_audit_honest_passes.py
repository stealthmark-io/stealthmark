"""ARQ-02 / P1-0: a check whose probe did not run is never reported as a pass."""
import io
import json
import re
import urllib.error
import urllib.request

import httpx
import pytest
from fastapi.testclient import TestClient

from gateway.auditor.ai_surface import parse_ai_surface
from gateway.routes import audit_v2
from gateway.routes.scanner import Fetched
from tests.conftest import fake_web, web_response
from tests.test_audit_endpoint import FakeDNSResolver

IP = "93.184.216.34"


class InternetDbAnswer:
    def __init__(self, payload: dict):
        self.status = 200
        self._body = json.dumps(payload).encode()

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> bool:
        return False


def internetdb_answers(monkeypatch, payload: dict) -> None:
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout: InternetDbAnswer(payload))


def ports_check(monkeypatch):
    monkeypatch.setattr(audit_v2, "_dns_resolver_factory", lambda: FakeDNSResolver({("example.com", "A"): [IP]}))
    return next(c for c in audit_v2.query_dns("example.com") if c.id == "exposed_ports_and_cves")


def fetched(status: int = 200, headers: dict[str, str] | None = None, body: bytes = b"") -> Fetched:
    return Fetched(status_code=status, headers=httpx.Headers(headers or {}), body=body, truncated=False)


def by_id(checks):
    return {c.id: c for c in checks}


def test_internetdb_down_is_not_assessed(monkeypatch):
    check = ports_check(monkeypatch)
    assert check.status == "not_assessed"
    assert IP in check.detail


def test_internetdb_without_a_record_is_not_assessed(monkeypatch):
    def not_found(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, io.BytesIO(b'{"detail":"No information available"}'))

    monkeypatch.setattr(urllib.request, "urlopen", not_found)
    assert ports_check(monkeypatch).status == "not_assessed"


def test_internetdb_answer_without_exposure_is_a_measured_pass(monkeypatch):
    internetdb_answers(monkeypatch, {"ports": [80, 443], "vulns": []})
    assert ports_check(monkeypatch).status == "pass"


def test_cloudflare_edge_ip_is_not_blamed_for_shared_edge_cves(monkeypatch):
    def must_not_query(req, timeout):
        raise AssertionError("InternetDB must not be queried for a shared CDN edge address")

    monkeypatch.setattr(urllib.request, "urlopen", must_not_query)
    monkeypatch.setattr(
        audit_v2, "_dns_resolver_factory", lambda: FakeDNSResolver({("example.com", "A"): ["104.21.33.252"]})
    )
    check = next(c for c in audit_v2.query_dns("example.com") if c.id == "exposed_ports_and_cves")
    assert check.status == "not_assessed"
    assert "Cloudflare" in check.detail
    assert "CVE-" not in check.detail


def test_internetdb_cves_are_reported_as_listed_not_verified(monkeypatch):
    internetdb_answers(monkeypatch, {"ports": [443, 3389], "vulns": ["CVE-2024-6387"]})
    check = ports_check(monkeypatch)
    assert check.status == "fail"
    assert "3389/RDP" in check.detail
    assert "CVEs reported by InternetDB (CVE-2024-6387)" in check.detail
    assert "verified" not in check.detail.lower()


def test_dotenv_403_is_a_rejection_not_a_waf_claim():
    dotfile = by_id(audit_v2.parse_headers(fetched(body=b"<html></html>"), fetched(403, body=b"Forbidden")))["dotfile_edge_shield"]
    assert dotfile.status == "pass"
    assert "HTTP 403" in dotfile.detail
    assert "waf" not in dotfile.detail.lower()


def test_failed_dotenv_probe_is_not_assessed():
    dotfile = by_id(audit_v2.parse_headers(fetched(body=b"<html></html>"), None))["dotfile_edge_shield"]
    assert dotfile.status == "not_assessed"


@pytest.mark.parametrize(
    "headers,body",
    [
        ({}, b"<html><body>Plain site</body></html>"),
        ({"x-stealthmark-edge-shield": "1"}, b'<html><link href="/wp-content/themes/x.css"></html>'),
        ({"x-stealthmark-edge-shield": "1", "x-railway-request-id": "abc"}, b"<html></html>"),
    ],
)
def test_cms_and_paas_never_fabricate_a_pass(headers, body):
    checks = by_id(audit_v2.parse_headers(fetched(headers=headers, body=body)))
    assert checks["cms_ecommerce_surface"].status == "info"
    assert checks["paas_origin_and_ai_secret_shield"].status == "info"


def test_detected_cms_without_shield_is_still_a_warning():
    checks = by_id(audit_v2.parse_headers(fetched(body=b'<html><script src="/wp-includes/js/x.js"></script></html>')))
    assert checks["cms_ecommerce_surface"].status == "warn"


@pytest.mark.parametrize("headers", [{"x-nextjs-prerender": "1"}, {"server-timing": "render;dur=12"}])
def test_render_substring_in_other_headers_is_not_render(headers):
    paas = by_id(audit_v2.parse_headers(fetched(headers=headers, body=b"<html></html>")))["paas_origin_and_ai_secret_shield"]
    assert paas.status == "info"


@pytest.mark.parametrize("headers", [{"rndr-id": "37b63153-c70a-421e"}, {"x-render-origin-server": "Render"}])
def test_render_own_headers_are_detected(headers):
    paas = by_id(audit_v2.parse_headers(fetched(headers=headers, body=b"<html></html>")))["paas_origin_and_ai_secret_shield"]
    assert paas.status == "warn"
    assert "Render" in paas.detail


def test_paas_warning_does_not_promise_a_waf():
    paas = by_id(audit_v2.parse_headers(fetched(headers={"rndr-id": "37b63153-c70a-421e"}, body=b"<html></html>")))["paas_origin_and_ai_secret_shield"]
    assert paas.status == "warn"
    for text in (paas.detail, paas.recommendation):
        assert "waf" not in text.lower()
        assert "0ms" not in text
    assert "rndr-id" in paas.recommendation


@pytest.mark.parametrize(
    "home,dotenv,check_id",
    [
        (fetched(body=b"<html></html>"), fetched(200, body=b"DB_PASSWORD=hunter2\n"), "dotfile_edge_shield"),
        (fetched(body=b"<html></html>"), fetched(200, body=b"<html>app shell</html>"), "dotfile_edge_shield"),
        (fetched(headers={"x-powered-by": "PHP/7.4.3"}, body=b"<html></html>"), fetched(404), "dotfile_edge_shield"),
        (fetched(body=b'<html><script src="/wp-includes/js/x.js"></script></html>'), None, "cms_ecommerce_surface"),
    ],
)
def test_dotfile_and_cms_findings_do_not_promise_a_waf(home, dotenv, check_id):
    check = by_id(audit_v2.parse_headers(home, dotenv))[check_id]
    assert check.status in ("fail", "warn")
    for text in (check.title, check.detail, check.recommendation):
        assert not re.search(r"\b(?:waf|virtual patch|0ms|botnets?|rce)\b", text, re.IGNORECASE), text


def test_canary_fixture_is_info_not_an_exposed_env():
    body = (
        b"# Este dominio usa @stealthmark/next \xc2\xb7 https://stealthmark.io/scan?domain=example.com\n"
        b"NODE_ENV=production\n"
        b"HEALTHCHECK_URL=https://stealthmark.io/api/telemetry/canary?t=abc.def\n"
    )
    dotfile = by_id(audit_v2.parse_headers(fetched(body=b"<html></html>"), fetched(200, body=body)))["dotfile_edge_shield"]
    assert dotfile.status == "info"
    leaked = by_id(audit_v2.parse_headers(fetched(body=b"<html></html>"), fetched(200, body=b"NODE_ENV=production\nHEALTHCHECK_URL=https://stealthmark.io/api/telemetry/canary?t=x\n")))
    assert leaked["dotfile_edge_shield"].status == "fail"


def test_google_browser_key_is_info_not_a_leaked_secret():
    google_key = "AIzaSy" + "A" * 33
    home = fetched(body=f'<html><script>maps("{google_key}")</script></html>'.encode())
    assert by_id(parse_ai_surface(None, None, home))["client_bundle_exposure"].status == "info"


def test_secret_tokens_still_fail():
    stripe_key = "sk_live_" + "a" * 30
    home = fetched(body=f"<html><script>const k='{stripe_key}'</script></html>".encode())
    assert by_id(parse_ai_surface(None, None, home))["client_bundle_exposure"].status == "fail"


def test_report_counts_not_assessed_with_internetdb_down(client: TestClient, monkeypatch):
    monkeypatch.setattr(audit_v2, "_dns_resolver_factory", lambda: FakeDNSResolver({("example.com", "A"): [IP]}))
    fake_web(monkeypatch, lambda request: web_response(200, {}, b"<html><body>Hello</body></html>"))

    data = client.get("/api/v2/audit?domain=example.com").json()
    statuses = {c["id"]: c["status"] for section in data["sections"].values() for c in section}
    assert statuses["exposed_ports_and_cves"] == "not_assessed"
    assert statuses["cms_ecommerce_surface"] == "info"
    assert statuses["paas_origin_and_ai_secret_shield"] == "info"
    # A home page without JS bundles leaves the bundle, source map, non-production URL and Web Storage token checks unassessed too.
    assert statuses["js_bundle_secrets"] == statuses["source_map_exposure"] == statuses["nonprod_environment_leak_in_bundle"] == statuses["jwt_in_localstorage_without_csp"] == "not_assessed"
    # The TLS certificate was not read either (the socket is stubbed off in tests).
    assert statuses["tls_certificate_trust"] == "not_assessed"
    assert data["summary"]["counts"]["not_assessed"] == 6
    assert data["summary"]["by_section"]["dns"]["not_assessed"] == 1
    assert data["summary"]["by_section"]["transport"]["not_assessed"] == 1
