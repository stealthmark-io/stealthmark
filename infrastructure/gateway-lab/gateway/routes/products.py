import time

from fastapi import APIRouter, Header, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from gateway.shields.passport import REGISTERED_AGENTS, verify_crypto_passport
from gateway.shields.rate_limit import enforce_rate_limit
from gateway.shields.semantic import scan_semantic_payload

router = APIRouter()

webhook_request_history = []


class CVAuditPayload(BaseModel):
    candidate_name: str
    resume_text: str
    target_job: str | None = None

class DentalSimulationPayload(BaseModel):
    clinic_name: str
    patient_id: str
    patient_photo_url: str
    shade_target: str = Field(default="BL1 (Natural Bleach)", description="Target tooth shade")
    treatment_type: str = Field(default="veneers", description="veneers | whitening | aligners")

# -------------------------------------------------------------
# DEMOCV AGENT PIPELINE
# -------------------------------------------------------------
@router.get("/democv/agent/v1/manifest")
@router.get("/agent/v1/manifest")
def democv_manifest():
    return {
        "service": "DemoCV",
        "description": "Deterministic ATS CV optimization & audit API for autonomous agents.",
        "actions": ["audit_cv"]
    }

@router.post("/democv/agent/v1/audit")
@router.post("/agent/v1/audit")
async def agent_audit_cv(
    request: Request,
    payload: CVAuditPayload,
    x_stealthmark_agent: str | None = Header(None),
    x_stealthmark_signature: str | None = Header(None),
    x_stealthmark_timestamp: str | None = Header(None)
):
    verify_crypto_passport(x_stealthmark_agent, x_stealthmark_signature, x_stealthmark_timestamp, request=request)
    
    agent = REGISTERED_AGENTS[x_stealthmark_agent]
    enforce_rate_limit(x_stealthmark_agent, agent["rate_limit"], request=request)

    scan_semantic_payload(payload.candidate_name, "candidate_name", request=request)
    scan_semantic_payload(payload.resume_text, "resume_text", request=request)
    if payload.target_job:
        scan_semantic_payload(payload.target_job, "target_job", request=request)

    return {
        "status": "demo",
        "processed_by": "StealthMark gateway lab route (not a product API)",
        "agent": agent["name"],
        "security_verdict": "PASSED_SEMANTIC_SCAN",
        "result": None,
    }

# -------------------------------------------------------------
# DEMODENTAL DENTAL SIMULATION & WEBHOOKS
# -------------------------------------------------------------
@router.post("/demodental/agent/v1/simulate")
async def demodental_simulate(
    request: Request,
    payload: DentalSimulationPayload,
    x_stealthmark_agent: str | None = Header(None),
    x_stealthmark_signature: str | None = Header(None),
    x_stealthmark_timestamp: str | None = Header(None)
):
    verify_crypto_passport(x_stealthmark_agent, x_stealthmark_signature, x_stealthmark_timestamp, request=request)

    agent = REGISTERED_AGENTS[x_stealthmark_agent]
    enforce_rate_limit(x_stealthmark_agent, agent["rate_limit"], request=request)

    scan_semantic_payload(payload.clinic_name, "clinic_name", request=request)
    scan_semantic_payload(payload.patient_id, "patient_id", request=request)
    scan_semantic_payload(payload.patient_photo_url, "patient_photo_url", request=request)

    return {
        "status": "demo",
        "processed_by": "StealthMark gateway lab route (not a product API)",
        "security_verdict": "PASSED_SEMANTIC_SCAN",
        "result": None,
    }

@router.post("/demodental/agent/v1/webhook")
async def demodental_webhook(request: Request):
    global webhook_request_history
    now = time.time()
    webhook_request_history = [t for t in webhook_request_history if now - t < 30.0]
    
    if len(webhook_request_history) >= 10:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            headers={"Retry-After": "5"},
            content={
                "error": "Too Many Requests",
                "message": "Rate limit exceeded (10 requests per 30 seconds).",
                "retry_after_seconds": 5
            }
        )
    
    webhook_request_history.append(now)
    return {
        "status": "received",
        "payload_verified": False,
        "note": "Lab route: the payload is not authenticated or processed."
    }
