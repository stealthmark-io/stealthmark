import time
from pathlib import Path

import pytest

from gateway import state
from gateway.shields import passport
from gateway.shields.passport import REGISTERED_AGENTS
from tests.conftest import signed_passport_headers

AGENT_ID = next(iter(REGISTERED_AGENTS))
MACHINE_UA = {"user-agent": "GPTBot/1.1"}


@pytest.mark.parametrize("path", ["/api/v1/defcon", "/api/v1/defcon/level"])
def test_defcon_shift_requires_the_internal_secret(client, internal_secret, path):
    assert client.post(path, json={"level": 1}).status_code == 404
    assert client.post(path, json={"level": 1}, headers={"x-internal-secret": "wrong"}).status_code == 404
    assert state.CURRENT_DEFCON_LEVEL == 5
    assert client.post(path, json={"level": 3}, headers=internal_secret).status_code == 200
    assert state.CURRENT_DEFCON_LEVEL == 3


def test_defcon_shift_does_not_exist_when_no_secret_is_configured(client):
    assert client.post("/api/v1/defcon", json={"level": 1}, headers={"x-internal-secret": ""}).status_code == 404
    assert client.post("/api/v1/defcon", json={"level": 1}, headers={"x-internal-secret": "anything"}).status_code == 404
    assert state.CURRENT_DEFCON_LEVEL == 5


def test_telemetry_reset_requires_the_internal_secret(client, internal_secret):
    state.TELEMETRY["requests_total"] = 7
    assert client.post("/api/v1/telemetry/reset").status_code == 404
    assert state.TELEMETRY["requests_total"] > 0
    assert client.post("/api/v1/telemetry/reset", headers=internal_secret).status_code == 200
    assert state.TELEMETRY["requests_total"] == 0


@pytest.mark.parametrize(
    "bypass_headers",
    [
        {"x-stealthmark-vip": "true"},
        {"authorization": "Bearer sm_live_anything"},
        {"x-kya-passport": "anything"},
        {"x-stealthmark-agent": AGENT_ID},
        {"x-stealthmark-agent": AGENT_ID, "x-stealthmark-signature": "deadbeef", "x-stealthmark-timestamp": "1"},
    ],
)
def test_defcon_one_has_no_header_bypass(client, monkeypatch, passport_secret, bypass_headers):
    monkeypatch.setattr(state, "CURRENT_DEFCON_LEVEL", 1)
    res = client.get("/some/page", headers=bypass_headers)
    assert res.status_code == 403
    assert res.json()["error"] == "DEFCON_1_EMERGENCY_LOCKDOWN"


def test_defcon_one_lets_a_validly_signed_passport_through(client, monkeypatch, passport_secret):
    monkeypatch.setattr(state, "CURRENT_DEFCON_LEVEL", 1)
    res = client.get("/some/page", headers=signed_passport_headers(AGENT_ID))
    assert res.status_code == 404
    assert res.json() == {"error": "not_found"}


def test_defcon_one_blocks_everything_when_no_passport_secret_is_configured(client, monkeypatch):
    monkeypatch.setattr(state, "CURRENT_DEFCON_LEVEL", 1)
    headers = {"x-stealthmark-agent": AGENT_ID, "x-stealthmark-signature": "a" * 64, "x-stealthmark-timestamp": str(time.time())}
    assert client.get("/some/page", headers=headers).status_code == 403


@pytest.mark.parametrize("fake_credentials", [{"x-kya-passport": "anything"}, {"authorization": "Bearer anything"}])
def test_defcon_two_does_not_accept_unverified_credentials(client, monkeypatch, fake_credentials):
    monkeypatch.setattr(state, "CURRENT_DEFCON_LEVEL", 2)
    res = client.get("/catalog", headers={**MACHINE_UA, **fake_credentials})
    assert res.status_code == 401
    assert res.json()["error"] == "DEFCON_2_KYA_REQUIRED"


def test_defcon_two_accepts_a_verified_passport(client, monkeypatch, passport_secret):
    monkeypatch.setattr(state, "CURRENT_DEFCON_LEVEL", 2)
    res = client.get("/catalog", headers={**MACHINE_UA, **signed_passport_headers(AGENT_ID)})
    assert res.status_code == 404


def audit(client, headers):
    return client.post("/agent/v1/audit", json={"candidate_name": "Ana", "resume_text": "Led 4 teams"}, headers=headers)


def test_signed_passport_is_accepted(lab_client, passport_secret):
    assert audit(lab_client, signed_passport_headers(AGENT_ID)).status_code == 200


def test_registered_agent_id_alone_is_not_a_credential(lab_client, passport_secret):
    assert audit(lab_client, {"x-stealthmark-agent": AGENT_ID}).status_code == 401


def test_every_passport_is_rejected_when_the_secret_is_not_configured(lab_client):
    assert passport.sign_passport(AGENT_ID, "1") is None
    headers = {"x-stealthmark-agent": AGENT_ID, "x-stealthmark-signature": "a" * 64, "x-stealthmark-timestamp": str(time.time())}
    assert audit(lab_client, headers).status_code == 401
    assert audit(lab_client, {"x-stealthmark-agent": AGENT_ID}).status_code == 401


@pytest.mark.parametrize("tamper", ["signature", "agent", "expired", "future", "garbage_timestamp", "nan_timestamp", "missing_timestamp"])
def test_forged_or_stale_passports_are_rejected(lab_client, passport_secret, tamper):
    headers = signed_passport_headers(AGENT_ID)
    if tamper == "signature":
        headers["x-stealthmark-signature"] = "0" * 64
    elif tamper == "agent":
        headers["x-stealthmark-agent"] = list(REGISTERED_AGENTS)[1]
    elif tamper == "expired":
        headers = signed_passport_headers(AGENT_ID, str(time.time() - 600))
    elif tamper == "future":
        headers = signed_passport_headers(AGENT_ID, str(time.time() + 600))
    elif tamper == "garbage_timestamp":
        headers = signed_passport_headers(AGENT_ID, "yesterday")
    elif tamper == "nan_timestamp":
        headers = signed_passport_headers(AGENT_ID, "nan")
    else:
        del headers["x-stealthmark-timestamp"]
    assert audit(lab_client, headers).status_code == 401


def test_passport_keys_differ_per_agent(passport_secret):
    first, second = list(REGISTERED_AGENTS)[:2]
    assert passport.sign_passport(first, "1") != passport.sign_passport(second, "1")


def test_no_key_material_is_hardcoded_in_the_gateway_sources():
    root = Path(__file__).resolve().parents[1] / "gateway"
    sources = {path: path.read_text() for path in root.rglob("*.py")}
    assert all("secret" not in entry for entry in REGISTERED_AGENTS.values())
    for path, text in sources.items():
        for marker in ("sm_sec_", "x-stealthmark-vip", "Bearer sm_live_", "x-kya-passport"):
            assert marker not in text, f"{marker} found in {path.name}"


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("POST", "/api/v1/defcon", {"bad": "schema"}),
        ("POST", "/api/v1/defcon/level", {"bad": "schema"}),
        ("POST", "/api/v1/domains", {"missing_domain": True}),
        ("GET", "/api/v1/telemetry/events?limit=notanint", None),
    ],
)
def test_control_plane_auth_runs_before_schema_validation(client, internal_secret, method, path, body):
    res = client.request(method, path, json=body) if body is not None else client.request(method, path)
    assert res.status_code == 404


def test_management_routes_reject_dns_rebinding_host_and_origin(client):
    for path in ("/health", "/api/v1/defcon", "/api/v1/ping", "/api/v1/telemetry/metrics"):
        res_host = client.get(path, headers={"host": "evil.dns-rebind.invalid"})
        assert res_host.status_code == 421, path
        assert res_host.headers.get("access-control-allow-origin") is None

        res_origin = client.get(path, headers={"host": "127.0.0.1:8082", "origin": "https://evil.dns-rebind.invalid"})
        assert res_origin.status_code == 403, path
        assert res_origin.headers.get("access-control-allow-origin") is None

        res_null = client.get(path, headers={"host": "127.0.0.1:8082", "origin": "null"})
        assert res_null.status_code == 403, path

    # Empty Host and non-canonical IPv4 variants are rejected fail-closed with 400
    for bad_host in ("", "0177.0.0.1", "127.0.0.01", "127.0.0.0x1", "2130706433", "127.1"):
        assert client.get("/health", headers={"host": bad_host}).status_code == 400, bad_host
    # Latin-1 superscript digits (which pass str.isdigit() in Python) are rejected by _parse_host
    from gateway.shields.host_guard import _parse_host
    assert _parse_host("127.0.0.1:\xb2") == ("", False)

    # Expanded IPv6, IPv4-mapped IPv6, trailing-dot localhost and *.localhost block cross-origin requests
    for loopback_host in ("sub.localhost:8082", "localhost.:8082", "[0:0:0:0:0:0:0:1]:8082", "[::ffff:127.0.0.1]:8082"):
        res_rebind = client.get("/anything", headers={"host": loopback_host, "origin": "https://evil.invalid"})
        assert res_rebind.status_code == 403, loopback_host

    # Malformed Origin with userinfo or non-HTTP scheme is rejected on management & loopback routes
    for bad_origin in ("https://evil.com@localhost", "ftp://localhost"):
        assert client.get("/health", headers={"host": "127.0.0.1:8082", "origin": bad_origin}).status_code == 403, bad_origin

    # Gateway API preflight rejects foreign origins and allows configured origins
    assert (
        client.options(
            "/api/v1/defcon",
            headers={"origin": "https://evil.invalid", "access-control-request-method": "POST"},
        ).status_code
        == 403
    )
    ok_pre = client.options(
        "/api/v1/defcon",
        headers={"origin": "https://stealthmark.io", "access-control-request-method": "POST"},
    )
    assert ok_pre.status_code == 204
    assert ok_pre.headers.get("access-control-allow-origin") == "https://stealthmark.io"

    assert client.get("/health", headers={"host": "127.0.0.1:8082"}).status_code == 200
    assert client.get("/health", headers={"host": "127.0.0.1:8082"}).headers.get("access-control-allow-origin") is None
