from fastapi import HTTPException


class ShieldBlock(HTTPException):
    """Rejection raised by a shield (passport, rate limit, semantic guard).

    The app-level handler answers it exactly like an HTTPException and, when the request targets a
    registered site, records it as a free agent_blocked usage event.
    """
