"""ML candidate train/forecast unit tests with synthetic series."""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from app.artifacts import load_artifact, load_estimator
from app.config import Settings
from app.features.lag_rolling import FEATURE_COLUMNS
from app.schemas import TrainRequest, TrainingSeriesPoint, BloodGroup
from app.training.ml_models import forecast_ml, train_ml_model
from app.training.service import train_models


def _dates_values(days: int = 45) -> tuple[list[date], list[float]]:
    start = date(2026, 1, 1)
    dates = [start + timedelta(days=offset) for offset in range(days)]
    values = [
        float(6 + (offset % 6) + (3 if offset % 7 in {5, 6} else 0))
        for offset in range(days)
    ]
    return dates, values


def test_train_random_forest_and_recursive_forecast() -> None:
    dates, values = _dates_values(45)
    trained = train_ml_model(dates, values, model_name="random_forest")
    assert trained.model_name == "random_forest"
    assert trained.features == FEATURE_COLUMNS
    assert trained.metrics.mae is not None
    assert trained.metrics.rmse is not None
    preds = forecast_ml(trained.estimator, dates, values, horizon=7)
    assert len(preds) == 7
    assert all(isinstance(value, float) for value in preds)
    assert all(value >= 0.0 for value in preds)


def test_train_hist_gradient_boosting_metrics_present() -> None:
    dates, values = _dates_values(45)
    trained = train_ml_model(dates, values, model_name="hist_gradient_boosting")
    assert trained.model_name == "hist_gradient_boosting"
    assert trained.metrics.mae is not None
    assert trained.metrics.wape is None or trained.metrics.wape >= 0.0


def test_train_pipeline_persists_ml_artifact(settings: Settings, model_dir: Path) -> None:
    dates, values = _dates_values(45)
    series = [
        TrainingSeriesPoint(
            blood_group=BloodGroup.O_POS,
            facility_id="facility-001",
            date=day,
            demand_units=units,
        )
        for day, units in zip(dates, values, strict=True)
    ]
    response = train_models(
        TrainRequest(
            series=series,
            candidate_models=["random_forest", "historical_average"],
        ),
        settings=settings,
    )
    assert response.selected_model in {"random_forest", "historical_average"}
    assert response.metrics.mae is not None
    assert response.baseline_metrics.mae is not None

    # Artifact directory should exist under MODEL_DIR.
    children = [path for path in model_dir.iterdir() if path.is_dir()]
    assert len(children) >= 1
    artifact = load_artifact(children[0].name, settings=settings)
    assert artifact.model_name == response.selected_model
    assert "mae" in (artifact.metrics or {})
    assert "wape" in (artifact.metrics or {})
    if artifact.model_name == "random_forest":
        assert (children[0] / "model.joblib").is_file()
        estimator = load_estimator(artifact.model_id, settings=settings, artifact=artifact)
        preds = forecast_ml(estimator, dates, values, 3)
        assert len(preds) == 3
