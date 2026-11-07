"""Bundle checks: session tokens in Web Storage without a CSP (A07) and non-production URLs in production bundles (A02).

Both read only the home page and the same-origin bundles the audit already downloads; a page or bundle that was
not read is not_assessed, never a pass.
"""
import asyncio
import time
import tracemalloc

import pytest
from fastapi.testclient import TestClient

from gateway.auditor.exposure import parse_bundle_secrets, parse_nonprod_environment_leak
from gateway.auditor.posture import parse_token_storage
from gateway.auditor.secrets import bundle_paths
from gateway.routes import audit_v2
from tests.conftest import fake_web, web_response
from tests.test_audit_endpoint import FakeDNSResolver
from tests.test_audit_surface import fetched

STRONG_CSP = "default-src 'self'; script-src 'self' 'nonce-r4nd0m'"
TOKEN_WRITE = b'function s(e){localStorage.setItem("access_token",e.token)}'


def home(csp: str | None = None, body: bytes = b"<html></html>"):
    return fetched(headers={"content-security-policy": csp} if csp else {}, body=body)


# ---------------------------------------------------------------------------
# jwt_in_localstorage_without_csp
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("snippet", [
    b'localStorage.setItem("token",e)',
    b"sessionStorage.getItem('jwt')",
    b'window.localStorage["accessToken"]',
    b"localStorage.authToken=t",
    b"localStorage . getItem ( `id_token` )",
    b'localStorage?.getItem("token")',
    b'localStorage.setItem?.("jwt",t)',
    b'sessionStorage?.["access_token"]',
    b"localStorage?.authToken",
])
def test_token_in_web_storage_without_csp_is_a_high_failure(snippet):
    check = parse_token_storage(home(), {"/assets/index-1a.js": fetched(body=snippet)}, "example.com")
    assert check.status == "fail"
    assert check.detail.startswith("High severity")
    assert "/assets/index-1a.js" in check.detail
    assert "HttpOnly; Secure; SameSite=Strict" in check.recommendation


@pytest.mark.parametrize("domain", ["admin.example.com", "backoffice.example.com", "admin.example.com.ar"])
def test_admin_hosts_are_critical(domain):
    check = parse_token_storage(home(), {"/assets/index.js": fetched(body=TOKEN_WRITE)}, domain)
    assert check.status == "fail"
    assert check.detail.startswith("Critical severity")
    assert "administrative session" in check.detail


@pytest.mark.parametrize("domain", ["admin.com", "backoffice.co.uk"])
def test_a_site_named_admin_is_not_an_admin_host(domain):
    check = parse_token_storage(home(), {"/assets/index.js": fetched(body=TOKEN_WRITE)}, domain)
    assert check.detail.startswith("High severity")


def test_inline_script_in_the_home_page_counts():
    check = parse_token_storage(home(body=b'<script>localStorage.setItem("bearer", t)</script>'), {}, "example.com")
    assert check.status == "fail"
    assert 'home HTML: localStorage "bearer"' in check.detail


@pytest.mark.parametrize("csp", ["default-src *", "script-src 'self' 'unsafe-inline'", "img-src 'self'"])
def test_weak_csp_does_not_protect_the_token(csp):
    assert parse_token_storage(home(csp), {"/assets/index.js": fetched(body=TOKEN_WRITE)}, "example.com").status == "fail"


def test_strong_csp_header_makes_it_info():
    assert parse_token_storage(home(STRONG_CSP), {"/assets/index.js": fetched(body=TOKEN_WRITE)}, "example.com").status == "info"


def test_strong_meta_csp_counts_like_the_header():
    page = home(body=f'<head><meta content="{STRONG_CSP}" http-equiv="Content-Security-Policy"></head>'.encode())
    assert parse_token_storage(page, {"/assets/index.js": fetched(body=TOKEN_WRITE)}, "example.com").status == "info"


@pytest.mark.parametrize("snippet", [
    b'localStorage.setItem("theme","dark")',
    b'localStorage.getItem("token_expiry")',
    b'localStorage.setItem("csrf",t)',
    b"localStorage.tokens=[]",
    b'cookieStore.set("token",t)',
    b'localStorage.getItem("token-expiry")',
    b'localStorage.getItem("token.expires_at")',
    b'sessionStorage.setItem("jwt-theme","x")',
    b"localStorage['bearer:last-seen']",
    b'localStorage.setItem("auth-token-count",1)',
    b"localStorage.tokenExpiry=0",
])
def test_other_keys_pass(snippet):
    check = parse_token_storage(home(), {"/assets/index.js": fetched(body=snippet)}, "example.com")
    assert check.status == "pass"
    assert "/assets/index.js" in check.detail


@pytest.mark.parametrize("res", [None, fetched(503), fetched(404)])
def test_token_storage_without_a_home_page_is_not_assessed(res):
    assert parse_token_storage(res, {}, "example.com").status == "not_assessed"


@pytest.mark.parametrize("bundles", [{}, {"/assets/index.js": None}, {"/assets/index.js": fetched(404)}])
def test_token_storage_without_a_bundle_read_is_not_assessed(bundles):
    check = parse_token_storage(home(), bundles, "example.com")
    assert check.status == "not_assessed"
    assert "/assets/index.js" in check.detail if bundles else "references no same-origin" in check.detail


@pytest.mark.parametrize("unread", [None, fetched(404)])
def test_one_unread_bundle_leaves_token_storage_unassessed_unless_the_other_leaks(unread):
    clean = parse_token_storage(home(), {"/assets/a.js": fetched(body=b"ok"), "/assets/b.js": unread}, "example.com")
    assert clean.status == "not_assessed"
    assert "/assets/b.js could not be read" in clean.detail
    assert parse_token_storage(home(), {"/assets/a.js": fetched(body=TOKEN_WRITE), "/assets/b.js": unread}, "example.com").status == "fail"


@pytest.mark.parametrize("snippet", [b'LocalStorage.getItem("token")', b'localStorage.GETITEM("token")'])
def test_web_storage_names_are_case_sensitive(snippet):
    assert parse_token_storage(home(), {"/assets/index.js": fetched(body=snippet)}, "example.com").status == "pass"


def test_listed_keys_are_capped():
    keys = ["token", "jwt", "bearer", "access_token", "auth_token", "id_token", "refresh_token"]
    body = ";".join(f'localStorage.getItem("{k}")' for k in keys).encode()
    check = parse_token_storage(home(), {"/assets/index.js": fetched(body=body)}, "example.com")
    assert check.status == "fail"
    assert "(+2 more)" in check.detail


def test_unclosed_meta_tags_stay_linear():
    page = home(body=b'<script>localStorage.setItem("token",t)</script>' + b"<meta " * 50_000)
    start = time.perf_counter()
    assert parse_token_storage(page, {}, "example.com").status == "fail"
    assert time.perf_counter() - start < 1


@pytest.mark.parametrize("body", [
    b'<p>Never call localStorage.setItem("token", t) in your app.</p>',
    b'<!-- <script>localStorage.setItem("token",t)</script> -->',
    b'<textarea>sessionStorage.getItem("jwt")</textarea>',
])
def test_page_prose_and_comments_are_not_code(body):
    assert parse_token_storage(home(body=body), {"/assets/index.js": fetched(body=b"ok")}, "example.com").status == "pass"


def test_a_comment_marker_inside_a_script_does_not_hide_the_next_script():
    page = home(body=b'<script>var s="<!--"</script><script>localStorage.setItem("token",t)</script>')
    assert parse_token_storage(page, {}, "example.com").status == "fail"


@pytest.mark.parametrize("content, status", [
    ("script-src &#39;self&#39; &#39;unsafe-inline&#39;", "fail"),
    ("script-src &apos;self&apos; &apos;nonce-r4nd0m&apos;", "info"),
])
def test_meta_csp_entities_are_decoded(content, status):
    page = home(body=f'<meta http-equiv="Content-Security-Policy" content="{content}"><script>localStorage.setItem("token",t)</script>'.encode())
    assert parse_token_storage(page, {}, "example.com").status == status


def test_every_csp_header_is_evaluated():
    page = fetched(headers=[("content-security-policy", "img-src *"), ("content-security-policy", STRONG_CSP)], body=b"<html></html>")
    assert parse_token_storage(page, {"/assets/index.js": fetched(body=TOKEN_WRITE)}, "example.com").status == "info"


def test_a_commented_out_meta_csp_is_not_enforced():
    page = home(body=f'<!-- <meta http-equiv="Content-Security-Policy" content="{STRONG_CSP}"> --><script>localStorage.setItem("token",t)</script>'.encode())
    assert parse_token_storage(page, {}, "example.com").status == "fail"


def test_report_only_meta_csp_is_not_enforced():
    page = home(body=f'<script>localStorage.setItem("token",t)</script><meta http-equiv="Content-Security-Policy-Report-Only" content="{STRONG_CSP}">'.encode())
    assert parse_token_storage(page, {}, "example.com").status == "fail"


# ---------------------------------------------------------------------------
# nonprod_environment_leak_in_bundle
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("url, host, hidden", [
    (b"https://api.homologation.example.com.ar/v1/login?client_secret=abc", "api.homologation.example.com.ar", "client_secret"),
    (b"https://staging.example.com", "staging.example.com", None),
    (b"http://auth.internal.corp.example:8443/oauth", "auth.internal.corp.example", "8443"),
    (b"https://API.DEV.Example.com/private", "api.dev.example.com", "/private"),
    (b"https://web.test.example.com/", "web.test.example.com", None),
    (b"wss://ws.staging.example.com/socket", "ws.staging.example.com", "/socket"),
    (b"https:\\/\\/api.staging.example.com\\/v1\\/accounts", "api.staging.example.com", "accounts"),
    (b"https://api-staging.example.com/v1", "api-staging.example.com", None),
    (b"https://api-homologacao.example.com.br/", "api-homologacao.example.com.br", None),
    (b"https://dev-api.example.com/", "dev-api.example.com", None),
    (b"https://test.api.example.com/", "test.api.example.com", None),
])
def test_nonprod_host_warns_and_shows_only_the_host(url, host, hidden):
    check = parse_nonprod_environment_leak({"/assets/index.js": fetched(body=b'const u="' + url + b'";')}, "example.com")
    assert check.status == "warn"
    assert check.detail.startswith("Medium severity")
    assert host in check.detail
    assert hidden is None or hidden not in check.detail


@pytest.mark.parametrize("body", [
    b'fetch("https://dev.to/api")',
    b'"https://developer.mozilla.org/docs"',
    b'"https://react.dev/errors/418"',
    b'"https://api.example.com/v1"',
    b'"https://cdn.devtools.example.com"',
    b'"https://dev.azure.com/org/_apis"',
    b'"https://test.pypi.org/simple"',
    b'"https://dev.virtualearth.net/REST/v1"',
    b'"https://feeds.dev.azure.com/org/_packaging"',
    b'"https://vssps.dev.azure.com/org"',
    b'"https://www.local.gov.uk/our-support"',
    b'"https://ecn.dev.virtualearth.net/mapcontrol"',
    b'"https://www.stage.com.br/agenda"',
    b'"https://www.internal.co.uk/"',
    b'"https://staging.example.com@cdn.example.net/x"',
    b'"https://backstage.example.com/"',
    b'"//staging.example.com/protocol-relative"',
])
def test_public_and_production_hosts_pass(body):
    assert parse_nonprod_environment_leak({"/assets/index.js": fetched(body=body)}, "example.com").status == "pass"


@pytest.mark.parametrize("url, domain", [
    (b"https://dev.example.com/api", "example.com"),
    (b"https://test.example.com/api", "www.example.com"),
    (b"https://local.example.com:3000/", "example.com"),
    (b"https://dev.example.com.ar/api", "app.example.com.ar"),
])
def test_dev_test_or_local_right_under_the_own_domain_is_info(url, domain):
    check = parse_nonprod_environment_leak({"/assets/index.js": fetched(body=b'"' + url + b'"')}, domain)
    assert check.status == "info"
    assert "public developer portal or a development environment" in check.detail


@pytest.mark.parametrize("url, domain", [
    (b"https://api.dev.example.com.ar/", "app.example.com.ar"),
    (b"https://dev-api.example.com/", "www.example.com"),
])
def test_nested_or_hyphenated_dev_under_the_own_domain_warns(url, domain):
    assert parse_nonprod_environment_leak({"/assets/index.js": fetched(body=b'"' + url + b'"')}, domain).status == "warn"


def test_a_warning_also_names_the_possible_portals():
    body = b'"https://dev.example.com" "https://api.staging.example.com"'
    check = parse_nonprod_environment_leak({"/assets/index.js": fetched(body=body)}, "example.com")
    assert check.status == "warn"
    assert "api.staging.example.com" in check.detail and "dev.example.com can be a public developer portal" in check.detail


def test_the_scanned_host_itself_is_not_a_leak():
    body = b'"https://app.staging.example.com/api"'
    assert parse_nonprod_environment_leak({"/assets/index.js": fetched(body=body)}, "app.staging.example.com").status == "pass"


def test_hosts_are_deduplicated_and_capped():
    body = b" ".join(f'"https://svc{i}.staging.example.com/a"'.encode() for i in range(8)) + b' "https://svc0.staging.example.com/b"'
    check = parse_nonprod_environment_leak({"/assets/index.js": fetched(body=body)}, "example.com")
    assert check.detail.count("svc0.staging.example.com") == 1
    assert "(+3 more)" in check.detail


def test_inlined_vite_url_variable_alone_is_info():
    body = b'const e={BASE_URL:"/",MODE:"production",VITE_API_URL:"https://api.example.com"}'
    check = parse_nonprod_environment_leak({"/assets/index.js": fetched(body=body)}, "example.com")
    assert check.status == "info"
    assert "VITE_API_URL" in check.detail
    assert "api.example.com" not in check.detail
    assert "ships to browsers" not in check.detail


@pytest.mark.parametrize("bundles", [{}, {"/assets/index.js": None}, {"/assets/index.js": fetched(404)}])
def test_nonprod_bundles_not_read_are_not_assessed(bundles):
    assert parse_nonprod_environment_leak(bundles, "example.com").status == "not_assessed"


@pytest.mark.parametrize("unread", [None, fetched(404)])
def test_one_unread_bundle_is_not_assessed_unless_the_other_leaks(unread):
    clean = parse_nonprod_environment_leak({"/assets/a.js": fetched(body=b"ok"), "/assets/b.js": unread}, "example.com")
    assert clean.status == "not_assessed"
    assert "/assets/b.js could not be read" in clean.detail
    leak = fetched(body=b'"https://api.staging.example.com"')
    assert parse_nonprod_environment_leak({"/assets/a.js": leak, "/assets/b.js": unread}, "example.com").status == "warn"


def test_listed_names_are_capped_in_length_and_number():
    body = b'"https://' + (b"a" * 60 + b".") * 3 + b'staging.example.com" ' + b" ".join(f"VITE_S{i}_URL".encode() for i in range(20))
    check = parse_nonprod_environment_leak({"/assets/index.js": fetched(body=body)}, "example.com")
    assert check.status == "warn"
    assert len(check.detail) < 2000
    assert "(+15 more)" in check.detail


@pytest.mark.parametrize("body", [
    b'"https://' + b"a." * 1_250_000 + b'"',
    b" ".join(b"http://h%d.dev.example.com" % i for i in range(100_000)),
], ids=["label-run", "distinct-dev-hosts"])
def test_nonprod_scan_of_a_hostile_bundle_stays_fast_and_small(body):
    bundles = {"/assets/index.js": fetched(body=body)}
    start = time.perf_counter()
    parse_nonprod_environment_leak(bundles, "example.com")
    assert time.perf_counter() - start < 2
    # Measured in a run of its own: tracemalloc slows the parser several times over.
    tracemalloc.start()
    parse_nonprod_environment_leak(bundles, "example.com")
    peak = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()
    assert peak < 64 * 1024 * 1024


def test_bundle_paths_are_bounded_in_length():
    page = b'<script src="/assets/' + b"a" * 300 + b'.js"></script><script src="/assets/index-1a.js"></script>'
    assert bundle_paths(page.decode(), "example.com") == ["/assets/index-1a.js"]


@pytest.mark.parametrize("tag", ["<script ", "<script src="], ids=["unclosed-tags", "unquoted-src"])
def test_bundle_paths_of_a_hostile_home_page_stay_linear(tag):
    # A tag that closes after the run would end the old scan in one match: the run must come last to hit the backtracking.
    page = '<script src="/assets/index-1a.js"></script>' + tag * (audit_v2.HOME_SCAN_BYTES // len(tag))
    start = time.perf_counter()
    paths = bundle_paths(page, "example.com")
    assert time.perf_counter() - start < 0.5
    assert paths == ["/assets/index-1a.js"]


def test_jwt_scan_of_a_hostile_bundle_stays_linear():
    start = time.perf_counter()
    parse_bundle_secrets({"/assets/index.js": fetched(body=b"eyJ-" * 65_536)})
    assert time.perf_counter() - start < 1


# ---------------------------------------------------------------------------
# Endpoint level: both run on the bundle the home page loads, read up to 2.5 MB
# ---------------------------------------------------------------------------

def test_audit_finds_both_past_the_old_512_kb_cap(client: TestClient, monkeypatch, internal_secret):
    monkeypatch.setattr(audit_v2, "_dns_resolver_factory", lambda: FakeDNSResolver({("example.com", "A"): ["93.184.216.34"]}))
    leak = b'localStorage.setItem("token",t);fetch("https://api.homologation.example.com/v1/accounts?id=7");'
    bundle = b"/*" + b"x" * (2 * 1024 * 1024) + b"*/" + leak + b"y" * (1024 * 1024)

    def handler(request):
        path = request.url.path
        if path == "/":
            return web_response(200, {"content-type": "text/html"}, b'<html><script src="/assets/index-7f.js"></script></html>')
        if path == "/assets/index-7f.js":
            return web_response(200, {"content-type": "application/javascript"}, bundle)
        return web_response(404, {}, b"Not Found")

    fake_web(monkeypatch, handler)
    res = client.get("/api/v2/audit?domain=example.com", headers=internal_secret)
    assert res.status_code == 200
    headers = {c["id"]: c for c in res.json()["sections"]["headers"]}
    token, env = headers["jwt_in_localstorage_without_csp"], headers["nonprod_environment_leak_in_bundle"]
    assert token["status"] == "fail"
    assert '/assets/index-7f.js: localStorage "token"' in token["detail"]
    assert env["status"] == "warn"
    assert "api.homologation.example.com" in env["detail"]
    assert "/v1/accounts" not in env["detail"]


def test_bundle_parsers_run_off_the_event_loop(client: TestClient, monkeypatch):
    monkeypatch.setattr(audit_v2, "_dns_resolver_factory", lambda: FakeDNSResolver({("example.com", "A"): ["93.184.216.34"]}))
    seen: list[str] = []
    original = audit_v2.parse_token_storage

    def spy(*args):
        try:
            asyncio.get_running_loop()
            seen.append("event loop")
        except RuntimeError:
            seen.append("thread")
        return original(*args)

    monkeypatch.setattr(audit_v2, "parse_token_storage", spy)
    fake_web(monkeypatch, lambda request: web_response(200, {}, b"<html></html>"))
    assert client.get("/api/v2/audit?domain=example.com").status_code == 200
    assert seen == ["thread"]
