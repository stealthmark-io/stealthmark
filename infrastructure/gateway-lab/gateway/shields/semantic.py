import re
import time
import unicodedata

from fastapi import Request, status

from gateway.audit import record_audit_log
from gateway.shields.errors import ShieldBlock
from gateway.state import TELEMETRY

# Semantic injection & jailbreak regex patterns (DEFCON 5 Ultra Hardened - Rev 00025-67t)
HOSTILE_PATTERNS = [
    # Core Instruction Overrides
    r"ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions",
    r"output\s+(?:the\s+)?(?:system\s+prompt|env\s+vars|environment)",
    r"disregard\s+(?:all\s+)?(?:prior|previous\s+)?instructions",
    r"bypass\s+(?:system\s+)?directives",
    r"dump\s+(?:the\s+)?(?:environment|env|database|db|tables)",
    # Roleplay & Jailbreaks (DAN, RootAdmin, System)
    r"roleplay\s+as\s+",
    r"act\s+as\s+(?:dan\b|rootadmin|system|admin)",
    r"dan\s*\((?:do\s+anything\s+now)\)",
    # Delimiter Escapes & System Directive Spoofing (DEFCON 5 Ultra)
    r"(?:---\s*end\s+of|\n\s*\[system\s+(?:directive|prompt|instruction)\])",
    r"\[system\s+(?:directive|prompt|instruction)\]",
    r"end\s+of\s+(?:resume|input|context|data)\s*---",
    # Markdown Image Exfiltration & Data Leaks (DEFCON 5 Ultra - linear-time O(N) non-backtracking)
    r"!\[[^\]]*\]\((?:https?:)?//[^\)\(\[\s]*(?:leak|exfil|token|prompt|key|secret|env)[^\)\(\[\s]*\)",
    r"!\[[^\]]*\]\(https?://[^\)\(\[\s]*\)",
    # Code Injection & SQLi Vectors
    r"<script[\s>]",
    r"javascript:",
    r"onerror\s*=",
    r"drop\s+table\s+",
    r"union\s+select\s+",
    r"'\s*or\s+'1'\s*=\s*'1",
    r"--\s*$",
    # Mass Assignment / Broken Object Property Level Authorization (OWASP API3:2023 / CWE-915)
    r"\"(?:is_admin|is_superuser|is_staff|isadmin)\"\s*:\s*true",
    r"\"(?:role|user_role|account_role)\"\s*:\s*\"(?:superadmin|root_admin|system_owner)\""
]

def scan_semantic_payload(text: str, field_name: str = "field", request: Request = None):
    if not text:
        return
    started = time.perf_counter()
    # NFKC folds compatibility forms (full-width "Ｉｇｎｏｒｅ", ideographic spaces) to ASCII before matching.
    folded_text = unicodedata.normalize("NFKC", text)
    # DEFCON 5 Ultra: Normalize zero-width and invisible unicode characters (Unicode Smuggling Shield)
    normalized_text = re.sub(r"[\u200b\u200c\u200d\u200e\u200f\ufeff\u00ad\u2060\u2061\u2062\u2063\u2064]", "", folded_text)
    text_lower = normalized_text.lower()
    for pattern in HOSTILE_PATTERNS:
        if re.search(pattern, text_lower):
            TELEMETRY["requests_total"] += 1
            TELEMETRY["threats_blocked"]["semantic_injections"] += 1
            if request:
                record_audit_log(request, 422, (time.perf_counter() - started) * 1000, f"Semantic Injection Blocked ({field_name})")
            raise ShieldBlock(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "error": "Semantic Injection Blocked",
                    "reason": f"Hostile instruction, delimiter escape, or exfiltration pattern detected in '{field_name}'.",
                    "shield": "StealthMark Defcon 5 Ultra Semantic Guard (Rev 00026-gb2)"
                }
            )
