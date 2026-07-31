from fastapi import Depends, FastAPI
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.deps import verify_application_key
from app.rate_limit import limiter
from app.routers import audit, auth, cases, documents, users


app = FastAPI(
    title="Sistema Integral de Gestión y Control Documental",
    description=(
        "API para expedientes de nulidad matrimonial. Conserva versiones inmutables, "
        "cifra archivos en reposo, registra autorizaciones notariales y firmas de integridad."
    ),
    version="2.0.0",
    root_path="/api",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)

protected = [Depends(verify_application_key)]
app.include_router(auth.router, dependencies=protected)
app.include_router(users.router, dependencies=protected)
app.include_router(cases.router, dependencies=protected)
app.include_router(documents.router, dependencies=protected)
app.include_router(audit.router, dependencies=protected)


@app.get("/health", tags=["health"])
def health_check():
    return {"status": "ok", "service": "document-control-api", "version": app.version}
