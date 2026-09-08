"""NBTS Blood AI Forecasting Service entrypoint."""

from fastapi import FastAPI

from app.api.routes import router
from app.errors import register_exception_handlers
from app.schemas import HealthResponse

app = FastAPI(
    title="NBTS Blood AI Forecasting Service",
    version="0.1.0",
    description="Forecasting boundary for the NBTS blood supply prediction system.",
)

register_exception_handlers(app)
app.include_router(router)


@app.get("/", response_model=HealthResponse)
def root() -> HealthResponse:
    return HealthResponse(service="nbts-blood-ai-service", status="ok")
