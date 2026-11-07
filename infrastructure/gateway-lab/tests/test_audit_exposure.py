"""P1-2: /.git/HEAD and OpenAPI/Swagger probes report only what the body proves."""
import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from gateway.auditor.exposure import parse_api_schema_exposure, parse_git_exposure
from gateway.routes import audit_v2
from gateway.routes.scanner import Fetched
from tests.conftest import fake_web, web_response
from tests.test_audit_endpoint import FakeDNSResolver

OPENAPI_BODY = b'{"openapi":"3.1.0","info":{"title":"Shop API","version":"1"},"paths":{"/orders":{"get":{}}}}'
CANARY_GIT_CONFIG = (
    b"# Este dominio usa @stealthmark/next \xc2\xb7 https://stealthmark.io/scan?domain=example.com\n"
    b"[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n"
    b'[remote "origin"]\n\turl = https://stealthmark.io/api/telemetry/canary/abc.def.git\n'
    b"\tfetch = +refs/heads/*:refs/remotes/origin/*\n"
    b'[branch "main"]\n\tremote = origin\n\tmerge = refs/heads/main\n'
)

# Catch-all pages that answer HTTP 200 for any path on common hosts.
SOFT_200_PAGES = {
    "next": b'<!DOCTYPE html><html lang="en"><head><script src="/_next/static/chunks/main.js"></script></head><body><div id="__next"></div></body></html>',
    "vercel": b"<!DOCTYPE html><html><head><title>404: NOT_FOUND</title></head><body>The page could not be found</body></html>",
    "cloudflare": b"<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>",
    "wordpress": b'<!DOCTYPE html><html><head><link rel="stylesheet" href="/wp-content/themes/x/style.css"></head><body class="error404">Page not found</body></html>',
}


def fetched(status: int = 200, headers: dict[str, str] | None = None, body: bytes = b"", truncated: bool = False) -> Fetched:
    return Fetched(status_code=status, headers=httpx.Headers(headers or {}), body=body, truncated=truncated)


@pytest.mark.parametrize("body", [b"ref: refs/heads/main\n", b"3f786850e387550fdab836ed7e6dc881de23001b\n"])
def test_git_head_content_is_a_failure(body):
    check = parse_git_exposure(fetched(body=body))
    assert check.status == "fail"
    assert check.id == "git_exposure"


def test_git_head_failure_explains_that_a_403_directory_does_not_protect_the_repository():
    check = parse_git_exposure(fetched(body=b"ref: refs/heads/main\n"))
    assert "403 on the /.git/ directory listing does not protect it" in check.detail
    assert "full source code and its commit history" in check.detail
    assert "every path under /.git/" in check.recommendation


def test_canary_git_fixture_is_info_not_an_exposed_repository():
    check = parse_git_exposure(fetched(body=b"ref: refs/heads/main\n"), fetched(body=CANARY_GIT_CONFIG))
    assert check.status == "info"
    assert "Canary fixture" in check.detail
    assert "abc.def" not in check.detail


@pytest.mark.parametrize(
    "config",
    [
        None,
        fetched(404, body=b"Not Found"),
        fetched(body=b'[remote "origin"]\n\turl = https://github.com/acme/shop.git\n'),
        fetched(body=CANARY_GIT_CONFIG.split(b"\n", 1)[1]),
    ],
    ids=["no_answer", "not_found", "real_remote", "no_disclosure_line"],
)
def test_git_head_with_any_other_config_is_a_failure(config):
    assert parse_git_exposure(fetched(body=b"ref: refs/heads/main\n"), config).status == "fail"


@pytest.mark.parametrize("host", sorted(SOFT_200_PAGES))
def test_soft_200_pages_are_not_git_or_schema_exposure(host):
    page = fetched(headers={"content-type": "text/html"}, body=SOFT_200_PAGES[host])
    assert parse_git_exposure(page).status == "pass"
    assert parse_api_schema_exposure({"/openapi.json": page, "/swagger.json": page}).status == "pass"


@pytest.mark.parametrize("status", [403, 404])
def test_rejected_probes_pass_without_a_waf_claim(status):
    git = parse_git_exposure(fetched(status, body=b"Forbidden"))
    schema = parse_api_schema_exposure({"/openapi.json": fetched(status), "/swagger.json": fetched(status)})
    for check in (git, schema):
        assert check.status == "pass"
        assert f"HTTP {status}" in check.detail
        assert "waf" not in check.detail.lower()


@pytest.mark.parametrize("res", [None, fetched(502)])
def test_probe_that_did_not_answer_is_not_assessed(res):
    assert parse_git_exposure(res).status == "not_assessed"
    schema = parse_api_schema_exposure({"/openapi.json": res, "/swagger.json": fetched(404)})
    assert schema.status == "not_assessed"
    assert "/openapi.json" in schema.detail


def test_public_openapi_schema_is_a_warning_never_a_failure():
    check = parse_api_schema_exposure({
        "/openapi.json": fetched(headers={"content-type": "application/json"}, body=OPENAPI_BODY),
        "/swagger.json": None,
    })
    assert check.status == "warn"
    assert check.detail.startswith("/openapi.json")


def test_truncated_schema_is_identified_by_its_version_field():
    body = b'{"swagger":"2.0","info":{"description":"' + b"x" * 9000
    check = parse_api_schema_exposure({
        "/openapi.json": fetched(404),
        "/swagger.json": fetched(headers={"content-type": "application/json"}, body=body[:8192], truncated=True),
    })
    assert check.status == "warn"


def test_json_without_a_schema_version_is_not_a_schema():
    check = parse_api_schema_exposure({
        "/openapi.json": fetched(headers={"content-type": "application/json"}, body=b'{"error":"not found","paths":{}}'),
        "/swagger.json": fetched(404),
    })
    assert check.status == "pass"


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


def test_audit_reports_exposure_in_the_headers_section(audited):
    def handler(request):
        if request.url.path == "/.git/HEAD":
            return web_response(200, {"content-type": "text/plain"}, b"ref: refs/heads/main\n")
        if request.url.path == "/openapi.json":
            return web_response(200, {"content-type": "application/json"}, OPENAPI_BODY)
        return web_response(404, {}, b"Not Found")

    headers, _ = audited(handler)
    assert headers["git_exposure"]["status"] == "fail"
    assert headers["api_schema_exposure"]["status"] == "warn"


def test_audit_grades_the_sdk_canary_git_fixture_as_info(audited):
    def handler(request):
        if request.url.path == "/.git/HEAD":
            return web_response(200, {"content-type": "text/plain"}, b"ref: refs/heads/main\n")
        if request.url.path == "/.git/config":
            return web_response(200, {"content-type": "text/plain"}, CANARY_GIT_CONFIG)
        return web_response(404, {}, b"Not Found")

    headers, sent = audited(handler)
    assert headers["git_exposure"]["status"] == "info"
    assert sum(1 for r in sent if r.url.path == "/.git/config") == 1


def test_slow_exposure_probe_times_out_as_not_assessed(audited, monkeypatch):
    monkeypatch.setattr(audit_v2, "EXPOSURE_PROBE_TIMEOUT_SECONDS", 0.05)

    async def handler(request):
        if request.url.path == "/.git/HEAD":
            await asyncio.sleep(1)
        return web_response(404, {}, b"Not Found")

    headers, _ = audited(handler)
    assert headers["git_exposure"]["status"] == "not_assessed"


def test_exposure_probes_do_not_follow_redirects(audited):
    def handler(request):
        if request.url.path in ("/.git/HEAD", "/openapi.json", "/swagger.json"):
            return web_response(301, {"location": "https://example.com/"}, b"")
        return web_response(404, {}, b"Not Found")

    headers, sent = audited(handler)
    assert headers["git_exposure"]["status"] == "pass"
    assert "HTTP 301" in headers["git_exposure"]["detail"]
    assert sum(1 for r in sent if r.url.path == "/.git/HEAD") == 1


def test_public_scan_never_requests_the_chat_endpoint(audited):
    """D-N2: the public scan never probes /api/chat (outbound level B waits for legal review)."""
    _, sent = audited(lambda request: web_response(404, {}, b"Not Found"))
    assert sent
    assert not any(r.url.path.rstrip("/") == "/api/chat" for r in sent)
