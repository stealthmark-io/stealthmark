import time

from fastapi import APIRouter, Header, Request

from gateway.auth import require_internal_secret
from gateway.state import RECENT_AUDIT_LOGS, REQUEST_LOG, TELEMETRY

router = APIRouter()


# -------------------------------------------------------------
# DYNAMIC TELEMETRY ENDPOINTS
# -------------------------------------------------------------
@router.get("/api/v1/telemetry/metrics")
def get_telemetry_metrics(x_stealthmark_agent: str | None = Header(None)):
    return {
        "cluster": "GCP us-central1 (stealthmark-prod)",
        "service": "stealthmark-data-plane",
        "timestamp": time.time(),
        "status": "operational",
        "metrics": {
            "total_requests": TELEMETRY["requests_total"],
            "threats_blocked": TELEMETRY["threats_blocked"],
            "performance": {
                "latency_p50_ms": None,
                "latency_p95_ms": None,
                "throughput_peak_rps": None
            },
            "economic_impact": {
                "tokens_saved": TELEMETRY["tokens_saved_approx"],
                "bandwidth_saved_mb": TELEMETRY["bandwidth_saved_mb"],
                "estimated_usd_saved": round((TELEMETRY["tokens_saved_approx"] / 1000000) * 3.0, 2)
            }
        }
    }

@router.get("/api/v1/telemetry/events")
def get_telemetry_events(request: Request, limit: int = 50):
    """Recent request log with client addresses and user agents: control plane only."""
    require_internal_secret(request)
    limit = max(1, min(limit, 200))
    return {
        "status": "ok",
        "total_recorded": len(RECENT_AUDIT_LOGS),
        "events": list(RECENT_AUDIT_LOGS)[:limit]
    }

@router.post("/api/v1/telemetry/reset")
def reset_telemetry(request: Request):
    require_internal_secret(request)
    TELEMETRY["requests_total"] = 0
    TELEMETRY["threats_blocked"]["semantic_injections"] = 0
    TELEMETRY["threats_blocked"]["spoofed_identities"] = 0
    TELEMETRY["threats_blocked"]["payload_bombs"] = 0
    TELEMETRY["threats_blocked"]["rate_limit_throttled"] = 0
    TELEMETRY["tokens_saved_approx"] = 0
    TELEMETRY["bandwidth_saved_mb"] = 0.0
    REQUEST_LOG.clear()
    RECENT_AUDIT_LOGS.clear()
    return {"status": "reset", "metrics": TELEMETRY}

@router.api_route("/api/v1/ping", methods=["GET", "POST"])
async def edge_ping_endpoint():
    """Reachability probe. It writes nothing: no counter, no audit row, no log entry."""
    return {
        "status": "ok",
        "message": "StealthMark Gateway reachable",
        "version": "1.6.0",
    }
