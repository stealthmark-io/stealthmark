"""P1-3: secret patterns in the home page and its JS bundles, reported redacted."""
import base64
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from gateway.auditor.exposure import parse_bundle_secrets, parse_source_map_exposure
from gateway.auditor.secrets import bundle_paths, find_secrets
from gateway.routes import audit_v2
from gateway.routes.scanner import Fetched
from tests.conftest import fake_web, web_response
from tests.test_audit_endpoint import FakeDNSResolver

# Synthetic values assembled at runtime so no key-shaped literal lives in the repository.
OPENAI_KEY = "sk-" + "proj-" + "A" * 74 + "T3Blbk" + "FJ" + "b" * 70 + "WxYz"
ANTHROPIC_KEY = "sk-" + "ant-" + "api03-" + "C" * 86 + "AA"
STRIPE_KEY = "sk_" + "live_" + "d" * 30
AWS_KEY_ID = "AK" + "IA" + "Q" * 16
AWS_SECRET = "e" * 40


def jwt(claims: dict) -> str:
    def part(data: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")

    return f"{part({'alg': 'HS256', 'typ': 'JWT'})}.{part(claims)}.{'s' * 43}"


def fetched(status: int = 200, body: bytes = b"", headers: dict[str, str] | None = None) -> Fetched:
    return Fetched(status_code=status, headers=httpx.Headers(headers or {}), body=body, truncated=False)


@pytest.mark.parametrize(
    "secret,kind",
    [
        (OPENAI_KEY, "OpenAI API key"),
        (ANTHROPIC_KEY, "Anthropic API key"),
        (STRIPE_KEY, "Stripe secret key"),
        (jwt({"iss": "supabase", "role": "service_role"}), "Supabase service_role key"),
    ],
)
def test_secret_patterns_fail_and_are_redacted(secret, kind):
    hits = find_secrets(f'const config = {{ key: "{secret}" }};')
    assert [(h.kind, h.severity) for h in hits] == [(kind, "fail")]
    assert hits[0].redacted.endswith(f"{secret[-4:]} (sha256:{hits[0].redacted[-9:-1]})")
    assert secret not in hits[0].redacted


def test_supabase_anon_key_is_public_by_design():
    assert find_secrets(f'createClient(url, "{jwt({"iss": "supabase", "role": "anon"})}")') == []


def test_aws_key_id_alone_warns_and_with_a_secret_nearby_fails():
    assert [h.severity for h in find_secrets(f'accessKeyId:"{AWS_KEY_ID}"')] == ["warn"]
    assert [h.severity for h in find_secrets(f'accessKeyId:"{AWS_KEY_ID}",secretAccessKey:"{AWS_SECRET}"')] == ["fail"]
    assert find_secrets('accessKeyId:"AKIAIOSFODNN7EXAMPLE"') == []


def test_css_class_starting_with_sk_is_not_an_ai_key():
    home = fetched(body=b'<html><div class="sk-hero-banner-container-wrapper-large"></div></html>')
    paas = {c.id: c for c in audit_v2.parse_headers(home)}["paas_origin_and_ai_secret_shield"]
    assert paas.status == "info"


def test_bundle_paths_keep_same_origin_bundles_page_chunks_first():
    html = """
      <script src="/_next/static/chunks/webpack-1a2b.js"></script>
      <script src="https://cdn.other.net/_next/static/chunks/app/page-x.js"></script>
      <script src="http://example.com/assets/index-insecure.js"></script>
      <script src="//www.example.com/assets/vendor-9f.js"></script>
      <script src="/_next/static/chunks/app/page-3c4d.js?dpl=dpl_123"></script>
      <script src="/static/js/main.js"></script>
    """
    assert bundle_paths(html, "example.com") == ["/_next/static/chunks/app/page-3c4d.js", "/_next/static/chunks/webpack-1a2b.js"]


@pytest.mark.parametrize("bundles", [{}, {"/assets/index.js": None}, {"/assets/index.js": fetched(404)}])
def test_bundles_not_read_are_not_assessed(bundles):
    assert parse_bundle_secrets(bundles).status == "not_assessed"


def test_bundle_with_only_a_google_browser_key_is_info():
    body = ('initializeApp({apiKey:"AIzaSy' + "A" * 33 + '"})').encode()
    assert parse_bundle_secrets({"/assets/index.js": fetched(body=body)}).status == "info"


def test_clean_bundle_is_a_measured_pass():
    check = parse_bundle_secrets({"/assets/index.js": fetched(body=b"console.log('hi')")})
    assert check.status == "pass"
    assert "/assets/index.js" in check.detail


def test_source_map_json_is_info_and_html_is_not_a_map():
    real_map = fetched(body=b'{"version":3,"file":"index.js","sources":["src/main.ts"],"mappings":"AAAA"}')
    assert parse_source_map_exposure({"/assets/index.js.map": real_map}).status == "info"
    soft_200 = fetched(body=b"<!DOCTYPE html><html><body>Not found</body></html>")
    assert parse_source_map_exposure({"/assets/index.js.map": soft_200}).status == "pass"
    assert parse_source_map_exposure({}).status == "not_assessed"


def test_audit_scans_home_bundles_and_never_echoes_the_key(client: TestClient, monkeypatch, internal_secret):
    monkeypatch.setattr(audit_v2, "_dns_resolver_factory", lambda: FakeDNSResolver({("example.com", "A"): ["93.184.216.34"]}))

    def handler(request):
        path = request.url.path
        if path == "/":
            return web_response(200, {"content-type": "text/html"}, b'<html><script src="/assets/index-7f.js"></script></html>')
        if path == "/assets/index-7f.js":
            return web_response(200, {"content-type": "application/javascript"}, f'const s="{STRIPE_KEY}";'.encode())
        if path == "/assets/index-7f.js.map":
            return web_response(200, {"content-type": "application/json"}, b'{"version":3,"sources":["a.ts"],"mappings":""}')
        return web_response(404, {}, b"Not Found")

    sent = fake_web(monkeypatch, handler)
    res = client.get("/api/v2/audit?domain=example.com", headers=internal_secret)
    assert res.status_code == 200
    headers = {c["id"]: c for c in res.json()["sections"]["headers"]}
    assert headers["js_bundle_secrets"]["status"] == "fail"
    assert "/assets/index-7f.js" in headers["js_bundle_secrets"]["detail"]
    assert headers["source_map_exposure"]["status"] == "info"
    assert STRIPE_KEY not in res.text
    assert sum(1 for r in sent if r.url.path == "/assets/index-7f.js") == 1
