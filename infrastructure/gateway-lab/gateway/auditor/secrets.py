"""Secret patterns for public HTML and JavaScript bundles (P1-3).

Matches are reported redacted (prefix, last 4 characters and a short SHA-256) and are never
validated against the provider: the scan only reads what the site already serves.
"""
import base64
import binascii
import hashlib
import json
import re
import urllib.parse
from dataclasses import dataclass
from typing import Optional


_START = r"(?<![A-Za-z0-9_-])"
_END = r"(?![A-Za-z0-9_-])"

# (kind, literal prefix shown in the redacted value, pattern). Every match is a leaked secret.
_SECRET_PATTERNS: list[tuple[str, str, re.Pattern[str]]] = [
    ("OpenAI API key", "sk-proj-", re.compile(_START + r"sk-proj-[A-Za-z0-9_-]{74}T3BlbkFJ[A-Za-z0-9_-]{74}" + _END)),
    ("OpenAI API key", "sk-", re.compile(_START + r"sk-[A-Za-z0-9]{48}" + _END)),
    ("Anthropic API key", "sk-ant-", re.compile(_START + r"sk-ant-(?:api03|admin01)-[A-Za-z0-9_-]{80,}" + _END)),
    ("Stripe secret key", "sk_live_", re.compile(r"\bsk_live_[0-9a-zA-Z]{24,99}\b")),
    ("Stripe restricted key", "rk_live_", re.compile(r"\brk_live_[0-9a-zA-Z]{24,99}\b")),
    ("GitHub token", "ghp_", re.compile(r"\bghp_[0-9a-zA-Z]{30,45}\b")),
    ("Resend API key", "re_", re.compile(r"\bre_[0-9a-zA-Z]{8}_[0-9a-zA-Z]{16,40}\b")),
    ("Slack bot token", "xoxb-", re.compile(r"\bxoxb-[0-9]{10,14}-[0-9A-Za-z-]{18,40}\b")),
]
AI_PROVIDER_KINDS = frozenset({"OpenAI API key", "Anthropic API key"})

_JWT_RE = re.compile(_START + r"eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{16,}")
_MAX_JWTS_DECODED = 20
_AWS_KEY_ID_RE = re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")
_AWS_SECRET_RE = re.compile(r"(?<![A-Za-z0-9/+=])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+=])")
_AWS_SECRET_WINDOW = 200
# Google browser keys (Maps, Firebase) are public by design: reported as info, not as a leaked secret.
GOOGLE_BROWSER_KEY_RE = re.compile(r"\bAIzaSy[0-9A-Za-z_-]{33}\b")

# [^<>] keeps each match inside its own tag, so a page of unclosed <script tags is scanned in linear time.
_SCRIPT_SRC_RE = re.compile(r"""<script\b[^<>]*\bsrc\s*=\s*["']([^"'<>]+)["']""", re.IGNORECASE)
_BUNDLE_PATH_RE = re.compile(r"\A/(?:_next/static/chunks|assets)/[^?#]{1,200}\.js\Z")
MAX_BUNDLES = 2


@dataclass(frozen=True)
class SecretHit:
    kind: str
    severity: str  # "fail" for a usable secret, "warn" for an AWS key id without its secret nearby
    redacted: str


def redact(value: str, prefix: str) -> str:
    digest = hashlib.sha256(value.encode()).hexdigest()[:8]
    return f"{prefix}…{value[-4:]} (sha256:{digest})"


def _jwt_role(segment: str) -> Optional[str]:
    try:
        claims = json.loads(base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4)))
    except (binascii.Error, ValueError):
        return None
    return claims.get("role") if isinstance(claims, dict) else None


def find_secrets(text: str) -> list[SecretHit]:
    hits: dict[str, SecretHit] = {}

    def add(kind: str, severity: str, value: str, prefix: str) -> None:
        hit = SecretHit(kind, severity, redact(value, prefix))
        hits.setdefault(hit.redacted, hit)

    for kind, prefix, pattern in _SECRET_PATTERNS:
        for match in pattern.finditer(text):
            add(kind, "fail", match.group(0), prefix)

    # A Supabase anon key is public by design; only a service_role JWT bypasses row-level security.
    for i, match in enumerate(_JWT_RE.finditer(text)):
        if i >= _MAX_JWTS_DECODED:
            break
        if _jwt_role(match.group(1)) == "service_role":
            add("Supabase service_role key", "fail", match.group(0), "eyJ")

    for match in _AWS_KEY_ID_RE.finditer(text):
        key_id = match.group(0)
        if key_id.endswith("EXAMPLE"):
            continue
        window = text[max(0, match.start() - _AWS_SECRET_WINDOW): match.end() + _AWS_SECRET_WINDOW]
        paired = _AWS_SECRET_RE.search(window) is not None
        add("AWS access key" if paired else "AWS access key ID", "fail" if paired else "warn", key_id, key_id[:4])

    return list(hits.values())


def describe(hits: list[SecretHit], source: Optional[str] = None) -> str:
    where = f" in {source}" if source else ""
    return "; ".join(f"{h.kind} {h.redacted}{where}" for h in hits[:5])


def bundle_paths(home_html: str, domain: str) -> list[str]:
    """Same-origin JS bundles the home page loads, page chunks first (they carry inlined public env values)."""
    hosts = {domain, f"www.{domain}", domain.removeprefix("www.")}
    paths: list[str] = []
    for src in _SCRIPT_SRC_RE.findall(home_html):
        parts = urllib.parse.urlsplit(src)
        if (parts.scheme and parts.scheme != "https") or (parts.netloc and parts.netloc.lower() not in hosts):
            continue
        if not parts.netloc and not src.startswith("/"):
            continue
        if _BUNDLE_PATH_RE.match(parts.path) and parts.path not in paths:
            paths.append(parts.path)
    page_chunks = [p for p in paths if "/app/" in p or "/pages/" in p]
    return (page_chunks + [p for p in paths if p not in page_chunks])[:MAX_BUNDLES]
