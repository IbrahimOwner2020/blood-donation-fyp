"""Tree-based ML candidates: RandomForest and HistGradientBoosting."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal, cast

import numpy as np
import pandas as pd
from sklearn.base import RegressorMixin
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor

from app.errors import unsupported_model
from app.evaluation.metrics import compute_metrics
from app.features.lag_rolling import (
    FEATURE_COLUMNS,
    MIN_HISTORY_FOR_FEATURES,
    build_feature_frame,
    feature_matrix,
    latest_feature_row,
)
from app.schemas import Metrics


MLModelName = Literal["random_forest", "hist_gradient_boosting"]

ML_MODEL_NAMES: tuple[MLModelName, ...] = (
    "random_forest",
    "hist_gradient_boosting",
)

# Keep estimators modest so training/walk-forward stay fast in CI.
_RF_PARAMS: dict[str, int | float | None] = {
    "n_estimators": 64,
    "max_depth": 8,
    "min_samples_leaf": 2,
    "random_state": 42,
    "n_jobs": 1,
}

_HGB_PARAMS: dict[str, int | float | None] = {
    "max_iter": 80,
    "max_depth": 6,
    "learning_rate": 0.08,
    "random_state": 42,
}


@dataclass(frozen=True, slots=True)
class TrainedMlModel:
    model_name: MLModelName
    estimator: RegressorMixin
    features: tuple[str, ...]
    metrics: Metrics
    params: dict[str, int | float | str | None]
    n_observations: int


def is_ml_model(name: str) -> bool:
    return name in ML_MODEL_NAMES


def make_estimator(model_name: str) -> RegressorMixin:
    if model_name == "random_forest":
        return RandomForestRegressor(**_RF_PARAMS)
    if model_name == "hist_gradient_boosting":
        return HistGradientBoostingRegressor(**_HGB_PARAMS)
    raise unsupported_model(model_name)


def train_ml_model(
    dates: list[date],
    values: list[float],
    *,
    model_name: str,
    min_walk_forward_train: int = 10,
) -> TrainedMlModel:
    """Fit an ML candidate and score it with time-aware walk-forward MAE/RMSE/WAPE."""
    if not is_ml_model(model_name):
        raise unsupported_model(model_name)

    featured = build_feature_frame(dates, values, dropna=True)
    if len(featured) < min_walk_forward_train + 1:
        raise ValueError(
            "Not enough rows after lag/rolling feature construction "
            f"for model '{model_name}'."
        )

    actuals, preds = walk_forward_predictions(
        featured,
        model_name=model_name,
        min_train=min_walk_forward_train,
    )
    metrics = (
        compute_metrics(actuals, preds)
        if actuals
        else Metrics(mae=None, rmse=None, wape=None)
    )

    x, y = feature_matrix(featured)
    estimator = make_estimator(model_name)
    estimator.fit(x, y)

    params: dict[str, int | float | str | None]
    if model_name == "random_forest":
        params = {key: value for key, value in _RF_PARAMS.items()}
    else:
        params = {key: value for key, value in _HGB_PARAMS.items()}
    params["n_observations"] = int(len(values))
    params["feature_rows"] = int(len(featured))

    return TrainedMlModel(
        model_name=cast(MLModelName, model_name),
        estimator=estimator,
        features=FEATURE_COLUMNS,
        metrics=metrics,
        params=params,
        n_observations=len(values),
    )


def walk_forward_predictions(
    featured: pd.DataFrame,
    *,
    model_name: str,
    min_train: int = 10,
) -> tuple[list[float], list[float]]:
    """Expanding-window one-step predictions (no random shuffle)."""
    rows = int(len(featured))
    if rows <= min_train:
        return [], []

    actuals: list[float] = []
    preds: list[float] = []
    feature_cols = list(FEATURE_COLUMNS)

    for idx in range(min_train, rows):
        train = featured.iloc[:idx]
        test_row = featured.iloc[idx]
        x_train = train.loc[:, feature_cols].to_numpy(dtype=float)
        y_train = train.loc[:, "demand_units"].to_numpy(dtype=float)
        estimator = make_estimator(model_name)
        estimator.fit(x_train, y_train)
        x_test = test_row.loc[feature_cols].to_numpy(dtype=float).reshape(1, -1)
        prediction = float(estimator.predict(x_test)[0])
        actuals.append(float(test_row["demand_units"]))
        preds.append(prediction)
    return actuals, preds


def forecast_ml(
    estimator: RegressorMixin,
    dates: list[date],
    values: list[float],
    horizon: int,
) -> list[float]:
    """Recursive multi-step forecast using lag/rolling features."""
    if horizon <= 0:
        return []
    if len(values) < MIN_HISTORY_FOR_FEATURES:
        raise ValueError(
            f"At least {MIN_HISTORY_FOR_FEATURES} history points are required "
            "for ML forecasting."
        )

    working_dates = list(dates)
    working_values = [float(v) for v in values]
    predictions: list[float] = []

    for _ in range(horizon):
        next_date = working_dates[-1] + timedelta(days=1)
        features = latest_feature_row(
            working_dates,
            working_values,
            next_date=next_date,
        )
        predicted = float(estimator.predict(features.reshape(1, -1))[0])
        # Demand cannot be negative in this domain.
        predicted = max(0.0, predicted)
        predictions.append(predicted)
        working_dates.append(next_date)
        working_values.append(predicted)

    return predictions


def evaluate_ml_candidate(
    dates: list[date],
    values: list[float],
    *,
    model_name: str,
) -> Metrics:
    """Score a candidate without persisting a fitted artifact."""
    featured = build_feature_frame(dates, values, dropna=True)
    if len(featured) < 11:
        mean_actual = float(np.mean(np.asarray(values, dtype=float))) if values else 0.0
        return compute_metrics([mean_actual], [mean_actual])
    actuals, preds = walk_forward_predictions(
        featured,
        model_name=model_name,
        min_train=10,
    )
    if not actuals:
        mean_actual = float(np.mean(np.asarray(values, dtype=float))) if values else 0.0
        return compute_metrics([mean_actual], [mean_actual])
    return compute_metrics(actuals, preds)
