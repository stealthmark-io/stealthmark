from typing import Optional

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware

from gateway import config, metering, state
from gateway.routes import audit_v2, blueprint, defcon, domains, manifests, microservices_v2, products, proxy, scanner, telemetry
from gateway.shields.defcon import defcon_perimeter_enforcer
from gateway.shields.errors import ShieldBlock
from gateway.shields.payload_guard import payload_size_guard
from gateway.shields.security_headers import security_headers_middleware


def create_app(lab_routes: Optional[bool] = None, public_docs: Optional[bool] = None) -> FastAPI:
    """Build the gateway. The scripted demo routers (blueprint, sample DemoCV/DemoDental pipelines) and the public
    API documentation are opt-in, so the production service serves only routes that do real work."""
    lab = config.LAB_ROUTES_ENABLED if lab_routes is None else lab_routes
    docs = config.PUBLIC_DOCS_ENABLED if public_docs is None else public_docs

    application = FastAPI(
        title="StealthMark Gateway & Security Scanner",
        version="1.6.0",
        description="Agent traffic gateway and perimeter readiness scanner",
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Payload size limiter first, then the active DEFCON perimeter posture.
    application.middleware("http")(payload_size_guard)
    application.middleware("http")(defcon_perimeter_enforcer)
    # Added last so it is outermost and also covers answers the shields above produce themselves.
    application.middleware("http")(security_headers_middleware)

    @application.exception_handler(ShieldBlock)
    async def shield_block_handler(request: Request, exc: ShieldBlock):
        await metering.record_blocked(request, exc.status_code)
        return await http_exception_handler(request, exc)

    @application.on_event("startup")
    async def startup_hydrate_telemetry():
        """Restore the persisted DEFCON posture on a fresh Cloud Run instance."""
        await state.hydrate_telemetry_from_supabase()

    @application.on_event("startup")
    async def startup_metering():
        await metering.start_metering()

    @application.on_event("shutdown")
    async def shutdown_metering():
        await metering.stop_metering()

    # Registration order matters: the universal reverse proxy is a catch-all and must stay last.
    modules = [scanner, audit_v2, microservices_v2, telemetry, defcon, domains, manifests]
    if lab:
        modules += [products, blueprint]
    modules.append(proxy)
    for module in modules:
        application.include_router(module.router)

    return application


app = create_app()
