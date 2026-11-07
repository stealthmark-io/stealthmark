import asyncio
import datetime
import time

import httpx
from fastapi import Request

from gateway.clientip import client_ip
from gateway.config import SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
from gateway.state import RECENT_AUDIT_LOGS, save_cached_telemetry

async def persist_audit_event_to_supabase(log_item: dict):
    """
    Persist real audit event into Supabase PostgreSQL audit_events table.
    Ensures 100% zero-mock audit logs for production inspection.
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return
    try:
        url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/audit_events"
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        }
        severity = "CRITICAL" if log_item.get("status", 200) >= 400 else "INFO"
        payload = {
            "event_type": log_item.get("securityCheck", "GATEWAY_INSPECTION"),
            "severity": severity,
            "status": str(log_item.get("status", 200)),
            "latency_ms": log_item.get("latencyMs", 10.0),
            "tokens_saved": log_item.get("tokensSavedCount", 0),
            "metadata_json": {
                "agent": log_item.get("agent"),
                "provider": log_item.get("provider"),
                "path": log_item.get("targetPath"),
                "method": log_item.get("method"),
                "clientIp": log_item.get("ip"),
                "userAgent": log_item.get("agent"),
            }
        }
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(url, headers=headers, json=payload)
    except Exception:
        pass

def record_audit_log(
    request: Request,
    status_code: int,
    latency_ms: float,
    security_check: str = "KYA Handshake Validated",
    tokens_saved: int = 0
):
    try:
        user_agent = request.headers.get("user-agent", "Unknown Client")
        ip = client_ip(request)
        custom_agent = request.headers.get("x-stealthmark-agent")
        
        agent_name = custom_agent if custom_agent else user_agent
        ua_lower = user_agent.lower()
        if "curl" in ua_lower:
            provider = "cURL Terminal CLI"
        elif "python-requests" in ua_lower or "python" in ua_lower:
            provider = "Python Automation / Hermes Script"
        elif "mozilla" in ua_lower or "chrome" in ua_lower:
            provider = "Chromium Browser Agent"
        else:
            provider = f"IP: {ip}"

        log_item = {
            "id": f"evt-{int(time.time()*1000)}-{len(RECENT_AUDIT_LOGS)}",
            "time": "Just now",
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
            "agent": agent_name,
            "provider": provider,
            "targetPath": request.url.path,
            "method": request.method,
            "status": status_code,
            "latencyMs": round(latency_ms, 1),
            "tokensSavedCount": tokens_saved,
            "tokenSavings": f"{tokens_saved:,} tokens saved" if tokens_saved > 0 else "Defended (0 wasted)" if status_code >= 400 else "Standard Pass",
            "securityCheck": security_check,
            "ip": ip,
        }
        RECENT_AUDIT_LOGS.appendleft(log_item)
        save_cached_telemetry()

        # Trigger async Supabase write in background if event loop is running
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(persist_audit_event_to_supabase(log_item))
        except RuntimeError:
            pass
    except Exception:
        pass
