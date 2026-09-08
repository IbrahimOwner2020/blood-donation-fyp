"""Forecast generation from request history, baseline/ML artifacts, or LLM."""

from __future__ import annotations

from datetime import date, timedelta

import pandas as pd

from app.artifacts import latest_artifact, load_estimator
from app.config import Settings, get_settings
from app.llm.forecast import generate_llm_forecast
from app.llm.providers.base import LLM_MODEL_NAME, is_llm_model
from app.preprocessing.series import (
    demand_values,
    ensure_min_history,
    history_to_frame,
    last_history_date,
)
from app.schemas import ForecastRequest, ForecastResponse, Metrics, PredictionPoint
from app.training.baselines import forecast_baseline, is_baseline
from app.training.ml_models import forecast_ml, is_ml_model


DEFAULT_FORECAST_MODEL = "moving_average"


def generate_forecast(
    request: ForecastRequest,
    settings: Settings | None = None,
) -> ForecastResponse:
    cfg = settings or get_settings()
    frame = history_to_frame(request.history)
    ensure_min_history(frame, settings=cfg)

    values = demand_values(frame)
    dates = _frame_dates(frame)
    preferred = (request.preferred_model or "").strip() or None

    if _should_use_llm(preferred=preferred, settings=cfg):
        return _forecast_with_llm(
            request=request,
            dates=dates,
            values=values,
            settings=cfg,
        )

    artifact = latest_artifact(
        blood_group=request.blood_group.value,
        facility_id=request.facility_id,
        settings=cfg,
    )

    # Prefer a matching trained artifact unless the caller pinned a baseline/ML name.
    if preferred and artifact is not None and artifact.model_name != preferred:
        if is_baseline(preferred) or is_ml_model(preferred):
            artifact = None

    model_name = preferred or DEFAULT_FORECAST_MODEL
    model_version = "ephemeral"
    metrics: Metrics | None = None
    window = 7
    season = 7
    predicted: list[float]

    if preferred and is_llm_model(preferred):
        return _forecast_with_llm(
            request=request,
            dates=dates,
            values=values,
            settings=cfg,
        )

    if artifact is not None and is_llm_model(artifact.model_name) and not preferred:
        return _forecast_with_llm(
            request=request,
            dates=dates,
            values=values,
            settings=cfg,
            model_version=artifact.model_version,
            metrics=_metrics_from_artifact(artifact.metrics),
        )

    if artifact is not None and is_ml_model(artifact.model_name) and (
        preferred is None or preferred == artifact.model_name
    ):
        model_name = artifact.model_name
        model_version = artifact.model_version
        metrics = _metrics_from_artifact(artifact.metrics)
        estimator = load_estimator(
            artifact.model_id,
            settings=cfg,
            artifact=artifact,
        )
        predicted = forecast_ml(
            estimator,
            dates,
            values,
            int(request.horizon_days),
        )
    elif artifact is not None and is_baseline(artifact.model_name) and (
        preferred is None or preferred == artifact.model_name
    ):
        model_name = artifact.model_name
        model_version = artifact.model_version
        params = artifact.params or {}
        window = int(params.get("window") or 7)
        season = int(params.get("season") or 7)
        metrics = _metrics_from_artifact(artifact.metrics)
        predicted = forecast_baseline(
            values,
            int(request.horizon_days),
            model_name=model_name,
            window=window,
            season=season,
        )
    elif preferred and is_baseline(preferred):
        model_name = preferred
        predicted = forecast_baseline(
            values,
            int(request.horizon_days),
            model_name=model_name,
            window=window,
            season=season,
        )
    elif preferred and is_ml_model(preferred):
        # No matching artifact: fall back to moving average rather than failing hard.
        model_name = DEFAULT_FORECAST_MODEL
        predicted = forecast_baseline(
            values,
            int(request.horizon_days),
            model_name=model_name,
            window=window,
            season=season,
        )
    else:
        model_name = DEFAULT_FORECAST_MODEL
        predicted = forecast_baseline(
            values,
            int(request.horizon_days),
            model_name=model_name,
            window=window,
            season=season,
        )

    return _build_response(
        request=request,
        model_name=model_name,
        model_version=model_version,
        predicted=predicted,
        metrics=metrics,
        frame=frame,
    )


def _should_use_llm(*, preferred: str | None, settings: Settings) -> bool:
    if preferred and is_llm_model(preferred):
        return True
    if preferred:
        return False
    return bool(settings.llm_forecast_default) and settings.llm_provider != "none"


def _forecast_with_llm(
    *,
    request: ForecastRequest,
    dates: list[date],
    values: list[float],
    settings: Settings,
    model_version: str | None = None,
    metrics: Metrics | None = None,
) -> ForecastResponse:
    result = generate_llm_forecast(
        blood_group=request.blood_group.value,
        facility_id=request.facility_id,
        horizon_days=int(request.horizon_days),
        history_dates=dates,
        history_values=values,
        settings=settings,
    )
    frame = history_to_frame(request.history)
    return _build_response(
        request=request,
        model_name=result.model or LLM_MODEL_NAME,
        model_version=model_version or result.model_version,
        predicted=result.units,
        metrics=metrics,
        frame=frame,
    )


def _build_response(
    *,
    request: ForecastRequest,
    model_name: str,
    model_version: str,
    predicted: list[float],
    metrics: Metrics | None,
    frame: pd.DataFrame,
) -> ForecastResponse:
    start = last_history_date(frame) + timedelta(days=1)
    predictions = [
        PredictionPoint(date=start + timedelta(days=offset), units=float(units))
        for offset, units in enumerate(predicted)
    ]
    total = float(sum(point.units for point in predictions))
    return ForecastResponse(
        blood_group=request.blood_group,
        facility_id=request.facility_id,
        horizon_days=request.horizon_days,
        model=model_name,
        model_version=model_version,
        predictions=predictions,
        total_predicted_units=total,
        metrics=metrics,
    )


def _metrics_from_artifact(raw: dict[str, float | None] | None) -> Metrics | None:
    if not raw:
        return None
    return Metrics(
        mae=raw.get("mae"),
        rmse=raw.get("rmse"),
        wape=raw.get("wape"),
    )


def _frame_dates(frame: pd.DataFrame) -> list[date]:
    return [pd.Timestamp(value).date() for value in frame["date"].tolist()]
