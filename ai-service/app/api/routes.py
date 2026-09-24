"""Chat-only FastAPI routes for public education and the staff assistant."""

from __future__ import annotations

from fastapi import APIRouter

from app.chat.public import run_public_chat
from app.chat.service import run_chat
from app.config import get_settings
from app.schemas import (
    AssistantChatRequest,
    AssistantChatResponse,
    HealthResponse,
    PublicChatRequest,
    PublicChatResponse,
)


router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(service="ai-service", status="ok")


@router.post("/chat", response_model=AssistantChatResponse)
def chat(request: AssistantChatRequest) -> AssistantChatResponse:
    return run_chat(request, settings=get_settings())


@router.post("/public-chat", response_model=PublicChatResponse)
def public_chat(request: PublicChatRequest) -> PublicChatResponse:
    return run_public_chat(request, settings=get_settings())
