"""gateway.stealthmark.io fronts the x402 prover on 127.0.0.1:8402, and its root answers browsers with a landing page."""
import httpx
import pytest

from gateway import state
from gateway.config import DEMOCV_UPSTREAM
from tests.conftest import fake_web

PROVER = "http://127.0.0.1:8402"


@pytest.mark.parametrize(
    ("path", "prover_path"),
    [
        ("/llms.txt", "/llms.txt"),
        ("/.well-known/x402-bazaar.json", "/.well-known/x402-bazaar.json"),
        ("/.well-known/x402", "/.well-known/x402"),
        ("/.well-known/x402.json", "/.well-known/x402.json"),
        ("/.well-known/mcp.json", "/.well-known/mcp.json"),
        ("/mcp.json", "/mcp.json"),
        ("/x402/health", "/health"),
        ("/x402/referral-program", "/x402/referral-program"),
    ],
)
def test_discovery_documents_come_from_the_prover(client, monkeypatch, path, prover_path):
    sent = fake_web(monkeypatch, lambda request: httpx.Response(200, content=b"doc"))
    res = client.get(path)
    assert (res.status_code, res.content) == (200, b"doc")
    assert res.headers["access-control-allow-origin"] == "*"
    assert [str(request.url) for request in sent] == [f"{PROVER}{prover_path}"]
    assert sent[0].headers["x-forwarded-host"] == "gateway.stealthmark.io"


def test_llms_txt_is_served_as_text(client, monkeypatch):
    fake_web(monkeypatch, lambda request: httpx.Response(200, content=b"# StealthMark"))
    assert client.get("/llms.txt").headers["content-type"] == "text/plain; charset=utf-8"


def test_paid_endpoint_relays_the_payment_challenge(client, monkeypatch):
    sent = fake_web(monkeypatch, lambda request: httpx.Response(402, headers={"payment-required": "challenge"}, json={}))
    res = client.get("/x402/catalog?limit=5", headers={"X-PAYMENT": "proof"})
    assert res.status_code == 402
    assert res.headers["payment-required"] == "challenge"
    assert str(sent[0].url) == f"{PROVER}/x402/catalog?limit=5"
    assert sent[0].headers["x-payment"] == "proof"


def test_paid_endpoint_forwards_the_post_body(client, monkeypatch):
    sent = fake_web(monkeypatch, lambda request: httpx.Response(200, json={"ok": True}))
    res = client.post("/x402/verify", content=b'{"spec": "x"}', headers={"content-type": "application/json"})
    assert res.json() == {"ok": True}
    assert (sent[0].method, str(sent[0].url), sent[0].content) == ("POST", f"{PROVER}/x402/verify", b'{"spec": "x"}')


def test_oversized_paid_request_never_reaches_the_prover(client, monkeypatch):
    sent = fake_web(monkeypatch, lambda request: httpx.Response(200))
    assert client.post("/x402/verify", content=b"x" * 65537).status_code == 413
    assert sent == []


def test_paid_endpoint_preflight_allows_the_payment_headers(client, monkeypatch):
    sent = fake_web(monkeypatch, lambda request: httpx.Response(200))
    res = client.options("/x402/catalog")
    assert res.status_code == 204
    assert "X-PAYMENT" in res.headers["access-control-allow-headers"]
    assert sent == []


@pytest.mark.parametrize(
    "path",
    [
        "/x402/catalog",
        "/.well-known/x402",
        "/.well-known/x402.json",
        "/.well-known/x402-bazaar.json",
        "/llms.txt",
        "/openapi.json",
    ],
)
def test_x402_routes_stay_reachable_in_a_defcon_1_lockdown(client, monkeypatch, path):
    monkeypatch.setattr(state, "CURRENT_DEFCON_LEVEL", 1)
    fake_web(monkeypatch, lambda request: httpx.Response(200, json={}))
    assert client.get(path).status_code == 200


def test_root_answers_browsers_with_the_landing_page_without_calling_an_upstream(client, monkeypatch):
    sent = fake_web(monkeypatch, lambda request: httpx.Response(500))
    res = client.get("/")
    assert res.status_code == 200
    assert res.headers["content-type"] == "text/html; charset=utf-8"
    assert "x402" in res.text
    assert client.head("/").status_code == 200
    assert sent == []


def test_root_proxies_a_tenant_only_when_the_service_header_names_it(client, monkeypatch):
    sent = fake_web(monkeypatch, lambda request: httpx.Response(200, content=b"<html>democv</html>"))
    res = client.get("/", headers={"x-stealthmark-service": "democv"})
    assert res.content == b"<html>democv</html>"
    assert [str(request.url) for request in sent] == [f"{DEMOCV_UPSTREAM}/es"]


def test_health_and_favicon_answer_head_and_get(client):
    assert client.head("/health").status_code == 200
    res = client.get("/favicon.ico")
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/svg+xml"
