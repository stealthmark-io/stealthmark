import time

from fastapi import Request, status
from fastapi.responses import JSONResponse

from gateway import metering, state
from gateway.audit import record_audit_log
from gateway.config import AGENT_UA_TOKENS
from gateway.shields.passport import has_valid_passport
from gateway.state import TELEMETRY

# 3b. Active DEFCON Perimeter Posture Enforcement Middleware
async def defcon_perimeter_enforcer(request: Request, call_next):
    started = time.perf_counter()
    path = request.url.path
    exempt_paths = [
        "/health",
        "/api/v1/ping",
        "/api/v1/defcon",
        "/api/v1/domains",
        "/api/v1/telemetry/metrics",
        "/api/v1/telemetry/events",
        "/.well-known/agent.json",
        "/agent-manifest.json",
        "/demo",
        "/docs",
        "/favicon.ico"
    ]
    if any(path.startswith(ep) for ep in exempt_paths):
        return await call_next(request)

    # DEFCON 1 — Emergency Origin Freeze / Lockdown
    if state.CURRENT_DEFCON_LEVEL == 1:
        if not has_valid_passport(request):
            TELEMETRY["requests_total"] += 1
            TELEMETRY["threats_blocked"]["spoofed_identities"] += 1
            record_audit_log(
                request,
                403,
                (time.perf_counter() - started) * 1000,
                "DEFCON 1 Emergency Lockdown Active (Unsigned Traffic Dropped)",
            )
            await metering.record_blocked(request, status.HTTP_403_FORBIDDEN)
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={
                    "detail": {
                        "error": "DEFCON 1 Emergency Lockdown Active",
                        "detail": "Perimeter frozen. Only agents presenting a valid signed passport are permitted.",
                        "shield": "StealthMark DEFCON 1 Perimeter Guard"
                    },
                    "error": "DEFCON_1_EMERGENCY_LOCKDOWN",
                    "message": "Emergency origin freeze engaged. Only agents with a valid signed passport pass.",
                    "status": 403,
                    "defcon_level": 1,
                    "shield": "StealthMark DEFCON 1 Sovereign Firewall"
                }
            )

    # DEFCON 2 — High Readiness (machine traffic must carry a verified HMAC passport)
    if state.CURRENT_DEFCON_LEVEL <= 2:
        user_agent = request.headers.get("user-agent", "").lower()
        is_bot = any(b in user_agent for b in AGENT_UA_TOKENS) or request.headers.get("x-stealthmark-agent")
        if is_bot and not has_valid_passport(request):
            TELEMETRY["requests_total"] += 1
            TELEMETRY["threats_blocked"]["spoofed_identities"] += 1
            record_audit_log(
                request,
                401,
                (time.perf_counter() - started) * 1000,
                "DEFCON 2 Passport Check Failed (Unsigned Machine Traffic)",
            )
            await metering.record_blocked(request, status.HTTP_401_UNAUTHORIZED)
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={
                    "error": "DEFCON_2_KYA_REQUIRED",
                    "message": "A valid signed agent passport is required under DEFCON 2 posture.",
                    "status": 401,
                    "defcon_level": state.CURRENT_DEFCON_LEVEL,
                    "shield": "StealthMark KYA Enforcer"
                }
            )

    return await call_next(request)
