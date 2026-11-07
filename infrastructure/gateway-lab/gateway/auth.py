import hmac

from fastapi import HTTPException, Request

from gateway import config


def has_internal_secret(request: Request) -> bool:
    secret = config.INTERNAL_AUTH_SECRET
    provided = request.headers.get("x-internal-secret", "")
    # Header values arrive latin-1 decoded; comparing bytes keeps a non-ASCII value a mismatch instead of a TypeError (500).
    return bool(secret) and bool(provided) and hmac.compare_digest(provided.encode("latin-1"), secret.encode())


def require_internal_secret(request: Request) -> None:
    """Control-plane endpoints are driven by the StealthMark API only; without a configured secret they do not exist (404)."""
    if not has_internal_secret(request):
        raise HTTPException(status_code=404, detail="Not found")
