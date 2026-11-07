import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from gateway import state
from gateway.audit import record_audit_log
from gateway.auth import require_internal_secret

router = APIRouter()


class DefconShiftModel(BaseModel):
    level: int

@router.get("/api/v1/defcon")
def get_defcon_posture():
    postures = {
        1: "DEFCON 1 — Emergency Origin Lockdown",
        2: "DEFCON 2 — High Readiness",
        3: "DEFCON 3 — Elevated Surveillance",
        4: "DEFCON 4 — Guarded Perimeter",
        5: "DEFCON 5 — Normal Operations"
    }
    return {
        "status": "operational",
        "defcon_level": state.CURRENT_DEFCON_LEVEL,
        "posture": postures.get(state.CURRENT_DEFCON_LEVEL, "DEFCON 5 — Normal Operations"),
        "timestamp": time.time()
    }

@router.post("/api/v1/defcon")
@router.post("/api/v1/defcon/level")
def update_defcon_posture(body: DefconShiftModel, request: Request):
    require_internal_secret(request)
    if body.level < 1 or body.level > 5:
        raise HTTPException(status_code=400, detail="Invalid DEFCON level. Must be between 1 and 5.")
    prev_level = state.CURRENT_DEFCON_LEVEL
    state.CURRENT_DEFCON_LEVEL = body.level
    state.save_cached_telemetry()
    record_audit_log(
        request=request,
        status_code=200,
        latency_ms=0.5,
        security_check=f"Tactical Perimeter Shift: DEFCON {prev_level} -> DEFCON {state.CURRENT_DEFCON_LEVEL}",
        tokens_saved=0
    )
    return {
        "status": "success",
        "previous_level": prev_level,
        "active_defcon": state.CURRENT_DEFCON_LEVEL,
        "message": f"Edge perimeter defense posture shifted to DEFCON {state.CURRENT_DEFCON_LEVEL}."
    }
