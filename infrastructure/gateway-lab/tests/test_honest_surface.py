"""The production gateway serves only what it really does: no scripted demo routes, no invented claims, no public request log."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from gateway import state
from gateway.app import create_app
from gateway.routes import scanner
from tests.conftest import fake_web, web_response

SCAN_URL = "/api/v1/scanner/audit-url"
BANNED_CLAIMS = ("99.999", "KYA", "Ed25519", "pentest", "VIP", "DEFCON", "sla_guarantee", "crypto_passports", "enforced", "anti_replay")


def fake_target(monkeypatch, response_headers=None, status=200, body=b"<html>ok</html>", manifest=False, docs=False):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/.well-known/agent.json":
            if manifest:
                return web_response(200, {"content-type": "application/json"}, b'{"name": "x"}')
            return web_response(404, content=b"nope")
        if request.url.path == "/docs":
            return web_response(200 if docs else 404, content=b"Swagger UI" if docs else b"nope")
        return web_response(status, response_headers, body)

    return fake_web(monkeypatch, handler)


def scan(client, target="https://example.com/"):
    return client.post(SCAN_URL, json={"target_url": target})


@pytest.mark.parametrize("path", ["/api/v1/blueprint/scenarios", "/api/v1/blueprint/simulate/saas", "/agent/v1/manifest"])
def test_production_gateway_does_not_serve_the_scripted_demo_routes(client, path):
    assert client.get(path).status_code == 404


def test_demo_routes_exist_only_when_explicitly_enabled():
    lab = TestClient(create_app(lab_routes=True))
    assert lab.get("/api/v1/blueprint/scenarios").status_code == 200
    assert lab.get("/agent/v1/manifest").status_code == 200


def test_lab_routes_default_to_off():
    from gateway import config

    assert config.LAB_ROUTES_ENABLED is False


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_api_documentation_is_not_public_by_default(client, path):
    assert client.get(path).status_code == 404
    assert TestClient(create_app(public_docs=True)).get(path).status_code == 200


def test_agent_manifest_makes_no_unbacked_claims(client):
    res = client.get("/.well-known/agent.json")
    assert res.status_code == 200
    text = json.dumps(res.json())
    for claim in BANNED_CLAIMS:
        assert claim not in text, claim
    assert "$schema" not in res.json()
    assert "run_security_pentest" not in res.json()["capabilities"]
    assert "x-stealthmark-latency" not in res.headers


def test_agent_root_reports_facts_not_enforcement_claims(client):
    res = client.get("/", headers={"x-stealthmark-agent": "test-agent"})
    assert res.status_code == 200
    text = json.dumps(res.json())
    for claim in BANNED_CLAIMS:
        assert claim not in text, claim


def test_request_log_with_client_addresses_requires_the_internal_secret(client, internal_secret):
    client.post("/anything", content=b"x", headers={"content-length": str(3 * 1024 * 1024)})
    assert state.RECENT_AUDIT_LOGS
    assert client.get("/api/v1/telemetry/events").status_code == 404
    assert client.get("/api/v1/telemetry/events", headers={"x-internal-secret": "wrong"}).status_code == 404
    res = client.get("/api/v1/telemetry/events", headers=internal_secret)
    assert res.status_code == 200
    assert res.json()["total_recorded"] == len(state.RECENT_AUDIT_LOGS)


def test_request_log_is_closed_when_no_secret_is_configured(client):
    assert client.get("/api/v1/telemetry/events").status_code == 404
    assert client.get("/api/v1/telemetry/events", headers={"x-internal-secret": ""}).status_code == 404


def test_ping_writes_nothing(client):
    before = state.TELEMETRY["requests_total"]
    res = client.post("/api/v1/ping")
    assert res.status_code == 200
    assert "latency_ms" not in res.json()
    assert state.TELEMETRY["requests_total"] == before
    assert not state.RECENT_AUDIT_LOGS


def test_attack_traffic_never_books_invented_token_savings(client):
    client.post("/anything", content=b"x", headers={"content-length": str(3 * 1024 * 1024)})
    assert state.TELEMETRY["tokens_saved_approx"] == 0
    assert all(item["tokensSavedCount"] == 0 for item in state.RECENT_AUDIT_LOGS)


@pytest.mark.parametrize("url", ["https://example.com/?stealthmark.io", "https://democv.example.com/", "https://www.demodental.example.com/", "https://stealthmark.io"])
def test_scanner_never_certifies_a_site_because_of_its_name(client, monkeypatch, url):
    fake_target(monkeypatch)
    body = scan(client, url).json()
    assert body["agentic_score"] != 98
    assert body["readiness_tier"] != "Tier 1: Agentic Native"
    text = json.dumps(body)
    for claim in ("DEFCON", "KYA", "Sovereign", "Gateway Pro", "Dual-Door", "99%", "326 bytes", "80%+"):
        assert claim not in text, claim


def test_scanner_ignores_a_self_declared_shield_header(client, monkeypatch):
    fake_target(monkeypatch)
    plain = scan(client).json()
    fake_target(monkeypatch, response_headers={"x-stealthmark-shield": "ACTIVE", "x-stealthmark-proxied": "true", "x-stealthmark-route": "DUAL_DOOR"})
    declared = scan(client).json()
    assert declared["agentic_score"] == plain["agentic_score"]
    signal = [f for f in declared["findings"] if f["tag"] == "SDK SIGNAL"]
    assert len(signal) == 1 and "self-declared" in signal[0]["description"]


def test_scanner_scores_only_measured_signals(client, monkeypatch):
    headers = {"strict-transport-security": "max-age=1", "content-security-policy": "default-src 'self'"}
    fake_target(monkeypatch, response_headers=headers, manifest=True)
    clean = scan(client).json()
    assert clean["agentic_score"] == 100
    assert clean["findings"] == []
    assert clean["metrics"]["agent_access"] == "OPEN"

    fake_target(monkeypatch, status=403, body=b"x" * 40_000, docs=True)
    bad = scan(client).json()
    assert bad["agentic_score"] == 10
    assert bad["metrics"]["agent_access"] == "BLOCKED (HTTP 403)"
    assert {f["tag"] for f in bad["findings"]} == {"AGENT ACCESS", "MANIFEST", "TRANSPORT HEADERS", "PAGE WEIGHT", "API DOCS"}


def test_scanner_does_not_touch_platform_telemetry(client, monkeypatch):
    fake_target(monkeypatch)
    before = (state.TELEMETRY["requests_total"], state.TELEMETRY["tokens_saved_approx"])
    assert scan(client).status_code == 200
    assert (state.TELEMETRY["requests_total"], state.TELEMETRY["tokens_saved_approx"]) == before


def test_scanner_is_limited_per_address(client, monkeypatch):
    fake_target(monkeypatch)
    statuses = [scan(client).status_code for _ in range(scanner.SCANS_PER_IP_PER_MINUTE + 1)]
    assert statuses[:-1] == [200] * scanner.SCANS_PER_IP_PER_MINUTE
    assert statuses[-1] == 429


def test_scan_budget_resets_each_minute():
    for _ in range(scanner.SCANS_PER_IP_PER_MINUTE):
        assert scanner.allow_scan("203.0.113.9", now=120.0)
    assert not scanner.allow_scan("203.0.113.9", now=121.0)
    assert scanner.allow_scan("203.0.113.9", now=181.0)
    assert scanner.allow_scan("203.0.113.10", now=121.0)


def test_analyze_gives_no_credit_for_a_stealthmark_header():
    probe = scanner.Probe(200, {"x-stealthmark-agent-policy": "observe"}, 100, manifest_found=False, docs_exposed=False)
    other = scanner.Probe(200, {}, 100, manifest_found=False, docs_exposed=False)
    assert scanner.analyze(probe).score == scanner.analyze(other).score
