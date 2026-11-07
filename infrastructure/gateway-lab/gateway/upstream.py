"""Pinned upstream fetch with manual, re-validated redirects."""
import httpx

from gateway import state, targets

MAX_REDIRECT_HOPS = 3
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
METHOD_CHANGING_REDIRECTS = frozenset({301, 302, 303})

STRIPPED_REQUEST_HEADERS = frozenset({
    "host", "authorization", "proxy-authorization", "cookie", "content-length", "transfer-encoding",
    "connection", "keep-alive", "proxy-connection", "te", "trailer", "upgrade", "accept-encoding",
    "metadata-flavor", "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip",
    "x-internal-secret",
})
STRIPPED_REQUEST_PREFIXES = ("x-stealthmark-", "x-goog-", "x-cloud-trace", "x-appengine-")


class UpstreamRefused(Exception):
    """The origin is not allowed to be contacted (blocked or non-public address)."""


def forward_headers(incoming: httpx.Headers | dict[str, str], original_host: str, client_ip: str) -> dict[str, str]:
    """Caller headers minus hop-by-hop, credential and StealthMark control headers, plus proxy provenance headers."""
    headers = {
        name: value for name, value in incoming.items()
        if name.lower() not in STRIPPED_REQUEST_HEADERS and not name.lower().startswith(STRIPPED_REQUEST_PREFIXES)
    }
    headers["x-forwarded-host"] = original_host
    headers["x-forwarded-for"] = client_ip
    headers["x-stealthmark-proxied"] = "true"
    return headers


async def fetch(
    method: str, origin: targets.Origin, path_and_query: str, headers: dict[str, str], body: bytes
) -> httpx.Response:
    """Send the request to the allowed origin, following at most 3 redirects and only to other allowed origins."""
    current, target = origin, path_and_query
    response: httpx.Response | None = None
    for hop in range(MAX_REDIRECT_HOPS + 1):
        pinned = await targets.pin_origin(current.base_url)
        if pinned is None:
            if response is None:
                raise UpstreamRefused(current.host)
            return response
        response = await state.http_client.request(
            method=method,
            url=f"{pinned.origin}{target}",
            headers={**headers, "host": pinned.host_header},
            content=body,
            follow_redirects=False,
            extensions={"sni_hostname": pinned.sni_hostname} if pinned.sni_hostname else {},
        )
        if response.status_code not in REDIRECT_STATUSES or hop == MAX_REDIRECT_HOPS:
            return response
        following = await targets.redirect_target(current, target, response.headers.get("location"))
        if following is None:
            return response
        current, target = following
        if response.status_code in METHOD_CHANGING_REDIRECTS and method not in ("GET", "HEAD"):
            method, body = "GET", b""
    return response
