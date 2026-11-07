import time
import urllib.parse

from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse

from gateway import metering, targets, upstream
from gateway.audit import record_audit_log
from gateway.clientip import client_ip
from gateway.config import logger
from gateway.shields.security_headers import mark_tenant_response
from gateway.shields.semantic import scan_semantic_payload
from gateway.state import TELEMETRY

router = APIRouter()

# Tenants share the gateway origin, so an origin must never be able to set a cookie on it.
EXCLUDED_RESPONSE_HEADERS = frozenset({"content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive", "set-cookie", "set-cookie2"})
NOT_FOUND = {"error": "not_found"}


# -------------------------------------------------------------
# UNIVERSAL REVERSE PROXY CORE (allowlisted origins only)
# -------------------------------------------------------------
@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
async def universal_reverse_proxy(request: Request, path: str):
    """
    Reverse proxy for allowlisted origins:
    - Targets are chosen by the 'X-Stealthmark-Target' header, the '?target=' parameter, the '/proxy/<url>' prefix,
      the '/democv/' and '/demodental/' product prefixes, or the request Host header.
    - A target is accepted only when it is an operator-configured upstream (DEMOCV/DEMODENTAL/SMILE or UPSTREAM_*) or an
      active registered site that resolves to public addresses. Everything else is a 404.
    - Performs Defcon security scans on incoming bodies (semantic injection, payload cap).
    - Never forwards credentials or StealthMark control headers to the origin.
    """
    start_time = time.perf_counter()

    if request.headers.get("x-stealthmark-proxied"):
        return JSONResponse(status_code=status.HTTP_508_LOOP_DETECTED, content={"error": "loop_detected"})

    resolved = await targets.resolve_request_target(request, path)
    if resolved is None:
        logger.warning("proxy target rejected for %s", request.url.path[:80].encode("ascii", "replace").decode())
        return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content=NOT_FOUND)

    origin, sub_path = resolved.origin, resolved.sub_path
    site = origin.site
    agent_id = metering.agent_identifier(request)
    if not agent_id:
        site = None
    event_type = metering.event_type_for_path(sub_path)

    # Shield first: blocked traffic is recorded for visibility (free) even when the org is over its cap.
    body = await request.body()
    if body and len(body) > 0:
        content_type = request.headers.get("content-type", "").lower()
        if "json" in content_type or "text" in content_type or "urlencoded" in content_type:
            try:
                text_content = body.decode("utf-8", errors="ignore")
                scan_semantic_payload(text_content, "proxy_request_body", request=request)
            except HTTPException as blocked:
                if site is not None and agent_id:
                    await metering.record_blocked(
                        request, blocked.status_code, (time.perf_counter() - start_time) * 1000, site=site
                    )
                raise
            except Exception:
                pass

    if site is not None:
        over_quota = await metering.enforce_quota(site.org_id)
        if over_quota is not None:
            record_audit_log(
                request=request,
                status_code=over_quota.status_code,
                latency_ms=round((time.perf_counter() - start_time) * 1000, 2),
                security_check="Monthly Agent Event Quota Exceeded"
            )
            return over_quota

    upstream_path = f"/{sub_path}".rstrip("/") or "/"
    query_items = [(k, v) for k, v in request.query_params.multi_items() if k != "target"]
    if query_items:
        upstream_path += f"?{urllib.parse.urlencode(query_items)}"
    outgoing_headers = upstream.forward_headers(request.headers, request.headers.get("host", ""), client_ip(request))

    try:
        upstream_res = await upstream.fetch(request.method, origin, upstream_path, outgoing_headers, body)

        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        TELEMETRY["requests_total"] += 1
        record_audit_log(
            request=request,
            status_code=upstream_res.status_code,
            latency_ms=duration_ms,
            security_check="Reverse Proxy Ingress Pass" if upstream_res.status_code < 400 else f"Upstream Status {upstream_res.status_code}",
            tokens_saved=0
        )
        if site is not None and agent_id:
            metering.record_event(site, request, agent_id, event_type, upstream_res.status_code, duration_ms)

        response_headers = {
            k: v for k, v in upstream_res.headers.items()
            if k.lower() not in EXCLUDED_RESPONSE_HEADERS
        }
        response_headers["x-stealthmark-inspected"] = "true"
        response_headers["x-stealthmark-latency-ms"] = str(duration_ms)
        response_headers["x-gateway-by"] = "StealthMark Multi-Service Gateway v1.6.0"

        mark_tenant_response(request)
        return Response(
            content=upstream_res.content,
            status_code=upstream_res.status_code,
            headers=response_headers,
            media_type=upstream_res.headers.get("content-type"),
        )
    except upstream.UpstreamRefused:
        return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content=NOT_FOUND)
    except HTTPException as he:
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        record_audit_log(
            request=request,
            status_code=he.status_code,
            latency_ms=duration_ms,
            security_check="Semantic Injection Neutralized" if he.status_code == 422 else f"HTTP Exception {he.status_code}"
        )
        raise
    except Exception as e:
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        logger.warning("proxy upstream failure for %s: %s", origin.host, type(e).__name__)
        record_audit_log(
            request=request,
            status_code=status.HTTP_502_BAD_GATEWAY,
            latency_ms=duration_ms,
            security_check=f"Bad Gateway: {type(e).__name__}"
        )
        if site is not None and agent_id:
            metering.record_event(site, request, agent_id, event_type, status.HTTP_502_BAD_GATEWAY, duration_ms)
        return JSONResponse(
            status_code=status.HTTP_502_BAD_GATEWAY,
            content={"error": "Bad Gateway", "shield": "StealthMark Reverse Proxy Guard"}
        )
