from fastapi import Request

from gateway import config


def client_ip(request: Request) -> str:
    """Client address as seen by the outermost trusted proxy; entries a caller prepends to X-Forwarded-For are ignored."""
    hops = config.TRUSTED_PROXY_HOPS
    if hops > 0:
        forwarded = [part.strip() for part in request.headers.get("x-forwarded-for", "").split(",") if part.strip()]
        if len(forwarded) >= hops:
            return forwarded[-hops]
    return request.client.host if request.client else "unknown"
