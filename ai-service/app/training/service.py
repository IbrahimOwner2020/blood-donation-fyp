"""Training orchestration for baseline and ML candidate models."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timezone

import pandas as pd
from sklearn.base import RegressorMixin

from app.artifacts import (
    ArtifactParams,
    ModelArtifact,
    make_model_id,
    make_model_version,
    save_artifact,
)
from app.config import Settings, get_settings
from app.errors import AiServiceError, unsupported_model
from app.evaluation.metrics import compute_metrics
from app.features.lag_rolling import FEATURE_COLUMNS
from app.llm.providers.base import LLM_MODEL_NAME, is_llm_model
from app.preprocessing.series import demand_values, ensure_min_history
from app.schemas import Metrics, TrainRequest, TrainResponse, TrainingSeriesPoint
from app.training.baselines import (
    BASELINE_NAMES,
    forecast_baseline,
    is_baseline,
    one_step_insample_predictions,
)
from app.training.ml_models import (
    ML_MODEL_NAMES,
    evaluate_ml_candidate,
    is_ml_model,
    train_ml_model,
)


SUPPORTED_TRAINING_MODELS = set(BASELINE_NAMES) | set(ML_MODEL_NAMES) | {LLM_MODEL_NAME}


def train_models(request: TrainRequest, settings: Settings | None = None) -> TrainResponse:
    cfg = settings or get_settings()
    requested = list(request.candidate_models or [])
    if not requested:
        requested = list(BASELINE_NAMES)

    llm_only = all(is_llm_model(name) for name in requested) and bool(requested)
    candidates = [
        name
        for name in requested
        if name in SUPPORTED_TRAINING_MODELS and not is_llm_model(name)
    ]
    if not candidates and not llm_only:
        raise unsupported_model(requested[0] if requested else "none")

    groups = _group_series(request.series)
    if not groups:
        raise unsupported_model("none")

    key = max(groups.keys(), key=lambda item: len(groups[item]))
    blood_group, facility_id = key
    points = groups[key]
    frame = _points_to_frame(points)
    ensure_min_history(frame, settings=cfg)

    values = demand_values(frame)
    dates = _frame_dates(frame)
    baseline_name = "historical_average"
    baseline_metrics = _evaluate_baseline(values, baseline_name)

    if llm_only:
        return _save_llm_stub_artifact(
            blood_group=blood_group,
            facility_id=facility_id,
            dates=dates,
            values=values,
            baseline_metrics=baseline_metrics,
            settings=cfg,
        )

    scored: list[tuple[str, Metrics]] = []
    for name in candidates:
        if is_baseline(name):
            scored.append((name, _evaluate_baseline(values, name)))
        elif is_ml_model(name):
            scored.append((name, evaluate_ml_candidate(dates, values, model_name=name)))
        else:
            raise unsupported_model(name)

    scored.sort(
        key=lambda item: (
            item[1].mae is None,
            item[1].mae if item[1].mae is not None else 1e18,
        )
    )
    selected_name, selected_metrics = scored[0]

    trained_at = datetime.now(timezone.utc)
    model_version = make_model_version(trained_at)
    model_id = make_model_id(selected_name, model_version)
    training_start = dates[0].isoformat() if dates else None
    training_end = dates[-1].isoformat() if dates else None

    estimator: RegressorMixin | None = None
    features: list[str] = ["demand_units"]
    params: ArtifactParams = {
        "window": 7,
        "season": 7,
        "n_observations": len(values),
    }

    if is_ml_model(selected_name):
        try:
            trained = train_ml_model(dates, values, model_name=selected_name)
        except ValueError as exc:
            raise AiServiceError(
                code="INSUFFICIENT_HISTORY",
                message=str(exc),
                status_code=400,
            ) from exc
        estimator = trained.estimator
        selected_metrics = trained.metrics
        features = list(trained.features or FEATURE_COLUMNS)
        params = {
            **trained.params,
            "features": features,
        }
    elif not is_baseline(selected_name):
        raise unsupported_model(selected_name)

    artifact = ModelArtifact(
        model_id=model_id,
        model_name=selected_name,
        model_version=model_version,
        blood_group=blood_group,
        facility_id=facility_id,
        trained_at=trained_at.isoformat(),
        training_start=training_start,
        training_end=training_end,
        features=features,
        target="demand_units",
        horizon_days=cfg.default_forecast_horizon,
        metrics={
            "mae": selected_metrics.mae,
            "rmse": selected_metrics.rmse,
            "wape": selected_metrics.wape,
        },
        baseline_metrics={
            "mae": baseline_metrics.mae,
            "rmse": baseline_metrics.rmse,
            "wape": baseline_metrics.wape,
        },
        params=params,
        estimator_file="model.joblib" if estimator is not None else None,
    )
    save_artifact(artifact, settings=cfg, estimator=estimator)

    return TrainResponse(
        selected_model=selected_name,
        model_version=model_version,
        metrics=selected_metrics,
        baseline_metrics=baseline_metrics,
    )


def _save_llm_stub_artifact(
    *,
    blood_group: str,
    facility_id: str | None,
    dates: list[date],
    values: list[float],
    baseline_metrics: Metrics,
    settings: Settings,
) -> TrainResponse:
    """Register an LLM forecast candidate without sklearn training."""
    trained_at = datetime.now(timezone.utc)
    model_version = make_model_version(trained_at)
    model_id = make_model_id(LLM_MODEL_NAME, model_version)
    provider = settings.llm_provider if settings.llm_provider != "none" else "unconfigured"
    provider_model = (
        settings.ollama_model
        if settings.llm_provider == "ollama"
        else settings.openai_model
        if settings.llm_provider == "openai"
        else "none"
    )
    # Use baseline metrics as a transparent reference; LLM is not MAE-trained.
    selected_metrics = baseline_metrics
    artifact = ModelArtifact(
        model_id=model_id,
        model_name=LLM_MODEL_NAME,
        model_version=f"{provider}:{provider_model}:{model_version}",
        blood_group=blood_group,
        facility_id=facility_id,
        trained_at=trained_at.isoformat(),
        training_start=dates[0].isoformat() if dates else None,
        training_end=dates[-1].isoformat() if dates else None,
        features=["demand_units", "llm_prompt_context"],
        target="demand_units",
        horizon_days=settings.default_forecast_horizon,
        metrics={
            "mae": selected_metrics.mae,
            "rmse": selected_metrics.rmse,
            "wape": selected_metrics.wape,
        },
        baseline_metrics={
            "mae": baseline_metrics.mae,
            "rmse": baseline_metrics.rmse,
            "wape": baseline_metrics.wape,
        },
        params={
            "llm_provider": provider,
            "llm_model": provider_model,
            "n_observations": len(values),
            "note": "LLM candidate; forecasts at request time via configured provider.",
        },
        estimator_file=None,
    )
    save_artifact(artifact, settings=settings, estimator=None)
    return TrainResponse(
        selected_model=LLM_MODEL_NAME,
        model_version=artifact.model_version,
        metrics=selected_metrics,
        baseline_metrics=baseline_metrics,
    )


def _evaluate_baseline(values: list[float], model_name: str) -> Metrics:
    actuals, preds = one_step_insample_predictions(values, model_name=model_name)
    if not actuals:
        constant = forecast_baseline(values, 1, model_name=model_name)
        mean_actual = float(sum(values) / len(values)) if values else 0.0
        return compute_metrics([mean_actual], constant or [0.0])
    return compute_metrics(actuals, preds)


def _group_series(
    series: list[TrainingSeriesPoint],
) -> dict[tuple[str, str | None], list[TrainingSeriesPoint]]:
    groups: dict[tuple[str, str | None], list[TrainingSeriesPoint]] = defaultdict(list)
    for point in series:
        key = (point.blood_group.value, point.facility_id)
        groups[key].append(point)
    return groups


def _points_to_frame(points: list[TrainingSeriesPoint]) -> pd.DataFrame:
    rows = [{"date": point.date, "demand_units": point.demand_units} for point in points]
    frame = pd.DataFrame(rows)
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce").dt.normalize()
    frame["demand_units"] = pd.to_numeric(frame["demand_units"], errors="coerce")
    frame = frame.dropna(subset=["date", "demand_units"])
    frame = frame.sort_values("date").drop_duplicates(subset=["date"], keep="last")
    return frame.reset_index(drop=True)


def _frame_dates(frame: pd.DataFrame) -> list[date]:
    return [pd.Timestamp(value).date() for value in frame["date"].tolist()]
