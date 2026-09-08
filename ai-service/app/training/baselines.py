"""Simple baseline forecasting models."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from app.errors import unsupported_model


BASELINE_NAMES = (
    "historical_average",
    "moving_average",
    "seasonal_naive",
)

DEFAULT_WINDOW = 7
DEFAULT_SEASON = 7


@dataclass(frozen=True, slots=True)
class BaselineSpec:
    name: str
    window: int = DEFAULT_WINDOW
    season: int = DEFAULT_SEASON


def is_baseline(name: str) -> bool:
    return name in BASELINE_NAMES


def forecast_baseline(
    values: list[float],
    horizon: int,
    *,
    model_name: str = "moving_average",
    window: int = DEFAULT_WINDOW,
    season: int = DEFAULT_SEASON,
) -> list[float]:
    if horizon <= 0:
        return []
    if not values:
        return [0.0] * horizon

    predictors: dict[str, Callable[[list[float], int], list[float]]] = {
        "historical_average": _historical_average,
        "moving_average": lambda series, steps: _moving_average(series, steps, window=window),
        "seasonal_naive": lambda series, steps: _seasonal_naive(series, steps, season=season),
    }
    predictor = predictors.get(model_name)
    if predictor is None:
        raise unsupported_model(model_name)
    return predictor(values, horizon)


def _historical_average(values: list[float], horizon: int) -> list[float]:
    mean_value = float(np.mean(np.asarray(values, dtype=float)))
    return [mean_value] * horizon


def _moving_average(values: list[float], horizon: int, *, window: int) -> list[float]:
    series = [float(v) for v in values]
    width = max(1, min(window, len(series)))
    predictions: list[float] = []
    working = list(series)
    for _ in range(horizon):
        recent = working[-width:]
        next_value = float(np.mean(np.asarray(recent, dtype=float)))
        predictions.append(next_value)
        working.append(next_value)
    return predictions


def _seasonal_naive(values: list[float], horizon: int, *, season: int) -> list[float]:
    series = [float(v) for v in values]
    period = max(1, season)
    if len(series) < period:
        # Fall back to last observed value when seasonality cannot be estimated.
        last = series[-1] if series else 0.0
        return [last] * horizon

    predictions: list[float] = []
    working = list(series)
    for _ in range(horizon):
        next_value = working[-period]
        predictions.append(float(next_value))
        working.append(float(next_value))
    return predictions


def one_step_insample_predictions(
    values: list[float],
    *,
    model_name: str,
    window: int = DEFAULT_WINDOW,
    season: int = DEFAULT_SEASON,
    min_fit: int = 7,
) -> tuple[list[float], list[float]]:
    """Walk-forward one-step predictions for time-aware baseline evaluation."""
    series = [float(v) for v in values]
    if len(series) <= min_fit:
        return [], []

    actuals: list[float] = []
    preds: list[float] = []
    for idx in range(min_fit, len(series)):
        history = series[:idx]
        forecast = forecast_baseline(
            history,
            1,
            model_name=model_name,
            window=window,
            season=season,
        )
        actuals.append(series[idx])
        preds.append(forecast[0] if forecast else 0.0)
    return actuals, preds
