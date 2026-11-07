import hashlib
import hmac
import math
import time
from typing import Optional

from fastapi import Request, status

from gateway.audit import record_audit_log
from gateway.config import PASSPORT_HMAC_SECRET
from gateway.shields.errors import ShieldBlock
from gateway.state import TELEMETRY

PASSPORT_MAX_SKEW_SECONDS = 120

# Registry of known agents (no key material). Each agent signs with a key derived from PASSPORT_HMAC_SECRET.
REGISTERED_AGENTS = {
    "agent_autodev_001": {"name": "Autonomous Dev Agent", "tier": "enterprise", "rate_limit": 500},
    "agent_claude_prod": {"name": "Claude Agentic Client", "tier": "pro", "rate_limit": 300},
    "agent_clinic_miami": {"name": "Miami Dental Aesthetics Bot", "tier": "clinic", "rate_limit": 400},
}


def sign_passport(agent_id: str, timestamp: str) -> Optional[str]:
    """HMAC-SHA256 passport signature, or None when PASSPORT_HMAC_SECRET is not configured."""
    if not PASSPORT_HMAC_SECRET:
        return None
    agent_key = hmac.new(PASSPORT_HMAC_SECRET.encode("utf-8"), agent_id.encode("utf-8"), hashlib.sha256).digest()
    return hmac.new(agent_key, f"{agent_id}:{timestamp}".encode("utf-8"), hashlib.sha256).hexdigest()


def passport_failure(
    agent_id: Optional[str], signature: Optional[str], timestamp: Optional[str]
) -> Optional[tuple[str, str]]:
    """Return (audit label, client message) for the first failed check, or None when the passport is valid.

    Without a configured secret every passport fails: an unverifiable credential is never accepted.
    """
    if not agent_id or agent_id not in REGISTERED_AGENTS:
        return "Unauthorized Agent: Identity Spoofing Blocked", "Unauthorized Agent. Unregistered identity."
    if not signature or not PASSPORT_HMAC_SECRET:
        return "Missing Passport Signature Blocked", "Signed passport required."
    if not timestamp:
        return "Missing Timestamp Header Blocked", "Spoofing Detected. Timestamp header required for cryptographic passport."
    try:
        issued_at = float(timestamp)
    except ValueError:
        return "Invalid Timestamp Format Blocked", "Invalid timestamp format."
    if not math.isfinite(issued_at):
        return "Invalid Timestamp Format Blocked", "Invalid timestamp format."
    if abs(time.time() - issued_at) > PASSPORT_MAX_SKEW_SECONDS:
        return "Expired Passport Replay Blocked", "Replay Attack Blocked. Passport timestamp expired."
    expected = sign_passport(agent_id, timestamp)
    if expected is None or not hmac.compare_digest(expected, signature):
        return "Forged Signature Passport Blocked", "Cryptographic Signature Invalid. Identity spoofing detected."
    return None


def has_valid_passport(request: Request) -> bool:
    return passport_failure(
        request.headers.get("x-stealthmark-agent"),
        request.headers.get("x-stealthmark-signature"),
        request.headers.get("x-stealthmark-timestamp"),
    ) is None


def verify_crypto_passport(agent_id: Optional[str], signature: Optional[str], timestamp: Optional[str], request: Optional[Request] = None):
    started = time.perf_counter()
    failure = passport_failure(agent_id, signature, timestamp)
    if failure is None:
        return
    label, message = failure
    TELEMETRY["requests_total"] += 1
    TELEMETRY["threats_blocked"]["spoofed_identities"] += 1
    if request:
        record_audit_log(request, 401, (time.perf_counter() - started) * 1000, label)
    raise ShieldBlock(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": message})
