"""High-level LLM forecast generation aligned with ForecastResponse shape."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from app.config import Settings, get_settings
from app.llm.parsing import extract_json_object, parse_forecast_units
from app.llm.prompts import build_forecast_messages
from app.llm.providers import LlmProvider, get_llm_provider
from app.llm.providers.base import LLM_MODEL_NAME
from app.training.baselines import forecast_baseline


@dataclass(frozen=True, slots=True)
class LlmForecastResult:
    model: str
    model_version: str
    units: list[float]
    provider: str
    provider_model: str


def generate_llm_forecast(
    *,
    blood_group: str,
    facility_id: str | None,
    horizon_days: int,
    history_dates: list[date],
    history_values: list[float],
    settings: Settings | None = None,
    provider: LlmProvider | None = None,
) -> LlmForecastResult:
    cfg = settings or get_settings()
    llm = provider or get_llm_provider(cfg)

    if not history_dates or not history_values:
        raise ValueError("history is required for LLM forecast")

    forecast_start = history_dates[-1] + timedelta(days=1)
    baseline_hint = forecast_baseline(
        history_values,
        horizon_days,
        model_name="moving_average",
        window=7,
        season=7,
    )

    history_pairs = list(zip(history_dates, history_values, strict=False))
    messages = build_forecast_messages(
        blood_group=blood_group,
        facility_id=facility_id,
        horizon_days=horizon_days,
        forecast_start=forecast_start,
        history=history_pairs,
        baseline_hint_units=baseline_hint,
    )

    completion = llm.complete(messages)
    payload = extract_json_object(completion.content)
    units = parse_forecast_units(
        payload,
        horizon_days=horizon_days,
        forecast_start=forecast_start,
        blood_group=blood_group,
    )

    model_version = f"{completion.provider}:{completion.model}"
    return LlmForecastResult(
        model=LLM_MODEL_NAME,
        model_version=model_version,
        units=units,
        provider=completion.provider,
        provider_model=completion.model,
    )
