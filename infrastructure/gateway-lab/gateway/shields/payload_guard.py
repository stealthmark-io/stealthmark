import time

from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.requests import ClientDisconnect
from starlette.responses import Response

from gateway import metering
from gateway.audit import record_audit_log
from gateway.config import MAX_BODY_BYTES
from gateway.state import TELEMETRY


async def _payload_too_large(request: Request, started: float) -> JSONResponse:
    TELEMETRY["requests_total"] += 1
    TELEMETRY["threats_blocked"]["payload_bombs"] += 1
    record_audit_log(request, 413, (time.perf_counter() - started) * 1000, "Payload Bomb Cap (2MB) Neutralized")
    await metering.record_blocked(request, status.HTTP_413_CONTENT_TOO_LARGE)
    return JSONResponse(
        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
        content={
            "error": "Payload Too Large",
            "detail": f"Request body exceeds maximum allowed limit of {MAX_BODY_BYTES // (1024*1024)}MB.",
            "shield": "StealthMark Anti-Buffer-Overflow Guard"
        }
    )


# 3. Payload Bomb & Body Size Limiter Middleware
async def payload_size_guard(request: Request, call_next):
    started = time.perf_counter()
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_BODY_BYTES:
        return await _payload_too_large(request, started)

    # A chunked body declares no length, so its bytes are counted as they arrive.
    chunks = []
    received = 0
    try:
        async for chunk in request.stream():
            received += len(chunk)
            if received > MAX_BODY_BYTES:
                return await _payload_too_large(request, started)
            chunks.append(chunk)
    except ClientDisconnect:
        return Response(status_code=status.HTTP_400_BAD_REQUEST)
    # BaseHTTPMiddleware replays a cached _body to the app below; a stream read here would reach it empty.
    request._body = b"".join(chunks)
    return await call_next(request)
