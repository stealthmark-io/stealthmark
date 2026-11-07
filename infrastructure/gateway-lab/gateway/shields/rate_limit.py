import time

from fastapi import Request, status

from gateway.audit import record_audit_log
from gateway.shields.errors import ShieldBlock
from gateway.state import REQUEST_LOG, TELEMETRY

def enforce_rate_limit(agent_id: str, limit: int, request: Request = None):
    started = time.perf_counter()
    now = time.time()
    REQUEST_LOG[agent_id] = [ts for ts in REQUEST_LOG[agent_id] if now - ts < 60]
    if len(REQUEST_LOG[agent_id]) >= limit:
        TELEMETRY["requests_total"] += 1
        TELEMETRY["threats_blocked"]["rate_limit_throttled"] += 1
        if request:
            record_audit_log(request, 429, (time.perf_counter() - started) * 1000, "Rate Limit Exceeded Throttled")
        raise ShieldBlock(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded ({limit} req/min). StealthMark throttle active."
        )
    REQUEST_LOG[agent_id].append(now)
