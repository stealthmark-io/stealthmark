import json
import os
from collections import defaultdict, deque

import httpx

from gateway.config import SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, TELEMETRY_CACHE_FILE

http_client = httpx.AsyncClient(timeout=15.0, follow_redirects=True)

CURRENT_DEFCON_LEVEL = 5

TELEMETRY = {
    "requests_total": 0,
    "threats_blocked": {
        "semantic_injections": 0,
        "spoofed_identities": 0,
        "payload_bombs": 0,
        "rate_limit_throttled": 0
    },
    "tokens_saved_approx": 0,
    "bandwidth_saved_mb": 0.0
}

def load_cached_telemetry():
    global CURRENT_DEFCON_LEVEL
    if os.path.exists(TELEMETRY_CACHE_FILE):
        try:
            with open(TELEMETRY_CACHE_FILE, "r") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    if "defcon_level" in data and isinstance(data["defcon_level"], int):
                        CURRENT_DEFCON_LEVEL = data["defcon_level"]
                    return data
        except Exception:
            pass
    return None

def save_cached_telemetry():
    try:
        with open(TELEMETRY_CACHE_FILE, "w") as f:
            save_payload = {**TELEMETRY, "defcon_level": CURRENT_DEFCON_LEVEL}
            json.dump(save_payload, f)
    except Exception:
        pass

# Hydrate from local cache immediately on module load
_cached = load_cached_telemetry()
if _cached:
    for k in ["requests_total", "tokens_saved_approx", "bandwidth_saved_mb"]:
        if k in _cached:
            TELEMETRY[k] = max(TELEMETRY[k], _cached[k])
    if "threats_blocked" in _cached and isinstance(_cached["threats_blocked"], dict):
        for tk in ["semantic_injections", "spoofed_identities", "payload_bombs", "rate_limit_throttled"]:
            TELEMETRY["threats_blocked"][tk] = max(
                TELEMETRY["threats_blocked"].get(tk, 0),
                _cached["threats_blocked"].get(tk, 0)
            )

async def hydrate_telemetry_from_supabase():
    """
    On container startup, restore the active DEFCON posture from the policies table so a fresh
    Cloud Run instance keeps the posture the operator set. Request counters are never rebuilt from the
    audit ledger: they count what this instance handled, not rows anyone could insert.
    """
    global CURRENT_DEFCON_LEVEL
    if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
        try:
            p_url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/policies?status=eq.active&select=defcon_level&order=updated_at.desc&limit=1"
            p_headers = {
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            }
            async with httpx.AsyncClient(timeout=3.0) as client:
                p_res = await client.get(p_url, headers=p_headers)
                if p_res.status_code == 200:
                    p_data = p_res.json()
                    if isinstance(p_data, list) and len(p_data) > 0:
                        db_lvl = p_data[0].get("defcon_level")
                        if isinstance(db_lvl, int) and 1 <= db_lvl <= 5:
                            CURRENT_DEFCON_LEVEL = db_lvl
                            save_cached_telemetry()
        except Exception:
            pass

RECENT_AUDIT_LOGS = deque(maxlen=200)

REQUEST_LOG = defaultdict(list)
