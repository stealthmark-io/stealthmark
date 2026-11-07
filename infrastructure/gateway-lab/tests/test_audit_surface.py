"""Checks #25-#28: cache poisoning, exceptional-condition stack leaks, supply-chain manifests and session cookies.

Each check reports only what the probe response proves: a soft-200 HTML page is not an exposure, and a probe
that did not answer is not_assessed, never a pass.
"""
import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from gateway.auditor.exposure import parse_stack_leak, parse_supply_chain_manifest_exposure
from gateway.auditor.posture import CACHE_PROBE_HOST, parse_cache_poisoning, parse_session_hardening
from gateway.routes import audit_v2
from gateway.routes.scanner import Fetched
from tests.conftest import fake_web, web_response
from tests.test_audit_endpoint import FakeDNSResolver

# Catch-all pages that answer HTTP 200 for any path on common hosts.
SOFT_200_PAGES = {
    "next": b'<!DOCTYPE html><html lang="en"><head><script src="/_next/static/chunks/main.js"></script></head><body><div id="__next"></div></body></html>',
    "vercel": b"<!DOCTYPE html><html><head><title>404: NOT_FOUND</title></head><body>The page could not be found</body></html>",
    "cloudflare": b"<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>",
    "wordpress": b'<!DOCTYPE html><html><head><link rel="stylesheet" href="/wp-content/themes/x/style.css"></head><body class="error404">Page not found</body></html>',
}


def fetched(status: int = 200, headers: list[tuple[str, str]] | dict[str, str] | None = None, body: bytes = b"", truncated: bool = False) -> Fetched:
    return Fetched(status_code=status, headers=httpx.Headers(headers or {}), body=body, truncated=truncated)


# ---------------------------------------------------------------------------
# #25 unkeyed_header_cache_poisoning
# ---------------------------------------------------------------------------

def test_cache_poisoning_fail_when_reflected_and_cacheable_without_vary():
    res = fetched(
        200,
        {"cache-control": "public, max-age=3600", "cf-cache-status": "HIT"},
        f'<link rel="canonical" href="https://{CACHE_PROBE_HOST}/">'.encode(),
    )
    check = parse_cache_poisoning(res)
    assert check.status == "fail"
    assert check.id == "unkeyed_header_cache_poisoning"
    assert CACHE_PROBE_HOST in check.detail
    assert "Vary" in check.recommendation


def test_cache_poisoning_fail_when_reflected_in_location():
    res = fetched(302, {"location": f"https://{CACHE_PROBE_HOST}/next", "x-cache": "Hit from cloudfront"}, b"")
    assert parse_cache_poisoning(res).status == "fail"


def test_cache_poisoning_reflected_but_vary_covers_it_is_only_a_warning():
    res = fetched(
        200,
        {"cache-control": "public, max-age=3600", "age": "10", "vary": "Accept-Encoding, X-Forwarded-Host"},
        f"host={CACHE_PROBE_HOST}".encode(),
    )
    check = parse_cache_poisoning(res)
    assert check.status == "warn"
    assert "Vary already includes" in check.detail


def test_cache_poisoning_reflected_without_cache_signal_is_only_a_warning():
    res = fetched(200, {"cache-control": "private, no-store"}, f"host={CACHE_PROBE_HOST}".encode())
    check = parse_cache_poisoning(res)
    assert check.status == "warn"
    assert "no shared-cache header" in check.detail


def test_cache_poisoning_not_reflected_is_pass():
    res = fetched(200, {"cache-control": "public, max-age=60", "cf-cache-status": "HIT"}, b"<html>home</html>")
    assert parse_cache_poisoning(res).status == "pass"


@pytest.mark.parametrize("res", [None, fetched(503)])
def test_cache_poisoning_without_an_answer_is_not_assessed(res):
    assert parse_cache_poisoning(res).status == "not_assessed"


# ---------------------------------------------------------------------------
# #26 exceptional_conditions_stack_leak
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "body",
    [
        b"Traceback (most recent call last):\n  File \"/app/main.py\", line 10",
        b"com.example: java.sql.SQLException: ORA-00942",
        b"PrismaClientKnownRequestError: Invalid `prisma.user.findUnique()`",
        b"Error\n    at Object.<anonymous> (/var/task/node_modules/pg/lib/client.js:1:1)",
    ],
)
def test_stack_trace_on_error_is_a_failure(body):
    check = parse_stack_leak(fetched(500, {"content-type": "text/plain"}, body))
    assert check.status == "fail"
    assert check.id == "exceptional_conditions_stack_leak"


def test_bare_node_modules_path_in_html_is_not_a_stack_leak():
    # A dev HTML page referencing /node_modules/ must not be flagged: only a real frame counts.
    page = fetched(404, {"content-type": "text/html"}, b'<script src="/node_modules/vite/client.js"></script>')
    assert parse_stack_leak(page).status == "pass"


@pytest.mark.parametrize("host", sorted(SOFT_200_PAGES))
def test_soft_200_pages_are_not_stack_leaks(host):
    assert parse_stack_leak(fetched(200, {"content-type": "text/html"}, SOFT_200_PAGES[host])).status == "pass"


def test_clean_404_is_pass():
    check = parse_stack_leak(fetched(404, {}, b"Not Found"))
    assert check.status == "pass"
    assert "HTTP 404" in check.detail


def test_stack_leak_without_an_answer_is_not_assessed():
    assert parse_stack_leak(None).status == "not_assessed"


# ---------------------------------------------------------------------------
# #27 supply_chain_manifest_exposure
# ---------------------------------------------------------------------------

def _manifests(**overrides):
    base = {"/.npmrc": fetched(404), "/package.json": fetched(404), "/package-lock.json": fetched(404), "/pnpm-lock.yaml": fetched(404)}
    base.update(overrides)
    return base


def test_public_package_json_is_a_warning():
    pkg = fetched(200, {"content-type": "application/json"}, b'{"name":"acme","version":"1.0.0","dependencies":{"next":"16.0.0"}}')
    check = parse_supply_chain_manifest_exposure(_manifests(**{"/package.json": pkg}))
    assert check.status == "warn"
    assert "/package.json" in check.detail


def test_pnpm_lock_yaml_is_detected():
    lock = fetched(200, {"content-type": "text/yaml"}, b"lockfileVersion: '9.0'\n\nimporters:\n")
    assert parse_supply_chain_manifest_exposure(_manifests(**{"/pnpm-lock.yaml": lock})).status == "warn"


def test_npmrc_with_token_is_a_failure_and_redacts_the_value():
    npmrc = fetched(200, {"content-type": "text/plain"}, b"//registry.npmjs.org/:_authToken=npm_SECRETVALUE123\nregistry=https://registry.npmjs.org/\n")
    check = parse_supply_chain_manifest_exposure(_manifests(**{"/.npmrc": npmrc}))
    assert check.status == "fail"
    assert "npm_SECRETVALUE123" not in check.detail
    assert "redacted" in check.detail.lower()


def test_npmrc_without_a_token_is_a_warning():
    npmrc = fetched(200, {"content-type": "text/plain"}, b"registry=https://registry.npmjs.org/\nsave-exact=true\n")
    assert parse_supply_chain_manifest_exposure(_manifests(**{"/.npmrc": npmrc})).status == "warn"


@pytest.mark.parametrize("host", sorted(SOFT_200_PAGES))
def test_soft_200_pages_are_not_manifest_exposure(host):
    page = fetched(200, {"content-type": "text/html"}, SOFT_200_PAGES[host])
    assert parse_supply_chain_manifest_exposure({p: page for p in ("/.npmrc", "/package.json", "/package-lock.json", "/pnpm-lock.yaml")}).status == "pass"


def test_json_that_is_not_a_package_manifest_is_not_flagged():
    other = fetched(200, {"content-type": "application/json"}, b'{"error":"not found"}')
    assert parse_supply_chain_manifest_exposure(_manifests(**{"/package.json": other})).status == "pass"


def test_all_404_is_pass():
    check = parse_supply_chain_manifest_exposure(_manifests())
    assert check.status == "pass"
    assert "HTTP 404" in check.detail


def test_silent_manifest_probe_is_not_assessed():
    assert parse_supply_chain_manifest_exposure(_manifests(**{"/.npmrc": None, "/package.json": fetched(502)})).status == "not_assessed"


# ---------------------------------------------------------------------------
# #28 auth_session_hardening
# ---------------------------------------------------------------------------

def _home(*cookies: str) -> Fetched:
    return fetched(200, [("set-cookie", c) for c in cookies])


def test_session_cookie_without_secure_is_a_failure():
    check = parse_session_hardening(_home("sessionid=abc; HttpOnly; SameSite=Lax; Max-Age=3600"))
    assert check.status == "fail"
    assert check.id == "auth_session_hardening"
    assert "abc" not in check.detail


def test_samesite_none_without_secure_fails():
    assert parse_session_hardening(_home("auth_token=xyz; HttpOnly; SameSite=None")).status == "fail"


def test_eternal_session_without_samesite_is_a_warning():
    check = parse_session_hardening(_home("connect.sid=zzz; Secure; HttpOnly"))
    assert check.status == "warn"
    assert "never expires" in check.detail


def test_missing_httponly_is_a_warning():
    assert parse_session_hardening(_home("jwt=zzz; Secure; SameSite=Lax; Max-Age=600")).status == "warn"


def test_fully_hardened_session_cookie_passes():
    assert parse_session_hardening(_home("sessionid=zzz; Secure; HttpOnly; SameSite=Strict; Max-Age=3600")).status == "pass"


def test_non_session_cookies_are_ignored():
    check = parse_session_hardening(_home("theme=dark; Path=/", "_ga=GA1.2.3; Path=/"))
    assert check.status == "info"
    assert "no session" in check.detail.lower()


@pytest.mark.parametrize("res", [None, fetched(500)])
def test_session_hardening_without_a_home_page_is_not_assessed(res):
    assert parse_session_hardening(res).status == "not_assessed"


# ---------------------------------------------------------------------------
# Endpoint-level: the four checks land in the headers section
# ---------------------------------------------------------------------------

@pytest.fixture
def audited(client: TestClient, monkeypatch, internal_secret):
    monkeypatch.setattr(audit_v2, "_dns_resolver_factory", lambda: FakeDNSResolver({("example.com", "A"): ["93.184.216.34"]}))

    def run(handler):
        sent = fake_web(monkeypatch, handler)
        res = client.get("/api/v2/audit?domain=example.com", headers=internal_secret)
        assert res.status_code == 200
        headers = {c["id"]: c for c in res.json()["sections"]["headers"]}
        return headers, sent

    return run


def test_audit_reports_the_four_new_checks(audited):
    def handler(request):
        path = request.url.path
        if path.startswith("/__sm_cache_probe_"):
            reflected = request.headers.get("x-forwarded-host", "")
            return web_response(200, {"cache-control": "public, max-age=3600", "cf-cache-status": "HIT"}, f'<link href="https://{reflected}/">'.encode())
        if path.startswith("/api/__sm_probe_"):
            return web_response(500, {"content-type": "text/plain"}, b"Traceback (most recent call last):\n  File \"/var/task/app.py\"")
        if path == "/.npmrc":
            return web_response(200, {"content-type": "text/plain"}, b"//registry.npmjs.org/:_authToken=npm_leak\nregistry=https://registry.npmjs.org/\n")
        if path == "/":
            return web_response(200, {"set-cookie": "sessionid=secret; Path=/"}, b"<html>home</html>")
        return web_response(404, {}, b"Not Found")

    headers, sent = audited(handler)
    assert headers["unkeyed_header_cache_poisoning"]["status"] == "fail"
    assert headers["exceptional_conditions_stack_leak"]["status"] == "fail"
    assert headers["supply_chain_manifest_exposure"]["status"] == "fail"
    assert headers["auth_session_hardening"]["status"] == "fail"
    # The session cookie value is never echoed back in the report.
    assert "secret" not in headers["auth_session_hardening"]["detail"]


def test_cache_probe_carries_the_untrusted_forwarded_host_and_a_cache_buster(audited):
    _, sent = audited(lambda request: web_response(404, {}, b"Not Found"))
    probes = [r for r in sent if r.url.path.startswith("/__sm_cache_probe_")]
    assert len(probes) == 1
    assert probes[0].headers.get("x-forwarded-host") == CACHE_PROBE_HOST
    assert "__sm_cb=" in str(probes[0].url)


def test_new_probes_do_not_follow_redirects(audited):
    def handler(request):
        if request.url.path.startswith("/__sm_cache_probe_") or request.url.path.startswith("/api/__sm_probe_"):
            return web_response(301, {"location": "https://example.com/"}, b"")
        return web_response(404, {}, b"Not Found")

    headers, sent = audited(handler)
    assert sum(1 for r in sent if r.url.path.startswith("/__sm_cache_probe_")) == 1
    assert headers["exceptional_conditions_stack_leak"]["status"] == "pass"


def test_clean_site_passes_all_four(audited):
    def handler(request):
        if request.url.path == "/":
            return web_response(200, {"set-cookie": "sessionid=zzz; Secure; HttpOnly; SameSite=Lax; Max-Age=3600"}, b"<html>home</html>")
        return web_response(404, {}, b"Not Found")

    headers, _ = audited(handler)
    assert headers["unkeyed_header_cache_poisoning"]["status"] == "pass"
    assert headers["exceptional_conditions_stack_leak"]["status"] == "pass"
    assert headers["supply_chain_manifest_exposure"]["status"] == "pass"
    assert headers["auth_session_hardening"]["status"] == "pass"
