"""Gateway-owned responses carry browser hardening headers; tenant content relayed by the proxy keeps its own headers."""
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.responses import Response

from gateway import state
from gateway.app import create_app
from gateway.shields import security_headers
from tests.conftest import make_request

HARDENING = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "strict-transport-security": "max-age=31536000",
    "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
}
TENANT_HEADERS = {
    "content-type": "text/html",
    "content-security-policy": "default-src 'self' https://cdn.customer.example",
    "x-frame-options": "SAMEORIGIN",
}


@pytest.fixture
def upstream(monkeypatch):
    mock = AsyncMock(return_value=httpx.Response(200, content=b"<html>tenant</html>", headers=TENANT_HEADERS))
    monkeypatch.setattr(state.http_client, "request", mock)
    return mock


def assert_hardened(response):
    for name, value in HARDENING.items():
        assert response.headers.get(name) == value, name


@pytest.mark.parametrize("path", ["/health", "/.well-known/agent.json", "/api/v1/ping"])
def test_gateway_owned_routes_are_hardened(client, path):
    res = client.get(path)
    assert res.status_code == 200
    assert_hardened(res)


def test_scanner_answers_are_hardened_including_errors(client):
    res = client.post("/api/v1/scanner/audit-url", json={"target_url": "http://169.254.169.254/"})
    assert res.status_code == 400
    assert_hardened(res)


def test_answers_produced_by_the_shields_are_hardened_too(client):
    res = client.post("/anything", content=b"x", headers={"content-length": str(3 * 1024 * 1024)})
    assert res.status_code == 413
    assert_hardened(res)


def test_gateway_generated_proxy_errors_are_hardened(client):
    res = client.get("/anything", headers={"host": "unlisted.example"})
    assert res.status_code == 404
    assert_hardened(res)


def test_tenant_content_keeps_the_headers_its_origin_chose(client, upstream):
    res = client.get("/democv/page")
    assert res.status_code == 200
    assert res.headers["content-security-policy"] == TENANT_HEADERS["content-security-policy"]
    assert res.headers["x-frame-options"] == "SAMEORIGIN"
    for injected in ("strict-transport-security", "referrer-policy", "x-content-type-options"):
        assert injected not in res.headers


def test_tenant_content_without_a_csp_does_not_get_one_from_the_gateway(client, upstream):
    upstream.return_value = httpx.Response(200, content=b"<html>tenant</html>", headers={"content-type": "text/html"})
    res = client.get("/democv/page")
    assert res.status_code == 200
    assert "content-security-policy" not in res.headers
    assert "x-frame-options" not in res.headers


def test_the_root_page_relayed_from_the_configured_upstream_is_left_alone(client, monkeypatch):
    relayed = httpx.Response(200, content=b"<html>home</html>", headers=TENANT_HEADERS)
    monkeypatch.setattr(state.http_client, "get", AsyncMock(return_value=relayed))
    res = client.get("/")
    assert res.status_code == 200
    assert res.headers["x-frame-options"] == "SAMEORIGIN"
    assert "strict-transport-security" not in res.headers


def test_the_root_json_for_agents_is_hardened(client):
    res = client.get("/", headers={"x-stealthmark-agent": "agent_x"})
    assert res.status_code == 200
    assert_hardened(res)


def test_public_api_docs_are_hardened_but_keep_swagger_working():
    docs_client = TestClient(create_app(public_docs=True))
    res = docs_client.get("/docs")
    assert res.status_code == 200
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert "content-security-policy" not in res.headers
    assert docs_client.get("/openapi.json").headers["content-security-policy"] == HARDENING["content-security-policy"]


async def test_a_header_a_route_already_set_is_not_overwritten():
    async def call_next(request):
        return Response("ok", headers={"x-frame-options": "SAMEORIGIN", "referrer-policy": "same-origin"})

    response = await security_headers.security_headers_middleware(make_request("/api/v1/thing"), call_next)
    assert response.headers["x-frame-options"] == "SAMEORIGIN"
    assert response.headers["referrer-policy"] == "same-origin"
    assert response.headers["x-content-type-options"] == "nosniff"


async def test_a_response_marked_as_tenant_content_passes_through_untouched():
    request = make_request("/page")

    async def call_next(inner):
        security_headers.mark_tenant_response(inner)
        return Response("tenant", headers={"x-custom": "1"})

    response = await security_headers.security_headers_middleware(request, call_next)
    assert response.headers["x-custom"] == "1"
    assert not any(name in response.headers for name in HARDENING)
