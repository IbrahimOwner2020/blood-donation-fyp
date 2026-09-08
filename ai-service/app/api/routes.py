"""FastAPI route handlers for the AI forecasting service."""

from __future__ import annotations

from fastapi import APIRouter

from app.artifacts import list_artifacts, load_artifact
from app.config import get_settings
from app.chat.service import run_chat
from app.forecasting.service import generate_forecast
from app.schemas import (
    AssistantChatRequest,
    AssistantChatResponse,
    ForecastRequest,
    ForecastResponse,
    HealthResponse,
    ModelMetricsResponse,
    ModelsListResponse,
    TrainRequest,
    TrainResponse,
)
from app.training.service import train_models


router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(service="ai-service", status="ok")


@router.post("/chat", response_model=AssistantChatResponse)
def chat(request: AssistantChatRequest) -> AssistantChatResponse:
    return run_chat(request, settings=get_settings())


@router.post("/train", response_model=TrainResponse)
def train(request: TrainRequest) -> TrainResponse:
    return train_models(request, settings=get_settings())


@router.post("/forecast", response_model=ForecastResponse)
def forecast(request: ForecastRequest) -> ForecastResponse:
    return generate_forecast(request, settings=get_settings())


@router.get("/models", response_model=ModelsListResponse)
def models() -> ModelsListResponse:
    artifacts = list_artifacts(settings=get_settings())
    return ModelsListResponse(models=[artifact.to_summary() for artifact in artifacts])


@router.get("/models/{model_id}/metrics", response_model=ModelMetricsResponse)
def model_metrics(model_id: str) -> ModelMetricsResponse:
    artifact = load_artifact(model_id, settings=get_settings())
    return artifact.to_metrics_response()
