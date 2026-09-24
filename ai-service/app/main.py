"""Blood Donation Management System chat service entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from app.api.routes import router
from app.config import get_settings, load_dotenv_files
from app.errors import register_exception_handlers
from app.schemas import HealthResponse


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    load_dotenv_files()
    get_settings.cache_clear()
    get_settings()
    yield


app = FastAPI(
    title="Blood Donation Management System Chat Service",
    version="0.1.0",
    description="Chat boundary for public donation education and the authenticated staff assistant.",
    lifespan=lifespan,
)

register_exception_handlers(app)
app.include_router(router)


@app.get("/", response_model=HealthResponse)
def root() -> HealthResponse:
    return HealthResponse(service="blood-donation-chat-service", status="ok")
