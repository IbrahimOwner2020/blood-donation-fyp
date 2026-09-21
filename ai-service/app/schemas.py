"""Pydantic request/response models matching docs/14-api-ai-contracts.md."""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class BloodGroup(str, Enum):
    A_POS = "A+"
    A_NEG = "A-"
    B_POS = "B+"
    B_NEG = "B-"
    AB_POS = "AB+"
    AB_NEG = "AB-"
    O_POS = "O+"
    O_NEG = "O-"


HorizonDays = Literal[7, 14, 30, 60]

BaselineModelName = Literal[
    "historical_average",
    "moving_average",
    "seasonal_naive",
]

CandidateModelName = Literal[
    "historical_average",
    "moving_average",
    "seasonal_naive",
    "random_forest",
    "hist_gradient_boosting",
    "llm",
]

PreferredForecastModel = Literal[
    "historical_average",
    "moving_average",
    "seasonal_naive",
    "random_forest",
    "hist_gradient_boosting",
    "llm",
]


class HealthResponse(BaseModel):
    service: str
    status: str


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody


class AssistantActionProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=12, max_length=120)
    action: str = Field(..., min_length=1, max_length=80)
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(..., min_length=1, max_length=1000)
    requiredPermission: str = Field(..., min_length=1, max_length=80)
    payload: dict[str, object] = Field(default_factory=dict)
    effect: str = Field(..., min_length=1, max_length=1000)


class AssistantContext(BaseModel):
    model_config = ConfigDict(extra="allow")

    pathname: str | None = Field(default=None, max_length=300)
    search: str | None = Field(default=None, max_length=800)
    filters: dict[str, object] = Field(default_factory=dict)


class AssistantToolDescriptor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    description: str
    requiredPermission: str | None = None
    mutates: bool
    inputSchema: dict[str, object] = Field(default_factory=dict)


class AssistantChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(..., min_length=1, max_length=2000)
    context: AssistantContext | None = None
    permissions: list[str] = Field(default_factory=list)
    toolSessionToken: str = Field(..., min_length=24, max_length=160)
    toolsUrl: str = Field(..., min_length=1)


class AssistantChatResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["answer", "navigation", "permission_denied", "action_proposal"]
    message: str = Field(..., min_length=1, max_length=4000)
    path: str | None = None
    requiredPermission: str | None = None
    proposal: AssistantActionProposal | None = None


class HistoryPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: date
    demand_units: float = Field(..., ge=0)


class ForecastRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    blood_group: BloodGroup
    facility_id: str | None = None
    horizon_days: HorizonDays = 7
    history: list[HistoryPoint] = Field(..., min_length=1)
    # Optional selector: "llm" uses configured OpenAI (primary) or Ollama path (docs/14).
    preferred_model: PreferredForecastModel | None = None

    @field_validator("history")
    @classmethod
    def history_must_have_unique_dates(cls, value: list[HistoryPoint]) -> list[HistoryPoint]:
        dates = [point.date for point in value]
        if len(dates) != len(set(dates)):
            raise ValueError("history dates must be unique")
        return value


class PredictionPoint(BaseModel):
    date: date
    units: float


class Metrics(BaseModel):
    mae: float | None = None
    rmse: float | None = None
    wape: float | None = None


class ForecastResponse(BaseModel):
    blood_group: BloodGroup
    facility_id: str | None = None
    horizon_days: HorizonDays
    model: str
    model_version: str
    predictions: list[PredictionPoint]
    total_predicted_units: float
    metrics: Metrics | None = None


class TrainingSeriesPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    blood_group: BloodGroup
    facility_id: str | None = None
    date: date
    demand_units: float = Field(..., ge=0)


class TrainRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    series: list[TrainingSeriesPoint] = Field(..., min_length=1)
    candidate_models: list[CandidateModelName] = Field(
        default_factory=lambda: [
            "historical_average",
            "moving_average",
            "seasonal_naive",
        ]
    )


class TrainResponse(BaseModel):
    selected_model: str
    model_version: str
    metrics: Metrics
    baseline_metrics: Metrics


class ModelSummary(BaseModel):
    model_id: str
    model_name: str
    model_version: str
    blood_group: BloodGroup | None = None
    facility_id: str | None = None
    trained_at: str | None = None
    training_start: date | None = None
    training_end: date | None = None
    features: list[str] = Field(default_factory=list)
    target: str = "demand_units"
    horizon_days: int | None = None
    metrics: Metrics | None = None


class ModelsListResponse(BaseModel):
    models: list[ModelSummary]


class ModelMetricsResponse(BaseModel):
    model_id: str
    model_name: str
    model_version: str
    metrics: Metrics
    baseline_metrics: Metrics | None = None
    training_start: date | None = None
    training_end: date | None = None
    features: list[str] = Field(default_factory=list)
    target: str = "demand_units"
    horizon_days: int | None = None
