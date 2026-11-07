from typing import Any, Optional

import httpx

from gateway import state
from gateway.config import SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL

REST_TIMEOUT_SECONDS = 5.0


def is_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def rest_headers(extra: Optional[dict[str, str]] = None) -> dict[str, str]:
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }
    if extra:
        headers.update(extra)
    return headers


def rest_url(table: str) -> str:
    return f"{SUPABASE_URL.rstrip('/')}/rest/v1/{table}"


async def rest_get(table: str, params: dict[str, str]) -> list[dict[str, Any]]:
    res = await state.http_client.get(
        rest_url(table), headers=rest_headers(), params=params, timeout=REST_TIMEOUT_SECONDS
    )
    if res.status_code != 200:
        raise httpx.HTTPError(f"PostgREST {table} returned {res.status_code}")
    data = res.json()
    if not isinstance(data, list):
        raise ValueError(f"PostgREST {table} returned a non-list payload")
    return data


async def rest_insert(table: str, rows: list[dict[str, Any]]) -> httpx.Response:
    headers = rest_headers({"Content-Type": "application/json", "Prefer": "return=minimal"})
    return await state.http_client.post(rest_url(table), headers=headers, json=rows, timeout=REST_TIMEOUT_SECONDS)
