import time
from typing import List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from gateway.auth import require_internal_secret
from gateway.config import SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, logger

router = APIRouter()


class DomainConnectModel(BaseModel):
    domain: str
    name: Optional[str] = None
    capabilities: Optional[List[str]] = None

@router.get("/api/v1/domains")
async def get_registered_domains(request: Request):
    require_internal_secret(request)
    """
    Retrieve registered domain and organization profile directly from Supabase PostgreSQL.
    Bypasses RLS using Secret Manager service_role key.
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return {"domain": "stealthmark.io", "organization": None}
    try:
        url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/organizations?domain=not.is.null&order=created_at.desc&limit=1"
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        }
        async with httpx.AsyncClient(timeout=4.0) as client:
            res = await client.get(url, headers=headers)
            if res.status_code == 200:
                data = res.json()
                if isinstance(data, list) and len(data) > 0:
                    return {"domain": data[0].get("domain"), "organization": data[0]}
    except Exception as e:
        logger.error(f"[Domains GET error]: {e}")
    return {"domain": "stealthmark.io", "organization": None}

@router.post("/api/v1/domains")
async def connect_domain(payload: DomainConnectModel, request: Request):
    require_internal_secret(request)
    """
    Persist domain & organization profile to Supabase organizations & registered_sites.
    Bypasses RLS using Secret Manager service_role key.
    """
    clean_dom = payload.domain.strip().lower().replace("https://", "").replace("http://", "").split("/")[0]
    if not clean_dom:
        raise HTTPException(status_code=400, detail="Domain is required")
    
    org_name = payload.name or f"{clean_dom.split('.')[0].upper()} Operations"
    slug = clean_dom.replace(".", "-")[:40]
    org_id = f"org-{int(time.time())}"
    persisted = False

    if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
        try:
            headers = {
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=representation"
            }
            async with httpx.AsyncClient(timeout=5.0) as client:
                # 1. Upsert organization
                org_url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/organizations"
                org_body = {
                    "name": org_name,
                    "slug": slug,
                    "domain": clean_dom,
                    "plan": "business" if "stealthmark" in clean_dom else "developer",
                    "status": "active"
                }
                res = await client.post(org_url, headers=headers, json=org_body)
                if res.status_code in [200, 201]:
                    persisted = True
                    ret_data = res.json()
                    if isinstance(ret_data, list) and len(ret_data) > 0:
                        org_id = ret_data[0].get("id", org_id)

                # 2. Upsert registered_sites
                sites_url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/registered_sites"
                site_body = {
                    "domain": clean_dom,
                    "display_name": org_name,
                    "status": "active",
                    "access_policy": "open"
                }
                headers_site = {**headers, "Prefer": "resolution=merge-duplicates"}
                await client.post(sites_url, headers=headers_site, json=site_body)
                persisted = True
        except Exception as e:
            logger.error(f"[Domains POST Supabase Error]: {e}")

    return {
        "success": True,
        "domain": clean_dom,
        "organizationId": org_id,
        "persistedInDatabase": persisted
    }
