"""Evaluation metrics for time-series forecasts.

Primary evaluation in this service is time-aware (walk-forward / chronological).
Never shuffle time-series rows when computing the metrics persisted on artifacts.
"""

from __future__ import annotations

import math

import numpy as np

from app.schemas import Metrics


def mae(y_true: list[float], y_pred: list[float]) -> float:
    actual = np.asarray(y_true, dtype=float)
    predicted = np.asarray(y_pred, dtype=float)
    if actual.size == 0:
        return float("nan")
    return float(np.mean(np.abs(actual - predicted)))


def rmse(y_true: list[float], y_pred: list[float]) -> float:
    actual = np.asarray(y_true, dtype=float)
    predicted = np.asarray(y_pred, dtype=float)
    if actual.size == 0:
        return float("nan")
    return float(math.sqrt(float(np.mean((actual - predicted) ** 2))))


def wape(y_true: list[float], y_pred: list[float]) -> float | None:
    actual = np.asarray(y_true, dtype=float)
    predicted = np.asarray(y_pred, dtype=float)
    denom = float(np.sum(np.abs(actual)))
    if denom <= 0.0:
        return None
    return float(np.sum(np.abs(actual - predicted)) / denom)


def compute_metrics(y_true: list[float], y_pred: list[float]) -> Metrics:
    """Compute MAE, RMSE, and WAPE for aligned actual/prediction sequences."""
    if len(y_true) != len(y_pred):
        raise ValueError(
            f"y_true and y_pred length mismatch: {len(y_true)} != {len(y_pred)}"
        )
    return Metrics(
        mae=mae(y_true, y_pred),
        rmse=rmse(y_true, y_pred),
        wape=wape(y_true, y_pred),
    )
