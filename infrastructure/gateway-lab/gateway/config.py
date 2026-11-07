import logging
import os

logger = logging.getLogger("stealthmark.gateway")

# Supabase Real Audit Event Persistence
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "") or os.getenv("SUPABASE_KEY", "")
INTERNAL_AUTH_SECRET = os.getenv("INTERNAL_AUTH_SECRET", "")

# Upstream Targets
DEMOCV_UPSTREAM = os.getenv("DEMOCV_UPSTREAM", "https://www.democv.example.com")
DEMODENTAL_UPSTREAM = os.getenv("DEMODENTAL_UPSTREAM", "https://www.demodental.example.com")
# No default: the old smile-api host lived in a shut-down Cloud Run project. Set it only to a live upstream.
SMILE_API_UPSTREAM = os.getenv("SMILE_API_UPSTREAM", "")

MAX_BODY_BYTES = 2 * 1024 * 1024  # 2MB Maximum Payload Cap

# Demo-only routers (scripted blueprint scenarios, DemoCV/DemoDental sample pipelines). Off unless exactly "true"; never enable on Cloud Run.
LAB_ROUTES_ENABLED = os.getenv("GATEWAY_LAB_ROUTES", "") == "true"

# Swagger UI, ReDoc and the OpenAPI document are published only when exactly "true".
PUBLIC_DOCS_ENABLED = os.getenv("GATEWAY_PUBLIC_DOCS", "") == "true"

TELEMETRY_CACHE_FILE = "/tmp/stealthmark_gateway_telemetry.json"

# Shared secret for signed agent passports. When unset, passports are treated as absent (never as valid).
PASSPORT_HMAC_SECRET = os.getenv("PASSPORT_HMAC_SECRET", "")

# Number of trusted reverse proxies in front of the gateway; the client IP is the Nth entry from the right of X-Forwarded-For.
TRUSTED_PROXY_HOPS = int(os.getenv("TRUSTED_PROXY_HOPS", "1") or "1")

# User-Agent tokens of AI agents and AI crawlers. Mirrors packages/core/src/detect-agent.ts so SDK and gateway bill the same traffic.
# Generic client tokens (curl, python, bot, spider, postman) are deliberately absent: monitors and search crawlers are not billed.
# Applebot-Extended and Google-Extended are robots.txt tokens, never sent as a User-Agent, so they are not matched.
AGENT_UA_TOKENS = tuple(token.lower() for token in (
    "GPTBot", "OAI-SearchBot", "ChatGPT-User",
    "ClaudeBot", "Claude-User", "Claude-SearchBot", "Anthropic-AI",
    "PerplexityBot", "Perplexity-User",
    "Meta-ExternalAgent", "Amazonbot", "Google-CloudVertexBot",
    "CCBot", "Bytespider", "cohere-ai", "DuckAssistBot", "YouBot",
    "OpenAI-Operator", "Claude-Agent", "MCP-Client", "A2A-Client", "AgentProtocol",
))
