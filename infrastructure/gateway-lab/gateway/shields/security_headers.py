"""Browser hardening headers for the responses the gateway itself produces.

Tenant content relayed through the reverse proxy keeps the headers its own origin chose (a customer's CSP or frame
policy is theirs to set), so relaying routes call mark_tenant_response and this middleware leaves those alone.
"""
from fastapi import Request

TENANT_RESPONSE_SCOPE_KEY = "stealthmark.tenant_response"
DOCS_PATH_PREFIXES = ("/docs", "/redoc")

SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "strict-transport-security": "max-age=31536000",
}
API_CONTENT_SECURITY_POLICY = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'"


def mark_tenant_response(request: Request) -> None:
    """Declare that this response carries a tenant origin's content and its headers must not be rewritten."""
    request.scope[TENANT_RESPONSE_SCOPE_KEY] = True


async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    if request.scope.get(TENANT_RESPONSE_SCOPE_KEY):
        return response
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    if not request.url.path.startswith(DOCS_PATH_PREFIXES):
        response.headers.setdefault("content-security-policy", API_CONTENT_SECURITY_POLICY)
    return response
